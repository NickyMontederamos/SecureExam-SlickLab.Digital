import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CourseAccessDeniedError } from "../courses";
import { ForbiddenError } from "../rbac";
import { forPlatform } from "../tenant-db";
import { addExamQuestion, createExam } from "../exams";
import {
  CourseNotFoundError,
  createQuestion,
  deleteQuestion,
  listQuestionsForCourse,
  QuestionInUseError,
  QuestionNotFoundError,
  updateQuestion,
} from "../questions";

describe("question bank (createQuestion / listQuestionsForCourse)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let institutionB: { id: string };
  let courseA: { id: string };
  let courseB: { id: string };
  let facultyA: { id: string };
  let unassignedFaculty: { id: string };

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Tenant A ${runId}`, slug: `q-tenant-a-${runId}` },
    });
    institutionB = await platform.institution.create({
      data: { name: `Tenant B ${runId}`, slug: `q-tenant-b-${runId}` },
    });
    courseA = await platform.course.create({
      data: { institutionId: institutionA.id, code: "LAW201", name: "Evidence", academicYear: "2026-2027" },
    });
    courseB = await platform.course.create({
      data: { institutionId: institutionB.id, code: "LAW201", name: "Evidence (B)", academicYear: "2026-2027" },
    });
    facultyA = await platform.user.create({
      data: {
        institutionId: institutionA.id,
        email: `faculty-${runId}@test.local`,
        name: "Faculty A",
        role: "FACULTY",
        passwordHash: "not-a-real-hash",
      },
    });
    await platform.courseFaculty.create({
      data: { institutionId: institutionA.id, courseId: courseA.id, userId: facultyA.id },
    });
    // Same institution, deliberately never assigned to courseA.
    unassignedFaculty = await platform.user.create({
      data: {
        institutionId: institutionA.id,
        email: `unassigned-faculty-${runId}@test.local`,
        name: "Unassigned Faculty",
        role: "FACULTY",
        passwordHash: "not-a-real-hash",
      },
    });
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.examQuestion.deleteMany({ where: { examVersion: { exam: { institutionId: institutionA.id } } } });
    await platform.examVersion.deleteMany({ where: { exam: { institutionId: institutionA.id } } });
    await platform.exam.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.questionVersion.deleteMany({ where: { question: { institutionId: institutionA.id } } });
    await platform.question.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.courseFaculty.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.user.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.course.deleteMany({ where: { institutionId: { in: [institutionA.id, institutionB.id] } } });
    await platform.institution.deleteMany({ where: { id: { in: [institutionA.id, institutionB.id] } } });
  });

  it("creates a question with its first version atomically", async () => {
    const { question, version } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      {
        courseId: courseA.id,
        type: "MULTIPLE_CHOICE",
        prompt: "What is consideration in contract law?",
        choices: [{ id: "a", text: "A benefit or detriment bargained for" }, { id: "b", text: "A type of court" }],
        correctAnswer: { choiceId: "a" },
        points: 1,
      }
    );

    expect(question.institutionId).toBe(institutionA.id);
    expect(question.courseId).toBe(courseA.id);
    expect(version.versionNumber).toBe(1);
    expect(version.questionId).toBe(question.id);
  });

  it("lists questions for a course including their latest version", async () => {
    const questions = await listQuestionsForCourse(institutionA.id, { id: facultyA.id, role: "FACULTY" }, courseA.id);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0].versions[0].prompt).toContain("consideration");
  });

  it("refuses to attach a question to another tenant's course", async () => {
    await expect(
      createQuestion(
        institutionA.id,
        { id: facultyA.id, role: "FACULTY" },
        {
          courseId: courseB.id, // belongs to institution B
          type: "TRUE_FALSE",
          prompt: "Should never be created",
          points: 1,
        }
      )
    ).rejects.toThrow(CourseNotFoundError);
  });

  it("refuses creation for a role without question:create permission", async () => {
    await expect(
      createQuestion(
        institutionA.id,
        { id: facultyA.id, role: "STUDENT" },
        {
          courseId: courseA.id,
          type: "TRUE_FALSE",
          prompt: "Should never be created either",
          points: 1,
        }
      )
    ).rejects.toThrow(ForbiddenError);
  });

  it("edits an unused question's prompt/points in place, but refuses once it's attached to an exam", async () => {
    const { question } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "SHORT_ANSWER", prompt: "Original prompt", points: 1 }
    );

    const updated = await updateQuestion(institutionA.id, { id: facultyA.id, role: "FACULTY" }, question.id, {
      prompt: "Edited prompt",
      points: 3,
    });
    expect(updated.prompt).toBe("Edited prompt");
    expect(updated.points).toBe(3);

    const { exam } = await createExam(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, title: "Locks The Question", timeLimitMinutes: 30 }
    );
    await addExamQuestion(institutionA.id, { id: facultyA.id, role: "FACULTY" }, { examId: exam.id, questionId: question.id, points: 3 });

    await expect(
      updateQuestion(institutionA.id, { id: facultyA.id, role: "FACULTY" }, question.id, { prompt: "Too late", points: 3 })
    ).rejects.toThrow(QuestionInUseError);
    await expect(deleteQuestion(institutionA.id, { id: facultyA.id, role: "FACULTY" }, question.id)).rejects.toThrow(QuestionInUseError);
  });

  it("deletes an unused question outright", async () => {
    const { question } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "ESSAY", prompt: "Delete me", points: 5 }
    );

    await deleteQuestion(institutionA.id, { id: facultyA.id, role: "FACULTY" }, question.id);

    await expect(
      updateQuestion(institutionA.id, { id: facultyA.id, role: "FACULTY" }, question.id, { prompt: "Gone", points: 1 })
    ).rejects.toThrow(QuestionNotFoundError);
  });

  it("refuses a faculty member who isn't assigned to the course (docs/PITCH_ROADMAP.md Milestone 6.6)", async () => {
    const { question } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "SHORT_ANSWER", prompt: "Not yours to touch", points: 1 }
    );

    await expect(
      listQuestionsForCourse(institutionA.id, { id: unassignedFaculty.id, role: "FACULTY" }, courseA.id)
    ).rejects.toThrow(CourseAccessDeniedError);
    await expect(
      createQuestion(institutionA.id, { id: unassignedFaculty.id, role: "FACULTY" }, { courseId: courseA.id, type: "TRUE_FALSE", prompt: "Nope", points: 1 })
    ).rejects.toThrow(CourseAccessDeniedError);
    await expect(
      updateQuestion(institutionA.id, { id: unassignedFaculty.id, role: "FACULTY" }, question.id, { prompt: "Hijacked", points: 1 })
    ).rejects.toThrow(CourseAccessDeniedError);
    await expect(
      deleteQuestion(institutionA.id, { id: unassignedFaculty.id, role: "FACULTY" }, question.id)
    ).rejects.toThrow(CourseAccessDeniedError);
  });
});
