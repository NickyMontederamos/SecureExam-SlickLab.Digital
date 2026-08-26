"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Ticks down to a server-computed deadline and clicks the real submit button
 * when it hits zero. The deadline is an absolute epoch ms, not a duration,
 * so a stale client clock can only make this fire early or late by its own
 * drift rather than by miscounting elapsed time.
 *
 * This component is a COURTESY DISPLAY, not a security control. A student
 * can stop it trivially — close the tab, disable JS, kill the network — and
 * nothing here would notice. Actual enforcement lives server-side in
 * `saveAnswers()`, which refuses any answer written after the attempt's
 * stored `expiresAt` and finalizes the attempt instead.
 *
 * That distinction previously did not hold. This docstring used to claim
 * "submitAttempt re-derives the deadline server-side", which was false: no
 * write path checked the deadline, and an answer could be saved and awarded
 * full credit hours after time expired (reproduced against real Postgres —
 * see finding A-01 in docs/WORLD_CLASS_AUDIT.md). Do not describe this
 * component as an enforcement mechanism again.
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
    return <p className="text-sm text-slate-500">Loading time remaining…</p>;
  }

  const clamped = Math.max(0, remainingMs);
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const isLow = clamped < 60_000;

  return (
    <p
      className={
        "inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium tabular-nums transition-colors " +
        (isLow ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600")
      }
      role="timer"
      aria-live="polite"
    >
      {minutes}:{seconds.toString().padStart(2, "0")} remaining
    </p>
  );
}
