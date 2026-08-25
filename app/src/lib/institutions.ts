import type { Role } from "@prisma/client";
import { ForbiddenError } from "./rbac";
import { forPlatform } from "./tenant-db";
import { hashPassword } from "./password";

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`Institution slug "${slug}" is already taken`);
    this.name = "SlugTakenError";
  }
}

export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`Email "${email}" is already in use`);
    this.name = "EmailTakenError";
  }
}

/**
 * Cross-tenant institution management is platform-level, not a normal
 * tenant-scoped RBAC check — rbac.ts's `institution: ["read","update"]`
 * grant for INSTITUTION_ADMIN is for a *different*, not-yet-built operation
 * (an admin managing their own institution's settings), and must not be
 * reused here or an institution admin could list/create other tenants.
 * Only SUPER_ADMIN and PLATFORM_ADMIN reach this code.
 */
function assertPlatformRole(role: Role, action: "create" | "read"): void {
  if (role !== "SUPER_ADMIN" && role !== "PLATFORM_ADMIN") {
    throw new ForbiddenError(role, "institution", action);
  }
}

export interface CreateInstitutionInput {
  name: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

/** Creates an institution and its first INSTITUTION_ADMIN atomically — an institution with no admin user is unusable. */
export async function createInstitution(actor: { role: Role }, input: CreateInstitutionInput) {
  assertPlatformRole(actor.role, "create");

  const db = forPlatform();

  const existingSlug = await db.institution.findUnique({ where: { slug: input.slug } });
  if (existingSlug) {
    throw new SlugTakenError(input.slug);
  }

  const existingEmail = await db.user.findUnique({ where: { email: input.adminEmail } });
  if (existingEmail) {
    throw new EmailTakenError(input.adminEmail);
  }

  const passwordHash = await hashPassword(input.adminPassword);

  return db.$transaction(async (tx) => {
    const institution = await tx.institution.create({
      data: { name: input.name, slug: input.slug },
    });

    const admin = await tx.user.create({
      data: {
        institutionId: institution.id,
        email: input.adminEmail,
        name: input.adminName,
        role: "INSTITUTION_ADMIN",
        passwordHash,
      },
    });

    return { institution, admin };
  });
}

export async function listInstitutions(actor: { role: Role }) {
  assertPlatformRole(actor.role, "read");
  return forPlatform().institution.findMany({ orderBy: { createdAt: "desc" } });
}
