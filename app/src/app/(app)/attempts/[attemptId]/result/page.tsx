import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { AttemptNotFoundError, AttemptOwnershipError, getAttemptResult } from "@/lib/attempts";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Alert, Card, PageHeader } from "@/components/ui";

export default async function AttemptResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ expired?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    redirect("/login");
  }

  const { attemptId } = await params;
  const { expired } = await searchParams;
  const institutionId = session.user.institutionId;

  let result;
  try {
    result = await getAttemptResult(institutionId, session.user, attemptId);
  } catch (error) {
    if (error instanceof AttemptNotFoundError) {
      notFound();
    }
    if (error instanceof AttemptOwnershipError) {
      redirect("/dashboard");
    }
    throw error;
  }

  // Real "approve to finish" step (docs/PITCH_ROADMAP.md Milestone 5): a
  // student who wasn't terminated for an integrity violation sees their
  // result only once a proctor verifies the submission. TERMINATED attempts
  // never get a Submission row (see resolveIntegrityReview in integrity.ts)
  // and skip this gate entirely — that result is shown immediately below.
  if (result.attempt.status !== "TERMINATED" && !result.attempt.submission?.verifiedAt) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <AutoRefresh intervalMs={5000} />
        <PageHeader backHref="/dashboard" title={result.attempt.examVersion.exam.title} />
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-brand-primary" />
          <Alert tone="warning">
            Your exam has been submitted. Waiting for your proctor to approve closing out your session — this page
            updates automatically once that happens.
          </Alert>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <PageHeader backHref="/dashboard" title={`${result.attempt.examVersion.exam.title} — Result`} />

      {expired === "1" && <Alert tone="warning">Time expired — this exam was auto-submitted.</Alert>}

      {result.attempt.status === "TERMINATED" ? (
        <Alert tone="error">
          This attempt was terminated following an integrity review — a faculty member confirmed a violation after
          repeated warnings during the exam. Contact your instructor if you believe this was in error.
        </Alert>
      ) : (
        <Card className="flex flex-col items-center gap-1 py-6 text-center">
          <span className="text-4xl font-semibold tracking-tight text-slate-900">
            {result.scoredPoints} <span className="text-2xl font-normal text-slate-400">/ {result.totalPoints}</span>
          </span>
          <span className="text-sm text-slate-500">
            {result.isFullyGraded ? "Final score" : "Partial score so far — some answers pending manual grading"}
          </span>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {result.breakdown.map((row, i) => (
          <Card key={i} className="text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-900">Q{i + 1}</span>
              <span className="text-slate-500">
                {row.pending ? "Pending grading" : `${row.pointsAwarded} / ${row.maxPoints} pt(s)`}
              </span>
            </div>
            <p className="mt-1 text-slate-700">{row.prompt}</p>
          </Card>
        ))}
      </div>
    </main>
  );
}
