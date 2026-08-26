import type { CSSProperties } from "react";
import { AuthError } from "next-auth";
import Image from "next/image";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getDemoInstitutionBranding } from "@/lib/branding";
import { Alert, Button, Card, inputClassName, labelClassName } from "@/components/ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const branding = await getDemoInstitutionBranding();

  const brandStyle: CSSProperties & Record<string, string> = {};
  if (branding?.primaryColor) brandStyle["--brand-primary"] = branding.primaryColor;
  if (branding?.secondaryColor) brandStyle["--brand-secondary"] = branding.secondaryColor;

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
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-b from-brand-primary/10 to-slate-50 p-6"
      style={brandStyle}
    >
      <div className="flex items-center justify-center gap-4">
        {branding?.sealUrl && (
          <Image src={branding.sealUrl} alt="College of Maasin seal" width={72} height={72} className="drop-shadow-sm" />
        )}
        {branding?.logoUrl && (
          <Image src={branding.logoUrl} alt="College of Law crest" width={62} height={72} className="h-auto w-[62px] drop-shadow-sm" />
        )}
      </div>
      <div className="text-center">
        <h1 className="text-xl font-semibold text-slate-900">{branding?.name ?? "CM-Law SecureExam"}</h1>
        <p className="text-sm text-slate-500">Secure Digital Examination Platform</p>
      </div>

      <Card className="w-full max-w-sm">
        {error && (
          <div className="mb-4">
            <Alert tone="error">Invalid email or password.</Alert>
          </div>
        )}
        <form action={authenticate} className="flex flex-col gap-4">
          <label className={labelClassName}>
            Email
            <input name="email" type="email" required defaultValue="admin@cmlaw.demo" className={inputClassName} />
          </label>
          <label className={labelClassName}>
            Password
            <input
              name="password"
              type="password"
              required
              defaultValue="DemoPass!2026"
              className={inputClassName}
            />
          </label>
          <Button type="submit" className="mt-1 w-full">
            Sign in
          </Button>
        </form>
      </Card>

      <p className="text-center text-xs text-slate-400">Phase 1 demo — sign in with a seeded account.</p>
    </main>
  );
}
