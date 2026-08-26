"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AttemptEventType } from "@prisma/client";
import { Alert } from "@/components/ui";

const WARNING_THRESHOLD = 3;

/**
 * Client-side half of the anti-cheat core (see docs/PITCH_ROADMAP.md
 * Milestone 2). Listens for the three signals a browser can actually detect
 * — tab/window blur, the page going hidden, and leaving fullscreen — and
 * reports each one to the server, which is the sole source of truth for the
 * warning count (see recordAttemptEvent in integrity.ts). This component
 * never decides "3 strikes" itself; it just displays whatever the server
 * says and reacts if the server reports the attempt just got auto-paused.
 *
 * Also reports network connectivity drops/recoveries — logged for the
 * faculty review trail's context, but never counted toward the warning
 * threshold (see STRIKE_EVENT_TYPES in integrity.ts): a bad connection isn't
 * the student's fault. Same reasoning is why this is deliberately NOT wired
 * to copy/paste — pasting into the in-exam Notepad shouldn't cost a strike either.
 */
export function IntegrityMonitor({
  attemptId,
  initialWarningCount,
  recordEventAction,
}: {
  attemptId: string;
  initialWarningCount: number;
  recordEventAction: (attemptId: string, type: AttemptEventType) => Promise<{ warningCount: number; paused: boolean }>;
}) {
  const router = useRouter();
  const [warningCount, setWarningCount] = useState(initialWarningCount);
  const pausedRef = useRef(false);

  useEffect(() => {
    async function report(type: AttemptEventType) {
      if (pausedRef.current) return;
      try {
        const result = await recordEventAction(attemptId, type);
        setWarningCount(result.warningCount);
        if (result.paused) {
          pausedRef.current = true;
          router.refresh();
        }
      } catch {
        // Best-effort signal — a failed report shouldn't crash the exam UI.
      }
    }

    function onBlur() {
      report("WINDOW_BLUR");
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        report("VISIBILITY_HIDDEN");
      }
    }
    function onFullscreenChange() {
      if (!document.fullscreenElement) {
        report("FULLSCREEN_EXIT");
      }
    }
    function onOffline() {
      report("NETWORK_OFFLINE");
    }
    function onOnline() {
      report("NETWORK_ONLINE");
    }

    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [attemptId, recordEventAction, router]);

  if (warningCount === 0) {
    return null;
  }

  return (
    <Alert tone="warning">
      Warning {Math.min(warningCount, WARNING_THRESHOLD)} of {WARNING_THRESHOLD} — leaving this window or exiting
      fullscreen is being logged. Reaching {WARNING_THRESHOLD} pauses the exam for faculty review.
    </Alert>
  );
}
