import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forPlatform } from "../tenant-db";
import { createQuestion } from "../questions";
import { addExamQuestion, createExam, publishExam } from "../exams";
import { startAttempt } from "../attempts";
import { ForbiddenError } from "../rbac";
import {
  getIntegrityReview,
  getWarningCount,
  listIntegrityReviewsForExam,
  recordAttemptEvent,
  resolveIntegrityReview,
} from "../integrity";

describe("integrity monitor (event log, 3-strike auto-pause, faculty review)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let courseA: { id: string };
  let faculty: { id: string };
  let student: { id: string };
  let studentTwo: { id: string };
  let examId: string;

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Integrity Tenant ${runId}`, slug: `integrity-tenant-${runId}` },
    });
    courseA = await platform.course.create({
      data: { institutionId: institutionA.id, code: "LAW501", name: "Evidence", academicYear: "2026-2027" },
    });
    faculty = await platform.user.create({
      data: { institutionId: institutionA.id, email: `integrity-faculty-${runId}@test.local`, name: "Faculty", role: "FACULTY", passwordHash: "x" },
    });
    student = await platform.user.create({
      data: { institutionId: institutionA.id, email: `integrity-student-${runId}@test.local`, name: "Student", role: "STUDENT", passwordHash: "x" },
    });
    await platform.enrollment.create({ data: { institutionId: institutionA.id, courseId: courseA.id, userId: student.id } });
    studentTwo = await platform.user.create({
      data: { institutionId: institutionA.id, email: `integrity-student2-${runId}@test.local`, name: "Student Two", role: "STUDENT", passwordHash: "x" },
    });
    await platform.enrollment.create({ data: { institutionId: institutionA.id, courseId: courseA.id, userId: studentTwo.id } });

    const { exam } = await createExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      title: "Integrity Test Exam",
      timeLimitMinutes: 60,
    });
    examId = exam.id;

    const { question } = await createQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      type: "MULTIPLE_CHOICE",
      prompt: "Pick one.",
      choices: [{ id: "0", text: "A" }, { id: "1", text: "B" }],
      correctAnswer: { choiceIds: ["0"] },
      points: 1,
    });
    await addExamQuestion(institutionA.id, { role: "FACULTY" }, { examId, questionId: question.id, points: 1 });

    await publishExam(institutionA.id, { role: "FACULTY" }, examId);
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.attemptEvent.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
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

  it("counts warnings from the event log and auto-pauses at the 3rd", async () => {
    const attempt = await startAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId);

    const first = await recordAttemptEvent(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id, "WINDOW_BLUR");
    expect(first).toEqual({ warningCount: 1, paused: false });

    const second = await recordAttemptEvent(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id, "VISIBILITY_HIDDEN");
    expect(second).toEqual({ warningCount: 2, paused: false });

    const third = await recordAttemptEvent(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id, "FULLSCREEN_EXIT");
    expect(third).toEqual({ warningCount: 3, paused: true });

    const count = await getWarningCount(institutionA.id, attempt.id);
    expect(count).toBe(3);

    const platform = forPlatform();
    const reloaded = await platform.examAttempt.findUnique({ where: { id: attempt.id } });
    expect(reloaded?.status).toBe("INTERRUPTED");
  });

  it("a paused attempt shows up in the faculty integrity-review queue", async () => {
    const attempt = await startAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId);
    await recordAttemptEvent(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id, "WINDOW_BLUR");
    await recordAttemptEvent(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id, "WINDOW_BLUR");
    await recordAttemptEvent(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id, "WINDOW_BLUR");

    const queue = await listIntegrityReviewsForExam(institutionA.id, { role: "FACULTY" }, examId);
    const entry = queue.find((a) => a.id === attempt.id);
    expect(entry).toBeDefined();
    expect(entry!.events).toHaveLength(3);

    // Reinstating clears it from the queue and lets the student resume.
    await resolveIntegrityReview(institutionA.id, { role: "FACULTY" }, attempt.id, "REINSTATE");
    const queueAfter = await listIntegrityReviewsForExam(institutionA.id, { role: "FACULTY" }, examId);
    expect(queueAfter.find((a) => a.id === attempt.id)).toBeUndefined();

    const platform = forPlatform();
    const reloaded = await platform.examAttempt.findUnique({ where: { id: attempt.id } });
    expect(reloaded?.status).toBe("IN_PROGRESS");
  });

  it("confirming a violation terminates the attempt, and further events don't re-trigger anything", async () => {
    const attempt = await startAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId);
    await recordAttemptEvent(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id, "WINDOW_BLUR");
    await recordAttemptEvent(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id, "WINDOW_BLUR");
    await recordAttemptEvent(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id, "WINDOW_BLUR");

    await resolveIntegrityReview(institutionA.id, { role: "FACULTY" }, attempt.id, "FAIL");

    const platform = forPlatform();
    const reloaded = await platform.examAttempt.findUnique({ where: { id: attempt.id } });
    expect(reloaded?.status).toBe("TERMINATED");

    // The student's browser could still fire a stray blur event after this —
    // must be a no-op, not an error, and must not un-terminate anything.
    const result = await recordAttemptEvent(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id, "WINDOW_BLUR");
    expect(result.paused).toBe(false);
    const stillTerminated = await platform.examAttempt.findUnique({ where: { id: attempt.id } });
    expect(stillTerminated?.status).toBe("TERMINATED");
  });

  it("logs network connectivity events but never counts them toward the strike threshold", async () => {
    const attempt = await startAttempt(institutionA.id, { id: studentTwo.id, role: "STUDENT" }, examId);

    const offline = await recordAttemptEvent(institutionA.id, { id: studentTwo.id, role: "STUDENT" }, attempt.id, "NETWORK_OFFLINE");
    expect(offline).toEqual({ warningCount: 0, paused: false });

    const online = await recordAttemptEvent(institutionA.id, { id: studentTwo.id, role: "STUDENT" }, attempt.id, "NETWORK_ONLINE");
    expect(online).toEqual({ warningCount: 0, paused: false });

    // A real strike still counts normally alongside the (uncounted) network events.
    const blur = await recordAttemptEvent(institutionA.id, { id: studentTwo.id, role: "STUDENT" }, attempt.id, "WINDOW_BLUR");
    expect(blur).toEqual({ warningCount: 1, paused: false });

    const platform = forPlatform();
    const allEvents = await platform.attemptEvent.findMany({ where: { attemptId: attempt.id } });
    expect(allEvents).toHaveLength(3); // both network events ARE logged, just not counted
  });

  it("a student can never load the integrity review screen, not even their own", async () => {
    // A fresh student — `student` already has a TERMINATED attempt on this
    // exam from the previous test, and Phase 1 has no retakes.
    const attempt = await startAttempt(institutionA.id, { id: studentTwo.id, role: "STUDENT" }, examId);
    await recordAttemptEvent(institutionA.id, { id: studentTwo.id, role: "STUDENT" }, attempt.id, "WINDOW_BLUR");

    await expect(
      getIntegrityReview(institutionA.id, { role: "STUDENT" }, attempt.id)
    ).rejects.toThrow(ForbiddenError);
  });
});
