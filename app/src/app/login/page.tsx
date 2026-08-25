import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">CM-Law SecureExam</h1>
      <p className="text-sm text-gray-500">Phase 1 demo — sign in with a seeded account.</p>
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
        <button type="submit" className="rounded bg-black px-3 py-2 text-white">
          Sign in
        </button>
      </form>
    </main>
  );
}
