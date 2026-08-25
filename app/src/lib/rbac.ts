import type { Role } from "@prisma/client";

/**
 * Explicit role -> resource -> action permission matrix (master prompt §9).
 * This is consulted server-side only (route handlers / server actions).
 * There is deliberately no client-side equivalent that hides UI based on
 * role — hiding a button is a UX nicety, not authorization, and master
 * prompt §9 is explicit that frontend-only authorization is not allowed.
 */

export type Resource =
  | "institution"
  | "user"
  | "course"
  | "question"
  | "exam"
  | "exam_attempt"
  | "grade"
  | "audit_log";

export type Action = "create" | "read" | "update" | "delete" | "publish" | "grade" | "take";

type PermissionMatrix = Record<Role, Partial<Record<Resource, Action[]>>>;

const PERMISSIONS: PermissionMatrix = {
  SUPER_ADMIN: {
    institution: ["create", "read", "update", "delete"],
    user: ["create", "read", "update", "delete"],
    course: ["create", "read", "update", "delete"],
    question: ["create", "read", "update", "delete"],
    exam: ["create", "read", "update", "delete", "publish"],
    exam_attempt: ["read"],
    grade: ["read", "grade"],
    audit_log: ["read"],
  },
  PLATFORM_ADMIN: {
    institution: ["create", "read", "update"],
    user: ["create", "read", "update"],
    audit_log: ["read"],
  },
  INSTITUTION_ADMIN: {
    institution: ["read", "update"],
    user: ["create", "read", "update", "delete"],
    course: ["create", "read", "update", "delete"],
    question: ["read"],
    exam: ["read", "publish"],
    exam_attempt: ["read"],
    grade: ["read"],
    audit_log: ["read"],
  },
  FACULTY: {
    course: ["read"],
    question: ["create", "read", "update", "delete"],
    exam: ["create", "read", "update", "publish"],
    exam_attempt: ["read"],
    grade: ["read", "grade"],
  },
  PROCTOR: {
    exam_attempt: ["read"],
  },
  STUDENT: {
    course: ["read"],
    exam: ["read"],
    exam_attempt: ["create", "read", "take"],
    grade: ["read"],
  },
};

export function can(role: Role, resource: Resource, action: Action): boolean {
  return PERMISSIONS[role]?.[resource]?.includes(action) ?? false;
}

export class ForbiddenError extends Error {
  constructor(role: Role, resource: Resource, action: Action) {
    super(`Role ${role} is not permitted to ${action} ${resource}`);
    this.name = "ForbiddenError";
  }
}

/** Throws ForbiddenError if the role lacks the permission; call at the top of every handler before touching data. */
export function assertCan(role: Role, resource: Resource, action: Action): void {
  if (!can(role, resource, action)) {
    throw new ForbiddenError(role, resource, action);
  }
}
