import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { ExamNotFoundError, getExam } from "@/lib/exams";
import { listAttemptsForExam } from "@/lib/grading";
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
  try {
    exam = await getExam(institutionId, session.user, examId);
    attempts = await listAttemptsForExam(institutionId, session.user, examId);
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

      <section className="flex flex-col gap-2">
        {attempts.length === 0 && <p className="text-sm text-gray-500">No submissions yet.</p>}
        {attempts.map((attempt) => {
          const pendingCount = attempt.answers.filter((a) => a.pointsAwarded === null).length;
          return (
            <a
              key={attempt.id}
              href={`/attempts/${attempt.id}/grade`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-gray-50"
            >
              <span>{attempt.student.name}</span>
              <span
                className={
                  "rounded px-2 py-0.5 text-xs " +
                  (attempt.status === "GRADED" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800")
                }
              >
                {attempt.status === "GRADED" ? "Graded" : `${pendingCount} pending`}
              </span>
            </a>
          );
        })}
      </section>
    </main>
  );
}
