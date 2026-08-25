"use server";

import { auth } from "@/auth";
import { beginBookedAttempt } from "@/lib/attempts";
import { checkProctorApproval, requestProctorApproval } from "@/lib/proctoring";

/**
 * Called from ExamEntryGate only after its device/ID/room-scan checks
 * finish and a proctor has actually approved the request — not the moment
 * "Start Exam" is clicked — so the exam timer (which starts from this call,
 * see beginBookedAttempt) doesn't burn time on the gate sequence or the
 * proctor wait.
 */
export async function beginAttemptAction(attemptId: string) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    throw new Error("Not authenticated");
  }

  await beginBookedAttempt(session.user.institutionId, session.user, attemptId);
}

/** Real replacement for the old scripted "Waiting for proctor…" delay — signals the student is ready. */
export async function requestProctorApprovalAction(attemptId: string) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    throw new Error("Not authenticated");
  }

  await requestProctorApproval(session.user.institutionId, session.user, attemptId);
}

/** Poll target for the entry gate's waiting step — see ExamEntryGate.tsx. */
export async function checkProctorApprovalAction(attemptId: string): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    throw new Error("Not authenticated");
  }

  return checkProctorApproval(session.user.institutionId, session.user, attemptId);
}
