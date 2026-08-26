import type { Prisma, QuestionType, Role } from "@prisma/client";
import { assertCan } from "./rbac";
import { forTenant } from "./tenant-db";
import { ExamNotFoundError } from "./exams";

export class ExamNotPublishedError extends Error {
  constructor(examId: string) {
    super(`Exam ${examId} is not published yet`);
    this.name = "ExamNotPublishedError";
  }
}

export class NotEnrolledError extends Error {
  constructor(courseId: string) {
    super(`Not enrolled in course ${courseId}`);
    this.name = "NotEnrolledError";
  }
}

export class AttemptAlreadyFinishedError extends Error {
  constructor(attemptId: string) {
    super(`Attempt ${attemptId} has already been submitted`);
    this.name = "AttemptAlreadyFinishedError";
  }
}

export class AttemptNotFoundError extends Error {
  constructor(attemptId: string) {
    super(`Attempt ${attemptId} not found in this institution`);
    this.name = "AttemptNotFoundError";
  }
}

/** A student attempting to read/act on someone else's attempt — distinct from tenant isolation, this is row-level ownership within the same tenant. */
export class AttemptOwnershipError extends Error {
  constructor(attemptId: string) {
    super(`Attempt ${attemptId} does not belong to this user`);
    this.name = "AttemptOwnershipError";
  }
}

export class ScheduledTimeOutOfWindowError extends Error {
  constructor(scheduledFor: Date, availableFrom: Date | null, availableUntil: Date | null) {
    super(
      `Requested time ${scheduledFor.toISOString()} falls outside the exam's available window ` +
        `(${availableFrom?.toISOString() ?? "no start"} – ${availableUntil?.toISOString() ?? "no end"})`
    );
    this.name = "ScheduledTimeOutOfWindowError";
  }
}

/** beginBookedAttempt refused because the real proctor-approval gate (docs/PITCH_ROADMAP.md Milestone 5) hasn't been satisfied yet — see proctorApprovedAt on ExamAttempt and approveProctorStart in proctoring.ts. */
export class ProctorApprovalRequiredError extends Error {
  constructor(attemptId: string) {
    super(`Attempt ${attemptId} is waiting on proctor approval before it can start`);
    this.name = "ProctorApprovalRequiredError";
  }
}

/**
 * A write arrived after the attempt's deadline (docs/WORLD_CLASS_AUDIT.md
 * finding A-01). Deliberately distinct from AttemptAlreadyFinishedError:
 * that one means "you already submitted", this means "your time ran out".
 */
export class AttemptExpiredError extends Error {
  constructor(attemptId: string) {
    super(`Attempt ${attemptId} is past its time limit`);
    this.name = "AttemptExpiredError";
  }
}

/**
 * The authoritative deadline for an attempt, or null if the timer hasn't
 * started (NOT_STARTED bookings have no deadline — the clock deliberately
 * does not run during booking or the entry-gate sequence).
 *
 * Prefers the stored `expiresAt`, which is the real source of truth and the
 * only value that accounts for paused time. Falls back to
 * `startedAt + timeLimitMinutes` for rows written before that column
 * existed, so legacy attempts are still enforced rather than silently
 * exempt — an unenforced legacy row would be exactly the hole this closes.
 */
export function attemptDeadline(
  attempt: { startedAt: Date | null; expiresAt?: Date | null },
  timeLimitMinutes: number
): Date | null {
  if (attempt.expiresAt) {
    return attempt.expiresAt;
  }
  if (!attempt.startedAt) {
    return null;
  }
  return new Date(attempt.startedAt.getTime() + timeLimitMinutes * 60_000);
}

/** True once `now` is strictly past the attempt's deadline. A not-yet-started attempt is never expired. */
export function isAttemptExpired(
  attempt: { startedAt: Date | null; expiresAt?: Date | null },
  timeLimitMinutes: number,
  now: Date = new Date()
): boolean {
  const deadline = attemptDeadline(attempt, timeLimitMinutes);
  return deadline !== null && now.getTime() > deadline.getTime();
}

/**
 * Starts (or resumes) a student's attempt at a published exam. Enforces:
 * exam must be PUBLISHED, student must be enrolled in the exam's course,
 * and a student can only ever have one attempt per exam version (schema's
 * @@unique([examVersionId, studentId])) — calling this again while
 * IN_PROGRESS just returns the existing attempt (resume), while calling it
 * after SUBMITTED/GRADED is refused (no retakes in Phase 1).
 */
export async function startAttempt(institutionId: string, actor: { id: string; role: Role }, examId: string) {
  assertCan(actor.role, "exam_attempt", "create");

  const db = forTenant(institutionId);

  const exam = await db.exam.findFirst({
    where: { id: examId },
    include: { versions: { where: { isActive: true }, take: 1 } },
  });
  if (!exam) {
    throw new ExamNotFoundError(examId);
  }
  if (exam.status !== "PUBLISHED") {
    throw new ExamNotPublishedError(examId);
  }
  const version = exam.versions[0];
  if (!version) {
    throw new ExamNotPublishedError(examId);
  }

  if (actor.role === "STUDENT") {
    const enrollment = await db.enrollment.findFirst({ where: { courseId: exam.courseId, userId: actor.id } });
    if (!enrollment) {
      throw new NotEnrolledError(exam.courseId);
    }
  }

  const existing = await db.examAttempt.findFirst({ where: { examVersionId: version.id, studentId: actor.id } });
  if (existing) {
    if (existing.status === "SUBMITTED" || existing.status === "GRADED" || existing.status === "TERMINATED") {
      throw new AttemptAlreadyFinishedError(existing.id);
    }
    return existing;
  }

  // The timer starts here, so the deadline is fixed here too.
  const startedAt = new Date();
  return db.examAttempt.create({
    // institutionId omitted deliberately — see questions.ts for why.
    data: {
      examVersionId: version.id,
      studentId: actor.id,
      status: "IN_PROGRESS",
      startedAt,
      expiresAt: new Date(startedAt.getTime() + version.timeLimitMinutes * 60_000),
      timeRemainingSeconds: version.timeLimitMinutes * 60,
    } as never,
  });
}

/**
 * Reserves a student's slot at a published exam (status NOT_STARTED, no
 * timer running yet) — the first step of the Book → Confirm → Receipt flow
 * (see docs/PITCH_ROADMAP.md). Same enrollment/publish checks as
 * startAttempt; calling it again while NOT_STARTED or IN_PROGRESS just
 * returns the existing booking (idempotent), same no-retake refusal once
 * finished.
 *
 * scheduledFor is the student's picked instant within the exam's
 * availableFrom/availableUntil window (Milestone 5's real scheduling,
 * replacing "confirm the one fixed window"). Optional and unvalidated when
 * the exam has no window at all — booking stays "anytime" for those exams,
 * same as before this field existed.
 */
export async function bookAttempt(
  institutionId: string,
  actor: { id: string; role: Role },
  examId: string,
  scheduledFor?: Date
) {
  assertCan(actor.role, "exam_attempt", "create");

  const db = forTenant(institutionId);

  const exam = await db.exam.findFirst({
    where: { id: examId },
    include: { versions: { where: { isActive: true }, take: 1 } },
  });
  if (!exam) {
    throw new ExamNotFoundError(examId);
  }
  if (exam.status !== "PUBLISHED") {
    throw new ExamNotPublishedError(examId);
  }
  const version = exam.versions[0];
  if (!version) {
    throw new ExamNotPublishedError(examId);
  }

  if (
    scheduledFor &&
    ((version.availableFrom && scheduledFor < version.availableFrom) ||
      (version.availableUntil && scheduledFor > version.availableUntil))
  ) {
    throw new ScheduledTimeOutOfWindowError(scheduledFor, version.availableFrom, version.availableUntil);
  }

  if (actor.role === "STUDENT") {
    const enrollment = await db.enrollment.findFirst({ where: { courseId: exam.courseId, userId: actor.id } });
    if (!enrollment) {
      throw new NotEnrolledError(exam.courseId);
    }
  }

  const existing = await db.examAttempt.findFirst({ where: { examVersionId: version.id, studentId: actor.id } });
  if (existing) {
    if (existing.status === "SUBMITTED" || existing.status === "GRADED" || existing.status === "TERMINATED") {
      throw new AttemptAlreadyFinishedError(existing.id);
    }
    return existing;
  }

  return db.examAttempt.create({
    data: {
      examVersionId: version.id,
      studentId: actor.id,
      status: "NOT_STARTED",
      scheduledFor,
      timeRemainingSeconds: version.timeLimitMinutes * 60,
    } as never,
  });
}

/**
 * Begins an already-booked attempt's timer — called after the entry-gate
 * sequence completes, not the moment "Start Exam" is clicked (same
 * timer-doesn't-burn-during-the-gate reasoning as the old direct
 * startAttempt call). Never creates a row itself — a booking (see
 * bookAttempt) must already exist. NOT_STARTED -> IN_PROGRESS with
 * startedAt set now; IN_PROGRESS is a no-op resume, matching startAttempt's
 * existing resume behavior for callers that skip booking entirely (tests,
 * mainly — see attempts.test.ts).
 *
 * Requires proctorApprovedAt to be set (Milestone 5's real wait-for-proctor
 * gate — see requestProctorApproval/approveProctorStart in proctoring.ts).
 * This is the actual enforcement point: nothing else stops a student from
 * calling this the moment they've booked.
 */
export async function beginBookedAttempt(institutionId: string, actor: { id: string; role: Role }, attemptId: string) {
  assertCan(actor.role, "exam_attempt", "take");

  const db = forTenant(institutionId);

  const attempt = await db.examAttempt.findFirst({
    where: { id: attemptId },
    include: { examVersion: { select: { timeLimitMinutes: true } } },
  });
  if (!attempt) {
    throw new AttemptNotFoundError(attemptId);
  }
  if (attempt.studentId !== actor.id) {
    throw new AttemptOwnershipError(attemptId);
  }
  if (attempt.status === "NOT_STARTED") {
    if (!attempt.proctorApprovedAt) {
      throw new ProctorApprovalRequiredError(attemptId);
    }
    // This is where the clock genuinely starts for a booked attempt — the
    // booking and the entry-gate sequence before it deliberately burn no
    // exam time — so this is where the deadline is fixed.
    const startedAt = new Date();
    return db.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: "IN_PROGRESS",
        startedAt,
        expiresAt: new Date(startedAt.getTime() + attempt.examVersion.timeLimitMinutes * 60_000),
      },
    });
  }
  if (attempt.status === "IN_PROGRESS") {
    return attempt;
  }
  throw new AttemptAlreadyFinishedError(attemptId);
}

/** For the exam landing page: does this student already have an attempt (any status) at this exam version? */
export async function findAttemptForStudent(institutionId: string, actor: { id: string; role: Role }, examVersionId: string) {
  assertCan(actor.role, "exam_attempt", "read");
  const db = forTenant(institutionId);
  return db.examAttempt.findFirst({ where: { examVersionId, studentId: actor.id } });
}

/**
 * Full attempt view for rendering the exam-taking (or review) UI. Strips
 * correctAnswer for students — faculty/proctor/admin viewing an attempt
 * (e.g. while grading) may see it.
 */
export async function getAttemptForTaking(institutionId: string, actor: { id: string; role: Role }, attemptId: string) {
  assertCan(actor.role, "exam_attempt", "read");

  const db = forTenant(institutionId);

  const attempt = await db.examAttempt.findFirst({
    where: { id: attemptId },
    include: {
      examVersion: {
        include: {
          exam: true,
          examQuestions: {
            orderBy: { order: "asc" },
            include: { questionVersion: true, question: true },
          },
        },
      },
      answers: true,
    },
  });
  if (!attempt) {
    throw new AttemptNotFoundError(attemptId);
  }
  if (actor.role === "STUDENT" && attempt.studentId !== actor.id) {
    throw new AttemptOwnershipError(attemptId);
  }

  const stripAnswerKey = actor.role === "STUDENT";
  const examQuestions = attempt.examVersion.examQuestions.map((eq) => ({
    ...eq,
    questionVersion: stripAnswerKey ? { ...eq.questionVersion, correctAnswer: null } : eq.questionVersion,
  }));

  return { ...attempt, examVersion: { ...attempt.examVersion, examQuestions } };
}

export interface AnswerInput {
  examQuestionId: string;
  /** Null means "no response typed this round" — e.g. flagging a question the student hasn't answered yet. Never overwrites a previously-saved response. */
  responseJson: Prisma.InputJsonValue | null;
  isFlagged?: boolean;
}

/**
 * Auto-save (master prompt §15): upserts every answer in the batch. Refuses
 * if the attempt isn't the caller's own IN_PROGRESS attempt, or if its time
 * limit has passed.
 *
 * The deadline check is the security-critical half (docs/WORLD_CLASS_AUDIT.md
 * A-01): the countdown in the browser is a courtesy display that a student
 * can trivially stop, so this — not ExamCountdown — is what actually
 * prevents an answer landing after time is up.
 */
export async function saveAnswers(
  institutionId: string,
  actor: { id: string; role: Role },
  attemptId: string,
  answers: AnswerInput[]
) {
  assertCan(actor.role, "exam_attempt", "take");

  const db = forTenant(institutionId);

  const attempt = await db.examAttempt.findFirst({
    where: { id: attemptId },
    include: { examVersion: { select: { timeLimitMinutes: true } } },
  });
  if (!attempt) {
    throw new AttemptNotFoundError(attemptId);
  }
  if (attempt.studentId !== actor.id) {
    throw new AttemptOwnershipError(attemptId);
  }
  if (attempt.status !== "IN_PROGRESS") {
    throw new AttemptAlreadyFinishedError(attemptId);
  }
  if (isAttemptExpired(attempt, attempt.examVersion.timeLimitMinutes)) {
    // Finalize rather than just refusing: an attempt whose deadline passed
    // while the student was away (closed laptop, dead connection) must not
    // sit IN_PROGRESS forever. Their already-saved answers are graded — only
    // this too-late batch is discarded.
    await finalizeAttempt(institutionId, attemptId);
    throw new AttemptExpiredError(attemptId);
  }

  const validQuestions = await db.examQuestion.findMany({
    where: { examVersionId: attempt.examVersionId },
    select: { id: true },
  });
  const validIds = new Set(validQuestions.map((q) => q.id));

  const toSave = answers.filter((a) => validIds.has(a.examQuestionId));
  if (toSave.length === 0) {
    return;
  }

  await db.$transaction(
    toSave.map((a) => {
      // Omitting responseJson (rather than passing null) on both branches means
      // a flag-only save can never clobber an already-saved response.
      const responseData = a.responseJson !== null ? { responseJson: a.responseJson } : {};
      return db.examAnswer.upsert({
        where: { attemptId_examQuestionId: { attemptId, examQuestionId: a.examQuestionId } },
        create: { attemptId, examQuestionId: a.examQuestionId, isFlagged: a.isFlagged ?? false, ...responseData },
        update: { isFlagged: a.isFlagged ?? false, ...responseData },
      });
    })
  );
}

/**
 * Objective auto-grading only (MC/MR/TF, full-credit-or-nothing — no
 * partial credit in Phase 1). Essay/short-answer always return null,
 * meaning "needs manual grading" (master prompt §21).
 */
function autoGradePoints(
  questionType: QuestionType,
  responseJson: unknown,
  correctAnswer: unknown,
  maxPoints: number
): number | null {
  if (questionType === "ESSAY" || questionType === "SHORT_ANSWER") {
    return null;
  }
  const correct = correctAnswer as { choiceIds?: string[] } | null;
  if (!correct?.choiceIds) {
    return 0;
  }
  const response = responseJson as { choiceIds?: string[] } | null;
  const responseIds = new Set(response?.choiceIds ?? []);
  const correctIds = new Set(correct.choiceIds);
  const exact = responseIds.size === correctIds.size && [...correctIds].every((id) => responseIds.has(id));
  return exact ? maxPoints : 0;
}

/**
 * Finalizes an attempt: freezes it (no more saveAnswers calls will
 * succeed), ensures every exam question has an ExamAnswer row (even if the
 * student left it blank — so it shows up in the manual grading queue rather
 * than silently scoring 0), auto-grades objective questions, and marks the
 * attempt GRADED immediately if nothing needs manual grading, or SUBMITTED
 * (pending grading) otherwise.
 *
 * Deliberately takes no actor: this runs both for a student's own submit
 * and for a server-side expiry finalization where there is no request in
 * flight (see saveAnswers). Callers own the authorization check.
 *
 * Idempotent by construction. The status transition is claimed with a
 * conditional updateMany rather than a read-then-write, so two concurrent
 * finalizations (double-click, retry, or a submit racing an expiry sweep)
 * can only produce one submission — the loser sees affected-count 0 and
 * returns the already-final attempt instead of grading it twice.
 */
async function finalizeAttempt(institutionId: string, attemptId: string) {
  const db = forTenant(institutionId);

  const attempt = await db.examAttempt.findFirst({
    where: { id: attemptId },
    include: {
      examVersion: { include: { examQuestions: { include: { questionVersion: true, question: true } } } },
      answers: true,
    },
  });
  if (!attempt) {
    throw new AttemptNotFoundError(attemptId);
  }
  if (attempt.status !== "IN_PROGRESS") {
    return attempt;
  }

  const answersByQuestion = new Map(attempt.answers.map((a) => [a.examQuestionId, a]));

  return db.$transaction(async (tx) => {
    let allGraded = true;
    const gradedRows: { examQuestionId: string; responseJson: unknown; pointsAwarded: number | null }[] = [];

    for (const eq of attempt.examVersion.examQuestions) {
      const existing = answersByQuestion.get(eq.id);
      const responseJson = existing?.responseJson ?? null;
      const pointsAwarded = autoGradePoints(eq.question.type, responseJson, eq.questionVersion.correctAnswer, eq.points);
      if (pointsAwarded === null) {
        allGraded = false;
      }
      gradedRows.push({ examQuestionId: eq.id, responseJson, pointsAwarded });
    }

    // Claim the transition first. If another caller already finalized this
    // attempt, count is 0 and we must not write answers or a submission.
    const claimed = await tx.examAttempt.updateMany({
      where: { id: attemptId, status: "IN_PROGRESS" },
      data: {
        status: allGraded ? "GRADED" : "SUBMITTED",
        submittedAt: new Date(),
        gradedAt: allGraded ? new Date() : null,
      },
    });
    if (claimed.count === 0) {
      const current = await tx.examAttempt.findFirst({ where: { id: attemptId } });
      return current!;
    }

    for (const row of gradedRows) {
      const isAutoGraded = row.pointsAwarded !== null;
      await tx.examAnswer.upsert({
        where: { attemptId_examQuestionId: { attemptId, examQuestionId: row.examQuestionId } },
        create: {
          attemptId,
          examQuestionId: row.examQuestionId,
          responseJson: row.responseJson as never,
          pointsAwarded: row.pointsAwarded ?? undefined,
          autoGraded: isAutoGraded,
          gradedAt: isAutoGraded ? new Date() : undefined,
        },
        update: {
          pointsAwarded: row.pointsAwarded ?? undefined,
          autoGraded: isAutoGraded,
          gradedAt: isAutoGraded ? new Date() : undefined,
        },
      });
    }

    await tx.submission.create({ data: { attemptId } });

    const updated = await tx.examAttempt.findFirst({ where: { id: attemptId } });
    return updated!;
  });
}

/**
 * A student submitting their own attempt. Ownership + status are checked
 * here; the grading itself is shared with the expiry path via
 * finalizeAttempt.
 *
 * Note the deliberate asymmetry with saveAnswers: submitting fractionally
 * late is *not* refused, because submitting accepts no new answer data — it
 * only grades what was already saved before the deadline. Refusing it would
 * punish network latency on the auto-submit round trip by discarding work
 * the student legitimately completed in time.
 */
export async function submitAttempt(institutionId: string, actor: { id: string; role: Role }, attemptId: string) {
  assertCan(actor.role, "exam_attempt", "take");

  const db = forTenant(institutionId);

  const attempt = await db.examAttempt.findFirst({ where: { id: attemptId } });
  if (!attempt) {
    throw new AttemptNotFoundError(attemptId);
  }
  if (attempt.studentId !== actor.id) {
    throw new AttemptOwnershipError(attemptId);
  }
  if (attempt.status !== "IN_PROGRESS") {
    throw new AttemptAlreadyFinishedError(attemptId);
  }

  return finalizeAttempt(institutionId, attemptId);
}

export interface AttemptResultBreakdownRow {
  prompt: string;
  maxPoints: number;
  pointsAwarded: number | null;
  pending: boolean;
}

export async function getAttemptResult(institutionId: string, actor: { id: string; role: Role }, attemptId: string) {
  assertCan(actor.role, "grade", "read");

  const db = forTenant(institutionId);

  const attempt = await db.examAttempt.findFirst({
    where: { id: attemptId },
    include: {
      examVersion: {
        include: { exam: true, examQuestions: { include: { questionVersion: true }, orderBy: { order: "asc" } } },
      },
      answers: true,
      submission: true,
    },
  });
  if (!attempt) {
    throw new AttemptNotFoundError(attemptId);
  }
  if (actor.role === "STUDENT" && attempt.studentId !== actor.id) {
    throw new AttemptOwnershipError(attemptId);
  }
  if (attempt.status === "IN_PROGRESS" || attempt.status === "NOT_STARTED") {
    throw new Error(`Attempt ${attemptId} has not been submitted yet`);
  }

  const answersByQuestion = new Map(attempt.answers.map((a) => [a.examQuestionId, a]));
  const breakdown: AttemptResultBreakdownRow[] = attempt.examVersion.examQuestions.map((eq) => {
    const answer = answersByQuestion.get(eq.id);
    return {
      prompt: eq.questionVersion.prompt,
      maxPoints: eq.points,
      pointsAwarded: answer?.pointsAwarded ?? null,
      pending: !answer || answer.pointsAwarded === null,
    };
  });

  const totalPoints = attempt.examVersion.examQuestions.reduce((sum, eq) => sum + eq.points, 0);
  const scoredPoints = breakdown.reduce((sum, b) => sum + (b.pointsAwarded ?? 0), 0);

  return { attempt, breakdown, totalPoints, scoredPoints, isFullyGraded: attempt.status === "GRADED" };
}
