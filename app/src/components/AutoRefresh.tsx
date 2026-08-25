"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Short-interval polling for screens that need to reflect another actor's
 * action without a page reload — the proctor dashboard's queues and a
 * student's post-submission wait for proctor verification
 * (docs/PITCH_ROADMAP.md Milestone 5). Renders nothing; just re-fetches the
 * current Server Component on an interval. This app has no WebSocket/SSE
 * infrastructure, so polling is the pattern-consistent choice, not a
 * real-time push — a few seconds of lag is an accepted trade-off.
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
