import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../rbac";
import { forPlatform } from "../tenant-db";
import { createQuestion } from "../questions";
import {
  addExamQuestion,
  addExamQuestions,
  createExam,
  deleteExam,
  EmptyExamError,
  ExamNotEditableError,
  ExamNotFoundError,
  ExamQuestionNotFoundError,
  getExam,
  listExamsForCourse,
  publishExam,
  QuestionNotFoundError,
  removeExamQuestion,
  updateExam,
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

  it("bulk-adds several bank questions to an exam in one call", async () => {
    const { exam } = await createExam(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, title: "Bulk Add Exam", timeLimitMinutes: 60 }
    );
    const { question: q1 } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "SHORT_ANSWER", prompt: "Bulk question 1", points: 3 }
    );
    const { question: q2 } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "SHORT_ANSWER", prompt: "Bulk question 2", points: 4 }
    );

    const attached = await addExamQuestions(institutionA.id, { role: "FACULTY" }, exam.id, [q1.id, q2.id]);
    expect(attached).toHaveLength(2);
    expect(attached.map((eq) => eq.order).sort()).toEqual([0, 1]);
    expect(attached.map((eq) => eq.points).sort()).toEqual([3, 4]); // took each question's own default points

    const fetched = await getExam(institutionA.id, { role: "FACULTY" }, exam.id);
    expect(fetched.versions[0].examQuestions).toHaveLength(2);
  });

  it("bulk-add refuses and attaches nothing if one question id doesn't belong to this tenant", async () => {
    const { exam } = await createExam(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, title: "Bulk Add Refusal", timeLimitMinutes: 60 }
    );
    const { question: q1 } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "SHORT_ANSWER", prompt: "Bulk question 3", points: 1 }
    );

    await expect(
      addExamQuestions(institutionA.id, { role: "FACULTY" }, exam.id, [q1.id, "does-not-exist"])
    ).rejects.toThrow(QuestionNotFoundError);

    const fetched = await getExam(institutionA.id, { role: "FACULTY" }, exam.id);
    expect(fetched.versions[0].examQuestions).toHaveLength(0);
  });

  it("cannot see or touch another tenant's exam", async () => {
    await expect(getExam(institutionA.id, { role: "FACULTY" }, examB.id)).rejects.toThrow(ExamNotFoundError);
  });

  it("refuses exam creation for a role without permission", async () => {
    await expect(
      createExam(institutionA.id, { id: facultyA.id, role: "STUDENT" }, { courseId: courseA.id, title: "Nope", timeLimitMinutes: 30 })
    ).rejects.toThrow(ForbiddenError);
  });

  it("edits a draft exam's title and time limit, but refuses once published", async () => {
    const { exam } = await createExam(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, title: "Original Title", timeLimitMinutes: 30 }
    );

    const updated = await updateExam(institutionA.id, { role: "FACULTY" }, exam.id, {
      title: "Renamed Title",
      timeLimitMinutes: 45,
    });
    expect(updated.title).toBe("Renamed Title");

    const fetched = await getExam(institutionA.id, { role: "FACULTY" }, exam.id);
    expect(fetched.versions[0].timeLimitMinutes).toBe(45);

    const { question } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "SHORT_ANSWER", prompt: "Edit-then-publish question", points: 1 }
    );
    await addExamQuestion(institutionA.id, { role: "FACULTY" }, { examId: exam.id, questionId: question.id, points: 1 });
    await publishExam(institutionA.id, { role: "FACULTY" }, exam.id);

    await expect(
      updateExam(institutionA.id, { role: "FACULTY" }, exam.id, { title: "Too Late", timeLimitMinutes: 60 })
    ).rejects.toThrow(ExamNotEditableError);
  });

  it("removes a question from a draft exam and renumbers the rest, but refuses once published", async () => {
    const { exam } = await createExam(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, title: "Remove Question Exam", timeLimitMinutes: 60 }
    );
    const { question: q1 } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "SHORT_ANSWER", prompt: "Keep me", points: 1 }
    );
    const { question: q2 } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "SHORT_ANSWER", prompt: "Remove me", points: 1 }
    );
    const { question: q3 } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "SHORT_ANSWER", prompt: "Keep me too", points: 1 }
    );

    const eq1 = await addExamQuestion(institutionA.id, { role: "FACULTY" }, { examId: exam.id, questionId: q1.id, points: 1 });
    const eq2 = await addExamQuestion(institutionA.id, { role: "FACULTY" }, { examId: exam.id, questionId: q2.id, points: 1 });
    const eq3 = await addExamQuestion(institutionA.id, { role: "FACULTY" }, { examId: exam.id, questionId: q3.id, points: 1 });
    expect([eq1.order, eq2.order, eq3.order]).toEqual([0, 1, 2]);

    await removeExamQuestion(institutionA.id, { role: "FACULTY" }, exam.id, eq2.id);

    const fetched = await getExam(institutionA.id, { role: "FACULTY" }, exam.id);
    const remaining = fetched.versions[0].examQuestions;
    expect(remaining).toHaveLength(2);
    // No gap left behind — the second surviving question renumbers down to order 1.
    expect(remaining.map((eq) => eq.order).sort()).toEqual([0, 1]);
    expect(remaining.some((eq) => eq.id === eq2.id)).toBe(false);

    await publishExam(institutionA.id, { role: "FACULTY" }, exam.id);
    await expect(
      removeExamQuestion(institutionA.id, { role: "FACULTY" }, exam.id, eq1.id)
    ).rejects.toThrow(ExamNotEditableError);
  });

  it("refuses to remove a question id that isn't on the exam", async () => {
    const { exam } = await createExam(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, title: "Bogus Remove Exam", timeLimitMinutes: 60 }
    );
    await expect(
      removeExamQuestion(institutionA.id, { role: "FACULTY" }, exam.id, "not-a-real-exam-question-id")
    ).rejects.toThrow(ExamQuestionNotFoundError);
  });

  it("deletes a draft exam outright, but refuses once published", async () => {
    const { exam } = await createExam(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, title: "Delete Me Draft", timeLimitMinutes: 60 }
    );
    await deleteExam(institutionA.id, { role: "FACULTY" }, exam.id);
    await expect(getExam(institutionA.id, { role: "FACULTY" }, exam.id)).rejects.toThrow(ExamNotFoundError);

    const { exam: publishedExam } = await createExam(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, title: "Delete Me Published", timeLimitMinutes: 60 }
    );
    const { question } = await createQuestion(
      institutionA.id,
      { id: facultyA.id, role: "FACULTY" },
      { courseId: courseA.id, type: "SHORT_ANSWER", prompt: "Blocks deletion", points: 1 }
    );
    await addExamQuestion(institutionA.id, { role: "FACULTY" }, { examId: publishedExam.id, questionId: question.id, points: 1 });
    await publishExam(institutionA.id, { role: "FACULTY" }, publishedExam.id);

    await expect(deleteExam(institutionA.id, { role: "FACULTY" }, publishedExam.id)).rejects.toThrow(ExamNotEditableError);
  });
});
