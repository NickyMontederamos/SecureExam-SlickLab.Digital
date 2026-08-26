import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forPlatform } from "../tenant-db";
import { createQuestion } from "../questions";
import { addExamQuestion, createExam, publishExam } from "../exams";
import {
  AttemptExpiredError,
  attemptDeadline,
  isAttemptExpired,
  saveAnswers,
  startAttempt,
  submitAttempt,
} from "../attempts";
import { recordAttemptEvent, resolveIntegrityReview } from "../integrity";

/**
 * Regression suite for docs/WORLD_CLASS_AUDIT.md finding A-01 — the exam
 * time limit was not enforced on any server write path, so an answer could
 * be saved and awarded full credit hours after the deadline.
 *
 * The headline test below is the exact scenario that was reproduced against
 * real Postgres during the audit. If it ever passes a late answer again,
 * the vulnerability is back.
 */

describe("attemptDeadline / isAttemptExpired (pure)", () => {
  const started = new Date("2026-01-01T10:00:00Z");

  it("prefers the stored expiresAt over deriving from startedAt", () => {
    const explicit = new Date("2026-01-01T10:45:00Z");
    const deadline = attemptDeadline({ startedAt: started, expiresAt: explicit }, 30);
    expect(deadline).toEqual(explicit); // 45min stored wins over 30min derived
  });

  it("falls back to startedAt + timeLimit for legacy rows with no expiresAt", () => {
    const deadline = attemptDeadline({ startedAt: started, expiresAt: null }, 30);
    expect(deadline).toEqual(new Date("2026-01-01T10:30:00Z"));
  });

  it("treats a not-yet-started attempt as having no deadline", () => {
    expect(attemptDeadline({ startedAt: null, expiresAt: null }, 30)).toBeNull();
    expect(isAttemptExpired({ startedAt: null, expiresAt: null }, 30)).toBe(false);
  });

  it("expires strictly after the deadline, not on it", () => {
    const attempt = { startedAt: started, expiresAt: new Date("2026-01-01T10:30:00Z") };
    expect(isAttemptExpired(attempt, 30, new Date("2026-01-01T10:29:59Z"))).toBe(false);
    expect(isAttemptExpired(attempt, 30, new Date("2026-01-01T10:30:00Z"))).toBe(false);
    expect(isAttemptExpired(attempt, 30, new Date("2026-01-01T10:30:01Z"))).toBe(true);
  });
});

describe("A-01 regression: server-enforced exam time limit (DB)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let courseA: { id: string };
  let faculty: { id: string };
  let student: { id: string };
  let student2: { id: string };
  let examId: string;
  let examQuestionId: string;

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Expiry ${runId}`, slug: `expiry-${runId}` },
    });
    courseA = await platform.course.create({
      data: { institutionId: institutionA.id, code: "EXP1", name: "Expiry", academicYear: "2026-2027" },
    });
    faculty = await platform.user.create({
      data: { institutionId: institutionA.id, email: `exp-f-${runId}@test.local`, name: "F", role: "FACULTY", passwordHash: "x" },
    });
    await platform.courseFaculty.create({
      data: { institutionId: institutionA.id, courseId: courseA.id, userId: faculty.id },
    });
    student = await platform.user.create({
      data: { institutionId: institutionA.id, email: `exp-s-${runId}@test.local`, name: "S", role: "STUDENT", passwordHash: "x" },
    });
    student2 = await platform.user.create({
      data: { institutionId: institutionA.id, email: `exp-s2-${runId}@test.local`, name: "S2", role: "STUDENT", passwordHash: "x" },
    });
    await platform.enrollment.create({
      data: { institutionId: institutionA.id, courseId: courseA.id, userId: student.id },
    });
    await platform.enrollment.create({
      data: { institutionId: institutionA.id, courseId: courseA.id, userId: student2.id },
    });

    const { exam } = await createExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      title: "One Minute Exam",
      timeLimitMinutes: 1,
    });
    examId = exam.id;

    const { question } = await createQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      type: "MULTIPLE_CHOICE",
      prompt: "Pick one.",
      choices: [{ id: "0", text: "Right" }, { id: "1", text: "Wrong" }],
      correctAnswer: { choiceIds: ["0"] },
      points: 1,
    });
    const eq = await addExamQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, { examId, questionId: question.id, points: 1 });
    examQuestionId = eq.id;

    await publishExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, examId);
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.submission.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
    await platform.examAnswer.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
    await platform.attemptEvent.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
    await platform.examAttempt.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.examQuestion.deleteMany({ where: { examVersion: { exam: { institutionId: institutionA.id } } } });
    await platform.examVersion.deleteMany({ where: { exam: { institutionId: institutionA.id } } });
    await platform.exam.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.questionVersion.deleteMany({ where: { question: { institutionId: institutionA.id } } });
    await platform.question.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.enrollment.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.courseFaculty.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.user.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.course.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.institution.deleteMany({ where: { id: institutionA.id } });
  });

  it("sets an explicit deadline when the attempt starts", async () => {
    const attempt = await startAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId);
    expect(attempt.expiresAt).not.toBeNull();
    const expectedMs = attempt.startedAt!.getTime() + 60_000;
    expect(Math.abs(attempt.expiresAt!.getTime() - expectedMs)).toBeLessThan(1000);
  });

  it("REFUSES an answer saved after the deadline, and finalizes the attempt", async () => {
    const attempt = await startAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId);

    // Exactly the audit scenario: a 1-minute exam, written 2 hours late.
    await forPlatform().examAttempt.update({
      where: { id: attempt.id },
      data: {
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000 + 60_000),
      },
    });

    await expect(
      saveAnswers(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id, [
        { examQuestionId, responseJson: { choiceIds: ["0"] } },
      ])
    ).rejects.toThrow(AttemptExpiredError);

    // The late answer must not have landed...
    const answer = await forPlatform().examAnswer.findFirst({
      where: { attemptId: attempt.id, examQuestionId },
    });
    expect(answer?.responseJson ?? null).toBeNull();
    expect(answer?.pointsAwarded ?? 0).toBe(0);

    // ...and the attempt must not be left dangling IN_PROGRESS forever.
    const final = await forPlatform().examAttempt.findUnique({ where: { id: attempt.id } });
    expect(final?.status).not.toBe("IN_PROGRESS");
  });

  it("still accepts answers saved before the deadline", async () => {
    const attempt = await startAttempt(institutionA.id, { id: student2.id, role: "STUDENT" }, examId);

    await saveAnswers(institutionA.id, { id: student2.id, role: "STUDENT" }, attempt.id, [
      { examQuestionId, responseJson: { choiceIds: ["0"] } },
    ]);

    const answer = await forPlatform().examAnswer.findFirst({
      where: { attemptId: attempt.id, examQuestionId },
    });
    expect(answer?.responseJson).toEqual({ choiceIds: ["0"] });

    // And submitting grades the work that was saved in time.
    const submitted = await submitAttempt(institutionA.id, { id: student2.id, role: "STUDENT" }, attempt.id);
    expect(submitted.status).toBe("GRADED");
  });

  it("credits paused review time back to the deadline on reinstatement", async () => {
    const platform = forPlatform();
    const student3 = await platform.user.create({
      data: { institutionId: institutionA.id, email: `exp-s3-${runId}@test.local`, name: "S3", role: "STUDENT", passwordHash: "x" },
    });
    await platform.enrollment.create({
      data: { institutionId: institutionA.id, courseId: courseA.id, userId: student3.id },
    });

    const attempt = await startAttempt(institutionA.id, { id: student3.id, role: "STUDENT" }, examId);
    const originalExpiry = attempt.expiresAt!;

    // Trip the 3-strike threshold to pause the attempt.
    const asStudent3 = { id: student3.id, role: "STUDENT" as const };
    await recordAttemptEvent(institutionA.id, asStudent3, attempt.id, "WINDOW_BLUR");
    await recordAttemptEvent(institutionA.id, asStudent3, attempt.id, "WINDOW_BLUR");
    await recordAttemptEvent(institutionA.id, asStudent3, attempt.id, "WINDOW_BLUR");

    const paused = await platform.examAttempt.findUnique({ where: { id: attempt.id } });
    expect(paused?.status).toBe("INTERRUPTED");
    expect(paused?.pausedAt).not.toBeNull();

    // Simulate a 10-minute faculty review.
    await platform.examAttempt.update({
      where: { id: attempt.id },
      data: { pausedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    await resolveIntegrityReview(institutionA.id, { role: "FACULTY" }, attempt.id, "REINSTATE");

    const resumed = await platform.examAttempt.findUnique({ where: { id: attempt.id } });
    expect(resumed?.status).toBe("IN_PROGRESS");
    expect(resumed?.pausedAt).toBeNull();
    // The student must get those 10 minutes back, not be charged for them.
    const creditedMs = resumed!.expiresAt!.getTime() - originalExpiry.getTime();
    expect(creditedMs).toBeGreaterThan(9 * 60 * 1000);
  });

  it("finalizes only once when two submissions race (A-03 guard)", async () => {
    const platform = forPlatform();
    const student4 = await platform.user.create({
      data: { institutionId: institutionA.id, email: `exp-s4-${runId}@test.local`, name: "S4", role: "STUDENT", passwordHash: "x" },
    });
    await platform.enrollment.create({
      data: { institutionId: institutionA.id, courseId: courseA.id, userId: student4.id },
    });

    const attempt = await startAttempt(institutionA.id, { id: student4.id, role: "STUDENT" }, examId);

    const results = await Promise.allSettled([
      submitAttempt(institutionA.id, { id: student4.id, role: "STUDENT" }, attempt.id),
      submitAttempt(institutionA.id, { id: student4.id, role: "STUDENT" }, attempt.id),
    ]);
    // At least one must succeed; the other either loses the claim or is
    // refused as already-finished. Neither may double-write.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);

    const submissions = await platform.submission.count({ where: { attemptId: attempt.id } });
    expect(submissions).toBe(1);
  });
});
