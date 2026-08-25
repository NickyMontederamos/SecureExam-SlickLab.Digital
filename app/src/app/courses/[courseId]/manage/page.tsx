import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { assignFaculty, CourseNotFoundError, enrollStudent, getCourseWithRoster } from "@/lib/courses";
import { listUsers } from "@/lib/users";

export default async function ManageCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    redirect("/login");
  }
  if (!can(session.user.role, "course", "update")) {
    redirect("/dashboard");
  }

  const { courseId } = await params;
  const institutionId = session.user.institutionId;

  let course;
  try {
    course = await getCourseWithRoster(institutionId, session.user, courseId);
  } catch (error) {
    if (error instanceof CourseNotFoundError) {
      notFound();
    }
    throw error;
  }

  const allUsers = await listUsers(institutionId, session.user);
  const facultyUsers = allUsers.filter((u) => u.role === "FACULTY");
  const studentUsers = allUsers.filter((u) => u.role === "STUDENT");
  const assignedFacultyIds = new Set(course.faculty.map((f) => f.userId));
  const enrolledStudentIds = new Set(course.enrollments.map((e) => e.userId));

  async function assignFacultyAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }
    const userId = String(formData.get("userId") ?? "");
    if (!userId) return;
    await assignFaculty(authSession.user.institutionId, authSession.user, courseId, userId);
    revalidatePath(`/courses/${courseId}/manage`);
  }

  async function enrollStudentAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }
    const userId = String(formData.get("userId") ?? "");
    if (!userId) return;
    await enrollStudent(authSession.user.institutionId, authSession.user, courseId, userId);
    revalidatePath(`/courses/${courseId}/manage`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div>
        <a href="/dashboard" className="text-sm text-gray-500">
          ← Dashboard
        </a>
        <h1 className="text-xl font-semibold">
          {course.code} — {course.name}
        </h1>
        <p className="text-sm text-gray-500">Roster management</p>
      </div>

      <section className="rounded border p-4">
        <h2 className="mb-3 font-medium">Faculty ({course.faculty.length})</h2>
        <ul className="mb-3 flex flex-col gap-1">
          {course.faculty.map((f) => (
            <li key={f.id} className="rounded border px-3 py-2 text-sm">
              {f.user.name} ({f.user.email})
            </li>
          ))}
          {course.faculty.length === 0 && <li className="text-sm text-gray-500">No faculty assigned yet.</li>}
        </ul>
        {facultyUsers.length > 0 ? (
          <form action={assignFacultyAction} className="flex items-center gap-2">
            <select name="userId" required className="flex-1 rounded border px-3 py-2 text-sm">
              {facultyUsers.map((u) => (
                <option key={u.id} value={u.id} disabled={assignedFacultyIds.has(u.id)}>
                  {u.name} ({u.email}) {assignedFacultyIds.has(u.id) ? "— already assigned" : ""}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-black px-3 py-2 text-sm text-white">
              Assign
            </button>
          </form>
        ) : (
          <p className="text-sm text-gray-500">
            No faculty accounts yet — <a href="/users" className="underline">add one</a> first.
          </p>
        )}
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-3 font-medium">Students ({course.enrollments.length})</h2>
        <ul className="mb-3 flex flex-col gap-1">
          {course.enrollments.map((e) => (
            <li key={e.id} className="rounded border px-3 py-2 text-sm">
              {e.user.name} ({e.user.email})
            </li>
          ))}
          {course.enrollments.length === 0 && <li className="text-sm text-gray-500">No students enrolled yet.</li>}
        </ul>
        {studentUsers.length > 0 ? (
          <form action={enrollStudentAction} className="flex items-center gap-2">
            <select name="userId" required className="flex-1 rounded border px-3 py-2 text-sm">
              {studentUsers.map((u) => (
                <option key={u.id} value={u.id} disabled={enrolledStudentIds.has(u.id)}>
                  {u.name} ({u.email}) {enrolledStudentIds.has(u.id) ? "— already enrolled" : ""}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-black px-3 py-2 text-sm text-white">
              Enroll
            </button>
          </form>
        ) : (
          <p className="text-sm text-gray-500">
            No student accounts yet — <a href="/users" className="underline">add one</a> first.
          </p>
        )}
      </section>
    </main>
  );
}
