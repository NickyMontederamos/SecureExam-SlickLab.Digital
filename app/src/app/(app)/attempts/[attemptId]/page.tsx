import type { Prisma, QuestionType } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { ExamCountdown } from "@/components/ExamCountdown";
import { ExamToolbar } from "@/components/ExamToolbar";
import {
  AttemptNotFoundError,
  AttemptOwnershipError,
  getAttemptForTaking,
  saveAnswers,
  submitAttempt,
} from "@/lib/attempts";

type AttemptView = Awaited<ReturnType<typeof getAttemptForTaking>>;
type ExamQuestionView = AttemptView["examVersion"]["examQuestions"][number];
type AnswerRow = AttemptView["answers"][number];
type AnswerShape = { choiceIds?: string[]; text?: string };

const SUBMIT_BUTTON_ID = "submit-exam-button";

function parseAnswerFromForm(formData: FormData, examQuestionId: string, questionType: QuestionType): Prisma.InputJsonValue | null {
  const name = `answer_${examQuestionId}`;
  if (questionType === "MULTIPLE_CHOICE" || questionType === "TRUE_FALSE") {
    const value = formData.get(name);
    return value ? { choiceIds: [String(value)] } : null;
  }
  if (questionType === "MULTIPLE_RESPONSE") {
    const values = formData.getAll(name).map(String);
    return values.length > 0 ? { choiceIds: values } : null;
  }
  const text = formData.get(name);
  return text ? { text: String(text) } : null;
}

function readAnswersFromForm(examQuestions: ExamQuestionView[], formData: FormData) {
  return examQuestions
    .map((eq) => ({
      examQuestionId: eq.id,
      responseJson: parseAnswerFromForm(formData, eq.id, eq.question.type),
      isFlagged: formData.get(`flag_${eq.id}`) === "on",
    }))
    // A question with neither a response nor a flag has nothing worth
    // writing — this is what lets "flag it, come back later" work for a
    // question the student hasn't answered yet.
    .filter((a) => a.responseJson !== null || a.isFlagged);
}

function renderInput(eq: ExamQuestionView, existingRow: AnswerRow | undefined) {
  const existing = existingRow?.responseJson as AnswerShape | undefined;
  const choices = (eq.questionVersion.choices as { id: string; text: string }[] | null) ?? [];
  const name = `answer_${eq.id}`;

  if (eq.question.type === "MULTIPLE_CHOICE" || eq.question.type === "TRUE_FALSE") {
    const selected = existing?.choiceIds?.[0];
    return (
      <div className="flex flex-col gap-1">
        {choices.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input type="radio" name={name} value={c.id} defaultChecked={selected === c.id} />
            {c.text}
          </label>
        ))}
      </div>
    );
  }
  if (eq.question.type === "MULTIPLE_RESPONSE") {
    const selectedIds = existing?.choiceIds ?? [];
    return (
      <div className="flex flex-col gap-1">
        {choices.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={name} value={c.id} defaultChecked={selectedIds.includes(c.id)} />
            {c.text}
          </label>
        ))}
      </div>
    );
  }
  if (eq.question.type === "SHORT_ANSWER") {
    return <input name={name} defaultValue={existing?.text ?? ""} className="w-full rounded border px-3 py-2 text-sm" />;
  }
  return <textarea name={name} defaultValue={existing?.text ?? ""} rows={4} className="w-full rounded border px-3 py-2 text-sm" />;
}

export default async function TakeExamPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    redirect("/login");
  }

  const { attemptId } = await params;
  const institutionId = session.user.institutionId;

  let attempt: AttemptView;
  try {
    attempt = await getAttemptForTaking(institutionId, session.user, attemptId);
  } catch (error) {
    if (error instanceof AttemptNotFoundError) {
      notFound();
    }
    if (error instanceof AttemptOwnershipError) {
      redirect("/dashboard");
    }
    throw error;
  }

  if (attempt.status !== "IN_PROGRESS") {
    redirect(`/attempts/${attemptId}/result`);
  }

  // Server-authorized timer (master prompt §18): computed fresh on every
  // load from startedAt, never trusted from the client. No live ticking
  // countdown or background auto-submit job yet (documented limitation) —
  // enforcement happens on next page load or save/submit action.
  const timeLimitSeconds = attempt.examVersion.timeLimitMinutes * 60;
  // This is a Server Component computing a server-authoritative timestamp once per
  // request (not a client render the purity rule is meant to protect) — Date.now() here IS the point.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const elapsedSeconds = attempt.startedAt ? Math.floor((now - attempt.startedAt.getTime()) / 1000) : 0;
  const remainingSeconds = Math.max(0, timeLimitSeconds - elapsedSeconds);
  const deadlineEpochMs = now + remainingSeconds * 1000;

  if (remainingSeconds <= 0) {
    await submitAttempt(institutionId, session.user, attemptId);
    redirect(`/attempts/${attemptId}/result?expired=1`);
  }

  const answersByQuestion = new Map(attempt.answers.map((a) => [a.examQuestionId, a]));
  const examQuestions = attempt.examVersion.examQuestions;

  async function saveProgressAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.id || !authSession.user.institutionId) {
      redirect("/login");
    }

    await saveAnswers(authSession.user.institutionId, authSession.user, attemptId, readAnswersFromForm(examQuestions, formData));
    revalidatePath(`/attempts/${attemptId}`);
  }

  async function submitExamAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.id || !authSession.user.institutionId) {
      redirect("/login");
    }

    await saveAnswers(authSession.user.institutionId, authSession.user, attemptId, readAnswersFromForm(examQuestions, formData));
    await submitAttempt(authSession.user.institutionId, authSession.user, attemptId);
    redirect(`/attempts/${attemptId}/result`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{attempt.examVersion.exam.title}</h1>
        <ExamCountdown deadlineEpochMs={deadlineEpochMs} submitButtonId={SUBMIT_BUTTON_ID} />
      </div>

      <form action={saveProgressAction} className="flex flex-col gap-6">
        {attempt.examVersion.examQuestions.map((eq, index) => {
          const existingRow = answersByQuestion.get(eq.id);
          return (
            <fieldset key={eq.id} className="rounded border p-3">
              <legend className="flex items-center gap-2 px-1 text-sm font-medium">
                <span>
                  Q{index + 1} · {eq.points} pt(s)
                </span>
                {existingRow?.isFlagged && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Flagged</span>
                )}
              </legend>
              <p className="mb-2 text-sm">{eq.questionVersion.prompt}</p>
              {renderInput(eq, existingRow)}
              <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                <input type="checkbox" name={`flag_${eq.id}`} defaultChecked={existingRow?.isFlagged ?? false} />
                Flag this question to review before submitting
              </label>
            </fieldset>
          );
        })}

        <div className="flex gap-3">
          <button type="submit" className="rounded border px-3 py-2">
            Save Progress
          </button>
          <button id={SUBMIT_BUTTON_ID} formAction={submitExamAction} className="rounded bg-black px-3 py-2 text-white">
            Submit Exam
          </button>
        </div>
      </form>

      <ExamToolbar />
    </main>
  );
}
