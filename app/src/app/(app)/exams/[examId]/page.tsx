import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { ExamEntryGate } from "@/components/ExamEntryGate";
import {
  addExamQuestion,
  addExamQuestions,
  deleteExam,
  ExamNotFoundError,
  getExam,
  publishExam,
  QuestionNotFoundError,
  removeExamQuestion,
  updateExam,
} from "@/lib/exams";
import { listQuestionsForCourse } from "@/lib/questions";
import { importQuestionsFromCsv, QuestionImportValidationError } from "@/lib/question-import";
import { bookAttempt, findAttemptForStudent, ScheduledTimeOutOfWindowError } from "@/lib/attempts";
import { beginAttemptAction, checkProctorApprovalAction, requestProctorApprovalAction } from "./actions";
import { Alert, Badge, Button, Card, EmptyState, LinkButton, PageHeader, Section, inputClassName, labelClassName } from "@/components/ui";

function formatWindow(from: Date | null, until: Date | null): string | null {
  if (!from && !until) return null;
  const fmt = (d: Date) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  if (from && until) return `${fmt(from)} – ${fmt(until)}`;
  if (from) return `Opens ${fmt(from)}`;
  return `Closes ${fmt(until!)}`;
}

/** `datetime-local` inputs need "YYYY-MM-DDTHH:mm" in the browser's local time, not an ISO string with a timezone. */
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function ExamBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ importError?: string; imported?: string; bulkError?: string; bookingError?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.institutionId) {
    redirect("/login");
  }

  const { examId } = await params;
  const { importError, imported, bulkError, bookingError } = await searchParams;
  const institutionId = session.user.institutionId;

  let exam: Awaited<ReturnType<typeof getExam>>;
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

  if (session.user.role === "STUDENT") {
    const myAttempt = version ? await findAttemptForStudent(institutionId, session.user, version.id) : null;
    const windowLabel = version ? formatWindow(version.availableFrom, version.availableUntil) : null;
    const hasWindow = Boolean(version?.availableFrom || version?.availableUntil);
    const scheduledForLabel = myAttempt?.scheduledFor
      ? myAttempt.scheduledFor.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : null;

    async function confirmBookingAction(formData: FormData) {
      "use server";
      const authSession = await auth();
      if (!authSession?.user?.institutionId) {
        redirect("/login");
      }
      const scheduledForRaw = String(formData.get("scheduledFor") ?? "");
      const scheduledFor = scheduledForRaw ? new Date(scheduledForRaw) : undefined;

      try {
        await bookAttempt(authSession.user.institutionId, authSession.user, examId, scheduledFor);
      } catch (err) {
        if (err instanceof ScheduledTimeOutOfWindowError) {
          redirect(`/exams/${examId}?bookingError=${encodeURIComponent(err.message)}`);
        }
        throw err;
      }
      revalidatePath(`/exams/${examId}`);
    }

    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <PageHeader
          backHref={`/courses/${exam.courseId}/exams`}
          backLabel="Exams"
          title={exam.title}
          subtitle={version && `${version.timeLimitMinutes} minutes · ${version.examQuestions.length} question(s)`}
        />

        {bookingError && <Alert tone="error">{bookingError}</Alert>}

        {!myAttempt && (
          <Card className="flex flex-col gap-4">
            <div>
              <h2 className="mb-1 text-base font-semibold text-slate-900">Book This Exam</h2>
              <p className="text-sm text-slate-500">Available: {windowLabel ?? "No fixed window — book anytime"}</p>
            </div>
            <form action={confirmBookingAction} className="flex flex-col gap-3">
              {hasWindow && (
                <label className={labelClassName}>
                  Pick a time within the window
                  <input
                    name="scheduledFor"
                    type="datetime-local"
                    required
                    min={version?.availableFrom ? toDatetimeLocalValue(version.availableFrom) : undefined}
                    max={version?.availableUntil ? toDatetimeLocalValue(version.availableUntil) : undefined}
                    className={inputClassName}
                  />
                </label>
              )}
              <Button type="submit" className="self-start">
                Confirm Booking
              </Button>
            </form>
          </Card>
        )}
        {myAttempt?.status === "NOT_STARTED" && (
          <ExamEntryGate
            attemptId={myAttempt.id}
            examTitle={exam.title}
            windowLabel={windowLabel}
            scheduledForLabel={scheduledForLabel}
            confirmationCode={myAttempt.id}
            beginAttemptAction={beginAttemptAction}
            requestProctorApprovalAction={requestProctorApprovalAction}
            checkProctorApprovalAction={checkProctorApprovalAction}
          />
        )}
        {myAttempt?.status === "IN_PROGRESS" && (
          <LinkButton href={`/attempts/${myAttempt.id}`} className="justify-center">
            Continue Exam
          </LinkButton>
        )}
        {myAttempt?.status === "INTERRUPTED" && <Alert tone="warning">Your exam is paused pending faculty review.</Alert>}
        {(myAttempt?.status === "SUBMITTED" || myAttempt?.status === "GRADED" || myAttempt?.status === "TERMINATED") && (
          <LinkButton href={`/attempts/${myAttempt.id}/result`} variant="secondary" className="justify-center">
            View Result
          </LinkButton>
        )}
      </main>
    );
  }

  const canEdit = can(session.user.role, "exam", "update") && isDraft;
  const canPublish = can(session.user.role, "exam", "publish") && isDraft;
  const canDelete = can(session.user.role, "exam", "delete") && isDraft;
  // Admin-only (exam_attempt:"delete" — rbac.ts): force-delete a PUBLISHED
  // exam too, cascading every attempt/answer/event/submission with it. Kept
  // separate from canDelete above so FACULTY (who shares exam:"delete")
  // never gets this — deleteExam() itself also enforces this, this is only
  // the UI gate.
  const canForceDelete = !isDraft && can(session.user.role, "exam_attempt", "delete");

  const availableQuestions = canEdit
    ? await listQuestionsForCourse(institutionId, session.user, exam.courseId)
    : [];
  const usedQuestionIds = new Set(version?.examQuestions.map((eq) => eq.questionId) ?? []);
  const unusedQuestions = availableQuestions.filter((q) => !usedQuestionIds.has(q.id));

  async function updateExamAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }

    const title = String(formData.get("title") ?? "").trim();
    const timeLimitMinutes = Number(formData.get("timeLimitMinutes") ?? 60);
    const availableFromRaw = String(formData.get("availableFrom") ?? "");
    const availableUntilRaw = String(formData.get("availableUntil") ?? "");

    await updateExam(authSession.user.institutionId, authSession.user, examId, {
      title,
      timeLimitMinutes,
      availableFrom: availableFromRaw ? new Date(availableFromRaw) : undefined,
      availableUntil: availableUntilRaw ? new Date(availableUntilRaw) : undefined,
    });
    revalidatePath(`/exams/${examId}`);
  }

  async function removeQuestionAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }

    const examQuestionId = String(formData.get("examQuestionId") ?? "");
    if (!examQuestionId) return;

    await removeExamQuestion(authSession.user.institutionId, authSession.user, examId, examQuestionId);
    revalidatePath(`/exams/${examId}`);
  }

  async function deleteExamAction() {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }

    await deleteExam(authSession.user.institutionId, authSession.user, examId);
    redirect(`/courses/${exam.courseId}/exams`);
  }

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

  async function addSelectedQuestionsAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }

    const questionIds = formData.getAll("questionIds").map(String).filter(Boolean);
    if (questionIds.length === 0) return;

    try {
      await addExamQuestions(authSession.user.institutionId, authSession.user, examId, questionIds);
    } catch (err) {
      if (err instanceof QuestionNotFoundError) {
        redirect(`/exams/${examId}?bulkError=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }
    revalidatePath(`/exams/${examId}`);
  }

  async function importCsvIntoExamAction(formData: FormData) {
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
      redirect(`/exams/${examId}?importError=${encodeURIComponent("Choose a CSV file first")}`);
    }

    const text = await file.text();
    let result: { imported: number };
    try {
      result = await importQuestionsFromCsv(
        actorInstitutionId,
        { id: actorId, role: actorRole },
        exam.courseId,
        text,
        examId
      );
    } catch (err) {
      if (err instanceof QuestionImportValidationError) {
        const summary = err.errors.map((e) => `Row ${e.row}: ${e.message}`).join(" · ");
        redirect(`/exams/${examId}?importError=${encodeURIComponent(summary)}`);
      }
      throw err;
    }

    revalidatePath(`/exams/${examId}`);
    redirect(`/exams/${examId}?imported=${result.imported}`);
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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
      <PageHeader
        backHref={`/courses/${exam.courseId}/exams`}
        backLabel="Exams"
        title={exam.title}
        badge={<Badge tone={exam.status === "PUBLISHED" ? "green" : "gray"}>{exam.status}</Badge>}
        subtitle={version && `${version.timeLimitMinutes} minutes`}
        actions={
          can(session.user.role, "grade", "read") &&
          exam.status === "PUBLISHED" && (
            <LinkButton href={`/exams/${examId}/grading`} variant="secondary">
              Grading
            </LinkButton>
          )
        }
      />

      {imported && <Alert tone="success">Imported and attached {imported} question(s) to this exam.</Alert>}
      {importError && <Alert tone="error">Import failed — nothing was added: {importError}</Alert>}
      {bulkError && <Alert tone="error">Couldn&apos;t add the selected questions: {bulkError}</Alert>}

      {canEdit && version && (
        <Section title="Exam details">
          <Card>
            <form action={updateExamAction} className="flex flex-col gap-3">
              <label className={labelClassName}>
                Title
                <input name="title" required defaultValue={exam.title} className={inputClassName} />
              </label>
              <label className={labelClassName}>
                Time limit (minutes)
                <input
                  name="timeLimitMinutes"
                  type="number"
                  defaultValue={version.timeLimitMinutes}
                  className={inputClassName}
                />
              </label>
              <label className={labelClassName}>
                Available from (optional)
                <input
                  name="availableFrom"
                  type="datetime-local"
                  defaultValue={version.availableFrom ? toDatetimeLocalValue(version.availableFrom) : undefined}
                  className={inputClassName}
                />
              </label>
              <label className={labelClassName}>
                Available until (optional)
                <input
                  name="availableUntil"
                  type="datetime-local"
                  defaultValue={version.availableUntil ? toDatetimeLocalValue(version.availableUntil) : undefined}
                  className={inputClassName}
                />
              </label>
              <Button type="submit" variant="secondary" className="self-start">
                Save changes
              </Button>
            </form>
          </Card>
        </Section>
      )}

      <Section
        title={
          <>
            Questions ({version?.examQuestions.length ?? 0})
            {version && version.examQuestions.length > 0 && (
              <span className="ml-2 font-normal text-slate-500">
                · {version.examQuestions.reduce((sum, eq) => sum + eq.points, 0)} pt(s) total
              </span>
            )}
          </>
        }
      >
        {(!version || version.examQuestions.length === 0) && <EmptyState>No questions added yet.</EmptyState>}
        <div className="flex flex-col gap-2">
          {version?.examQuestions.map((eq) => (
            <Card key={eq.id} className="text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">Q{eq.order + 1}</span>
                <span className="flex items-center gap-3">
                  <span className="text-slate-500">{eq.points} pt(s)</span>
                  {canEdit && (
                    <form action={removeQuestionAction}>
                      <input type="hidden" name="examQuestionId" value={eq.id} />
                      <Button type="submit" variant="danger" className="px-2.5 py-1 text-xs">
                        Remove
                      </Button>
                    </form>
                  )}
                </span>
              </div>
              <p className="mt-1 text-slate-700">{eq.questionVersion.prompt}</p>
            </Card>
          ))}
        </div>
      </Section>

      {canEdit && (
        <>
          <Section
            title="Import from CSV directly into this exam"
            description="Creates the questions in the course's reusable bank and attaches all of them to this exam in one step. All-or-nothing, same as the question bank's import."
          >
            <Card className="flex flex-col gap-3">
              <LinkButton href="/templates/question-bank-template.csv" download variant="secondary" className="self-start">
                Download the template
              </LinkButton>
              <form action={importCsvIntoExamAction} className="flex items-center gap-2">
                <input name="file" type="file" accept=".csv,text/csv" required className="flex-1 text-sm" />
                <Button type="submit" variant="secondary">
                  Import into exam
                </Button>
              </form>
            </Card>
          </Section>

          {unusedQuestions.length > 0 && (
            <Section title="Add multiple questions from the bank at once">
              <Card>
                <form action={addSelectedQuestionsAction} className="flex flex-col gap-2">
                  <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                    {unusedQuestions.map((q) => (
                      <label key={q.id} className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name="questionIds" value={q.id} className="mt-1" />
                        <span>
                          [{q.type}] {q.versions[0]?.prompt.slice(0, 80)} ({q.versions[0]?.points} pt(s) default)
                        </span>
                      </label>
                    ))}
                  </div>
                  <Button type="submit" className="self-start">
                    Add selected to exam
                  </Button>
                  <p className="text-xs text-slate-500">Each question is added at its own default points.</p>
                </form>
              </Card>
            </Section>
          )}

          <Section title="Add one question with custom points">
            <Card>
              {availableQuestions.length === 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-slate-500">No questions in this course&apos;s bank yet.</p>
                  <LinkButton href={`/courses/${exam.courseId}/questions`} variant="secondary" className="px-2.5 py-1 text-xs">
                    Go to question bank
                  </LinkButton>
                </div>
              )}
              {availableQuestions.length > 0 && (
                <form action={addQuestionAction} className="flex flex-col gap-3">
                  <label className={labelClassName}>
                    Question
                    <select name="questionId" required className={inputClassName}>
                      {availableQuestions.map((q) => (
                        <option key={q.id} value={q.id} disabled={usedQuestionIds.has(q.id)}>
                          [{q.type}] {q.versions[0]?.prompt.slice(0, 60)}
                          {usedQuestionIds.has(q.id) ? " (already added)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClassName}>
                    Points
                    <input name="points" type="number" step="0.5" defaultValue={1} className={inputClassName} />
                  </label>
                  <Button type="submit" className="self-start">
                    Add to exam
                  </Button>
                </form>
              )}
            </Card>
          </Section>
        </>
      )}

      {canPublish && (
        <Card>
          <form action={publishAction}>
            <Button type="submit" variant="success">
              Publish exam
            </Button>
            <p className="mt-2 text-xs text-slate-500">
              Freezes this version — no more edits to it once published (Phase 1 has no re-versioning yet).
            </p>
          </form>
        </Card>
      )}

      {canDelete && (
        <Card>
          <form action={deleteExamAction}>
            <Button type="submit" variant="danger">
              Delete exam
            </Button>
            <p className="mt-2 text-xs text-slate-500">
              Safe while still a draft — no student can have an attempt against an unpublished exam.
            </p>
          </form>
        </Card>
      )}

      {canForceDelete && (
        <Card className="border-red-300 bg-red-50">
          <h2 className="mb-2 text-sm font-semibold text-red-900">Danger zone (admin only)</h2>
          <form action={deleteExamAction}>
            <Button type="submit" variant="danger">
              Force-delete this exam
            </Button>
            <p className="mt-2 text-xs text-red-800">
              This exam has already been published — deleting it also erases every student&apos;s attempt, answers,
              integrity events, and submission record against it. This cannot be undone. Only use this for cleaning up
              test/demo data, not a real academic record.
            </p>
          </form>
        </Card>
      )}
    </main>
  );
}
