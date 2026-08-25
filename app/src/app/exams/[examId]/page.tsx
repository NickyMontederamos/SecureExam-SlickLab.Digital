import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { addExamQuestion, ExamNotFoundError, getExam, publishExam } from "@/lib/exams";
import { listQuestionsForCourse } from "@/lib/questions";

export default async function ExamBuilderPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.institutionId) {
    redirect("/login");
  }

  const { examId } = await params;
  const institutionId = session.user.institutionId;

  let exam;
  try {
    exam = await getExam(institutionId, session.user, examId);
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      notFound();
    }
    throw error;
  }

  const version = exam.versions[0];
  const isDraft = exam.status === "DRAFT";
  const canEdit = can(session.user.role, "exam", "update") && isDraft;
  const canPublish = can(session.user.role, "exam", "publish") && isDraft;

  const availableQuestions = canEdit
    ? await listQuestionsForCourse(institutionId, session.user, exam.courseId)
    : [];
  const usedQuestionIds = new Set(version?.examQuestions.map((eq) => eq.questionId) ?? []);

  async function addQuestionAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }

    const questionId = String(formData.get("questionId") ?? "");
    const points = Number(formData.get("points") ?? 1);
    if (!questionId) return;

    await addExamQuestion(authSession.user.institutionId, authSession.user, { examId, questionId, points });
    revalidatePath(`/exams/${examId}`);
  }

  async function publishAction() {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }

    await publishExam(authSession.user.institutionId, authSession.user, examId);
    revalidatePath(`/exams/${examId}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div>
        <a href={`/courses/${exam.courseId}/exams`} className="text-sm text-gray-500">
          ← Exams
        </a>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{exam.title}</h1>
          <span
            className={
              "rounded px-2 py-0.5 text-xs " +
              (exam.status === "PUBLISHED" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700")
            }
          >
            {exam.status}
          </span>
        </div>
        {version && <p className="text-sm text-gray-500">{version.timeLimitMinutes} minutes</p>}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Questions ({version?.examQuestions.length ?? 0})</h2>
        {(!version || version.examQuestions.length === 0) && (
          <p className="text-sm text-gray-500">No questions added yet.</p>
        )}
        {version?.examQuestions.map((eq) => (
          <div key={eq.id} className="rounded border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Q{eq.order + 1}</span>
              <span className="text-gray-500">{eq.points} pt(s)</span>
            </div>
            <p className="mt-1">{eq.questionVersion.prompt}</p>
          </div>
        ))}
      </section>

      {canEdit && (
        <section className="rounded border p-4">
          <h2 className="mb-3 font-medium">Add a question from the bank</h2>
          {availableQuestions.length === 0 && (
            <p className="text-sm text-gray-500">
              No questions in this course&apos;s bank yet — add some on the{" "}
              <a href={`/courses/${exam.courseId}/questions`} className="underline">
                question bank page
              </a>{" "}
              first.
            </p>
          )}
          {availableQuestions.length > 0 && (
            <form action={addQuestionAction} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Question
                <select name="questionId" required className="rounded border px-3 py-2">
                  {availableQuestions.map((q) => (
                    <option key={q.id} value={q.id} disabled={usedQuestionIds.has(q.id)}>
                      [{q.type}] {q.versions[0]?.prompt.slice(0, 60)}
                      {usedQuestionIds.has(q.id) ? " (already added)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Points
                <input name="points" type="number" step="0.5" defaultValue={1} className="rounded border px-3 py-2" />
              </label>
              <button type="submit" className="rounded bg-black px-3 py-2 text-white">
                Add to exam
              </button>
            </form>
          )}
        </section>
      )}

      {canPublish && (
        <form action={publishAction}>
          <button type="submit" className="rounded bg-green-700 px-3 py-2 text-white">
            Publish exam
          </button>
          <p className="mt-1 text-xs text-gray-500">
            Freezes this version — no more edits to it once published (Phase 1 has no re-versioning yet).
          </p>
        </form>
      )}
    </main>
  );
}
