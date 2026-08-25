import { forPlatform } from "./tenant-db";

/**
 * Phase 1 has exactly one pitch-demo institution, and the public login page
 * needs to show its branding before anyone has authenticated (so there's no
 * tenant in the session yet). Reading Institution's public branding fields
 * unscoped is fine — the name/logo/colors are meant to be public, unlike
 * every other tenant-scoped model. This helper does NOT generalize to real
 * multi-tenant login (e.g. subdomain-per-institution) — that's Phase 3.
 */
export async function getDemoInstitutionBranding() {
  return forPlatform().institution.findUnique({
    where: { slug: "college-of-maasin-law" },
    select: {
      name: true,
      logoUrl: true,
      sealUrl: true,
      primaryColor: true,
      secondaryColor: true,
    },
  });
}
