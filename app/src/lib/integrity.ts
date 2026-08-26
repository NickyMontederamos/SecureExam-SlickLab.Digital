import type { AttemptEventType, Role } from "@prisma/client";
import { assertCan, ForbiddenError } from "./rbac";
import { forTenant } from "./tenant-db";
import { AttemptNotFoundError, AttemptOwnershipError } from "./attempts";
import { ExamNotFoundError } from "./exams";

/** How many warning-worthy signals before an attempt auto-pauses. Not institution-configurable yet — see docs/PITCH_ROADMAP.md. */
const WARNING_THRESHOLD = 3;

/**
 * Only these count toward the 3-strike threshold. NETWORK_OFFLINE/ONLINE are
 * logged (so faculty see them in the review trail for context) but never
 * counted — a dropped connection isn't the student's fault and must never
 * read as misconduct, per the same principle already stated on the review screen.
 * Exported so every "how many strikes" display (grading list, review page)
 * reads from one definition instead of each guessing its own copy.
 */
export const STRIKE_EVENT_TYPES: AttemptEventType[] = ["WINDOW_BLUR", "VISIBILITY_HIDDEN", "FULLSCREEN_EXIT"];

export class AttemptNotInProgressError extends Error {
  constructor(attemptId: string) {
    super(`Attempt ${attemptId} is not in progress`);
    this.name = "AttemptNotInProgressError";
  }
}

/**
 * Records one integrity signal (tab-blur, visibility-hidden, fullscreen-exit)
 * for a student's own in-progress attempt, and auto-pauses it the moment the
 * warning count reaches WARNING_THRESHOLD. The count is derived by reading
 * the event log back, never stored redundantly — this table is the single
 * source of truth, per docs/PITCH_ROADMAP.md's "event log, not a bare
 * counter" principle.
 */
export async function recordAttemptEvent(
  institutionId: string,
  actor: { id: string; role: Role },
  attemptId: string,
  type: AttemptEventType
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
    // The attempt already paused/finished from an earlier event or a normal
    // submit — nothing to do, and definitely don't re-pause an already-final attempt.
    return { warningCount: WARNING_THRESHOLD, paused: attempt.status === "INTERRUPTED" };
  }

  await db.attemptEvent.create({ data: { attemptId, type } });

  // Always computed from STRIKE_EVENT_TYPES only, regardless of what type
  // was just recorded — logging a network event must never move this
  // number, so the visible "Warning X of 3" banner never reacts to a
  // connection drop.
  const warningCount = await db.attemptEvent.count({ where: { attemptId, type: { in: STRIKE_EVENT_TYPES } } });
  const paused = warningCount >= WARNING_THRESHOLD;

  if (paused) {
    // pausedAt stops the exam clock for the duration of the faculty review
    // — see resolveIntegrityReview, which credits the paused time back to
    // expiresAt on reinstatement. Without this, a student would be charged
    // exam time for a review that might well clear them.
    await db.examAttempt.update({
      where: { id: attemptId },
      data: { status: "INTERRUPTED", pausedAt: new Date() },
    });
  }

  return { warningCount, paused };
}

/** Current warning count for one attempt — read fresh from the event log on every page load, never cached on the attempt row. Network events don't count — see STRIKE_EVENT_TYPES. */
export async function getWarningCount(institutionId: string, attemptId: string) {
  const db = forTenant(institutionId);
  return db.attemptEvent.count({ where: { attemptId, type: { in: STRIKE_EVENT_TYPES } } });
}

/** Attempts currently paused for integrity review, for the faculty queue. */
export async function listIntegrityReviewsForExam(institutionId: string, actor: { role: Role }, examId: string) {
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
    where: { examVersionId: version.id, status: "INTERRUPTED" },
    include: { student: true, events: { orderBy: { occurredAt: "asc" } } },
  });
}

/**
 * Full event trail + attempt context for one review — the evidence a faculty
 * member actually reads before deciding. Explicitly faculty/admin-only: the
 * "grade":"read" permission is shared with STUDENT (for viewing their own
 * result), which is too coarse here — a student must never see this screen,
 * not even their own, since it's evidence for someone else's decision.
 */
export async function getIntegrityReview(institutionId: string, actor: { role: Role }, attemptId: string) {
  assertCan(actor.role, "grade", "read");
  if (actor.role === "STUDENT") {
    throw new ForbiddenError(actor.role, "grade", "read");
  }

  const db = forTenant(institutionId);

  const attempt = await db.examAttempt.findFirst({
    where: { id: attemptId },
    include: {
      student: true,
      events: { orderBy: { occurredAt: "asc" } },
      examVersion: { include: { exam: true } },
    },
  });
  if (!attempt) {
    throw new AttemptNotFoundError(attemptId);
  }

  return attempt;
}

/**
 * Faculty decision on a paused attempt. REINSTATE returns it to IN_PROGRESS
 * so the student can resume (their answers so far are untouched). FAIL
 * confirms it as TERMINATED — a human decision on top of the machine's
 * signal, never automatic (see docs/PITCH_ROADMAP.md Milestone 2).
 */
export async function resolveIntegrityReview(
  institutionId: string,
  actor: { role: Role },
  attemptId: string,
  decision: "REINSTATE" | "FAIL"
) {
  assertCan(actor.role, "grade", "grade");

  const db = forTenant(institutionId);

  const attempt = await db.examAttempt.findFirst({ where: { id: attemptId } });
  if (!attempt) {
    throw new AttemptNotFoundError(attemptId);
  }
  if (attempt.status !== "INTERRUPTED") {
    throw new AttemptNotInProgressError(attemptId);
  }

  if (decision === "REINSTATE") {
    // Credit back the time this attempt spent paused, so a review never
    // eats into the student's exam time — least of all one that clears
    // them. Guarded on both fields: a legacy attempt paused before these
    // columns existed simply resumes on its original deadline rather than
    // crashing or silently gaining unlimited time.
    const pausedMs = attempt.pausedAt ? Date.now() - attempt.pausedAt.getTime() : 0;
    const extendedExpiry =
      attempt.expiresAt && pausedMs > 0 ? new Date(attempt.expiresAt.getTime() + pausedMs) : attempt.expiresAt;

    return db.examAttempt.update({
      where: { id: attemptId },
      data: { status: "IN_PROGRESS", pausedAt: null, expiresAt: extendedExpiry },
    });
  }

  return db.examAttempt.update({
    where: { id: attemptId },
    data: { status: "TERMINATED", submittedAt: new Date(), gradedAt: new Date() },
  });
}
