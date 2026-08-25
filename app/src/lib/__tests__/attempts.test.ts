import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forPlatform } from "../tenant-db";
import { createQuestion } from "../questions";
import { addExamQuestion, createExam, publishExam } from "../exams";
import {
  AttemptAlreadyFinishedError,
  AttemptOwnershipError,
  NotEnrolledError,
  getAttemptForTaking,
  getAttemptResult,
  saveAnswers,
  startAttempt,
  submitAttempt,
} from "../attempts";
import { gradeAnswer, listAttemptsForExam } from "../grading";

describe("exam attempts (start / save / submit / grade)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let courseA: { id: string };
  let faculty: { id: string };
  let studentEnrolled: { id: string };
  let studentUnenrolled: { id: string };
  let examId: string;
  let mcExamQuestionId: string;
  let essayExamQuestionId: string;
  let submittedAttemptId: string;

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Tenant A ${runId}`, slug: `attempt-tenant-a-${runId}` },
    });
    courseA = await platform.course.create({
      data: { institutionId: institutionA.id, code: "LAW401", name: "Civil Procedure", academicYear: "2026-2027" },
    });
    faculty = await platform.user.create({
      data: { institutionId: institutionA.id, email: `attempt-faculty-${runId}@test.local`, name: "Faculty", role: "FACULTY", passwordHash: "x" },
    });
    studentEnrolled = await platform.user.create({
      data: { institutionId: institutionA.id, email: `attempt-student-${runId}@test.local`, name: "Student", role: "STUDENT", passwordHash: "x" },
    });
    studentUnenrolled = await platform.user.create({
      data: { institutionId: institutionA.id, email: `attempt-unenrolled-${runId}@test.local`, name: "Unenrolled", role: "STUDENT", passwordHash: "x" },
    });
    await platform.enrollment.create({ data: { institutionId: institutionA.id, courseId: courseA.id, userId: studentEnrolled.id } });

    const { exam } = await createExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      title: "Attempt Test Exam",
      timeLimitMinutes: 60,
    });
    examId = exam.id;

    const { question: mcQuestion } = await createQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      type: "MULTIPLE_CHOICE",
      prompt: "Pick the correct choice.",
      choices: [{ id: "0", text: "Right" }, { id: "1", text: "Wrong" }],
      correctAnswer: { choiceIds: ["0"] },
      points: 2,
    });
    const mcExamQuestion = await addExamQuestion(institutionA.id, { role: "FACULTY" }, { examId, questionId: mcQuestion.id, points: 2 });
    mcExamQuestionId = mcExamQuestion.id;

    const { question: essayQuestion } = await createQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      type: "ESSAY",
      prompt: "Explain forum shopping.",
      points: 10,
    });
    const essayExamQuestion = await addExamQuestion(institutionA.id, { role: "FACULTY" }, { examId, questionId: essayQuestion.id, points: 10 });
    essayExamQuestionId = essayExamQuestion.id;

    await publishExam(institutionA.id, { role: "FACULTY" }, examId);
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.submission.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
    await platform.examAnswer.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
    await platform.examAttempt.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.examQuestion.deleteMany({ where: { examVersion: { exam: { institutionId: institutionA.id } } } });
    await platform.examVersion.deleteMany({ where: { exam: { institutionId: institutionA.id } } });
    await platform.exam.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.questionVersion.deleteMany({ where: { question: { institutionId: institutionA.id } } });
    await platform.question.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.enrollment.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.user.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.course.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.institution.deleteMany({ where: { id: institutionA.id } });
  });

  it("refuses to start an attempt for an unenrolled student", async () => {
    await expect(
      startAttempt(institutionA.id, { id: studentUnenrolled.id, role: "STUDENT" }, examId)
    ).rejects.toThrow(NotEnrolledError);
  });

  it("starts an attempt for an enrolled student, and resumes on a second call", async () => {
    const first = await startAttempt(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, examId);
    expect(first.status).toBe("IN_PROGRESS");
    expect(first.timeRemainingSeconds).toBe(60 * 60);

    const second = await startAttempt(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, examId);
    expect(second.id).toBe(first.id);
  });

  it("strips the answer key from the taking view for a student", async () => {
    const attempt = await startAttempt(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, examId);
    const view = await getAttemptForTaking(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, attempt.id);
    const mcQuestion = view.examVersion.examQuestions.find((eq) => eq.id === mcExamQuestionId);
    expect(mcQuestion?.questionVersion.correctAnswer).toBeNull();
  });

  it("refuses another student from reading or saving into someone else's attempt", async () => {
    const attempt = await startAttempt(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, examId);
    await expect(
      getAttemptForTaking(institutionA.id, { id: studentUnenrolled.id, role: "STUDENT" }, attempt.id)
    ).rejects.toThrow(AttemptOwnershipError);
    await expect(
      saveAnswers(institutionA.id, { id: studentUnenrolled.id, role: "STUDENT" }, attempt.id, [
        { examQuestionId: mcExamQuestionId, responseJson: { choiceIds: ["0"] } },
      ])
    ).rejects.toThrow(AttemptOwnershipError);
  });

  it("saves answers, auto-grades the objective question on submit, and leaves the essay pending", async () => {
    const attempt = await startAttempt(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, examId);

    await saveAnswers(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, attempt.id, [
      { examQuestionId: mcExamQuestionId, responseJson: { choiceIds: ["0"] } },
      { examQuestionId: essayExamQuestionId, responseJson: { text: "Forum shopping is..." } },
    ]);

    const submitted = await submitAttempt(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, attempt.id);
    expect(submitted.status).toBe("SUBMITTED"); // essay still pending manual grading
    submittedAttemptId = attempt.id;

    const result = await getAttemptResult(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, attempt.id);
    const mcRow = result.breakdown.find((r) => r.maxPoints === 2);
    expect(mcRow?.pointsAwarded).toBe(2); // full credit, correct choice
    expect(mcRow?.pending).toBe(false);
    const essayRow = result.breakdown.find((r) => r.maxPoints === 10);
    expect(essayRow?.pending).toBe(true);
    expect(result.isFullyGraded).toBe(false);
  });

  it("refuses to start, save, or submit again once an attempt is already submitted", async () => {
    // Uses the attempt submitted by the previous test — starting fresh here
    // would itself throw (no retakes), so this exercises that path directly.
    await expect(
      startAttempt(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, examId)
    ).rejects.toThrow(AttemptAlreadyFinishedError);
    await expect(
      saveAnswers(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, submittedAttemptId, [
        { examQuestionId: mcExamQuestionId, responseJson: { choiceIds: ["1"] } },
      ])
    ).rejects.toThrow(AttemptAlreadyFinishedError);
    await expect(
      submitAttempt(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, submittedAttemptId)
    ).rejects.toThrow(AttemptAlreadyFinishedError);
  });

  it("faculty grading the pending essay completes the attempt", async () => {
    const attempts = await listAttemptsForExam(institutionA.id, { role: "FACULTY" }, examId);
    expect(attempts).toHaveLength(1);
    const essayAnswer = attempts[0].answers.find((a) => a.examQuestionId === essayExamQuestionId);
    expect(essayAnswer).toBeDefined();
    expect(essayAnswer!.pointsAwarded).toBeNull();

    await gradeAnswer(institutionA.id, { id: faculty.id, role: "FACULTY" }, essayAnswer!.id, 7);

    const result = await getAttemptResult(institutionA.id, { id: faculty.id, role: "FACULTY" }, attempts[0].id);
    expect(result.isFullyGraded).toBe(true);
    expect(result.scoredPoints).toBe(9); // 2 (mc) + 7 (essay, manually graded)
  });

  it("clamps a grade above the question's max points", async () => {
    const attempts = await listAttemptsForExam(institutionA.id, { role: "FACULTY" }, examId);
    const essayAnswer = attempts[0].answers.find((a) => a.examQuestionId === essayExamQuestionId)!;

    await gradeAnswer(institutionA.id, { id: faculty.id, role: "FACULTY" }, essayAnswer.id, 999);

    const result = await getAttemptResult(institutionA.id, { id: faculty.id, role: "FACULTY" }, attempts[0].id);
    const essayRow = result.breakdown.find((r) => r.maxPoints === 10);
    expect(essayRow?.pointsAwarded).toBe(10);
  });
});
