import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { ExamNotFoundError, getExam } from "@/lib/exams";
import { listAttemptsForExam } from "@/lib/grading";
import { listIntegrityReviewsForExam, STRIKE_EVENT_TYPES } from "@/lib/integrity";
import { ForbiddenError } from "@/lib/rbac";

export default async function ExamGradingPage({ params }: { params: Promise<{ examId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    redirect("/login");
  }

  const { examId } = await params;
  const institutionId = session.user.institutionId;

  let exam;
  let attempts;
  let integrityReviews;
  try {
    exam = await getExam(institutionId, session.user, examId);
    attempts = await listAttemptsForExam(institutionId, session.user, examId);
    integrityReviews = await listIntegrityReviewsForExam(institutionId, session.user, examId);
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      notFound();
    }
    if (error instanceof ForbiddenError) {
      redirect("/dashboard");
    }
    throw error;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div>
        <a href={`/exams/${examId}`} className="text-sm text-gray-500">
          ← Exam
        </a>
        <h1 className="text-xl font-semibold">{exam.title} — Grading</h1>
        <p className="text-sm text-gray-500">{attempts.length} submission(s)</p>
      </div>

      {integrityReviews.length > 0 && (
        <section className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3">
          <h2 className="font-medium text-amber-900">Pending integrity review ({integrityReviews.length})</h2>
          {integrityReviews.map((attempt) => {
            const strikeCount = attempt.events.filter((e) => STRIKE_EVENT_TYPES.includes(e.type)).length;
            return (
              <a
                key={attempt.id}
                href={`/attempts/${attempt.id}/review`}
                className="flex items-center justify-between rounded border border-amber-300 bg-white p-3 text-sm hover:bg-amber-50"
              >
                <span>{attempt.student.name}</span>
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  {strikeCount} strike(s) — paused
                </span>
              </a>
            );
          })}
        </section>
      )}

      <section className="flex flex-col gap-2">
        {attempts.length === 0 && <p className="text-sm text-gray-500">No submissions yet.</p>}
        {attempts.map((attempt) => {
          const pendingCount = attempt.answers.filter((a) => a.pointsAwarded === null).length;
          const isTerminated = attempt.status === "TERMINATED";
          return (
            <a
              key={attempt.id}
              href={isTerminated ? `/attempts/${attempt.id}/review` : `/attempts/${attempt.id}/grade`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-gray-50"
            >
              <span>{attempt.student.name}</span>
              <span
                className={
                  "rounded px-2 py-0.5 text-xs " +
                  (isTerminated
                    ? "bg-red-100 text-red-800"
                    : attempt.status === "GRADED"
                      ? "bg-green-100 text-green-800"
                      : "bg-amber-100 text-amber-800")
                }
              >
                {isTerminated ? "Terminated" : attempt.status === "GRADED" ? "Graded" : `${pendingCount} pending`}
              </span>
            </a>
          );
        })}
      </section>
    </main>
  );
}
