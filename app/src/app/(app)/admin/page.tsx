import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { createInstitution, EmailTakenError, listInstitutions, SlugTakenError } from "@/lib/institutions";
import { Alert, Button, Card, EmptyState, PageHeader, Section, inputClassName, labelClassName } from "@/components/ui";

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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
      <PageHeader title="Platform Admin" subtitle="Cross-tenant onboarding — not scoped to any one institution." />

      <Section title={`Institutions (${institutions.length})`}>
        {institutions.length === 0 ? (
          <EmptyState>No institutions onboarded yet.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {institutions.map((institution) => (
              <li key={institution.id}>
                <Card className="text-sm">
                  <span className="font-medium text-slate-900">{institution.name}</span>{" "}
                  <span className="text-slate-500">({institution.slug})</span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Onboard a new institution" description="Creates the institution and its first INSTITUTION_ADMIN account together.">
        <Card>
          {error && (
            <div className="mb-3">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
          <form action={createInstitutionAction} className="flex flex-col gap-3">
            <label className={labelClassName}>
              Institution name
              <input name="name" required className={inputClassName} />
            </label>
            <label className={labelClassName}>
              Slug (url-safe, unique)
              <input name="slug" required pattern="[a-z0-9-]+" className={inputClassName} />
            </label>
            <label className={labelClassName}>
              First admin&apos;s name
              <input name="adminName" required className={inputClassName} />
            </label>
            <label className={labelClassName}>
              First admin&apos;s email
              <input name="adminEmail" type="email" required className={inputClassName} />
            </label>
            <label className={labelClassName}>
              First admin&apos;s password
              <input name="adminPassword" type="password" required minLength={8} className={inputClassName} />
            </label>
            <Button type="submit" className="self-start">
              Create institution
            </Button>
          </form>
        </Card>
      </Section>
    </main>
  );
}
