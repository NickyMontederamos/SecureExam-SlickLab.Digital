import { AuthError } from "next-auth";
import Image from "next/image";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getDemoInstitutionBranding } from "@/lib/branding";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const branding = await getDemoInstitutionBranding();

  async function authenticate(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/dashboard",
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect("/login?error=1");
      }
      throw err;
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex items-center justify-center gap-4">
        {branding?.sealUrl && (
          <Image src={branding.sealUrl} alt="College of Maasin seal" width={64} height={64} />
        )}
        {branding?.logoUrl && (
          <Image src={branding.logoUrl} alt="College of Law crest" width={56} height={64} />
        )}
      </div>
      <div className="text-center">
        <h1 className="text-lg font-semibold">{branding?.name ?? "CM-Law SecureExam"}</h1>
        <p className="text-sm text-gray-500">Secure Digital Examination Platform</p>
      </div>
      {error && (
        <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-700">
          Invalid email or password.
        </p>
      )}
      <form action={authenticate} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            required
            defaultValue="admin@cmlaw.demo"
            className="rounded border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            name="password"
            type="password"
            required
            defaultValue="DemoPass!2026"
            className="rounded border px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded px-3 py-2 text-white"
          style={{ backgroundColor: branding?.primaryColor ?? "#000000" }}
        >
          Sign in
        </button>
      </form>
      <p className="text-center text-xs text-gray-400">
        Phase 1 demo — sign in with a seeded account.
      </p>
      <div className="flex items-center justify-center gap-2 border-t pt-4 opacity-70">
        <Image
          src="/branding/slicklab-digital-watermark.png"
          alt="SlickLab.Digital"
          width={20}
          height={20}
        />
        <span className="text-xs text-gray-400">Built by SlickLab.Digital</span>
      </div>
    </main>
  );
}
