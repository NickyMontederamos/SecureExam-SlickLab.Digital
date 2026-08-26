import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { AttemptNotFoundError } from "@/lib/attempts";
import { getIntegrityReview, resolveIntegrityReview, STRIKE_EVENT_TYPES } from "@/lib/integrity";
import { ForbiddenError } from "@/lib/rbac";
import { Alert, Badge, Button, Card, PageHeader, Section } from "@/components/ui";

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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <PageHeader
        backHref={`/exams/${attempt.examVersion.exam.id}/grading`}
        backLabel="Grading"
        title={`Integrity Review — ${attempt.student.name}`}
        subtitle={`${attempt.examVersion.exam.title} · Status: ${attempt.status}`}
      />

      <Section
        title={`Event trail (${attempt.events.length})`}
        description="Technical signals only — this is evidence for a human decision, not an automatic verdict. A student losing focus because of an OS notification isn't automatically misconduct."
      >
        <ul className="flex flex-col gap-2">
          {attempt.events.map((event) => {
            const isStrike = STRIKE_EVENT_TYPES.includes(event.type);
            return (
              <li key={event.id}>
                <Card className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    {EVENT_LABELS[event.type] ?? event.type}
                    {!isStrike && <Badge tone="blue">Context only — not a strike</Badge>}
                  </span>
                  <span className="text-xs text-slate-500">{event.occurredAt.toLocaleString()}</span>
                </Card>
              </li>
            );
          })}
        </ul>
      </Section>

      {canDecide ? (
        <div className="flex gap-3">
          <form action={reinstateAction}>
            <Button type="submit" variant="secondary">
              Reinstate — let the student continue
            </Button>
          </form>
          <form action={failAction}>
            <Button type="submit" variant="danger">
              Confirm violation — terminate attempt
            </Button>
          </form>
        </div>
      ) : (
        <Alert tone="info">This attempt is no longer pending review (current status: {attempt.status}).</Alert>
      )}
    </main>
  );
}
