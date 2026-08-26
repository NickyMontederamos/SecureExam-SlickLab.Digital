import type { QuestionType } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { AttemptNotFoundError, getAttemptForTaking } from "@/lib/attempts";
import { gradeAnswer } from "@/lib/grading";
import { can, ForbiddenError } from "@/lib/rbac";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

type AnswerShape = { choiceIds?: string[]; text?: string };

/** Turns a raw ExamAnswer.responseJson into something a grader can actually read — choice text for MC/MR/TF, plain text for short-answer/essay, never a raw JSON dump. */
function formatResponse(questionType: QuestionType, choices: unknown, responseJson: unknown): string {
  if (!responseJson) return "(no answer)";
  const response = responseJson as AnswerShape;

  if (questionType === "SHORT_ANSWER" || questionType === "ESSAY") {
    return response.text?.trim() || "(no answer)";
  }

  const choiceList = (choices as { id: string; text: string }[] | null) ?? [];
  const selectedIds = response.choiceIds ?? [];
  if (selectedIds.length === 0) return "(no answer)";
  return selectedIds.map((id) => choiceList.find((c) => c.id === id)?.text ?? id).join(", ");
}

export default async function GradeAttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    redirect("/login");
  }

  const { attemptId } = await params;
  const institutionId = session.user.institutionId;

  let attempt;
  try {
    attempt = await getAttemptForTaking(institutionId, session.user, attemptId);
  } catch (error) {
    if (error instanceof AttemptNotFoundError) {
      notFound();
    }
    if (error instanceof ForbiddenError) {
      redirect("/dashboard");
    }
    throw error;
  }

  if (attempt.status === "IN_PROGRESS" || attempt.status === "NOT_STARTED") {
    redirect("/dashboard");
  }

  const answersByQuestion = new Map(attempt.answers.map((a) => [a.examQuestionId, a]));
  const canGrade = can(session.user.role, "grade", "grade");
  const pendingCount = attempt.examVersion.examQuestions.filter((eq) => {
    if (eq.question.type !== "ESSAY" && eq.question.type !== "SHORT_ANSWER") return false;
    const a = answersByQuestion.get(eq.id);
    return !a || a.pointsAwarded === null;
  }).length;

  async function gradeAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.id || !authSession.user.institutionId) {
      redirect("/login");
    }

    const examAnswerId = String(formData.get("examAnswerId") ?? "");
    const points = Number(formData.get("points") ?? 0);
    if (!examAnswerId) return;

    await gradeAnswer(authSession.user.institutionId, authSession.user, examAnswerId, points);
    revalidatePath(`/attempts/${attemptId}/grade`);
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <PageHeader
        backHref={`/exams/${attempt.examVersion.exam.id}/grading`}
        backLabel="Grading"
        title={`Grading: ${attempt.examVersion.exam.title}`}
        subtitle={
          <>
            Status: {attempt.status}
            {pendingCount > 0 && <span className="ml-2 text-amber-700">· {pendingCount} question(s) still pending</span>}
          </>
        }
      />

      <div className="flex flex-col gap-3">
        {attempt.examVersion.examQuestions.map((eq, i) => {
          const answer = answersByQuestion.get(eq.id);
          const responseText = formatResponse(eq.question.type, eq.questionVersion.choices, answer?.responseJson);
          const isManual = eq.question.type === "ESSAY" || eq.question.type === "SHORT_ANSWER";

          return (
            <Card key={eq.id} className="text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">
                  Q{i + 1} · {eq.points} pt(s)
                </span>
                {answer?.autoGraded && <Badge>Auto-graded</Badge>}
              </div>
              <p className="mt-1 text-slate-700">{eq.questionVersion.prompt}</p>
              <p className="mt-2 rounded-lg bg-slate-50 p-2.5 text-sm text-slate-800">{responseText}</p>

              {isManual && canGrade ? (
                <form action={gradeAction} className="mt-3 flex items-center gap-2">
                  <input type="hidden" name="examAnswerId" value={answer?.id} />
                  <input
                    name="points"
                    type="number"
                    step="0.5"
                    min={0}
                    max={eq.points}
                    defaultValue={answer?.pointsAwarded ?? undefined}
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  />
                  <Button type="submit" className="px-3 py-1.5 text-xs">
                    Save grade
                  </Button>
                </form>
              ) : isManual ? (
                <p className="mt-2 text-xs text-slate-500">
                  {answer?.pointsAwarded === null || answer?.pointsAwarded === undefined
                    ? "Pending grading (view only — your role can't grade)"
                    : `${answer.pointsAwarded} / ${eq.points} (manually graded)`}
                </p>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  {answer?.pointsAwarded ?? 0} / {eq.points} (auto-graded)
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </main>
  );
}
