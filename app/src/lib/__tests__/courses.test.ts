import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../rbac";
import { forPlatform } from "../tenant-db";
import {
  assignFaculty,
  CourseCodeTakenError,
  CourseHasContentError,
  createCourse,
  deleteCourse,
  enrollStudent,
  getCourseWithRoster,
  unassignFaculty,
  unenrollStudent,
  updateCourse,
  UserNotFoundError,
} from "../courses";

describe("course management (INSTITUTION_ADMIN)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let institutionB: { id: string };
  let facultyA: { id: string };
  let studentA: { id: string };
  let facultyB: { id: string };

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Tenant A ${runId}`, slug: `course-tenant-a-${runId}` },
    });
    institutionB = await platform.institution.create({
      data: { name: `Tenant B ${runId}`, slug: `course-tenant-b-${runId}` },
    });
    facultyA = await platform.user.create({
      data: { institutionId: institutionA.id, email: `course-faculty-${runId}@test.local`, name: "Faculty A", role: "FACULTY", passwordHash: "x" },
    });
    studentA = await platform.user.create({
      data: { institutionId: institutionA.id, email: `course-student-${runId}@test.local`, name: "Student A", role: "STUDENT", passwordHash: "x" },
    });
    facultyB = await platform.user.create({
      data: { institutionId: institutionB.id, email: `course-faculty-b-${runId}@test.local`, name: "Faculty B", role: "FACULTY", passwordHash: "x" },
    });
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.enrollment.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.courseFaculty.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.question.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.course.deleteMany({ where: { institutionId: { in: [institutionA.id, institutionB.id] } } });
    await platform.user.deleteMany({ where: { institutionId: { in: [institutionA.id, institutionB.id] } } });
    await platform.institution.deleteMany({ where: { id: { in: [institutionA.id, institutionB.id] } } });
  });

  it("creates a course", async () => {
    const course = await createCourse(institutionA.id, { role: "INSTITUTION_ADMIN" }, {
      code: "LAW999",
      name: "Test Course",
      academicYear: "2026-2027",
    });
    expect(course.institutionId).toBe(institutionA.id);
  });

  it("refuses a duplicate course code for the same academic year", async () => {
    await expect(
      createCourse(institutionA.id, { role: "INSTITUTION_ADMIN" }, {
        code: "LAW999",
        name: "Duplicate",
        academicYear: "2026-2027",
      })
    ).rejects.toThrow(CourseCodeTakenError);
  });

  it("refuses course creation for roles without permission", async () => {
    await expect(
      createCourse(institutionA.id, { role: "FACULTY" }, { code: "LAW998", name: "Nope", academicYear: "2026-2027" })
    ).rejects.toThrow(ForbiddenError);
  });

  it("assigns faculty and enrolls a student, reflected in the roster", async () => {
    const courses = await forPlatform().course.findMany({ where: { institutionId: institutionA.id, code: "LAW999" } });
    const courseId = courses[0].id;

    await assignFaculty(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseId, facultyA.id);
    await enrollStudent(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseId, studentA.id);

    const roster = await getCourseWithRoster(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseId);
    expect(roster.faculty.some((f) => f.userId === facultyA.id)).toBe(true);
    expect(roster.enrollments.some((e) => e.userId === studentA.id)).toBe(true);
  });

  it("refuses to assign a faculty member from another institution", async () => {
    const courses = await forPlatform().course.findMany({ where: { institutionId: institutionA.id, code: "LAW999" } });
    const courseId = courses[0].id;

    await expect(
      assignFaculty(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseId, facultyB.id)
    ).rejects.toThrow(UserNotFoundError);
  });

  it("updates a course's name and academic year", async () => {
    const courses = await forPlatform().course.findMany({ where: { institutionId: institutionA.id, code: "LAW999" } });
    const courseId = courses[0].id;

    const updated = await updateCourse(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseId, { name: "Renamed Course" });
    expect(updated.name).toBe("Renamed Course");
  });

  it("unassigns faculty and unenrolls a student", async () => {
    const courses = await forPlatform().course.findMany({ where: { institutionId: institutionA.id, code: "LAW999" } });
    const courseId = courses[0].id;

    await unassignFaculty(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseId, facultyA.id);
    await unenrollStudent(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseId, studentA.id);

    const roster = await getCourseWithRoster(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseId);
    expect(roster.faculty.some((f) => f.userId === facultyA.id)).toBe(false);
    expect(roster.enrollments.some((e) => e.userId === studentA.id)).toBe(false);
  });

  it("deletes an empty course", async () => {
    const empty = await createCourse(institutionA.id, { role: "INSTITUTION_ADMIN" }, {
      code: "LAW777",
      name: "Empty Course",
      academicYear: "2026-2027",
    });

    await deleteCourse(institutionA.id, { role: "INSTITUTION_ADMIN" }, empty.id);

    const stillExists = await forPlatform().course.findUnique({ where: { id: empty.id } });
    expect(stillExists).toBeNull();
  });

  it("refuses to delete a course that has a question attached", async () => {
    const courses = await forPlatform().course.findMany({ where: { institutionId: institutionA.id, code: "LAW999" } });
    const courseId = courses[0].id;

    await forPlatform().question.create({
      data: {
        institutionId: institutionA.id,
        courseId,
        type: "SHORT_ANSWER",
        tags: [],
        learningObjectives: [],
        createdById: facultyA.id,
      },
    });

    await expect(deleteCourse(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseId)).rejects.toThrow(
      CourseHasContentError
    );
  });
});
