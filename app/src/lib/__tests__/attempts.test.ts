import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forPlatform } from "../tenant-db";
import { createQuestion } from "../questions";
import { addExamQuestion, createExam, publishExam } from "../exams";
import {
  AttemptAlreadyFinishedError,
  AttemptNotFoundError,
  AttemptOwnershipError,
  NotEnrolledError,
  ProctorApprovalRequiredError,
  ScheduledTimeOutOfWindowError,
  beginBookedAttempt,
  bookAttempt,
  getAttemptForTaking,
  getAttemptResult,
  saveAnswers,
  startAttempt,
  submitAttempt,
} from "../attempts";
import { approveProctorStart } from "../proctoring";
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
    await platform.courseFaculty.create({ data: { institutionId: institutionA.id, courseId: courseA.id, userId: faculty.id } });
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
    const mcExamQuestion = await addExamQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, { examId, questionId: mcQuestion.id, points: 2 });
    mcExamQuestionId = mcExamQuestion.id;

    const { question: essayQuestion } = await createQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      type: "ESSAY",
      prompt: "Explain forum shopping.",
      points: 10,
    });
    const essayExamQuestion = await addExamQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, { examId, questionId: essayQuestion.id, points: 10 });
    essayExamQuestionId = essayExamQuestion.id;

    await publishExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, examId);
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
    await platform.courseFaculty.deleteMany({ where: { institutionId: institutionA.id } });
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

  it("flags a question without answering it, without clobbering a later real answer", async () => {
    const attempt = await startAttempt(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, examId);

    // Flag the essay question with no response yet — this is the main use
    // case for flagging: "come back to this one," not necessarily "I've
    // already answered this and want to double check it."
    await saveAnswers(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, attempt.id, [
      { examQuestionId: essayExamQuestionId, responseJson: null, isFlagged: true },
    ]);

    let view = await getAttemptForTaking(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, attempt.id);
    let essayAnswer = view.answers.find((a) => a.examQuestionId === essayExamQuestionId);
    expect(essayAnswer?.isFlagged).toBe(true);
    expect(essayAnswer?.responseJson).toBeNull();

    // Answering it for real, still flagged — the response must actually land.
    await saveAnswers(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, attempt.id, [
      { examQuestionId: essayExamQuestionId, responseJson: { text: "Draft answer" }, isFlagged: true },
    ]);

    view = await getAttemptForTaking(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, attempt.id);
    essayAnswer = view.answers.find((a) => a.examQuestionId === essayExamQuestionId);
    expect(essayAnswer?.isFlagged).toBe(true);
    expect(essayAnswer?.responseJson).toEqual({ text: "Draft answer" });

    // Unflagging with no new text typed this round must not erase the
    // already-saved response — omitting the field, not nulling it, is the point.
    await saveAnswers(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, attempt.id, [
      { examQuestionId: essayExamQuestionId, responseJson: null, isFlagged: false },
    ]);

    view = await getAttemptForTaking(institutionA.id, { id: studentEnrolled.id, role: "STUDENT" }, attempt.id);
    essayAnswer = view.answers.find((a) => a.examQuestionId === essayExamQuestionId);
    expect(essayAnswer?.isFlagged).toBe(false);
    expect(essayAnswer?.responseJson).toEqual({ text: "Draft answer" });
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

describe("booking flow (bookAttempt / beginBookedAttempt)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let courseA: { id: string };
  let faculty: { id: string };
  let proctor: { id: string };
  let student: { id: string };
  let examId: string;
  let windowedExamId: string;
  let windowFrom: Date;
  let windowUntil: Date;

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Booking Tenant ${runId}`, slug: `booking-tenant-${runId}` },
    });
    courseA = await platform.course.create({
      data: { institutionId: institutionA.id, code: "LAW601", name: "Booking Test Course", academicYear: "2026-2027" },
    });
    faculty = await platform.user.create({
      data: { institutionId: institutionA.id, email: `booking-faculty-${runId}@test.local`, name: "Faculty", role: "FACULTY", passwordHash: "x" },
    });
    await platform.courseFaculty.create({ data: { institutionId: institutionA.id, courseId: courseA.id, userId: faculty.id } });
    proctor = await platform.user.create({
      data: { institutionId: institutionA.id, email: `booking-proctor-${runId}@test.local`, name: "Proctor", role: "PROCTOR", passwordHash: "x" },
    });
    student = await platform.user.create({
      data: { institutionId: institutionA.id, email: `booking-student-${runId}@test.local`, name: "Student", role: "STUDENT", passwordHash: "x" },
    });
    await platform.enrollment.create({ data: { institutionId: institutionA.id, courseId: courseA.id, userId: student.id } });
    await platform.courseProctor.create({ data: { institutionId: institutionA.id, courseId: courseA.id, userId: proctor.id } });

    const { exam } = await createExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      title: "Booking Test Exam",
      timeLimitMinutes: 45,
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
    await addExamQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, { examId, questionId: question.id, points: 1 });
    await publishExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, examId);

    windowFrom = new Date(Date.now() + 60 * 60 * 1000);
    windowUntil = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const { exam: windowedExam } = await createExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      title: "Windowed Booking Exam",
      timeLimitMinutes: 30,
      availableFrom: windowFrom,
      availableUntil: windowUntil,
    });
    windowedExamId = windowedExam.id;
    await addExamQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, { examId: windowedExamId, questionId: question.id, points: 1 });
    await publishExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, windowedExamId);
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
    await platform.courseProctor.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.courseFaculty.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.enrollment.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.user.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.course.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.institution.deleteMany({ where: { id: institutionA.id } });
  });

  it("books a slot as NOT_STARTED with no timer running, and is idempotent", async () => {
    const first = await bookAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId);
    expect(first.status).toBe("NOT_STARTED");
    expect(first.startedAt).toBeNull();
    expect(first.timeRemainingSeconds).toBe(45 * 60);

    const second = await bookAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("NOT_STARTED");
  });

  it("refuses to begin an attempt that was never booked", async () => {
    await expect(
      beginBookedAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, "not-a-real-attempt-id")
    ).rejects.toThrow(AttemptNotFoundError);
  });

  it("refuses a scheduled time outside the exam's booking window", async () => {
    const tooEarly = new Date(windowFrom.getTime() - 60 * 60 * 1000);
    await expect(
      bookAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, windowedExamId, tooEarly)
    ).rejects.toThrow(ScheduledTimeOutOfWindowError);
  });

  it("books a windowed exam at a time inside the window", async () => {
    const insideWindow = new Date(windowFrom.getTime() + 30 * 60 * 1000);
    const booked = await bookAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, windowedExamId, insideWindow);
    expect(booked.scheduledFor?.getTime()).toBe(insideWindow.getTime());
  });

  it("refuses to begin a booked attempt until a proctor approves it", async () => {
    const booked = await bookAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId);
    await expect(
      beginBookedAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id)
    ).rejects.toThrow(ProctorApprovalRequiredError);
  });

  it("begins a booked attempt once approved (starts the timer), and resuming afterward is a no-op", async () => {
    const booked = await bookAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId);
    expect(booked.status).toBe("NOT_STARTED");

    await approveProctorStart(institutionA.id, { id: proctor.id, role: "PROCTOR" }, booked.id);

    const begun = await beginBookedAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id);
    expect(begun.status).toBe("IN_PROGRESS");
    expect(begun.startedAt).not.toBeNull();

    // Calling it again (e.g. a page reload mid-exam) must not reset the timer.
    const resumed = await beginBookedAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id);
    expect(resumed.startedAt?.getTime()).toBe(begun.startedAt?.getTime());

    await expect(
      submitAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id)
    ).resolves.toBeDefined();

    // Once finished, neither booking again nor beginning again is allowed.
    await expect(
      bookAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId)
    ).rejects.toThrow(AttemptAlreadyFinishedError);
    await expect(
      beginBookedAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id)
    ).rejects.toThrow(AttemptAlreadyFinishedError);
  });
});
