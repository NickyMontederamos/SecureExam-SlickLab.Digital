/**
 * Shared between Button.tsx (client — needs useFormStatus) and ui.tsx's
 * LinkButton (server-safe — plain navigation, no form state). Kept in a
 * plain .ts file with no "use client" so importing it never forces a
 * server component into the client bundle.
 */

export const BUTTON_VARIANTS = {
  primary: "bg-brand-primary text-white shadow-sm hover:brightness-110 hover:shadow-md focus-visible:brightness-110",
  secondary: "border border-slate-300 bg-white text-slate-900 shadow-sm hover:bg-slate-50 hover:shadow-md",
  danger: "bg-red-700 text-white shadow-sm hover:bg-red-800 hover:shadow-md",
  success: "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 hover:shadow-md",
  ghost: "text-slate-600 hover:bg-slate-100",
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium " +
  "transition-all duration-200 ease-in-out active:scale-[0.97] " +
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 disabled:hover:shadow-none disabled:hover:brightness-100";
