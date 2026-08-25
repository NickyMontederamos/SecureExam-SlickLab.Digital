"use server";

import type { AttemptEventType } from "@prisma/client";
import { auth } from "@/auth";
import { recordAttemptEvent } from "@/lib/integrity";

/**
 * Called directly from the client-side IntegrityMonitor (not a form submit)
 * whenever a blur/visibility/fullscreen-exit signal fires during an exam
 * attempt. A dedicated "use server" file, not an inline action in the page,
 * because this needs to be invoked as a plain async call from client code —
 * see docs/ERROR_LOG.md ERROR-004 for why inline actions and shared plain
 * helpers don't mix safely inside that Server Component.
 */
export async function recordIntegrityEventAction(attemptId: string, type: AttemptEventType) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    throw new Error("Not authenticated");
  }

  return recordAttemptEvent(session.user.institutionId, session.user, attemptId, type);
}
