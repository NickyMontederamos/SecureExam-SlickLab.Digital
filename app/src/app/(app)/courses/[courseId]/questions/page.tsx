import type { Prisma, QuestionType } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { createQuestion, deleteQuestion, listQuestionsForCourse, QuestionInUseError, updateQuestion } from "@/lib/questions";
import { importQuestionsFromCsv, QuestionImportValidationError } from "@/lib/question-import";
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

/** Inverse of parseChoices — prefills the edit form's textarea from a question's current choices/correctAnswer. */
function formatChoicesText(choices: unknown, correctAnswer: unknown): string {
  const choiceList = (choices as { id: string; text: string }[] | null) ?? [];
  const correctIds = new Set(((correctAnswer as { choiceIds?: string[] } | null)?.choiceIds) ?? []);
  return choiceList.map((c) => (correctIds.has(c.id) ? `*${c.text}` : c.text)).join("\n");
}

export default async function CourseQuestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ importError?: string; imported?: string; edit?: string; editError?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.institutionId) {
    redirect("/login");
  }

  const { courseId } = await params;
  const { importError, imported, edit, editError } = await searchParams;
  const institutionId = session.user.institutionId;

  const course = await forTenant(institutionId).course.findFirst({ where: { id: courseId } });
  if (!course) {
    notFound();
  }

  const questions = can(session.user.role, "question", "read")
    ? await listQuestionsForCourse(institutionId, session.user, courseId)
    : [];
  const canCreate = can(session.user.role, "question", "create");
  const canUpdate = can(session.user.role, "question", "update");
  const canDelete = can(session.user.role, "question", "delete");

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

  async function updateQuestionAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }

    const questionId = String(formData.get("questionId") ?? "");
    const type = formData.get("type") as QuestionType;
    const prompt = String(formData.get("prompt") ?? "").trim();
    const points = Number(formData.get("points") ?? 1);
    const choicesRaw = String(formData.get("choicesText") ?? "");
    if (!questionId) return;

    const { choices, correctAnswer } = CHOICE_TYPES.has(type)
      ? parseChoices(choicesRaw)
      : { choices: undefined, correctAnswer: undefined };

    try {
      await updateQuestion(authSession.user.institutionId, authSession.user, questionId, { prompt, points, choices, correctAnswer });
    } catch (err) {
      if (err instanceof QuestionInUseError) {
        redirect(`/courses/${courseId}/questions?editError=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }
    revalidatePath(`/courses/${courseId}/questions`);
    redirect(`/courses/${courseId}/questions`);
  }

  async function deleteQuestionAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }

    const questionId = String(formData.get("questionId") ?? "");
    if (!questionId) return;

    try {
      await deleteQuestion(authSession.user.institutionId, authSession.user, questionId);
    } catch (err) {
      if (err instanceof QuestionInUseError) {
        redirect(`/courses/${courseId}/questions?editError=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }
    revalidatePath(`/courses/${courseId}/questions`);
  }

  async function importCsvAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    const actorId = authSession?.user?.id;
    const actorInstitutionId = authSession?.user?.institutionId;
    const actorRole = authSession?.user?.role;
    if (!actorId || !actorInstitutionId || !actorRole) {
      redirect("/login");
    }

    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) {
      redirect(`/courses/${courseId}/questions?importError=${encodeURIComponent("Choose a CSV file first")}`);
    }

    const text = await file.text();
    let result: { imported: number };
    try {
      result = await importQuestionsFromCsv(actorInstitutionId, { id: actorId, role: actorRole }, courseId, text);
    } catch (err) {
      if (err instanceof QuestionImportValidationError) {
        const summary = err.errors.map((e) => `Row ${e.row}: ${e.message}`).join(" · ");
        redirect(`/courses/${courseId}/questions?importError=${encodeURIComponent(summary)}`);
      }
      throw err;
    }

    revalidatePath(`/courses/${courseId}/questions`);
    redirect(`/courses/${courseId}/questions?imported=${result.imported}`);
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

      {imported && (
        <p className="rounded bg-green-100 p-2 text-sm text-green-800">Imported {imported} question(s).</p>
      )}
      {importError && (
        <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-700">
          Import failed — nothing was added: {importError}
        </p>
      )}
      {editError && (
        <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-700">
          {editError}
        </p>
      )}

      <section className="flex flex-col gap-2">
        {questions.length === 0 && <p className="text-sm text-gray-500">No questions yet.</p>}
        {questions.map((question) => {
          const latest = question.versions[0];
          const isUnused = question._count.examQuestions === 0;

          if (edit === question.id && canUpdate && isUnused) {
            return (
              <form
                key={question.id}
                action={updateQuestionAction}
                className="flex flex-col gap-3 rounded border border-black p-3 text-sm"
              >
                <input type="hidden" name="questionId" value={question.id} />
                <input type="hidden" name="type" value={question.type} />
                <p className="text-xs text-gray-500">{question.type} (type can&apos;t be changed after creation)</p>
                <label className="flex flex-col gap-1">
                  Prompt
                  <textarea name="prompt" required rows={2} defaultValue={latest?.prompt} className="rounded border px-3 py-2" />
                </label>
                {CHOICE_TYPES.has(question.type) && (
                  <label className="flex flex-col gap-1">
                    Choices (one per line, prefix the correct one(s) with *)
                    <textarea
                      name="choicesText"
                      rows={4}
                      defaultValue={formatChoicesText(latest?.choices, latest?.correctAnswer)}
                      className="rounded border px-3 py-2 font-mono text-xs"
                    />
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  Points
                  <input name="points" type="number" step="0.5" defaultValue={latest?.points ?? 1} className="rounded border px-3 py-2" />
                </label>
                <div className="flex gap-2">
                  <button type="submit" className="rounded bg-black px-3 py-2 text-white">
                    Save
                  </button>
                  <a href={`/courses/${courseId}/questions`} className="rounded border px-3 py-2">
                    Cancel
                  </a>
                </div>
              </form>
            );
          }

          return (
            <div key={question.id} className="rounded border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{question.type}</span>
                <span className="flex items-center gap-3">
                  <span className="text-gray-500">{latest?.points ?? 0} pt(s)</span>
                  {isUnused ? (
                    <>
                      {canUpdate && (
                        <a href={`/courses/${courseId}/questions?edit=${question.id}`} className="text-xs underline">
                          Edit
                        </a>
                      )}
                      {canDelete && (
                        <form action={deleteQuestionAction}>
                          <input type="hidden" name="questionId" value={question.id} />
                          <button type="submit" className="text-xs text-red-700 underline">
                            Delete
                          </button>
                        </form>
                      )}
                    </>
                  ) : (
                    (canUpdate || canDelete) && (
                      <span className="text-xs text-gray-400" title="Already attached to an exam — its wording is locked in for that exam's record">
                        Used in an exam
                      </span>
                    )
                  )}
                </span>
              </div>
              <p className="mt-1">{latest?.prompt}</p>
            </div>
          );
        })}
      </section>

      {canCreate && (
        <>
          <section className="rounded border p-4">
            <h2 className="mb-3 font-medium">Import from CSV</h2>
            <p className="mb-3 text-xs text-gray-500">
              All-or-nothing: if any row is invalid, nothing is imported and you&apos;ll see exactly which rows to
              fix.{" "}
              <a href="/templates/question-bank-template.csv" download className="underline">
                Download the template
              </a>
              .
            </p>
            <form action={importCsvAction} className="flex items-center gap-2">
              <input name="file" type="file" accept=".csv,text/csv" required className="flex-1 text-sm" />
              <button type="submit" className="rounded border px-3 py-2 text-sm">
                Import
              </button>
            </form>
          </section>

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
        </>
      )}
    </main>
  );
}
