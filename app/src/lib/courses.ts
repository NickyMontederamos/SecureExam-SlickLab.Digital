import type { Role } from "@prisma/client";
import { assertCan } from "./rbac";
import { forTenant } from "./tenant-db";

export class CourseCodeTakenError extends Error {
  constructor(code: string, academicYear: string) {
    super(`Course code "${code}" is already used for ${academicYear}`);
    this.name = "CourseCodeTakenError";
  }
}

export class CourseNotFoundError extends Error {
  constructor(courseId: string) {
    super(`Course ${courseId} not found in this institution`);
    this.name = "CourseNotFoundError";
  }
}

export class UserNotFoundError extends Error {
  constructor(userId: string, expectedRole: Role) {
    super(`No ${expectedRole} user ${userId} found in this institution`);
    this.name = "UserNotFoundError";
  }
}

/**
 * Role-appropriate course list for the dashboard: students see only what
 * they're enrolled in, faculty see only what they teach, everyone else
 * (institution admin, proctor, ...) sees the whole tenant's courses. This
 * is a UX/relevance filter, not an authorization boundary — tenant scoping
 * already prevents cross-institution leakage regardless of role.
 */
export async function listCoursesForUser(institutionId: string, actor: { id: string; role: Role }) {
  const db = forTenant(institutionId);

  if (actor.role === "STUDENT") {
    const enrollments = await db.enrollment.findMany({
      where: { userId: actor.id },
      include: { course: true },
      orderBy: { course: { code: "asc" } },
    });
    return enrollments.map((e) => e.course);
  }

  if (actor.role === "FACULTY") {
    const taught = await db.courseFaculty.findMany({
      where: { userId: actor.id },
      include: { course: true },
      orderBy: { course: { code: "asc" } },
    });
    return taught.map((cf) => cf.course);
  }

  return db.course.findMany({ orderBy: { code: "asc" } });
}

export interface CreateCourseInput {
  code: string;
  name: string;
  academicYear: string;
}

export async function createCourse(institutionId: string, actor: { role: Role }, input: CreateCourseInput) {
  assertCan(actor.role, "course", "create");

  const db = forTenant(institutionId);
  const existing = await db.course.findFirst({ where: { code: input.code, academicYear: input.academicYear } });
  if (existing) {
    throw new CourseCodeTakenError(input.code, input.academicYear);
  }

  return db.course.create({
    data: { code: input.code, name: input.name, academicYear: input.academicYear } as never,
  });
}

/** Tenant-scoped detail view including who teaches it and who's enrolled — for the admin's course management page. */
export async function getCourseWithRoster(institutionId: string, actor: { role: Role }, courseId: string) {
  assertCan(actor.role, "course", "read");

  const db = forTenant(institutionId);
  const course = await db.course.findFirst({
    where: { id: courseId },
    include: {
      faculty: { include: { user: true } },
      enrollments: { include: { user: true } },
    },
  });
  if (!course) {
    throw new CourseNotFoundError(courseId);
  }
  return course;
}

export async function assignFaculty(institutionId: string, actor: { role: Role }, courseId: string, userId: string) {
  assertCan(actor.role, "course", "update");

  const db = forTenant(institutionId);
  const course = await db.course.findFirst({ where: { id: courseId } });
  if (!course) {
    throw new CourseNotFoundError(courseId);
  }
  const user = await db.user.findFirst({ where: { id: userId, role: "FACULTY" } });
  if (!user) {
    throw new UserNotFoundError(userId, "FACULTY");
  }

  return db.courseFaculty.upsert({
    where: { courseId_userId: { courseId, userId } },
    update: {},
    create: { courseId, userId } as never,
  });
}

export async function enrollStudent(institutionId: string, actor: { role: Role }, courseId: string, userId: string) {
  assertCan(actor.role, "course", "update");

  const db = forTenant(institutionId);
  const course = await db.course.findFirst({ where: { id: courseId } });
  if (!course) {
    throw new CourseNotFoundError(courseId);
  }
  const user = await db.user.findFirst({ where: { id: userId, role: "STUDENT" } });
  if (!user) {
    throw new UserNotFoundError(userId, "STUDENT");
  }

  return db.enrollment.upsert({
    where: { courseId_userId: { courseId, userId } },
    update: {},
    create: { courseId, userId } as never,
  });
}
