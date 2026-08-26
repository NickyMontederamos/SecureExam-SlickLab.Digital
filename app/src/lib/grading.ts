import type { Role } from "@prisma/client";
import { assertCan } from "./rbac";
import { forTenant } from "./tenant-db";
import { ExamNotFoundError } from "./exams";
import { assertFacultyAssignedToCourse } from "./courses";
import { AUDIT_ACTIONS, logAudit } from "./audit";

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

export interface CourseExamSummary {
  examId: string;
  title: string;
  status: string;
  submittedCount: number;
  pendingCount: number;
  gradedCount: number;
  terminatedCount: number;
  averageScorePercent: number | null;
}

/**
 * Per-exam grading rollup for the course-home page: how many attempts are
 * awaiting grading vs. already graded, and the class average once graded.
 * Uses the same course-assignment guard as everything else in Milestone
 * 6.6 — this is reached from the course-home page, not just from an
 * exam's own grading queue, so it needs its own check rather than relying
 * on the caller already having passed one.
 */
export async function getCourseExamSummaries(
  institutionId: string,
  actor: { id: string; role: Role },
  courseId: string
): Promise<CourseExamSummary[]> {
  assertCan(actor.role, "grade", "read");
  await assertFacultyAssignedToCourse(institutionId, actor, courseId);

  const db = forTenant(institutionId);
  const exams = await db.exam.findMany({
    where: { courseId },
    include: {
      versions: {
        where: { isActive: true },
        take: 1,
        include: {
          examQuestions: { select: { points: true } },
          examAttempts: {
            where: { status: { in: ["SUBMITTED", "GRADED", "TERMINATED"] } },
            select: { status: true, answers: { select: { pointsAwarded: true } } },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return exams.map((exam) => {
    const version = exam.versions[0];
    const attempts = version?.examAttempts ?? [];
    const maxPoints = version?.examQuestions.reduce((sum, q) => sum + q.points, 0) ?? 0;

    const graded = attempts.filter((a) => a.status === "GRADED");
    const pending = attempts.filter((a) => a.status === "SUBMITTED");
    const terminated = attempts.filter((a) => a.status === "TERMINATED");

    const averageScorePercent =
      graded.length > 0 && maxPoints > 0
        ? (graded.reduce((sum, a) => sum + a.answers.reduce((s, ans) => s + (ans.pointsAwarded ?? 0), 0), 0) /
            (graded.length * maxPoints)) *
          100
        : null;

    return {
      examId: exam.id,
      title: exam.title,
      status: exam.status,
      submittedCount: attempts.length,
      pendingCount: pending.length,
      gradedCount: graded.length,
      terminatedCount: terminated.length,
      averageScorePercent,
    };
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
  const previousPoints = answer.pointsAwarded;

  await db.examAnswer.update({
    where: { id: examAnswerId },
    data: { pointsAwarded: clamped, autoGraded: false, gradedAt: new Date(), gradedById: actor.id },
  });

  // The single most important audit record in the system: "who changed
  // this grade, from what, to what, and when". Records the previous value
  // explicitly — a grade change is only meaningful in an appeal if the
  // prior score is recoverable, and the row it overwrote is gone.
  await logAudit({
    institutionId,
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.gradeAssign,
    resourceType: "exam_answer",
    resourceId: examAnswerId,
    result: "SUCCESS",
    metadata: {
      attemptId: answer.attemptId,
      studentId: answer.attempt.studentId,
      previousPoints,
      newPoints: clamped,
      maxPoints: answer.examQuestion.points,
      requestedPoints: pointsAwarded,
      wasClamped: pointsAwarded !== clamped,
      overrodeAutoGrade: answer.autoGraded,
    },
  });

  const remaining = await db.examAnswer.findMany({ where: { attemptId: answer.attemptId } });
  const allGraded = remaining.every((a) => a.pointsAwarded !== null);
  if (allGraded) {
    await db.examAttempt.update({ where: { id: answer.attemptId }, data: { status: "GRADED", gradedAt: new Date() } });
  }
}
