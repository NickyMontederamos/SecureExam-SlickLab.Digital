import type { Role } from "@prisma/client";
import { forTenant } from "./tenant-db";

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
