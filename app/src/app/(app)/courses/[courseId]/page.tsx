import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { CourseAccessDeniedError, CourseNotFoundError, getCourseWithRoster } from "@/lib/courses";
import { getCourseExamSummaries } from "@/lib/grading";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";

/**
 * The course-home landing page (docs/PITCH_ROADMAP.md Milestone 6.7):
 * roster + exam/grading overview in one place, so faculty and admins land
 * somewhere useful when opening a course instead of jumping straight into
 * the question bank or the roster-editing form. FACULTY/INSTITUTION_ADMIN
 * only — students take exams from their own course-exams list, proctors and
 * platform-level roles have their own landing pages (see dashboard/page.tsx
 * for the same routing split).
 */
export default async function CourseHomePage({ params }: { params: Promise<{ courseId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    redirect("/login");
  }
  if (session.user.role !== "FACULTY" && session.user.role !== "INSTITUTION_ADMIN") {
    redirect("/dashboard");
  }

  const { courseId } = await params;
  const institutionId = session.user.institutionId;

  let course;
  try {
    course = await getCourseWithRoster(institutionId, session.user, courseId);
  } catch (err) {
    if (err instanceof CourseNotFoundError) {
      notFound();
    }
    if (err instanceof CourseAccessDeniedError) {
      redirect("/dashboard");
    }
    throw err;
  }

  const examSummaries = await getCourseExamSummaries(institutionId, session.user, courseId);
  const totalPending = examSummaries.reduce((sum, e) => sum + e.pendingCount, 0);
  const canManage = can(session.user.role, "course", "update");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
      <PageHeader
        backHref="/dashboard"
        title={`${course.code} — ${course.name}`}
        subtitle={course.academicYear}
        badge={totalPending > 0 ? <Badge tone="amber">{totalPending} pending grading</Badge> : undefined}
        actions={
          <>
            <LinkButton href={`/courses/${courseId}/questions`} variant="secondary">
              Question bank
            </LinkButton>
            <LinkButton href={`/courses/${courseId}/exams`} variant="secondary">
              Exams
            </LinkButton>
            {canManage && (
              <LinkButton href={`/courses/${courseId}/manage`} variant="secondary">
                Manage roster
              </LinkButton>
            )}
          </>
        }
      />

      <Section title={`Taught by ${course.faculty.length} · Proctored by ${course.proctors.length}`}>
        <Card className="text-sm text-slate-600">
          {course.faculty.length === 0 && course.proctors.length === 0 ? (
            <span>No faculty or proctors assigned yet.</span>
          ) : (
            <div className="flex flex-col gap-1">
              {course.faculty.length > 0 && (
                <span>Faculty: {course.faculty.map((f) => f.user.name).join(", ")}</span>
              )}
              {course.proctors.length > 0 && (
                <span>Proctors: {course.proctors.map((p) => p.user.name).join(", ")}</span>
              )}
            </div>
          )}
        </Card>
      </Section>

      <Section title={`Students (${course.enrollments.length})`}>
        {course.enrollments.length === 0 ? (
          <EmptyState>No students enrolled yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Enrolled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {course.enrollments.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2 font-medium text-slate-900">{e.user.name}</td>
                    <td className="px-4 py-2 text-slate-600">{e.user.email}</td>
                    <td className="px-4 py-2 text-slate-500">
                      {e.enrolledAt.toLocaleDateString(undefined, { dateStyle: "medium" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Exams & grading (${examSummaries.length})`}>
        {examSummaries.length === 0 ? (
          <EmptyState>No exams yet.</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {examSummaries.map((exam) => (
              <Card key={exam.examId} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{exam.title}</span>
                  <Badge tone={exam.status === "PUBLISHED" ? "green" : "gray"}>{exam.status}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span>{exam.submittedCount} submitted</span>
                  <span>{exam.gradedCount} graded</span>
                  {exam.terminatedCount > 0 && <span>{exam.terminatedCount} terminated</span>}
                  {exam.averageScorePercent !== null && <span>avg {exam.averageScorePercent.toFixed(0)}%</span>}
                  {exam.pendingCount > 0 && <Badge tone="amber">{exam.pendingCount} pending grading</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <LinkButton href={`/exams/${exam.examId}`} variant="secondary" className="px-2.5 py-1 text-xs">
                    View exam
                  </LinkButton>
                  {exam.pendingCount > 0 && (
                    <LinkButton href={`/exams/${exam.examId}/grading`} variant="secondary" className="px-2.5 py-1 text-xs">
                      Grade now
                    </LinkButton>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </main>
  );
}
