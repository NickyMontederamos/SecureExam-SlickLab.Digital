import type { Role } from "@prisma/client";
import { assertCan, ForbiddenError } from "./rbac";
import { forPlatform, forTenant } from "./tenant-db";
import { hashPassword } from "./password";
import { AUDIT_ACTIONS, logAudit } from "./audit";

export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`Email "${email}" is already in use`);
    this.name = "EmailTakenError";
  }
}

const CREATABLE_ROLES: Role[] = ["INSTITUTION_ADMIN", "FACULTY", "PROCTOR", "STUDENT"];

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
}

/**
 * Institution admins manage their own institution's people — but not
 * SUPER_ADMIN/PLATFORM_ADMIN, which are platform-level and only created
 * via /admin (src/lib/institutions.ts). Refused explicitly here rather
 * than relying solely on rbac.ts, since the "user" resource permission
 * INSTITUTION_ADMIN holds doesn't itself distinguish which roles they may
 * assign.
 */
export async function createUser(institutionId: string, actor: { id?: string; role: Role }, input: CreateUserInput) {
  assertCan(actor.role, "user", "create");
  if (!CREATABLE_ROLES.includes(input.role)) {
    throw new ForbiddenError(actor.role, "user", "create");
  }

  // email is globally unique (not per-institution), so the check must be
  // unscoped — forTenant() would only look inside this institution and
  // miss a collision with a user in another tenant.
  const existing = await forPlatform().user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new EmailTakenError(input.email);
  }

  const passwordHash = await hashPassword(input.password);
  const db = forTenant(institutionId);
  const created = await db.user.create({
    data: { email: input.email, name: input.name, role: input.role, passwordHash } as never,
  });

  // Never log the password or its hash — only the fact of creation and the
  // privilege level granted, which is the part an auditor cares about.
  await logAudit({
    institutionId,
    actorUserId: actor.id ?? null,
    action: AUDIT_ACTIONS.userCreate,
    resourceType: "user",
    resourceId: created.id,
    result: "SUCCESS",
    metadata: { email: created.email, name: created.name, role: created.role },
  });

  return created;
}

export async function listUsers(institutionId: string, actor: { role: Role }) {
  assertCan(actor.role, "user", "read");
  return forTenant(institutionId).user.findMany({ orderBy: { createdAt: "desc" } });
}

/**
 * Deactivating stamps `sessionsValidAfter`, which cuts any session the user
 * already has on its very next request — the periodic revalidation in
 * auth.ts would catch it within ~30s anyway, but deactivation is the lever
 * an institution pulls during an incident, so it must be immediate rather
 * than eventually-consistent (docs/WORLD_CLASS_AUDIT.md A-02).
 *
 * Reactivating clears the cutoff so the account can sign in normally again.
 */
export async function setUserActive(
  institutionId: string,
  actor: { id?: string; role: Role },
  userId: string,
  isActive: boolean
) {
  assertCan(actor.role, "user", "update");
  const db = forTenant(institutionId);
  const updated = await db.user.update({
    where: { id: userId },
    data: { isActive, sessionsValidAfter: isActive ? null : new Date() },
  });

  await logAudit({
    institutionId,
    actorUserId: actor.id ?? null,
    action: isActive ? AUDIT_ACTIONS.userActivate : AUDIT_ACTIONS.userDeactivate,
    resourceType: "user",
    resourceId: userId,
    result: "SUCCESS",
    metadata: { email: updated.email, role: updated.role, sessionsRevoked: !isActive },
  });

  return updated;
}

/**
 * Admin-initiated reset, not a self-service email flow — there's no
 * password-reset-by-email path yet (see DEPLOYMENT.md). This replaces the
 * previous stopgap of editing passwordHash directly via a script.
 */
export async function resetUserPassword(
  institutionId: string,
  actor: { id?: string; role: Role },
  userId: string,
  newPassword: string
) {
  assertCan(actor.role, "user", "update");
  const passwordHash = await hashPassword(newPassword);
  const db = forTenant(institutionId);
  // A password reset must terminate existing sessions. If the reason for
  // the reset is a compromised account, leaving the attacker's already-
  // issued token working would defeat the entire point of resetting it.
  const updated = await db.user.update({
    where: { id: userId },
    data: { passwordHash, sessionsValidAfter: new Date() },
  });

  // Records that a reset happened and by whom — never the password itself,
  // in any form.
  await logAudit({
    institutionId,
    actorUserId: actor.id ?? null,
    action: AUDIT_ACTIONS.userPasswordReset,
    resourceType: "user",
    resourceId: userId,
    result: "SUCCESS",
    metadata: { email: updated.email, role: updated.role, sessionsRevoked: true },
  });
}
