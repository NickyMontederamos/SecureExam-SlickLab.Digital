import type { Prisma, QuestionType } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { createQuestion, listQuestionsForCourse } from "@/lib/questions";
import { forTenant } from "@/lib/tenant-db";

const CHOICE_TYPES = new Set<QuestionType>(["MULTIPLE_CHOICE", "MULTIPLE_RESPONSE", "TRUE_FALSE"]);

/**
 * Parses the create-question form's plain-text "choices" textarea: one
 * choice per line, a leading "*" marks it correct. Deliberately simple for
 * a Phase 1 pitch demo — a real question editor is a later priority.
 */
function parseChoices(raw: string): { choices: Prisma.InputJsonValue; correctAnswer: Prisma.InputJsonValue } {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const choices = lines.map((line, index) => ({
    id: String(index),
    text: line.replace(/^\*\s*/, ""),
  }));
  const correctChoiceIds = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith("*"))
    .map(({ index }) => String(index));

  return { choices, correctAnswer: { choiceIds: correctChoiceIds } };
}

export default async function CourseQuestionsPage({
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

  const questions = can(session.user.role, "question", "read")
    ? await listQuestionsForCourse(institutionId, session.user, courseId)
    : [];
  const canCreate = can(session.user.role, "question", "create");

  async function createQuestionAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    const actorId = authSession?.user?.id;
    const actorInstitutionId = authSession?.user?.institutionId;
    const actorRole = authSession?.user?.role;
    if (!actorId || !actorInstitutionId || !actorRole) {
      redirect("/login");
    }

    const type = formData.get("type") as QuestionType;
    const prompt = String(formData.get("prompt") ?? "").trim();
    const points = Number(formData.get("points") ?? 1);
    const choicesRaw = String(formData.get("choicesText") ?? "");

    const { choices, correctAnswer } = CHOICE_TYPES.has(type)
      ? parseChoices(choicesRaw)
      : { choices: undefined, correctAnswer: undefined };

    await createQuestion(actorInstitutionId, { id: actorId, role: actorRole }, {
      courseId,
      type,
      prompt,
      points,
      choices,
      correctAnswer,
    });

    revalidatePath(`/courses/${courseId}/questions`);
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
          Question bank · <a href={`/courses/${courseId}/exams`} className="underline">Exams</a>
        </p>
      </div>

      <section className="flex flex-col gap-2">
        {questions.length === 0 && <p className="text-sm text-gray-500">No questions yet.</p>}
        {questions.map((question) => {
          const latest = question.versions[0];
          return (
            <div key={question.id} className="rounded border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{question.type}</span>
                <span className="text-gray-500">{latest?.points ?? 0} pt(s)</span>
              </div>
              <p className="mt-1">{latest?.prompt}</p>
            </div>
          );
        })}
      </section>

      {canCreate && (
        <section className="rounded border p-4">
          <h2 className="mb-3 font-medium">Add a question</h2>
          <form action={createQuestionAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Type
              <select name="type" className="rounded border px-3 py-2" defaultValue="MULTIPLE_CHOICE">
                <option value="MULTIPLE_CHOICE">Multiple choice</option>
                <option value="MULTIPLE_RESPONSE">Multiple response</option>
                <option value="TRUE_FALSE">True / False</option>
                <option value="SHORT_ANSWER">Short answer</option>
                <option value="ESSAY">Essay</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Prompt
              <textarea name="prompt" required rows={2} className="rounded border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Choices (one per line, prefix the correct one(s) with *) — leave blank for short answer/essay
              <textarea name="choicesText" rows={4} className="rounded border px-3 py-2 font-mono text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Points
              <input name="points" type="number" step="0.5" defaultValue={1} className="rounded border px-3 py-2" />
            </label>
            <button type="submit" className="rounded bg-black px-3 py-2 text-white">
              Add question
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
