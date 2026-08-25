import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../rbac";
import { forPlatform } from "../tenant-db";
import { createQuestion } from "../questions";
import {
  addExamQuestion,
  createExam,
  EmptyExamError,
  ExamNotEditableError,
  ExamNotFoundError,
  getExam,
  listExamsForCourse,
  publishExam,
} from "../exams";

describe("exam builder (createExam / addExamQuestion / publishExam)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let institutionB: { id: string };
  let courseA: { id: string };
  let examB: { id: string };
  let facultyA: { id: string };

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Tenant A ${runId}`, slug: `exam-tenant-a-${runId}` },
    });
    institutionB = await platform.institution.create({
      data: { name: `Tenant B ${runId}`, slug: `exam-tenant-b-${runId}` },
    });
    courseA = await platform.course.create({
      data: { institutionId: institutionA.id, code: "LAW301", name: "Remedial Law", academicYear: "2026-2027" },
    });
    const courseB = await platform.course.create({
      data: { institutionId: institutionB.id, code: "LAW301", name: "Remedial Law (B)", academicYear: "2026-2027" },
    });
    facultyA = await platform.user.create({
      data: {
        institutionId: institutionA.id,
        email: `exam-faculty-${runId}@test.local`,
        name: "Faculty A",
        role: "FACULTY",
        passwordHash: "not-a-real-hash",
      },
    });

    const examBRecord = await platform.exam.create({
      data: { institutionId: institutionB.id, courseId: courseB.id, title: "Tenant B Exam", status: "DRAFT", createdById: facultyA.id },
    });
    examB = examBRecord;
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.examQuestion.deleteMany({ where: { examVersion: { exam: { institutionId: institutionA.id } } } });
    await platform.examVersion.deleteMany({ where: { exam: { institutionId: { in: [institutionA.id, institutionB.id] } } } });
    await platform.exam.deleteMany({ where: { institutionId: { in: [institutionA.id, institutionB.id] } } });
    await platform.questionVersion.deleteMany({ where: { question: { institutionId: institutionA.id } } });
    await platform.question.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.user.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.course.deleteMany({ where: { institutionId: { in: [institutionA.id, institutionB.id] } } });
    await platform.institution.deleteMany({ where: { id: { in: [institutionA.id, institutionB.id] } } });
  });

  it("creates an exam with a DRAFT status and an active version", async () => {
    const { exam, version } = await createExam(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, title: "Midterm Exam", timeLimitMinutes: 90 }
    );
    expect(exam.status).toBe("DRAFT");
    expect(version.versionNumber).toBe(1);
    expect(version.isActive).toBe(true);
  });

  it("refuses to publish an exam with no questions", async () => {
    const { exam } = await createExam(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, title: "Empty Exam", timeLimitMinutes: 60 }
    );
    await expect(publishExam(institutionA.id, { role: "FACULTY" }, exam.id)).rejects.toThrow(EmptyExamError);
  });

  it("adds a question from the bank, then publishes successfully", async () => {
    const { exam } = await createExam(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, title: "Finals", timeLimitMinutes: 120 }
    );
    const { question } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "TRUE_FALSE", prompt: "Res judicata bars relitigation.", points: 2 }
    );

    const examQuestion = await addExamQuestion(institutionA.id, { role: "FACULTY" }, {
      examId: exam.id,
      questionId: question.id,
      points: 2,
    });
    expect(examQuestion.order).toBe(0);

    const published = await publishExam(institutionA.id, { role: "FACULTY" }, exam.id);
    expect(published.status).toBe("PUBLISHED");

    const fetched = await getExam(institutionA.id, { role: "FACULTY" }, exam.id);
    expect(fetched.versions[0].examQuestions).toHaveLength(1);

    const facultyView = await listExamsForCourse(institutionA.id, { role: "FACULTY" }, courseA.id);
    const studentView = await listExamsForCourse(institutionA.id, { role: "STUDENT" }, courseA.id);
    expect(facultyView.some((e) => e.id === exam.id)).toBe(true);
    expect(studentView.every((e) => e.status === "PUBLISHED")).toBe(true);
    expect(studentView.some((e) => e.id === exam.id)).toBe(true); // this one is published, so students see it
  });

  it("refuses to add a question to an exam once it's published", async () => {
    const { exam } = await createExam(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, title: "Already Published", timeLimitMinutes: 60 }
    );
    const { question } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "SHORT_ANSWER", prompt: "Define grave abuse of discretion.", points: 5 }
    );
    await addExamQuestion(institutionA.id, { role: "FACULTY" }, { examId: exam.id, questionId: question.id, points: 5 });
    await publishExam(institutionA.id, { role: "FACULTY" }, exam.id);

    await expect(
      addExamQuestion(institutionA.id, { role: "FACULTY" }, { examId: exam.id, questionId: question.id, points: 5 })
    ).rejects.toThrow(ExamNotEditableError);
  });

  it("cannot see or touch another tenant's exam", async () => {
    await expect(getExam(institutionA.id, { role: "FACULTY" }, examB.id)).rejects.toThrow(ExamNotFoundError);
  });

  it("refuses exam creation for a role without permission", async () => {
    await expect(
      createExam(institutionA.id, { id: facultyA.id, role: "STUDENT" }, { courseId: courseA.id, title: "Nope", timeLimitMinutes: 30 })
    ).rejects.toThrow(ForbiddenError);
  });
});
