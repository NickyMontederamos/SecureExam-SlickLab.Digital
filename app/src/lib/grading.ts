import type { Role } from "@prisma/client";
import { assertCan } from "./rbac";
import { forTenant } from "./tenant-db";
import { ExamNotFoundError } from "./exams";

export class AnswerNotFoundError extends Error {
  constructor(answerId: string) {
    super(`Answer ${answerId} not found in this institution`);
    this.name = "AnswerNotFoundError";
  }
}

/** Every submitted/graded attempt for an exam, for the faculty grading queue. */
export async function listAttemptsForExam(institutionId: string, actor: { role: Role }, examId: string) {
  assertCan(actor.role, "grade", "read");

  const db = forTenant(institutionId);

  const exam = await db.exam.findFirst({ where: { id: examId }, include: { versions: { where: { isActive: true }, take: 1 } } });
  if (!exam) {
    throw new ExamNotFoundError(examId);
  }
  const version = exam.versions[0];
  if (!version) {
    return [];
  }

  return db.examAttempt.findMany({
    // TERMINATED is included so a confirmed integrity violation stays
    // visible here after it resolves — it drops out of the integrity-review
    // queue once decided, and this is the only other list a faculty member
    // would think to check.
    where: { examVersionId: version.id, status: { in: ["SUBMITTED", "GRADED", "TERMINATED"] } },
    include: { student: true, answers: true },
    orderBy: { submittedAt: "asc" },
  });
}

/**
 * Assigns (or overrides) points for one answer. Clamped to
 * [0, examQuestion.points] — a grader cannot award more than the question
 * is worth. ExamAnswer has no institutionId of its own (see
 * tenant-db.ts), so ownership is verified explicitly here via the parent
 * attempt's institutionId rather than relying on the query-layer extension.
 */
export async function gradeAnswer(
  institutionId: string,
  actor: { id: string; role: Role },
  examAnswerId: string,
  pointsAwarded: number
) {
  assertCan(actor.role, "grade", "grade");

  const db = forTenant(institutionId);

  const answer = await db.examAnswer.findFirst({
    where: { id: examAnswerId },
    include: { attempt: true, examQuestion: true },
  });
  if (!answer || answer.attempt.institutionId !== institutionId) {
    throw new AnswerNotFoundError(examAnswerId);
  }

  const clamped = Math.max(0, Math.min(pointsAwarded, answer.examQuestion.points));

  await db.examAnswer.update({
    where: { id: examAnswerId },
    data: { pointsAwarded: clamped, autoGraded: false, gradedAt: new Date(), gradedById: actor.id },
  });

  const remaining = await db.examAnswer.findMany({ where: { attemptId: answer.attemptId } });
  const allGraded = remaining.every((a) => a.pointsAwarded !== null);
  if (allGraded) {
    await db.examAttempt.update({ where: { id: answer.attemptId }, data: { status: "GRADED", gradedAt: new Date() } });
  }
}
