"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { approveProctorStart, cancelAttempt, verifySubmission } from "@/lib/proctoring";

export async function approveStartAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    throw new Error("Not authenticated");
  }
  const attemptId = String(formData.get("attemptId") ?? "");
  if (!attemptId) return;

  await approveProctorStart(session.user.institutionId, session.user, attemptId);
  revalidatePath("/proctor");
}

export async function verifySubmissionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    throw new Error("Not authenticated");
  }
  const attemptId = String(formData.get("attemptId") ?? "");
  if (!attemptId) return;

  await verifySubmission(session.user.institutionId, session.user, attemptId);
  revalidatePath("/proctor");
}

/** Admin-only "reset" action (exam_attempt:"delete" — see rbac.ts) — cancelAttempt itself re-checks the permission, this is just the wiring. */
export async function cancelAttemptAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    throw new Error("Not authenticated");
  }
  const attemptId = String(formData.get("attemptId") ?? "");
  if (!attemptId) return;

  await cancelAttempt(session.user.institutionId, session.user, attemptId);
  revalidatePath("/proctor");
}
