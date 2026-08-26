import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import type { Role } from "@prisma/client";
import { assertCan } from "./rbac";
import { forPlatform, forTenant } from "./tenant-db";
import { CourseNotFoundError } from "./courses";
import { generateTempPassword, hashPassword } from "./password";

type RosterRole = "FACULTY" | "STUDENT";
const ROSTER_ROLES: RosterRole[] = ["FACULTY", "STUDENT"];

export interface ParsedRosterRow {
  /** 1-indexed against the CSV file including the header, so row 2 is the first data row — matches what a spreadsheet program shows. */
  row: number;
  email: string;
  role: RosterRole;
  /** Optional — only used if this row ends up creating a new account. Falls back to a name derived from the email's local part. */
  name?: string;
}

export interface RowError {
  row: number;
  message: string;
}

export interface RosterParseResult {
  rows: ParsedRosterRow[];
  errors: RowError[];
}

/**
 * Pure parsing/validation of the CSV's shape only — no database access, so
 * it's cheap to unit test exhaustively. Whether each email resolves to an
 * existing account, a role conflict, or a new account to create is checked
 * separately in `importRosterFromCsv`, since that needs the tenant DB.
 */
export function parseRosterCsv(csvText: string): RosterParseResult {
  const errors: RowError[] = [];
  let records: Record<string, string>[];

  try {
    records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return { rows: [], errors: [{ row: 0, message: `Could not parse CSV: ${(err as Error).message}` }] };
  }

  const rows: ParsedRosterRow[] = [];
  const seen = new Set<string>();

  records.forEach((record, index) => {
    const rowNumber = index + 2; // header is row 1
    const email = (record.email ?? "").trim().toLowerCase();
    const roleRaw = (record.role ?? "").trim().toUpperCase();
    const name = (record.name ?? "").trim() || undefined;

    if (!email || !email.includes("@")) {
      errors.push({ row: rowNumber, message: `Missing or invalid email "${record.email ?? ""}"` });
      return;
    }
    if (!ROSTER_ROLES.includes(roleRaw as RosterRole)) {
      errors.push({ row: rowNumber, message: `Invalid role "${record.role ?? ""}" — must be FACULTY or STUDENT` });
      return;
    }

    const key = `${roleRaw}:${email}`;
    if (seen.has(key)) {
      errors.push({ row: rowNumber, message: `Duplicate row for ${email} as ${roleRaw}` });
      return;
    }
    seen.add(key);

    rows.push({ row: rowNumber, email, role: roleRaw as RosterRole, name });
  });

  return { rows, errors };
}

export class RosterImportValidationError extends Error {
  constructor(public readonly errors: RowError[]) {
    super(`CSV has ${errors.length} invalid row(s) — nothing was imported`);
    this.name = "RosterImportValidationError";
  }
}

/** "tatum.davis" -> "Tatum Davis" — used when a row creates a new account and the CSV has no `name` column. */
function deriveNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

export interface CreatedAccount {
  email: string;
  name: string;
  role: RosterRole;
  tempPassword: string;
}

/**
 * One-time, in-process stash for freshly generated temp passwords —
 * plaintext is never written to the database or a log, only handed back to
 * the admin exactly once via `consumeCreatedCredentials`. This is process-
 * local memory (fine for this project's single-instance Phase 1 scope, see
 * docs/DEPLOYMENT.md) rather than a real secrets store; a multi-instance
 * deployment would need this moved to shared storage with the same
 * read-once contract.
 */
const CREDENTIAL_TTL_MS = 10 * 60 * 1000;
const credentialStash = new Map<string, { accounts: CreatedAccount[]; expiresAt: number }>();

function stashCreatedCredentials(accounts: CreatedAccount[]): string {
  const token = randomUUID();
  credentialStash.set(token, { accounts, expiresAt: Date.now() + CREDENTIAL_TTL_MS });
  return token;
}

/** Reads and immediately deletes the stash entry — a page refresh (or a second admin) never sees it twice. Returns null once consumed, expired, or unknown. */
export function consumeCreatedCredentials(token: string): CreatedAccount[] | null {
  const entry = credentialStash.get(token);
  credentialStash.delete(token);
  if (!entry || entry.expiresAt < Date.now()) {
    return null;
  }
  return entry.accounts;
}

export interface RosterImportResult {
  facultyAssigned: number;
  studentsEnrolled: number;
  accountsCreated: number;
  /** Pass to `consumeCreatedCredentials` to display the new accounts' temp passwords once. Null if nothing was created. */
  credentialsToken: string | null;
}

/**
 * Bulk faculty-assign / student-enroll from a CSV of `email,role[,name]`
 * rows. An email that already has an account of the matching role is just
 * attached to the course. An email with no account anywhere is created —
 * with a generated temp password (never role-guessed or auto-emailed, see
 * `consumeCreatedCredentials`) — then attached. An email that already
 * exists under a *different* role, or in a different institution, is a row
 * error: roster CSV never changes an existing account's role or tenant.
 *
 * All-or-nothing, same reasoning as `importQuestionsFromCsv`: every row is
 * validated (CSV shape, then account resolution) before anything is
 * written, so a bad file never leaves a half-applied roster or an
 * orphaned account.
 */
export async function importRosterFromCsv(
  institutionId: string,
  actor: { role: Role },
  courseId: string,
  csvText: string
): Promise<RosterImportResult> {
  assertCan(actor.role, "course", "update");
  assertCan(actor.role, "user", "create"); // this action can create accounts, not just assign existing ones

  const db = forTenant(institutionId);
  const course = await db.course.findFirst({ where: { id: courseId } });
  if (!course) {
    throw new CourseNotFoundError(courseId);
  }

  const { rows, errors: syntaxErrors } = parseRosterCsv(csvText);

  type Resolved =
    | { kind: "existing"; userId: string; role: RosterRole }
    | { kind: "new"; email: string; name: string; role: RosterRole };

  const resolved: Resolved[] = [];
  const lookupErrors: RowError[] = [];

  // Global lookup (not tenant-scoped) — email is unique across the whole
  // platform, so an email registered to another institution must be
  // refused, not silently reused or duplicated (same reasoning as
  // createUser's EmailTakenError check in users.ts).
  const platform = forPlatform();
  for (const row of rows) {
    const existing = await platform.user.findUnique({ where: { email: row.email } });
    if (!existing) {
      resolved.push({ kind: "new", email: row.email, name: row.name ?? deriveNameFromEmail(row.email), role: row.role });
      continue;
    }
    if (existing.institutionId !== institutionId) {
      lookupErrors.push({ row: row.row, message: `${row.email} is already registered to a different institution` });
      continue;
    }
    if (existing.role !== row.role) {
      lookupErrors.push({
        row: row.row,
        message: `${row.email} already exists as ${existing.role} — roster CSV can't change an existing account's role`,
      });
      continue;
    }
    resolved.push({ kind: "existing", userId: existing.id, role: row.role });
  }

  const errors = [...syntaxErrors, ...lookupErrors].sort((a, b) => a.row - b.row);
  if (errors.length > 0) {
    throw new RosterImportValidationError(errors);
  }

  // Passwords are generated/hashed before the transaction — bcrypt is slow
  // by design and shouldn't run while holding a DB transaction open.
  const toCreate = resolved.filter((r): r is Resolved & { kind: "new" } => r.kind === "new");
  const plans = await Promise.all(
    toCreate.map(async (r) => {
      const tempPassword = generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);
      return { ...r, tempPassword, passwordHash };
    })
  );
  const planByEmail = new Map(plans.map((p) => [p.email, p]));

  let facultyAssigned = 0;
  let studentsEnrolled = 0;
  const created: CreatedAccount[] = [];

  await db.$transaction(async (tx) => {
    for (const entry of resolved) {
      let userId: string;
      if (entry.kind === "existing") {
        userId = entry.userId;
      } else {
        const plan = planByEmail.get(entry.email);
        if (!plan) {
          continue; // unreachable — every "new" entry has a matching plan
        }
        const user = await tx.user.create({
          data: { email: entry.email, name: entry.name, role: entry.role, passwordHash: plan.passwordHash } as never,
        });
        userId = user.id;
        created.push({ email: entry.email, name: entry.name, role: entry.role, tempPassword: plan.tempPassword });
      }

      if (entry.role === "FACULTY") {
        await tx.courseFaculty.upsert({
          where: { courseId_userId: { courseId, userId } },
          update: {},
          create: { courseId, userId } as never,
        });
        facultyAssigned++;
      } else {
        await tx.enrollment.upsert({
          where: { courseId_userId: { courseId, userId } },
          update: {},
          create: { courseId, userId } as never,
        });
        studentsEnrolled++;
      }
    }
  });

  return {
    facultyAssigned,
    studentsEnrolled,
    accountsCreated: created.length,
    credentialsToken: created.length > 0 ? stashCreatedCredentials(created) : null,
  };
}
