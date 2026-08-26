import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { createExam, listExamsForCourse } from "@/lib/exams";
import { forTenant } from "@/lib/tenant-db";
import { Badge, Button, Card, EmptyState, LinkButton, PageHeader, Section, inputClassName, labelClassName } from "@/components/ui";

export default async function CourseExamsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.institutionId) {
    redirect("/login");
  }

  const { courseId } = await params;
  const institutionId = session.user.institutionId;

  const course = await forTenant(institutionId).course.findFirst({ where: { id: courseId } });
  if (!course) {
    notFound();
  }

  const exams = can(session.user.role, "exam", "read")
    ? await listExamsForCourse(institutionId, session.user, courseId)
    : [];
  const canCreate = can(session.user.role, "exam", "create");

  async function createExamAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    const actorId = authSession?.user?.id;
    const actorInstitutionId = authSession?.user?.institutionId;
    const actorRole = authSession?.user?.role;
    if (!actorId || !actorInstitutionId || !actorRole) {
      redirect("/login");
    }

    const title = String(formData.get("title") ?? "").trim();
    const timeLimitMinutes = Number(formData.get("timeLimitMinutes") ?? 60);
    const availableFromRaw = String(formData.get("availableFrom") ?? "");
    const availableUntilRaw = String(formData.get("availableUntil") ?? "");

    await createExam(actorInstitutionId, { id: actorId, role: actorRole }, {
      courseId,
      title,
      timeLimitMinutes,
      availableFrom: availableFromRaw ? new Date(availableFromRaw) : undefined,
      availableUntil: availableUntilRaw ? new Date(availableUntilRaw) : undefined,
    });

    revalidatePath(`/courses/${courseId}/exams`);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
      <PageHeader
        backHref={session.user.role === "STUDENT" ? "/dashboard" : `/courses/${courseId}`}
        title={`${course.code} — ${course.name}`}
        subtitle="Exams"
        actions={
          <LinkButton href={`/courses/${courseId}/questions`} variant="secondary">
            Question bank
          </LinkButton>
        }
      />

      <Section title={`Exams (${exams.length})`}>
        {exams.length === 0 ? (
          <EmptyState>No exams yet.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {exams.map((exam) => {
              const version = exam.versions[0];
              return (
                <li key={exam.id}>
                  <a href={`/exams/${exam.id}`}>
                    <Card interactive className="flex items-center justify-between">
                      <span className="text-sm">
                        <span className="font-medium text-slate-900">{exam.title}</span>
                        {version && (
                          <span className="text-slate-500">
                            {" "}
                            · {version.examQuestions.length} question(s) · {version.timeLimitMinutes} min
                          </span>
                        )}
                      </span>
                      <Badge tone={exam.status === "PUBLISHED" ? "green" : "gray"}>{exam.status}</Badge>
                    </Card>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {canCreate && (
        <Section title="Create an exam">
          <Card>
            <form action={createExamAction} className="flex flex-col gap-3">
              <label className={labelClassName}>
                Title
                <input name="title" required className={inputClassName} />
              </label>
              <label className={labelClassName}>
                Time limit (minutes)
                <input name="timeLimitMinutes" type="number" defaultValue={60} className={inputClassName} />
              </label>
              <label className={labelClassName}>
                Available from (optional)
                <input name="availableFrom" type="datetime-local" className={inputClassName} />
              </label>
              <label className={labelClassName}>
                Available until (optional)
                <input name="availableUntil" type="datetime-local" className={inputClassName} />
              </label>
              <Button type="submit" className="self-start">
                Create exam (draft)
              </Button>
            </form>
          </Card>
        </Section>
      )}
    </main>
  );
}
