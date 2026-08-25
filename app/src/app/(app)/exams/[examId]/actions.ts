"use server";

import { auth } from "@/auth";
import { beginBookedAttempt } from "@/lib/attempts";

/**
 * Called from ExamEntryGate only after its mocked device/ID/room-scan/
 * proctor sequence finishes — not the moment "Start Exam" is clicked — so
 * the exam timer (which starts from this call, see beginBookedAttempt)
 * doesn't burn time on the simulated gate.
 */
export async function beginAttemptAction(attemptId: string) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    throw new Error("Not authenticated");
  }

  await beginBookedAttempt(session.user.institutionId, session.user, attemptId);
}
