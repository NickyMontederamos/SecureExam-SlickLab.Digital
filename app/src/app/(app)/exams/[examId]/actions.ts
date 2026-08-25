"use server";

import { auth } from "@/auth";
import { startAttempt } from "@/lib/attempts";

/**
 * Starts a student's attempt. Called from the client-side ExamEntryGate only
 * after its mock device/ID/room-scan/proctor sequence finishes — not the
 * moment "Book & Start Exam" is clicked — so the exam timer (which starts
 * from this call, see attempts.ts) doesn't burn time on the simulated gate.
 */
export async function startAttemptAction(examId: string) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    throw new Error("Not authenticated");
  }

  const attempt = await startAttempt(session.user.institutionId, session.user, examId);
  return attempt.id;
}
