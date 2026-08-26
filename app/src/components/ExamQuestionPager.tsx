"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";

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
              "relative h-8 w-8 rounded-lg border text-xs font-medium transition-colors " +
              (i === active
                ? "border-brand-primary bg-brand-primary text-white"
                : q.answered
                  ? "border-slate-300 bg-slate-100 text-slate-700"
                  : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50")
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
        <Button
          type="button"
          variant="secondary"
          onClick={() => setActive((i) => Math.max(0, i - 1))}
          disabled={active === 0}
        >
          ← Previous
        </Button>
        <span className="text-xs text-slate-500">
          Question {active + 1} of {total}
        </span>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setActive((i) => Math.min(total - 1, i + 1))}
          disabled={active === total - 1}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}
