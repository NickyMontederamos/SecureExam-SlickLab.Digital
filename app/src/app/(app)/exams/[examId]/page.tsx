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
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
        <div>
          <a href={`/courses/${exam.courseId}/exams`} className="text-sm text-gray-500">
            ← Exams
          </a>
          <h1 className="text-xl font-semibold">{exam.title}</h1>
          {version && (
            <p className="text-sm text-gray-500">
              {version.timeLimitMinutes} minutes · {version.examQuestions.length} question(s)
            </p>
          )}
        </div>

        {bookingError && (
          <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-700">
            {bookingError}
          </p>
        )}

        {!myAttempt && (
          <div className="flex flex-col gap-4 rounded border p-4">
            <div>
              <h2 className="mb-2 font-medium">Book This Exam</h2>
              <p className="text-sm text-gray-500">Available: {windowLabel ?? "No fixed window — book anytime"}</p>
            </div>
            <form action={confirmBookingAction} className="flex flex-col gap-3">
              {hasWindow && (
                <label className="flex flex-col gap-1 text-sm">
                  Pick a time within the window
                  <input
                    name="scheduledFor"
                    type="datetime-local"
                    required
                    min={version?.availableFrom ? toDatetimeLocalValue(version.availableFrom) : undefined}
                    max={version?.availableUntil ? toDatetimeLocalValue(version.availableUntil) : undefined}
                    className="rounded border px-3 py-2"
                  />
                </label>
              )}
              <button type="submit" className="self-start rounded bg-black px-3 py-2 text-white">
                Confirm Booking
              </button>
            </form>
          </div>
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
          <a href={`/attempts/${myAttempt.id}`} className="rounded bg-black px-3 py-2 text-center text-white">
            Continue Exam
          </a>
        )}
        {myAttempt?.status === "INTERRUPTED" && (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            Your exam is paused pending faculty review.
          </p>
        )}
        {(myAttempt?.status === "SUBMITTED" || myAttempt?.status === "GRADED" || myAttempt?.status === "TERMINATED") && (
          <a href={`/attempts/${myAttempt.id}/result`} className="rounded border px-3 py-2 text-center">
            View Result
          </a>
        )}
      </main>
    );
  }

  const canEdit = can(session.user.role, "exam", "update") && isDraft;
  const canPublish = can(session.user.role, "exam", "publish") && isDraft;
  const canDelete = can(session.user.role, "exam", "delete") && isDraft;

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
        {can(session.user.role, "grade", "read") && exam.status === "PUBLISHED" && (
          <a href={`/exams/${examId}/grading`} className="text-sm underline">
            Grading
          </a>
        )}
      </div>

      {imported && (
        <p className="rounded bg-green-100 p-2 text-sm text-green-800">
          Imported and attached {imported} question(s) to this exam.
        </p>
      )}
      {importError && (
        <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-700">
          Import failed — nothing was added: {importError}
        </p>
      )}
      {bulkError && (
        <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-700">
          Couldn&apos;t add the selected questions: {bulkError}
        </p>
      )}

      {canEdit && version && (
        <section className="rounded border p-4">
          <h2 className="mb-3 font-medium">Exam details</h2>
          <form action={updateExamAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Title
              <input name="title" required defaultValue={exam.title} className="rounded border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Time limit (minutes)
              <input
                name="timeLimitMinutes"
                type="number"
                defaultValue={version.timeLimitMinutes}
                className="rounded border px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Available from (optional)
              <input
                name="availableFrom"
                type="datetime-local"
                defaultValue={version.availableFrom ? toDatetimeLocalValue(version.availableFrom) : undefined}
                className="rounded border px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Available until (optional)
              <input
                name="availableUntil"
                type="datetime-local"
                defaultValue={version.availableUntil ? toDatetimeLocalValue(version.availableUntil) : undefined}
                className="rounded border px-3 py-2"
              />
            </label>
            <button type="submit" className="self-start rounded border px-3 py-2 text-sm">
              Save changes
            </button>
          </form>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">
          Questions ({version?.examQuestions.length ?? 0})
          {version && version.examQuestions.length > 0 && (
            <span className="ml-2 font-normal text-gray-500">
              · {version.examQuestions.reduce((sum, eq) => sum + eq.points, 0)} pt(s) total
            </span>
          )}
        </h2>
        {(!version || version.examQuestions.length === 0) && (
          <p className="text-sm text-gray-500">No questions added yet.</p>
        )}
        {version?.examQuestions.map((eq) => (
          <div key={eq.id} className="rounded border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Q{eq.order + 1}</span>
              <span className="flex items-center gap-2">
                <span className="text-gray-500">{eq.points} pt(s)</span>
                {canEdit && (
                  <form action={removeQuestionAction}>
                    <input type="hidden" name="examQuestionId" value={eq.id} />
                    <button type="submit" className="text-xs text-red-700 underline">
                      Remove
                    </button>
                  </form>
                )}
              </span>
            </div>
            <p className="mt-1">{eq.questionVersion.prompt}</p>
          </div>
        ))}
      </section>

      {canEdit && (
        <>
          <section className="rounded border p-4">
            <h2 className="mb-3 font-medium">Import from CSV directly into this exam</h2>
            <p className="mb-3 text-xs text-gray-500">
              Creates the questions in the course&apos;s reusable bank <em>and</em> attaches all of them to this exam
              in one step. All-or-nothing, same as the question bank&apos;s import.{" "}
              <a href="/templates/question-bank-template.csv" download className="underline">
                Download the template
              </a>
              .
            </p>
            <form action={importCsvIntoExamAction} className="flex items-center gap-2">
              <input name="file" type="file" accept=".csv,text/csv" required className="flex-1 text-sm" />
              <button type="submit" className="rounded border px-3 py-2 text-sm">
                Import into exam
              </button>
            </form>
          </section>

          {unusedQuestions.length > 0 && (
            <section className="rounded border p-4">
              <h2 className="mb-3 font-medium">Add multiple questions from the bank at once</h2>
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
                <button type="submit" className="self-start rounded bg-black px-3 py-2 text-sm text-white">
                  Add selected to exam
                </button>
                <p className="text-xs text-gray-500">Each question is added at its own default points.</p>
              </form>
            </section>
          )}

          <section className="rounded border p-4">
            <h2 className="mb-3 font-medium">Add one question with custom points</h2>
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
        </>
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

      {canDelete && (
        <form action={deleteExamAction}>
          <button type="submit" className="rounded bg-red-700 px-3 py-2 text-sm text-white">
            Delete exam
          </button>
          <p className="mt-1 text-xs text-gray-500">
            Safe while still a draft — no student can have an attempt against an unpublished exam.
          </p>
        </form>
      )}
    </main>
  );
}
