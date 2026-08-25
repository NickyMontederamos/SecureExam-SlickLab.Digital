"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Ticks down to a server-computed deadline and clicks the real submit button
 * when it hits zero. The deadline is an absolute epoch ms, not a duration —
 * a stale client clock can only make this fire early/late by its own drift,
 * never extend a student's time, since submitAttempt re-derives the deadline
 * server-side regardless of what this component displays.
 */
export function ExamCountdown({
  deadlineEpochMs,
  submitButtonId,
}: {
  deadlineEpochMs: number;
  submitButtonId: string;
}) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const remaining = deadlineEpochMs - Date.now();
      setRemainingMs(remaining);
      if (remaining <= 0 && !firedRef.current) {
        firedRef.current = true;
        document.getElementById(submitButtonId)?.click();
      }
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [deadlineEpochMs, submitButtonId]);

  // Avoids a hydration mismatch: the server has no business computing "time
  // since render" — the real value only exists once this mounts client-side.
  if (remainingMs === null) {
    return <p className="text-sm text-gray-500">Loading time remaining…</p>;
  }

  const clamped = Math.max(0, remainingMs);
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const isLow = clamped < 60_000;

  return (
    <p
      className={`text-sm font-medium tabular-nums ${isLow ? "text-red-600" : "text-gray-500"}`}
      role="timer"
      aria-live="polite"
    >
      {minutes}:{seconds.toString().padStart(2, "0")} remaining
    </p>
  );
}
