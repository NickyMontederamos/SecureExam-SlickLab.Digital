import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { AutoRefresh } from "@/components/AutoRefresh";
import {
  listBookedAttemptsForProctor,
  listPendingApprovalsForProctor,
  listPendingVerificationsForProctor,
} from "@/lib/proctoring";
import { approveStartAction, verifySubmissionAction } from "./actions";

function formatTime(d: Date | null): string {
  if (!d) return "No scheduled time";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * PROCTOR's landing page (docs/PITCH_ROADMAP.md Milestone 5) — replaces the
 * generic course-list dashboard for this role, since a proctor's job here
 * is acting on queues, not browsing courses. Scoped to whichever
 * courses this proctor is assigned to via CourseProctor (src/lib/courses.ts's
 * assignProctor) — an unassigned proctor sees three empty queues, not an error.
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
  const [booked, pendingApprovals, pendingVerifications] = await Promise.all([
    listBookedAttemptsForProctor(institutionId, session.user),
    listPendingApprovalsForProctor(institutionId, session.user),
    listPendingVerificationsForProctor(institutionId, session.user),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <AutoRefresh intervalMs={5000} />
      <div>
        <h1 className="text-xl font-semibold">Proctor Dashboard</h1>
        <p className="text-sm text-gray-500">
          {session.user.name} · Refreshes automatically every few seconds.
        </p>
      </div>

      <section className="rounded border p-4">
        <h2 className="mb-3 font-medium">Waiting for your approval to start ({pendingApprovals.length})</h2>
        {pendingApprovals.length === 0 && <p className="text-sm text-gray-500">Nothing waiting right now.</p>}
        <ul className="flex flex-col gap-2">
          {pendingApprovals.map((attempt) => (
            <li key={attempt.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>
                {attempt.student.name} — {attempt.examVersion.exam.title}
                <span className="ml-2 text-gray-500">Requested {formatTime(attempt.proctorRequestedAt)}</span>
              </span>
              <form action={approveStartAction}>
                <input type="hidden" name="attemptId" value={attempt.id} />
                <button type="submit" className="rounded bg-black px-3 py-1.5 text-xs text-white">
                  Approve start
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-3 font-medium">Waiting for your sign-off to finish ({pendingVerifications.length})</h2>
        {pendingVerifications.length === 0 && <p className="text-sm text-gray-500">Nothing waiting right now.</p>}
        <ul className="flex flex-col gap-2">
          {pendingVerifications.map((attempt) => (
            <li key={attempt.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>
                {attempt.student.name} — {attempt.examVersion.exam.title}
                <span className="ml-2 text-gray-500">Submitted {formatTime(attempt.submittedAt)}</span>
              </span>
              <form action={verifySubmissionAction}>
                <input type="hidden" name="attemptId" value={attempt.id} />
                <button type="submit" className="rounded bg-black px-3 py-1.5 text-xs text-white">
                  Approve to finish
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-3 font-medium">Booked, upcoming ({booked.length})</h2>
        {booked.length === 0 && <p className="text-sm text-gray-500">No booked attempts right now.</p>}
        <ul className="flex flex-col gap-1">
          {booked.map((attempt) => (
            <li key={attempt.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>
                {attempt.student.name} — {attempt.examVersion.exam.title}
              </span>
              <span className="text-gray-500">{formatTime(attempt.scheduledFor)}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
