"use client";

import { useState, type ReactNode } from "react";

export interface QuestionPagerMeta {
  id: string;
  flagged: boolean;
  answered: boolean;
}

/**
 * Shows one question at a time with a palette to jump between them, per the
 * real secure-exam UX benchmark (Next/Previous, flag-and-return-later).
 * Every question's fieldset stays mounted in the underlying <form> — this
 * only controls which one is visible — so Save Progress and Submit Exam
 * keep working exactly as before regardless of which question is on screen.
 *
 * The palette's flagged/answered dots reflect the last-saved state, not live
 * keystrokes — same simplification as the "Flagged" badge elsewhere on this
 * page, which also only updates after a Save Progress round-trip.
 */
export function ExamQuestionPager({ questions, children }: { questions: QuestionPagerMeta[]; children: ReactNode[] }) {
  const [active, setActive] = useState(0);
  const total = questions.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {questions.map((q, i) => (
          <button
            key={q.id}
            type="button"
            onClick={() => setActive(i)}
            aria-current={i === active}
            className={
              "relative h-8 w-8 rounded border text-xs font-medium " +
              (i === active
                ? "border-black bg-black text-white"
                : q.answered
                  ? "border-gray-300 bg-gray-100 text-gray-700"
                  : "border-gray-300 bg-white text-gray-500")
            }
          >
            {i + 1}
            {q.flagged && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-400" aria-label="Flagged" />
            )}
          </button>
        ))}
      </div>

      {children.map((child, i) => (
        <div key={i} className={i === active ? "" : "hidden"}>
          {child}
        </div>
      ))}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setActive((i) => Math.max(0, i - 1))}
          disabled={active === 0}
          className="rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Previous
        </button>
        <span className="text-xs text-gray-500">
          Question {active + 1} of {total}
        </span>
        <button
          type="button"
          onClick={() => setActive((i) => Math.min(total - 1, i + 1))}
          disabled={active === total - 1}
          className="rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
