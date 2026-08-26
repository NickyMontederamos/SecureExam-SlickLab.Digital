import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { createCourse, CourseCodeTakenError, listCoursesForUser } from "@/lib/courses";
import { Alert, Button, Card, EmptyState, PageHeader, Section, inputClassName, labelClassName } from "@/components/ui";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  // SUPER_ADMIN / PLATFORM_ADMIN operate cross-tenant and have no
  // institutionId of their own — they get their own landing page, not
  // this tenant dashboard.
  if (session.user.role === "SUPER_ADMIN" || session.user.role === "PLATFORM_ADMIN") {
    redirect("/admin");
  }

  // Proctors act on queues (docs/PITCH_ROADMAP.md Milestone 5), not browse
  // courses — the generic course-list dashboard below isn't their job here.
  if (session.user.role === "PROCTOR") {
    redirect("/proctor");
  }

  if (!session.user.institutionId) {
    redirect("/login");
  }

  const { error } = await searchParams;
  const institutionId = session.user.institutionId;

  const courses = await listCoursesForUser(institutionId, session.user);

  const courseLinkPath = session.user.role === "STUDENT" ? "exams" : "";
  const canCreateCourse = can(session.user.role, "course", "create");

  async function createCourseAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }

    const code = String(formData.get("code") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const academicYear = String(formData.get("academicYear") ?? "").trim();

    try {
      await createCourse(authSession.user.institutionId, authSession.user, { code, name, academicYear });
    } catch (err) {
      if (err instanceof CourseCodeTakenError) {
        redirect(`/dashboard?error=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }

    revalidatePath("/dashboard");
  }

  const coursesLabel =
    session.user.role === "STUDENT" ? "My Courses" : session.user.role === "FACULTY" ? "Courses I Teach" : "Courses";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
      <PageHeader title={`Welcome, ${session.user.name}`} subtitle={`Signed in as ${session.user.role}`} />

      <Section title={coursesLabel}>
        {courses.length === 0 ? (
          <EmptyState>No courses yet.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {courses.map((course) => (
              <li key={course.id}>
                <a href={courseLinkPath ? `/courses/${course.id}/${courseLinkPath}` : `/courses/${course.id}`}>
                  <Card interactive className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-900">
                      {course.code} — {course.name}
                    </span>
                    <span className="text-xs text-slate-500">{course.academicYear}</span>
                  </Card>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {canCreateCourse && (
        <Section title="Create a course">
          <Card>
            {error && (
              <div className="mb-3">
                <Alert tone="error">{error}</Alert>
              </div>
            )}
            <form action={createCourseAction} className="flex flex-col gap-3">
              <label className={labelClassName}>
                Code
                <input name="code" required placeholder="LAW101" className={inputClassName} />
              </label>
              <label className={labelClassName}>
                Name
                <input name="name" required className={inputClassName} />
              </label>
              <label className={labelClassName}>
                Academic year
                <input name="academicYear" required placeholder="2026-2027" className={inputClassName} />
              </label>
              <Button type="submit" className="self-start">
                Create course
              </Button>
            </form>
          </Card>
        </Section>
      )}
    </main>
  );
}
