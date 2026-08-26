import type { AnchorHTMLAttributes, ReactNode } from "react";
import { BUTTON_BASE, BUTTON_VARIANTS, type ButtonVariant } from "./button-styles";

/**
 * Shared visual language for every authenticated page (docs/PITCH_ROADMAP.md
 * Milestone 6 — UI/UX pass, refreshed in Milestone 7 for a friendlier feel).
 * Before this, every page hand-rolled its own `rounded border p-3 text-sm`
 * markup with no shared source of truth, so status colors and spacing
 * drifted page to page. These primitives are the fix: one definition per
 * pattern, reused everywhere. `bg-brand-primary` / `text-brand-primary` etc.
 * resolve through the `--brand-primary` CSS variable set at runtime from the
 * signed-in institution's branding (see (app)/layout.tsx) — never hardcode a
 * hex color for a primary action here.
 *
 * Button itself lives in ./Button.tsx (a client component — it needs
 * useFormStatus for automatic submit-pending states) and is re-exported
 * here so every existing `from "@/components/ui"` import keeps working
 * unchanged.
 */

export type { ButtonVariant };
export { Button } from "./Button";

/** Same visual language as Button, for navigation that must render as a link (e.g. "View Result") — never a form submit target, so no pending-state wiring needed. */
export function LinkButton({
  variant = "primary",
  className = "",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant }) {
  return <a className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`} {...props} />;
}

/**
 * A plain content container — the default "box" every page used to
 * hand-roll. Pass `interactive` for a hoverable clickable card (e.g. a list
 * row that's an <a>). Pass `as="fieldset"` when the card needs to be a real
 * <fieldset> (e.g. wrapping a <legend> in the exam-taking form) — everything
 * else about the styling stays identical.
 */
export function Card({
  children,
  className = "",
  interactive = false,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  as?: "div" | "fieldset";
}) {
  return (
    <Tag
      className={
        "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 ease-in-out " +
        (interactive ? "hover:-translate-y-0.5 hover:shadow-md " : "") +
        className
      }
    >
      {children}
    </Tag>
  );
}

const BADGE_TONES = {
  gray: "bg-slate-100 text-slate-700",
  brand: "bg-brand-primary/10 text-brand-primary",
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-blue-100 text-blue-800",
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

/** A small status pill — PUBLISHED/DRAFT, role tags, warning counters. One definition instead of every page re-deriving its own color className string. */
export function Badge({ tone = "gray", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

const ALERT_TONES = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
} as const;

/** A banner message — form errors, success confirmations, warnings. Replaces the `role="alert"` div every page used to redefine by hand. Fades/slides in on mount so it reads as a fresh event, not part of the static page. */
export function Alert({ tone, children }: { tone: keyof typeof ALERT_TONES; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`animate-fade-in rounded-xl border p-3 text-sm ${ALERT_TONES[tone]}`}
    >
      {children}
    </p>
  );
}

/**
 * Every page's header block: a back link, the title, an optional status
 * badge next to it, an optional subtitle line, and a right-aligned actions
 * slot. Consolidates a pattern that used to be copy-pasted (with small
 * drifts) at the top of every page in the app.
 */
export function PageHeader({
  backHref,
  backLabel = "Back",
  title,
  badge,
  subtitle,
  actions,
}: {
  backHref?: string;
  backLabel?: string;
  title: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-slate-200 pb-4">
      {backHref && (
        <a
          href={backHref}
          className="w-fit rounded-md text-sm text-slate-500 transition-colors duration-200 hover:text-brand-primary"
        >
          ← {backLabel}
        </a>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {badge}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

/** A section within a page — a heading plus a card's worth of content, used for every "Questions", "Faculty", "Add a question" etc. block. */
export function Section({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="text-xs text-slate-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** The "no data yet" state — was a bare gray paragraph everywhere; now a soft, intentional-looking placeholder with an icon accent instead of reading as broken or unfinished. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center text-sm text-slate-500">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 7.5 12 3l9 4.5M3 7.5v9L12 21m-9-4.5L12 21m0-13.5 9 4.5M12 21l9-4.5v-9"
          />
        </svg>
      </span>
      <span>{children}</span>
    </div>
  );
}

export const inputClassName =
  "rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 " +
  "transition-all duration-200 ease-in-out focus:border-brand-primary focus:outline-none";

export const labelClassName = "flex flex-col gap-1 text-sm font-medium text-slate-700";
