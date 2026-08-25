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

export class CourseHasContentError extends Error {
  constructor(courseId: string) {
    super(
      `Course ${courseId} has questions or exams and cannot be deleted — those are academic records. Remove its roster if you need to retire it.`
    );
    this.name = "CourseHasContentError";
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

/** Tenant-scoped detail view including who teaches it, who's enrolled, and how much content it has — for the admin's course management page. */
export async function getCourseWithRoster(institutionId: string, actor: { role: Role }, courseId: string) {
  assertCan(actor.role, "course", "read");

  const db = forTenant(institutionId);
  const course = await db.course.findFirst({
    where: { id: courseId },
    include: {
      faculty: { include: { user: true } },
      proctors: { include: { user: true } },
      enrollments: { include: { user: true } },
      _count: { select: { questions: true, exams: true } },
    },
  });
  if (!course) {
    throw new CourseNotFoundError(courseId);
  }
  return course;
}

export interface UpdateCourseInput {
  name?: string;
  academicYear?: string;
}

export async function updateCourse(institutionId: string, actor: { role: Role }, courseId: string, input: UpdateCourseInput) {
  assertCan(actor.role, "course", "update");

  const db = forTenant(institutionId);
  const course = await db.course.findFirst({ where: { id: courseId } });
  if (!course) {
    throw new CourseNotFoundError(courseId);
  }

  return db.course.update({ where: { id: courseId }, data: input });
}

/**
 * Refuses to delete a course that has any questions or exams attached —
 * those are academic records (grades, published exams a student may have
 * already taken) and must never silently disappear. An empty course (the
 * common case: created by mistake, or a test/demo course) can be removed
 * cleanly, roster included.
 */
export async function deleteCourse(institutionId: string, actor: { role: Role }, courseId: string) {
  assertCan(actor.role, "course", "delete");

  const db = forTenant(institutionId);
  const course = await db.course.findFirst({
    where: { id: courseId },
    include: { _count: { select: { questions: true, exams: true } } },
  });
  if (!course) {
    throw new CourseNotFoundError(courseId);
  }
  if (course._count.questions > 0 || course._count.exams > 0) {
    throw new CourseHasContentError(courseId);
  }

  await db.$transaction([
    db.enrollment.deleteMany({ where: { courseId } }),
    db.courseFaculty.deleteMany({ where: { courseId } }),
    db.courseProctor.deleteMany({ where: { courseId } }),
    db.course.delete({ where: { id: courseId } }),
  ]);
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

/** Same shape as assignFaculty — see CourseProctor in schema.prisma for why this is a separate table rather than reusing CourseFaculty. */
export async function assignProctor(institutionId: string, actor: { role: Role }, courseId: string, userId: string) {
  assertCan(actor.role, "course", "update");

  const db = forTenant(institutionId);
  const course = await db.course.findFirst({ where: { id: courseId } });
  if (!course) {
    throw new CourseNotFoundError(courseId);
  }
  const user = await db.user.findFirst({ where: { id: userId, role: "PROCTOR" } });
  if (!user) {
    throw new UserNotFoundError(userId, "PROCTOR");
  }

  return db.courseProctor.upsert({
    where: { courseId_userId: { courseId, userId } },
    update: {},
    create: { courseId, userId } as never,
  });
}

export async function unassignProctor(institutionId: string, actor: { role: Role }, courseId: string, userId: string) {
  assertCan(actor.role, "course", "update");
  const db = forTenant(institutionId);
  await db.courseProctor.deleteMany({ where: { courseId, userId } });
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

export async function unassignFaculty(institutionId: string, actor: { role: Role }, courseId: string, userId: string) {
  assertCan(actor.role, "course", "update");
  const db = forTenant(institutionId);
  await db.courseFaculty.deleteMany({ where: { courseId, userId } });
}

export async function unenrollStudent(institutionId: string, actor: { role: Role }, courseId: string, userId: string) {
  assertCan(actor.role, "course", "update");
  const db = forTenant(institutionId);
  await db.enrollment.deleteMany({ where: { courseId, userId } });
}
