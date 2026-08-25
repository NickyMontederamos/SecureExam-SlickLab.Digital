import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { createInstitution, EmailTakenError, listInstitutions, SlugTakenError } from "@/lib/institutions";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  if (session.user.role !== "SUPER_ADMIN" && session.user.role !== "PLATFORM_ADMIN") {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const institutions = await listInstitutions(session.user);

  async function createInstitutionAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.id) {
      redirect("/login");
    }

    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim();
    const adminName = String(formData.get("adminName") ?? "").trim();
    const adminEmail = String(formData.get("adminEmail") ?? "").trim();
    const adminPassword = String(formData.get("adminPassword") ?? "");

    try {
      await createInstitution(authSession.user, { name, slug, adminName, adminEmail, adminPassword });
    } catch (error) {
      if (error instanceof SlugTakenError || error instanceof EmailTakenError) {
        redirect(`/admin?error=${encodeURIComponent(error.message)}`);
      }
      throw error;
    }

    revalidatePath("/admin");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Platform Admin</h1>
      </div>

      <section>
        <h2 className="mb-2 font-medium">Institutions ({institutions.length})</h2>
        <ul className="flex flex-col gap-1">
          {institutions.map((institution) => (
            <li key={institution.id} className="rounded border px-3 py-2 text-sm">
              {institution.name} <span className="text-gray-500">({institution.slug})</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-3 font-medium">Onboard a new institution</h2>
        <p className="mb-3 text-xs text-gray-500">
          Creates the institution and its first INSTITUTION_ADMIN account together.
        </p>
        {error && (
          <p role="alert" className="mb-3 rounded bg-red-100 p-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <form action={createInstitutionAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Institution name
            <input name="name" required className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Slug (url-safe, unique)
            <input name="slug" required pattern="[a-z0-9-]+" className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            First admin&apos;s name
            <input name="adminName" required className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            First admin&apos;s email
            <input name="adminEmail" type="email" required className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            First admin&apos;s password
            <input name="adminPassword" type="password" required minLength={8} className="rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-black px-3 py-2 text-white">
            Create institution
          </button>
        </form>
      </section>
    </main>
  );
}
