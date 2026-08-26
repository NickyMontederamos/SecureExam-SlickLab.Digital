import Image from "next/image";
import { auth, signOut } from "@/auth";
import { getDemoInstitutionBranding } from "@/lib/branding";
import { can } from "@/lib/rbac";
import { Button } from "@/components/ui";

/**
 * Institution branding + real navigation, shared by every authenticated
 * route via src/app/(app)/layout.tsx. Deliberately excludes the
 * SlickLab.Digital ownership credit (see BrandCredit) — this header is
 * "whose app is this for the end user", not "who built it".
 *
 * Before this pass, this was branding text plus a sign-out button with no
 * navigation at all — every page's only way "home" was a plain text
 * "← Dashboard" link, and nothing pointed to /users or /proctor except the
 * dashboard page itself. Nav links here are gated by the same `can()` checks
 * each destination page already enforces server-side, same as the rest of
 * this app's "no client-side-only authorization" rule (master prompt §9) —
 * this is a convenience shortcut, not the access control.
 */
export async function AppHeader() {
  const [session, branding] = await Promise.all([auth(), getDemoInstitutionBranding()]);
  const role = session?.user?.role;

  const navLinks = [
    { href: "/dashboard", label: "Dashboard", show: Boolean(role) },
    { href: "/users", label: "Users", show: role ? can(role, "user", "create") : false },
    // INSTITUTION_ADMIN now has institution-wide proctor authority too
    // (rbac.ts's exam_attempt "approve" — Milestone 6.5), so this reuses
    // the same permission check /proctor itself enforces server-side,
    // rather than hardcoding role === "PROCTOR".
    { href: "/proctor", label: "Proctor Queue", show: role ? can(role, "exam_attempt", "approve") : false },
    { href: "/audit", label: "Audit Log", show: role ? can(role, "audit_log", "read") : false },
    { href: "/admin", label: "Platform Admin", show: role === "SUPER_ADMIN" || role === "PLATFORM_ADMIN" },
  ].filter((link) => link.show);

  return (
    <header
      className="border-b border-slate-200 bg-white"
      style={{ borderBottomColor: "var(--brand-primary)", borderBottomWidth: session?.user ? "3px" : undefined }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div className="flex items-center gap-6">
          <a href="/dashboard" className="flex items-center gap-3">
            {branding?.sealUrl && (
              <Image src={branding.sealUrl} alt="College of Maasin seal" width={40} height={40} className="rounded-full" />
            )}
            {branding?.logoUrl && (
              <Image src={branding.logoUrl} alt="College of Law crest" width={34} height={40} className="h-auto w-[34px]" />
            )}
            <span className="text-sm font-semibold text-slate-900">{branding?.name ?? "CM-Law SecureExam"}</span>
          </a>

          {navLinks.length > 0 && (
            <nav className="hidden items-center gap-1 sm:flex">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          )}
        </div>

        {session?.user && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">
              {session.user.name} <span className="text-slate-300">·</span>{" "}
              <span className="font-medium text-slate-700">{session.user.role}</span>
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button type="submit" variant="ghost" className="px-2.5 py-1 text-xs">
                Sign out
              </Button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
