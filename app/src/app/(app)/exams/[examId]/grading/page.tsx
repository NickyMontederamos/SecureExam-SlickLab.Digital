import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { ExamNotFoundError, getExam } from "@/lib/exams";
import { listAttemptsForExam } from "@/lib/grading";
import { listIntegrityReviewsForExam, STRIKE_EVENT_TYPES } from "@/lib/integrity";
import { ForbiddenError } from "@/lib/rbac";
import { Alert, Badge, Card, EmptyState, PageHeader, Section } from "@/components/ui";

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

  const gradedCount = attempts.filter((a) => a.status === "GRADED").length;
  const pendingAttemptCount = attempts.length - gradedCount;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
      <PageHeader backHref={`/exams/${examId}`} backLabel="Exam" title={`${exam.title} — Grading`} subtitle={`${attempts.length} submission(s)`} />

      {integrityReviews.length > 0 && (
        <Section title={`Pending integrity review (${integrityReviews.length})`}>
          <div className="flex flex-col gap-2">
            {integrityReviews.map((attempt) => {
              const strikeCount = attempt.events.filter((e) => STRIKE_EVENT_TYPES.includes(e.type)).length;
              return (
                <a key={attempt.id} href={`/attempts/${attempt.id}/review`}>
                  <Card interactive className="flex items-center justify-between border-amber-300 bg-amber-50 text-sm">
                    <span className="text-slate-900">{attempt.student.name}</span>
                    <Badge tone="amber">{strikeCount} strike(s) — paused</Badge>
                  </Card>
                </a>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Submissions">
        {attempts.length === 0 ? (
          <EmptyState>No submissions yet.</EmptyState>
        ) : (
          <>
            {pendingAttemptCount > 0 ? (
              <Alert tone="warning">
                {pendingAttemptCount} of {attempts.length} submission(s) still need grading.
              </Alert>
            ) : (
              <Alert tone="success">All {attempts.length} submission(s) fully graded.</Alert>
            )}
            <div className="mt-3 flex flex-col gap-2">
              {attempts.map((attempt) => {
                const pendingCount = attempt.answers.filter((a) => a.pointsAwarded === null).length;
                const isTerminated = attempt.status === "TERMINATED";
                return (
                  <a key={attempt.id} href={isTerminated ? `/attempts/${attempt.id}/review` : `/attempts/${attempt.id}/grade`}>
                    <Card interactive className="flex items-center justify-between text-sm">
                      <span className="text-slate-900">{attempt.student.name}</span>
                      <Badge tone={isTerminated ? "red" : attempt.status === "GRADED" ? "green" : "amber"}>
                        {isTerminated
                          ? "Terminated"
                          : attempt.status === "GRADED"
                            ? "Graded"
                            : `${pendingCount} of ${attempt.answers.length} question(s) pending`}
                      </Badge>
                    </Card>
                  </a>
                );
              })}
            </div>
          </>
        )}
      </Section>
    </main>
  );
}
