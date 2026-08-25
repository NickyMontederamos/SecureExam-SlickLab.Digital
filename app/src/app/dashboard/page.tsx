import Image from "next/image";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/auth";
import { can } from "@/lib/rbac";
import { getDemoInstitutionBranding } from "@/lib/branding";
import { createCourse, CourseCodeTakenError, listCoursesForUser } from "@/lib/courses";

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

  if (!session.user.institutionId) {
    redirect("/login");
  }

  const { error } = await searchParams;
  const institutionId = session.user.institutionId;

  const [courses, branding] = await Promise.all([
    listCoursesForUser(institutionId, session.user),
    getDemoInstitutionBranding(),
  ]);

  const isAdmin = session.user.role === "INSTITUTION_ADMIN";
  const courseLinkPath = session.user.role === "STUDENT" ? "exams" : isAdmin ? "manage" : "questions";
  const canCreateCourse = can(session.user.role, "course", "create");
  const canManageUsers = can(session.user.role, "user", "create");

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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-3">
          {branding?.sealUrl && (
            <Image src={branding.sealUrl} alt="College of Maasin seal" width={40} height={40} />
          )}
          {branding?.logoUrl && (
            <Image src={branding.logoUrl} alt="College of Law crest" width={36} height={40} />
          )}
          <span className="text-sm font-medium">{branding?.name}</span>
        </div>
        <div className="flex items-center gap-3">
          {canManageUsers && (
            <a href="/users" className="text-sm underline">
              Users
            </a>
          )}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="rounded border px-3 py-1 text-sm">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <div>
        <h1 className="text-xl font-semibold">Welcome, {session.user.name}</h1>
        <p className="text-sm text-gray-500">
          Role: {session.user.role} · Institution-scoped session (institutionId: {session.user.institutionId})
        </p>
      </div>

      <section>
        <h2 className="mb-2 font-medium">
          {session.user.role === "STUDENT" ? "My Courses" : session.user.role === "FACULTY" ? "Courses I Teach" : "Courses"}
        </h2>
        <ul className="flex flex-col gap-1">
          {courses.map((course) => (
            <li key={course.id} className="rounded border px-3 py-2 text-sm">
              <a href={`/courses/${course.id}/${courseLinkPath}`} className="hover:underline">
                {course.code} — {course.name} ({course.academicYear})
              </a>
            </li>
          ))}
          {courses.length === 0 && <li className="text-sm text-gray-500">No courses yet.</li>}
        </ul>
      </section>

      {canCreateCourse && (
        <section className="rounded border p-4">
          <h2 className="mb-3 font-medium">Create a course</h2>
          {error && (
            <p role="alert" className="mb-3 rounded bg-red-100 p-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <form action={createCourseAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Code
              <input name="code" required placeholder="LAW101" className="rounded border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input name="name" required className="rounded border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Academic year
              <input name="academicYear" required placeholder="2026-2027" className="rounded border px-3 py-2" />
            </label>
            <button type="submit" className="rounded bg-black px-3 py-2 text-white">
              Create course
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
