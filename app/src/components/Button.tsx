"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes } from "react";
import { BUTTON_BASE, BUTTON_VARIANTS, type ButtonVariant } from "./button-styles";

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/**
 * The one primitive in this design system that has to be a client
 * component: `useFormStatus` reads the nearest ancestor <form>'s pending
 * state, so every `type="submit"` Button gets a spinner + auto-disable for
 * free with zero per-page wiring — every server action in this app is a
 * plain `<form action={...}>`, so this covers all of them automatically.
 * `type="button"` instances (ExamEntryGate's step buttons, ExamQuestionPager's
 * nav) are unaffected — `isSubmitting` only gates on `type="submit"`, and
 * `useFormStatus` itself is a no-op (`pending: false`) outside any <form>.
 */
export function Button({
  variant = "primary",
  className = "",
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const { pending } = useFormStatus();
  const isSubmitting = pending && props.type === "submit";

  return (
    <button
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`}
      disabled={disabled || isSubmitting}
      aria-busy={isSubmitting || undefined}
      {...props}
    >
      {isSubmitting && <Spinner />}
      {children}
    </button>
  );
}
