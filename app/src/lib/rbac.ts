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

export type Action = "create" | "read" | "update" | "delete" | "publish" | "grade" | "take" | "approve";

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
  // Institution admins get everything FACULTY has (course/exam/grading
  // management) on top of their own admin-only permissions — an admin
  // should never need a separate faculty account just to author an exam or
  // grade a submission. Keep the two lists in sync: any addition to
  // FACULTY's resource actions probably belongs here too.
  INSTITUTION_ADMIN: {
    institution: ["read", "update"],
    user: ["create", "read", "update", "delete"],
    course: ["create", "read", "update", "delete"],
    question: ["create", "read", "update", "delete"],
    exam: ["create", "read", "update", "delete", "publish"],
    // "approve" gives an institution admin the same proctor-queue authority
    // as an actual PROCTOR, institution-wide (not scoped to a CourseProctor
    // assignment — see proctoring.ts's scopedCourseIds). "delete" is new,
    // admin-only destructive power: cancel a stuck/wrong attempt, or force-
    // delete an exam regardless of status (FACULTY's exam:"delete" above is
    // DRAFT-only — see exams.ts's deleteExam).
    exam_attempt: ["read", "approve", "delete"],
    grade: ["read", "grade"],
    audit_log: ["read"],
  },
  FACULTY: {
    course: ["read"],
    question: ["create", "read", "update", "delete"],
    exam: ["create", "read", "update", "delete", "publish"],
    exam_attempt: ["read"],
    grade: ["read", "grade"],
  },
  PROCTOR: {
    course: ["read"],
    exam_attempt: ["read", "approve"],
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
