import type { CSSProperties, ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { getDemoInstitutionBranding } from "@/lib/branding";

/**
 * Shared chrome for every authenticated route (dashboard, courses, exams,
 * attempts, admin, users). /login sits outside this route group deliberately
 * — it has its own centered branding treatment and shouldn't get a second
 * header above it.
 *
 * Sets --brand-primary/--brand-secondary (see globals.css) from the signed-in
 * institution's branding, scoped to this wrapper so every `bg-brand-primary`
 * etc. utility anywhere in the authenticated app reflects the actual tenant
 * instead of a hardcoded color — before this pass, institution branding
 * colors were only ever used on the login page's button.
 *
 * `force-dynamic` is required, not just a hardening default: this layout's
 * own DB call (unlike AppHeader's auth()/cookies() call) isn't the kind of
 * API Next.js treats as an automatic dynamic-rendering signal, so without
 * this it will attempt to statically prerender the shell at `next build`
 * time — executing a real Postgres query during the build, which breaks the
 * build whenever Postgres isn't reachable there (exactly the concern
 * docs/DEPLOYMENT.md already raises about production build environments not
 * always having DB access) and would bake branding into a stale static
 * shell even when it works. Every route here was already effectively
 * dynamic via auth()'s cookies() access — this just makes it explicit.
 */
export const dynamic = "force-dynamic";

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const branding = await getDemoInstitutionBranding();

  const brandStyle: CSSProperties & Record<string, string> = {};
  if (branding?.primaryColor) brandStyle["--brand-primary"] = branding.primaryColor;
  if (branding?.secondaryColor) brandStyle["--brand-secondary"] = branding.secondaryColor;

  return (
    <div className="flex min-h-full flex-col bg-slate-50" style={brandStyle}>
      <AppHeader />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
