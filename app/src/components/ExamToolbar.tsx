"use client";

import { useState } from "react";

function computeOp(a: number, b: number, op: string): number {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "×":
      return a * b;
    case "÷":
      return b === 0 ? NaN : a / b;
    default:
      return b;
  }
}

function Calculator() {
  const [display, setDisplay] = useState("0");
  const [pending, setPending] = useState<{ value: number; op: string } | null>(null);

  function pressDigit(d: string) {
    setDisplay((prev) => (prev === "0" ? d : prev + d));
  }

  function pressDecimal() {
    setDisplay((prev) => (prev.includes(".") ? prev : prev + "."));
  }

  function pressOperator(op: string) {
    const current = Number.parseFloat(display);
    if (pending) {
      const result = computeOp(pending.value, current, pending.op);
      setDisplay(String(result));
      setPending(op === "=" ? null : { value: result, op });
    } else if (op !== "=") {
      setPending({ value: current, op });
    }
    if (op !== "=") setDisplay("0");
  }

  function clearAll() {
    setDisplay("0");
    setPending(null);
  }

  const keys = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "-", "0", ".", "=", "+"];

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded bg-gray-100 p-2 text-right font-mono text-lg tabular-nums">{display}</div>
      <div className="grid grid-cols-4 gap-1">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              if (/[0-9]/.test(k)) pressDigit(k);
              else if (k === ".") pressDecimal();
              else pressOperator(k);
            }}
            className="rounded border py-1 text-sm hover:bg-gray-50"
          >
            {k}
          </button>
        ))}
      </div>
      <button type="button" onClick={clearAll} className="rounded border py-1 text-xs text-gray-500 hover:bg-gray-50">
        Clear
      </button>
    </div>
  );
}

function Notepad() {
  const [text, setText] = useState("");
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      rows={8}
      placeholder="Scratch notes — not saved, cleared on reload"
      className="w-full resize-none rounded border p-2 text-sm"
    />
  );
}

/**
 * In-exam scratch tools (master prompt UX benchmark: real secure-exam apps
 * ship a timer, calculator, and notepad alongside the questions). Both tools
 * are intentionally client-only scratch state — nothing here is graded or
 * persisted, so there's no server round-trip or exam-integrity surface to it.
 */
export function ExamToolbar() {
  const [open, setOpen] = useState<"calculator" | "notepad" | null>(null);

  return (
    <div className="fixed left-3 top-16 z-40 flex flex-col items-start gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(open === "calculator" ? null : "calculator")}
          className="rounded border bg-white px-3 py-1.5 text-xs shadow-sm hover:bg-gray-50"
        >
          Calculator
        </button>
        <button
          type="button"
          onClick={() => setOpen(open === "notepad" ? null : "notepad")}
          className="rounded border bg-white px-3 py-1.5 text-xs shadow-sm hover:bg-gray-50"
        >
          Notepad
        </button>
      </div>
      {open && (
        <div className="w-64 rounded border bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase text-gray-500">
              {open === "calculator" ? "Calculator" : "Notepad"}
            </span>
            <button type="button" onClick={() => setOpen(null)} className="text-xs text-gray-400 hover:text-gray-700">
              Close
            </button>
          </div>
          {open === "calculator" ? <Calculator /> : <Notepad />}
        </div>
      )}
    </div>
  );
}
