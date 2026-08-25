import type { Role } from "@prisma/client";
import { assertCan } from "./rbac";
import { forTenant } from "./tenant-db";
import { AttemptAlreadyFinishedError, AttemptNotFoundError, AttemptOwnershipError } from "./attempts";

/** A PROCTOR acting on an attempt outside every course they're assigned to via CourseProctor — see courses.ts's assignProctor. */
export class ProctorNotAssignedError extends Error {
  constructor(attemptId: string) {
    super(`Attempt ${attemptId} is not in a course this proctor is assigned to`);
    this.name = "ProctorNotAssignedError";
  }
}

export class SubmissionNotFoundError extends Error {
  constructor(attemptId: string) {
    super(`Attempt ${attemptId} has no submission to verify yet`);
    this.name = "SubmissionNotFoundError";
  }
}

async function assignedCourseIds(db: ReturnType<typeof forTenant>, proctorId: string) {
  const rows = await db.courseProctor.findMany({ where: { userId: proctorId }, select: { courseId: true } });
  return rows.map((r) => r.courseId);
}

/**
 * Booked (not yet started) attempts across every course this proctor is
 * assigned to — the proctor dashboard's main queue (docs/PITCH_ROADMAP.md
 * Milestone 5). Mirrors listCoursesForUser's FACULTY branch, scoped through
 * CourseProctor instead of CourseFaculty.
 */
export async function listBookedAttemptsForProctor(institutionId: string, actor: { id: string; role: Role }) {
  assertCan(actor.role, "exam_attempt", "read");

  const db = forTenant(institutionId);
  const courseIds = await assignedCourseIds(db, actor.id);
  if (courseIds.length === 0) {
    return [];
  }

  return db.examAttempt.findMany({
    where: { status: "NOT_STARTED", examVersion: { exam: { courseId: { in: courseIds } } } },
    include: { student: true, examVersion: { include: { exam: true } } },
    orderBy: { scheduledFor: "asc" },
  });
}

/**
 * Student signals "ready to start, waiting for a proctor" — called from the
 * entry gate once its device/identity/room-scan steps finish, replacing the
 * old scripted "Waiting for proctor…" delay. Idempotent: a second call
 * (e.g. the gate re-running after a page reload) doesn't reset the
 * timestamp, so an already-pending request can't lose its place.
 */
export async function requestProctorApproval(institutionId: string, actor: { id: string; role: Role }, attemptId: string) {
  assertCan(actor.role, "exam_attempt", "take");

  const db = forTenant(institutionId);
  const attempt = await db.examAttempt.findFirst({ where: { id: attemptId } });
  if (!attempt) {
    throw new AttemptNotFoundError(attemptId);
  }
  if (attempt.studentId !== actor.id) {
    throw new AttemptOwnershipError(attemptId);
  }
  if (attempt.status !== "NOT_STARTED") {
    throw new AttemptAlreadyFinishedError(attemptId);
  }

  return db.examAttempt.update({
    where: { id: attemptId },
    data: { proctorRequestedAt: attempt.proctorRequestedAt ?? new Date() },
  });
}

/** Whether a booked attempt's proctor-approval request has been approved yet — cheap poll target for the entry gate's waiting step. */
export async function checkProctorApproval(institutionId: string, actor: { id: string; role: Role }, attemptId: string) {
  assertCan(actor.role, "exam_attempt", "take");

  const db = forTenant(institutionId);
  const attempt = await db.examAttempt.findFirst({ where: { id: attemptId } });
  if (!attempt) {
    throw new AttemptNotFoundError(attemptId);
  }
  if (attempt.studentId !== actor.id) {
    throw new AttemptOwnershipError(attemptId);
  }

  return attempt.proctorApprovedAt !== null;
}

/** Requests waiting on this proctor's decision, across their assigned courses — the "start" half of the proctor dashboard. */
export async function listPendingApprovalsForProctor(institutionId: string, actor: { id: string; role: Role }) {
  assertCan(actor.role, "exam_attempt", "approve");

  const db = forTenant(institutionId);
  const courseIds = await assignedCourseIds(db, actor.id);
  if (courseIds.length === 0) {
    return [];
  }

  return db.examAttempt.findMany({
    where: {
      status: "NOT_STARTED",
      proctorRequestedAt: { not: null },
      proctorApprovedAt: null,
      examVersion: { exam: { courseId: { in: courseIds } } },
    },
    include: { student: true, examVersion: { include: { exam: true } } },
    orderBy: { proctorRequestedAt: "asc" },
  });
}

/**
 * Proctor approves a student's start request — the real gate beginBookedAttempt
 * checks (see attempts.ts). Refuses a proctor acting on a course they're not
 * assigned to, not just any PROCTOR in the institution (same reasoning as
 * grading being scoped to a course's faculty, not every FACULTY user).
 */
export async function approveProctorStart(institutionId: string, actor: { id: string; role: Role }, attemptId: string) {
  assertCan(actor.role, "exam_attempt", "approve");

  const db = forTenant(institutionId);
  const attempt = await db.examAttempt.findFirst({
    where: { id: attemptId },
    include: { examVersion: { include: { exam: true } } },
  });
  if (!attempt) {
    throw new AttemptNotFoundError(attemptId);
  }
  const assigned = await db.courseProctor.findFirst({
    where: { courseId: attempt.examVersion.exam.courseId, userId: actor.id },
  });
  if (!assigned) {
    throw new ProctorNotAssignedError(attemptId);
  }
  if (attempt.status !== "NOT_STARTED") {
    throw new AttemptAlreadyFinishedError(attemptId);
  }

  return db.examAttempt.update({
    where: { id: attemptId },
    data: { proctorApprovedAt: attempt.proctorApprovedAt ?? new Date() },
  });
}

/** Submitted/graded attempts still waiting on this proctor's "approve to finish" sign-off — the "finish" half of the proctor dashboard. */
export async function listPendingVerificationsForProctor(institutionId: string, actor: { id: string; role: Role }) {
  assertCan(actor.role, "exam_attempt", "approve");

  const db = forTenant(institutionId);
  const courseIds = await assignedCourseIds(db, actor.id);
  if (courseIds.length === 0) {
    return [];
  }

  return db.examAttempt.findMany({
    where: {
      status: { in: ["SUBMITTED", "GRADED"] },
      submission: { verifiedAt: null },
      examVersion: { exam: { courseId: { in: courseIds } } },
    },
    include: { student: true, examVersion: { include: { exam: true } }, submission: true },
    orderBy: { submittedAt: "asc" },
  });
}

/**
 * The real "approve to finish" step (docs/PITCH_ROADMAP.md Milestone 5):
 * a student's result stays hidden behind a waiting screen until a proctor
 * assigned to the exam's course sets this. Submission has no institutionId
 * of its own (see tenant-db.ts) — ownership is verified explicitly via the
 * parent attempt, already confirmed tenant-scoped above, same pattern as
 * gradeAnswer in grading.ts.
 */
export async function verifySubmission(institutionId: string, actor: { id: string; role: Role }, attemptId: string) {
  assertCan(actor.role, "exam_attempt", "approve");

  const db = forTenant(institutionId);
  const attempt = await db.examAttempt.findFirst({
    where: { id: attemptId },
    include: { examVersion: { include: { exam: true } }, submission: true },
  });
  if (!attempt) {
    throw new AttemptNotFoundError(attemptId);
  }
  const assigned = await db.courseProctor.findFirst({
    where: { courseId: attempt.examVersion.exam.courseId, userId: actor.id },
  });
  if (!assigned) {
    throw new ProctorNotAssignedError(attemptId);
  }
  if (!attempt.submission) {
    throw new SubmissionNotFoundError(attemptId);
  }
  if (attempt.submission.verifiedAt) {
    return attempt.submission;
  }

  return db.submission.update({
    where: { id: attempt.submission.id },
    data: { verifiedAt: new Date(), verifiedById: actor.id },
  });
}
