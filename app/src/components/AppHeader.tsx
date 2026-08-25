import Image from "next/image";
import { auth, signOut } from "@/auth";
import { getDemoInstitutionBranding } from "@/lib/branding";

/**
 * Institution branding + "who am I logged in as" strip, shared by every
 * authenticated route via src/app/(app)/layout.tsx. Deliberately excludes
 * the SlickLab.Digital ownership credit (see BrandCredit) — this header is
 * "whose app is this for the end user", not "who built it".
 */
export async function AppHeader() {
  const [session, branding] = await Promise.all([auth(), getDemoInstitutionBranding()]);

  return (
    <header className="flex items-center justify-between border-b bg-white px-6 py-3">
      <div className="flex items-center gap-3">
        {branding?.sealUrl && (
          <Image src={branding.sealUrl} alt="College of Maasin seal" width={32} height={32} />
        )}
        {branding?.logoUrl && (
          <Image src={branding.logoUrl} alt="College of Law crest" width={28} height={32} />
        )}
        <span className="text-sm font-medium">{branding?.name ?? "CM-Law SecureExam"}</span>
      </div>
      {session?.user && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {session.user.name} · {session.user.role}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="rounded border px-3 py-1 text-xs">
              Sign out
            </button>
          </form>
        </div>
      )}
    </header>
  );
}
