import type { Role } from "@prisma/client";
import { assertCan, ForbiddenError } from "./rbac";
import { forPlatform, forTenant } from "./tenant-db";
import { hashPassword } from "./password";

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
export async function createUser(institutionId: string, actor: { role: Role }, input: CreateUserInput) {
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
  return db.user.create({
    data: { email: input.email, name: input.name, role: input.role, passwordHash } as never,
  });
}

export async function listUsers(institutionId: string, actor: { role: Role }) {
  assertCan(actor.role, "user", "read");
  return forTenant(institutionId).user.findMany({ orderBy: { createdAt: "desc" } });
}

export async function setUserActive(institutionId: string, actor: { role: Role }, userId: string, isActive: boolean) {
  assertCan(actor.role, "user", "update");
  const db = forTenant(institutionId);
  return db.user.update({ where: { id: userId }, data: { isActive } });
}

/**
 * Admin-initiated reset, not a self-service email flow — there's no
 * password-reset-by-email path yet (see DEPLOYMENT.md). This replaces the
 * previous stopgap of editing passwordHash directly via a script.
 */
export async function resetUserPassword(institutionId: string, actor: { role: Role }, userId: string, newPassword: string) {
  assertCan(actor.role, "user", "update");
  const passwordHash = await hashPassword(newPassword);
  const db = forTenant(institutionId);
  await db.user.update({ where: { id: userId }, data: { passwordHash } });
}
