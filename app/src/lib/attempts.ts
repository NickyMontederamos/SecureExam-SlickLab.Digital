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
    if (existing.status === "SUBMITTED" || existing.status === "GRADED") {
      throw new AttemptAlreadyFinishedError(existing.id);
    }
    return existing;
  }

  return db.examAttempt.create({
    // institutionId omitted deliberately — see questions.ts for why.
    data: {
      examVersionId: version.id,
      studentId: actor.id,
      status: "IN_PROGRESS",
      startedAt: new Date(),
      timeRemainingSeconds: version.timeLimitMinutes * 60,
    } as never,
  });
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

/** Auto-save (master prompt §15): upserts every answer in the batch. Refuses if the attempt isn't the caller's own IN_PROGRESS attempt. */
export async function saveAnswers(
  institutionId: string,
  actor: { id: string; role: Role },
  attemptId: string,
  answers: AnswerInput[]
) {
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
 */
export async function submitAttempt(institutionId: string, actor: { id: string; role: Role }, attemptId: string) {
  assertCan(actor.role, "exam_attempt", "take");

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
  if (attempt.studentId !== actor.id) {
    throw new AttemptOwnershipError(attemptId);
  }
  if (attempt.status !== "IN_PROGRESS") {
    throw new AttemptAlreadyFinishedError(attemptId);
  }

  const answersByQuestion = new Map(attempt.answers.map((a) => [a.examQuestionId, a]));

  return db.$transaction(async (tx) => {
    let allGraded = true;

    for (const eq of attempt.examVersion.examQuestions) {
      const existing = answersByQuestion.get(eq.id);
      const responseJson = existing?.responseJson ?? null;
      const pointsAwarded = autoGradePoints(eq.question.type, responseJson, eq.questionVersion.correctAnswer, eq.points);
      const isAutoGraded = pointsAwarded !== null;
      if (!isAutoGraded) {
        allGraded = false;
      }

      await tx.examAnswer.upsert({
        where: { attemptId_examQuestionId: { attemptId, examQuestionId: eq.id } },
        create: {
          attemptId,
          examQuestionId: eq.id,
          responseJson: responseJson as never,
          pointsAwarded: pointsAwarded ?? undefined,
          autoGraded: isAutoGraded,
          gradedAt: isAutoGraded ? new Date() : undefined,
        },
        update: {
          pointsAwarded: pointsAwarded ?? undefined,
          autoGraded: isAutoGraded,
          gradedAt: isAutoGraded ? new Date() : undefined,
        },
      });
    }

    const updated = await tx.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: allGraded ? "GRADED" : "SUBMITTED",
        submittedAt: new Date(),
        gradedAt: allGraded ? new Date() : null,
      },
    });

    await tx.submission.create({ data: { attemptId } });

    return updated;
  });
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
