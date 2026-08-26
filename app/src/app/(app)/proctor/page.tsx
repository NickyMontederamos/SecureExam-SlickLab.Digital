import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { AutoRefresh } from "@/components/AutoRefresh";
import {
  listBookedAttemptsForProctor,
  listPendingApprovalsForProctor,
  listPendingVerificationsForProctor,
} from "@/lib/proctoring";
import { approveStartAction, cancelAttemptAction, verifySubmissionAction } from "./actions";
import { Badge, Button, Card, EmptyState, PageHeader, Section } from "@/components/ui";

function formatTime(d: Date | null): string {
  if (!d) return "No scheduled time";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * PROCTOR's landing page (docs/PITCH_ROADMAP.md Milestone 5) — replaces the
 * generic course-list dashboard for this role, since a proctor's job here
 * is acting on queues, not browsing courses. Scoped to whichever courses
 * this proctor is assigned to via CourseProctor (src/lib/courses.ts's
 * assignProctor) — an unassigned proctor sees three empty queues, not an
 * error. INSTITUTION_ADMIN can also reach this page (Milestone 6.5) with
 * institution-wide authority instead of a CourseProctor scope — see
 * scopedCourseIds in proctoring.ts — plus a "Cancel" reset action the
 * queues don't offer a plain PROCTOR.
 */
export default async function ProctorDashboardPage() {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    redirect("/login");
  }
  if (!can(session.user.role, "exam_attempt", "approve")) {
    redirect("/dashboard");
  }

  const institutionId = session.user.institutionId;
  const canCancel = can(session.user.role, "exam_attempt", "delete");
  const [booked, pendingApprovals, pendingVerifications] = await Promise.all([
    listBookedAttemptsForProctor(institutionId, session.user),
    listPendingApprovalsForProctor(institutionId, session.user),
    listPendingVerificationsForProctor(institutionId, session.user),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
      <AutoRefresh intervalMs={5000} />
      <PageHeader
        title="Proctor Dashboard"
        subtitle={
          session.user.role === "PROCTOR"
            ? `${session.user.name} · Scoped to your assigned courses · Refreshes automatically every few seconds.`
            : `${session.user.name} · Institution-wide oversight · Refreshes automatically every few seconds.`
        }
      />

      <Section
        title={
          <>
            Waiting for your approval to start
            {pendingApprovals.length > 0 && <Badge tone="amber">{pendingApprovals.length}</Badge>}
          </>
        }
      >
        {pendingApprovals.length === 0 ? (
          <EmptyState>Nothing waiting right now.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingApprovals.map((attempt) => (
              <li key={attempt.id}>
                <Card className="flex items-center justify-between text-sm">
                  <span>
                    <span className="font-medium text-slate-900">{attempt.student.name}</span>
                    <span className="text-slate-500"> — {attempt.examVersion.exam.title}</span>
                    <span className="ml-2 text-xs text-slate-400">Requested {formatTime(attempt.proctorRequestedAt)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <form action={approveStartAction}>
                      <input type="hidden" name="attemptId" value={attempt.id} />
                      <Button type="submit" className="px-3 py-1.5 text-xs">
                        Approve start
                      </Button>
                    </form>
                    {canCancel && (
                      <form action={cancelAttemptAction}>
                        <input type="hidden" name="attemptId" value={attempt.id} />
                        <Button type="submit" variant="danger" className="px-3 py-1.5 text-xs">
                          Cancel
                        </Button>
                      </form>
                    )}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={
          <>
            Waiting for your sign-off to finish
            {pendingVerifications.length > 0 && <Badge tone="amber">{pendingVerifications.length}</Badge>}
          </>
        }
      >
        {pendingVerifications.length === 0 ? (
          <EmptyState>Nothing waiting right now.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingVerifications.map((attempt) => (
              <li key={attempt.id}>
                <Card className="flex items-center justify-between text-sm">
                  <span>
                    <span className="font-medium text-slate-900">{attempt.student.name}</span>
                    <span className="text-slate-500"> — {attempt.examVersion.exam.title}</span>
                    <span className="ml-2 text-xs text-slate-400">Submitted {formatTime(attempt.submittedAt)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <form action={verifySubmissionAction}>
                      <input type="hidden" name="attemptId" value={attempt.id} />
                      <Button type="submit" className="px-3 py-1.5 text-xs">
                        Approve to finish
                      </Button>
                    </form>
                    {canCancel && (
                      <form action={cancelAttemptAction}>
                        <input type="hidden" name="attemptId" value={attempt.id} />
                        <Button type="submit" variant="danger" className="px-3 py-1.5 text-xs">
                          Cancel
                        </Button>
                      </form>
                    )}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Booked, upcoming (${booked.length})`}>
        {booked.length === 0 ? (
          <EmptyState>No booked attempts right now.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {booked.map((attempt) => (
              <li key={attempt.id}>
                <Card className="flex items-center justify-between text-sm">
                  <span className="text-slate-900">
                    {attempt.student.name} <span className="text-slate-500">— {attempt.examVersion.exam.title}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-slate-500">{formatTime(attempt.scheduledFor)}</span>
                    {canCancel && (
                      <form action={cancelAttemptAction}>
                        <input type="hidden" name="attemptId" value={attempt.id} />
                        <Button type="submit" variant="danger" className="px-3 py-1.5 text-xs">
                          Cancel
                        </Button>
                      </form>
                    )}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}
