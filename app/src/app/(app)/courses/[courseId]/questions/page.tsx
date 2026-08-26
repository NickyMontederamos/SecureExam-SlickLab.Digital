import type { Prisma, QuestionType } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { createQuestion, deleteQuestion, listQuestionsForCourse, QuestionInUseError, updateQuestion } from "@/lib/questions";
import { importQuestionsFromCsv, QuestionImportValidationError } from "@/lib/question-import";
import { forTenant } from "@/lib/tenant-db";
import { Alert, Button, Card, EmptyState, LinkButton, PageHeader, Section, inputClassName, labelClassName } from "@/components/ui";

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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
      <PageHeader
        backHref={`/courses/${courseId}`}
        title={`${course.code} — ${course.name}`}
        subtitle="Question bank"
        actions={
          <LinkButton href={`/courses/${courseId}/exams`} variant="secondary">
            Exams
          </LinkButton>
        }
      />

      {imported && <Alert tone="success">Imported {imported} question(s).</Alert>}
      {importError && <Alert tone="error">Import failed — nothing was added: {importError}</Alert>}
      {editError && <Alert tone="error">{editError}</Alert>}

      <Section title={`Questions (${questions.length})`}>
        {questions.length === 0 && <EmptyState>No questions yet.</EmptyState>}
        <div className="flex flex-col gap-2">
        {questions.map((question) => {
          const latest = question.versions[0];
          const isUnused = question._count.examQuestions === 0;

          if (edit === question.id && canUpdate && isUnused) {
            return (
              <form key={question.id} action={updateQuestionAction}>
                <Card className="flex flex-col gap-3 ring-2 ring-brand-primary">
                  <input type="hidden" name="questionId" value={question.id} />
                  <input type="hidden" name="type" value={question.type} />
                  <p className="text-xs text-slate-500">{question.type} (type can&apos;t be changed after creation)</p>
                  <label className={labelClassName}>
                    Prompt
                    <textarea name="prompt" required rows={2} defaultValue={latest?.prompt} className={inputClassName} />
                  </label>
                  {CHOICE_TYPES.has(question.type) && (
                    <label className={labelClassName}>
                      Choices (one per line, prefix the correct one(s) with *)
                      <textarea
                        name="choicesText"
                        rows={4}
                        defaultValue={formatChoicesText(latest?.choices, latest?.correctAnswer)}
                        className={`${inputClassName} font-mono text-xs`}
                      />
                    </label>
                  )}
                  <label className={labelClassName}>
                    Points
                    <input name="points" type="number" step="0.5" defaultValue={latest?.points ?? 1} className={inputClassName} />
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit">Save</Button>
                    <LinkButton href={`/courses/${courseId}/questions`} variant="secondary">
                      Cancel
                    </LinkButton>
                  </div>
                </Card>
              </form>
            );
          }

          return (
            <Card key={question.id} className="text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{question.type}</span>
                <span className="flex items-center gap-3">
                  <span className="text-slate-500">{latest?.points ?? 0} pt(s)</span>
                  {isUnused ? (
                    <>
                      {canUpdate && (
                        <LinkButton
                          href={`/courses/${courseId}/questions?edit=${question.id}`}
                          variant="secondary"
                          className="px-2.5 py-1 text-xs"
                        >
                          Edit
                        </LinkButton>
                      )}
                      {canDelete && (
                        <form action={deleteQuestionAction}>
                          <input type="hidden" name="questionId" value={question.id} />
                          <Button type="submit" variant="danger" className="px-2.5 py-1 text-xs">
                            Delete
                          </Button>
                        </form>
                      )}
                    </>
                  ) : (
                    (canUpdate || canDelete) && (
                      <span
                        className="text-xs text-slate-400"
                        title="Already attached to an exam — its wording is locked in for that exam's record"
                      >
                        Used in an exam
                      </span>
                    )
                  )}
                </span>
              </div>
              <p className="mt-1 text-slate-700">{latest?.prompt}</p>
            </Card>
          );
        })}
        </div>
      </Section>

      {canCreate && (
        <>
          <Section
            title="Import from CSV"
            description="All-or-nothing: if any row is invalid, nothing is imported and you'll see exactly which rows to fix."
          >
            <Card className="flex flex-col gap-3">
              <LinkButton href="/templates/question-bank-template.csv" download variant="secondary" className="self-start">
                Download the template
              </LinkButton>
              <form action={importCsvAction} className="flex items-center gap-2">
                <input name="file" type="file" accept=".csv,text/csv" required className="flex-1 text-sm" />
                <Button type="submit" variant="secondary">
                  Import
                </Button>
              </form>
            </Card>
          </Section>

          <Section title="Add a question">
            <Card>
              <form action={createQuestionAction} className="flex flex-col gap-3">
                <label className={labelClassName}>
                  Type
                  <select name="type" className={inputClassName} defaultValue="MULTIPLE_CHOICE">
                    <option value="MULTIPLE_CHOICE">Multiple choice</option>
                    <option value="MULTIPLE_RESPONSE">Multiple response</option>
                    <option value="TRUE_FALSE">True / False</option>
                    <option value="SHORT_ANSWER">Short answer</option>
                    <option value="ESSAY">Essay</option>
                  </select>
                </label>
                <label className={labelClassName}>
                  Prompt
                  <textarea name="prompt" required rows={2} className={inputClassName} />
                </label>
                <label className={labelClassName}>
                  Choices (one per line, prefix the correct one(s) with *) — leave blank for short answer/essay
                  <textarea name="choicesText" rows={4} className={`${inputClassName} font-mono text-xs`} />
                </label>
                <label className={labelClassName}>
                  Points
                  <input name="points" type="number" step="0.5" defaultValue={1} className={inputClassName} />
                </label>
                <Button type="submit" className="self-start">
                  Add question
                </Button>
              </form>
            </Card>
          </Section>
        </>
      )}
    </main>
  );
}
