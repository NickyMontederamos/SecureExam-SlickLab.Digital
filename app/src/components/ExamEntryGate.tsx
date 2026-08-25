"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type GateStep = "rules" | "device" | "identity" | "room" | "proctor" | "starting";

const STEP_LABELS: Record<Exclude<GateStep, "rules">, string> = {
  device: "Checking your device…",
  identity: "Capturing ID…",
  room: "Scanning your surroundings…",
  proctor: "Waiting for proctor approval…",
  starting: "Starting your exam…",
};

/** How long each mocked gate step is shown before advancing — pacing for a demo, not a real check duration. */
const STEP_DELAY_MS = 1400;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Races a promise against a timeout. Needed specifically for
 * requestFullscreen(): some browsers/automation contexts neither resolve nor
 * reject it, they just leave it pending forever — a plain try/catch doesn't
 * protect against that, and this is a "soft" check that must never block the
 * exam from starting (see the file-level comment below).
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, wait(ms).then(() => undefined)]);
}

/**
 * Everything between "I agree to the rules" and the exam actually starting.
 * Device/ID/room-scan/proctor steps are deliberately mocked (no real camera
 * access, no real proctor) per docs/PITCH_ROADMAP.md — this demonstrates the
 * gate sequence a real secure-exam app has, without the infrastructure
 * (staffed proctor console, identity verification vendor) a pitch-stage
 * prototype doesn't have yet. Fullscreen is the one real check here, and
 * it's soft: exiting/denying it never blocks the exam, it just becomes the
 * first thing the in-exam integrity monitor can flag once questions start.
 */
export function ExamEntryGate({
  examId,
  startAttemptAction,
}: {
  examId: string;
  startAttemptAction: (examId: string) => Promise<string>;
}) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [step, setStep] = useState<GateStep>("rules");
  const [error, setError] = useState<string | null>(null);

  async function runGateSequence() {
    setStep("device");
    try {
      const request = document.documentElement.requestFullscreen?.();
      if (request) {
        await withTimeout(request, 1500);
      }
    } catch {
      // Soft check — proceed regardless. See ExamEntryGate's file comment.
    }
    await wait(STEP_DELAY_MS);

    setStep("identity");
    await wait(STEP_DELAY_MS);

    setStep("room");
    await wait(STEP_DELAY_MS);

    setStep("proctor");
    await wait(STEP_DELAY_MS * 1.3);

    setStep("starting");
    try {
      const attemptId = await startAttemptAction(examId);
      router.push(`/attempts/${attemptId}`);
    } catch {
      setError("Couldn't start the exam. Please try again.");
      setStep("rules");
    }
  }

  if (step !== "rules") {
    return (
      <div className="flex flex-col items-center gap-3 rounded border p-8 text-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
        <p className="text-sm font-medium">{STEP_LABELS[step]}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        I have read and agree to the exam rules above.
      </label>
      <button
        type="button"
        disabled={!agreed}
        onClick={runGateSequence}
        className="self-start rounded bg-black px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        Book &amp; Start Exam
      </button>
    </div>
  );
}
