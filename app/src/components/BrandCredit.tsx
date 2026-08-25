import Image from "next/image";

/**
 * Persistent "Built by SlickLab.Digital" ownership credit, shown on every
 * page (promoted from login-only — see NEXT_PHASE_PLAN.md Ask 1). Scoped
 * down from the originally-proposed tiled "FOR SALE" watermark: a loud
 * ownership overlay across every screen — including the exam-taking view —
 * reads as unfinished/unprofessional in front of a prospective institutional
 * client, which undercuts the same pitch this credit is meant to protect.
 * A quiet, fixed corner credit signals authorship without that cost.
 *
 * Toggle off via NEXT_PUBLIC_SHOW_BRAND_CREDIT=false once this build has a
 * signed institutional deployment and the credit is no longer wanted.
 */
export function BrandCredit() {
  if (process.env.NEXT_PUBLIC_SHOW_BRAND_CREDIT === "false") {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded bg-white/80 px-2 py-1 opacity-70 backdrop-blur-sm">
      <Image src="/branding/slicklab-digital-watermark.png" alt="SlickLab.Digital" width={18} height={18} />
      <span className="text-xs text-gray-400">Built by SlickLab.Digital</span>
    </div>
  );
}
