import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { AttemptNotFoundError, AttemptOwnershipError, getAttemptResult } from "@/lib/attempts";

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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div>
        <a href="/dashboard" className="text-sm text-gray-500">
          ← Dashboard
        </a>
        <h1 className="text-xl font-semibold">{result.attempt.examVersion.exam.title} — Result</h1>
        {expired === "1" && (
          <p className="text-sm text-amber-700">Time expired — this exam was auto-submitted.</p>
        )}
        {result.attempt.status === "TERMINATED" ? (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            This attempt was terminated following an integrity review — a faculty member confirmed a violation after
            repeated warnings during the exam. Contact your instructor if you believe this was in error.
          </p>
        ) : (
          <p className="text-sm text-gray-500">
            {result.isFullyGraded
              ? `Score: ${result.scoredPoints} / ${result.totalPoints}`
              : `Partial score so far: ${result.scoredPoints} / ${result.totalPoints} (some answers pending manual grading)`}
          </p>
        )}
      </div>

      <section className="flex flex-col gap-2">
        {result.breakdown.map((row, i) => (
          <div key={i} className="rounded border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Q{i + 1}</span>
              <span className="text-gray-500">
                {row.pending ? "Pending grading" : `${row.pointsAwarded} / ${row.maxPoints} pt(s)`}
              </span>
            </div>
            <p className="mt-1">{row.prompt}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
