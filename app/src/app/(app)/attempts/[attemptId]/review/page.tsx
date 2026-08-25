import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { AttemptNotFoundError } from "@/lib/attempts";
import { getIntegrityReview, resolveIntegrityReview, STRIKE_EVENT_TYPES } from "@/lib/integrity";
import { ForbiddenError } from "@/lib/rbac";

const EVENT_LABELS: Record<string, string> = {
  WINDOW_BLUR: "Alt+Tab or window switch detected",
  VISIBILITY_HIDDEN: "Switched to another browser tab",
  FULLSCREEN_EXIT: "Exited fullscreen",
  NETWORK_OFFLINE: "Network connection lost",
  NETWORK_ONLINE: "Network connection restored",
};


export default async function IntegrityReviewPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    redirect("/login");
  }

  const { attemptId } = await params;
  const institutionId = session.user.institutionId;

  let attempt;
  try {
    attempt = await getIntegrityReview(institutionId, session.user, attemptId);
  } catch (error) {
    if (error instanceof AttemptNotFoundError) {
      notFound();
    }
    if (error instanceof ForbiddenError) {
      redirect("/dashboard");
    }
    throw error;
  }

  const canDecide = attempt.status === "INTERRUPTED";

  async function reinstateAction() {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }
    await resolveIntegrityReview(authSession.user.institutionId, authSession.user, attemptId, "REINSTATE");
    revalidatePath(`/attempts/${attemptId}/review`);
  }

  async function failAction() {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }
    await resolveIntegrityReview(authSession.user.institutionId, authSession.user, attemptId, "FAIL");
    revalidatePath(`/attempts/${attemptId}/review`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div>
        <a href={`/exams/${attempt.examVersion.exam.id}/grading`} className="text-sm text-gray-500">
          ← Grading
        </a>
        <h1 className="text-xl font-semibold">Integrity Review — {attempt.student.name}</h1>
        <p className="text-sm text-gray-500">
          {attempt.examVersion.exam.title} · Status: {attempt.status}
        </p>
      </div>

      <section className="rounded border p-4">
        <h2 className="mb-3 font-medium">Event trail ({attempt.events.length})</h2>
        <p className="mb-3 text-xs text-gray-500">
          Technical signals only — this is evidence for a human decision, not an automatic verdict. A student losing
          focus because of an OS notification isn&apos;t automatically misconduct.
        </p>
        <ul className="flex flex-col gap-2">
          {attempt.events.map((event) => {
            const isStrike = STRIKE_EVENT_TYPES.includes(event.type);
            return (
              <li key={event.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  {EVENT_LABELS[event.type] ?? event.type}
                  {!isStrike && (
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">Context only — not a strike</span>
                  )}
                </span>
                <span className="text-xs text-gray-500">{event.occurredAt.toLocaleString()}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {canDecide ? (
        <section className="flex gap-3">
          <form action={reinstateAction}>
            <button type="submit" className="rounded border px-3 py-2 text-sm">
              Reinstate — let the student continue
            </button>
          </form>
          <form action={failAction}>
            <button type="submit" className="rounded bg-red-700 px-3 py-2 text-sm text-white">
              Confirm violation — terminate attempt
            </button>
          </form>
        </section>
      ) : (
        <p className="text-sm text-gray-500">
          This attempt is no longer pending review (current status: {attempt.status}).
        </p>
      )}
    </main>
  );
}
