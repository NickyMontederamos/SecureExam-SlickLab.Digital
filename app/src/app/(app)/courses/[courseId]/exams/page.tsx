import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { createExam, listExamsForCourse } from "@/lib/exams";
import { forTenant } from "@/lib/tenant-db";

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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div>
        <a href="/dashboard" className="text-sm text-gray-500">
          ← Dashboard
        </a>
        <h1 className="text-xl font-semibold">
          {course.code} — {course.name}
        </h1>
        <p className="text-sm text-gray-500">
          Exams · <a href={`/courses/${courseId}/questions`} className="underline">Question bank</a>
        </p>
      </div>

      <section className="flex flex-col gap-2">
        {exams.length === 0 && <p className="text-sm text-gray-500">No exams yet.</p>}
        {exams.map((exam) => {
          const version = exam.versions[0];
          return (
            <a
              key={exam.id}
              href={`/exams/${exam.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-gray-50"
            >
              <span>
                <span className="font-medium">{exam.title}</span>
                {version && (
                  <span className="text-gray-500"> · {version.examQuestions.length} question(s) · {version.timeLimitMinutes} min</span>
                )}
              </span>
              <span
                className={
                  "rounded px-2 py-0.5 text-xs " +
                  (exam.status === "PUBLISHED" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700")
                }
              >
                {exam.status}
              </span>
            </a>
          );
        })}
      </section>

      {canCreate && (
        <section className="rounded border p-4">
          <h2 className="mb-3 font-medium">Create an exam</h2>
          <form action={createExamAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Title
              <input name="title" required className="rounded border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Time limit (minutes)
              <input name="timeLimitMinutes" type="number" defaultValue={60} className="rounded border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Available from (optional)
              <input name="availableFrom" type="datetime-local" className="rounded border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Available until (optional)
              <input name="availableUntil" type="datetime-local" className="rounded border px-3 py-2" />
            </label>
            <button type="submit" className="rounded bg-black px-3 py-2 text-white">
              Create exam (draft)
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
