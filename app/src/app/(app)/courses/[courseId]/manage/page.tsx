import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import {
  assignFaculty,
  assignProctor,
  CourseHasContentError,
  CourseNotFoundError,
  deleteCourse,
  enrollStudent,
  getCourseWithRoster,
  unassignFaculty,
  unassignProctor,
  unenrollStudent,
  updateCourse,
} from "@/lib/courses";
import { listUsers } from "@/lib/users";

export default async function ManageCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    redirect("/login");
  }
  if (!can(session.user.role, "course", "update")) {
    redirect("/dashboard");
  }

  const { courseId } = await params;
  const { error } = await searchParams;
  const institutionId = session.user.institutionId;

  let course;
  try {
    course = await getCourseWithRoster(institutionId, session.user, courseId);
  } catch (err) {
    if (err instanceof CourseNotFoundError) {
      notFound();
    }
    throw err;
  }

  const allUsers = await listUsers(institutionId, session.user);
  const facultyUsers = allUsers.filter((u) => u.role === "FACULTY");
  const proctorUsers = allUsers.filter((u) => u.role === "PROCTOR");
  const studentUsers = allUsers.filter((u) => u.role === "STUDENT");
  const assignedFacultyIds = new Set(course.faculty.map((f) => f.userId));
  const assignedProctorIds = new Set(course.proctors.map((p) => p.userId));
  const enrolledStudentIds = new Set(course.enrollments.map((e) => e.userId));
  const canDelete = can(session.user.role, "course", "delete");
  const isEmpty = course._count.questions === 0 && course._count.exams === 0;

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

  async function unassignFacultyAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }
    const userId = String(formData.get("userId") ?? "");
    if (!userId) return;
    await unassignFaculty(authSession.user.institutionId, authSession.user, courseId, userId);
    revalidatePath(`/courses/${courseId}/manage`);
  }

  async function assignProctorAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }
    const userId = String(formData.get("userId") ?? "");
    if (!userId) return;
    await assignProctor(authSession.user.institutionId, authSession.user, courseId, userId);
    revalidatePath(`/courses/${courseId}/manage`);
  }

  async function unassignProctorAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }
    const userId = String(formData.get("userId") ?? "");
    if (!userId) return;
    await unassignProctor(authSession.user.institutionId, authSession.user, courseId, userId);
    revalidatePath(`/courses/${courseId}/manage`);
  }

  async function unenrollStudentAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }
    const userId = String(formData.get("userId") ?? "");
    if (!userId) return;
    await unenrollStudent(authSession.user.institutionId, authSession.user, courseId, userId);
    revalidatePath(`/courses/${courseId}/manage`);
  }

  async function updateCourseAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }
    const name = String(formData.get("name") ?? "").trim();
    const academicYear = String(formData.get("academicYear") ?? "").trim();
    await updateCourse(authSession.user.institutionId, authSession.user, courseId, { name, academicYear });
    revalidatePath(`/courses/${courseId}/manage`);
  }

  async function deleteCourseAction() {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }
    try {
      await deleteCourse(authSession.user.institutionId, authSession.user, courseId);
    } catch (err) {
      if (err instanceof CourseHasContentError) {
        redirect(`/courses/${courseId}/manage?error=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }
    redirect("/dashboard");
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
        <p className="text-sm text-gray-500">
          Roster management ·{" "}
          <a href={`/courses/${courseId}/questions`} className="underline">
            Question bank
          </a>{" "}
          ·{" "}
          <a href={`/courses/${courseId}/exams`} className="underline">
            Exams
          </a>
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="rounded border p-4">
        <h2 className="mb-3 font-medium">Course details</h2>
        <form action={updateCourseAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input name="name" required defaultValue={course.name} className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Academic year
            <input name="academicYear" required defaultValue={course.academicYear} className="rounded border px-3 py-2" />
          </label>
          <button type="submit" className="self-start rounded border px-3 py-2 text-sm">
            Save changes
          </button>
        </form>

        {canDelete && (
          <div className="mt-4 border-t pt-4">
            {isEmpty ? (
              <form action={deleteCourseAction}>
                <button type="submit" className="rounded bg-red-700 px-3 py-2 text-sm text-white">
                  Delete course
                </button>
                <p className="mt-1 text-xs text-gray-500">This course has no questions or exams — safe to delete.</p>
              </form>
            ) : (
              <p className="text-xs text-gray-500">
                Can&apos;t delete — this course has {course._count.questions} question(s) and {course._count.exams}{" "}
                exam(s) attached. Those are academic records.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-3 font-medium">Faculty ({course.faculty.length})</h2>
        <ul className="mb-3 flex flex-col gap-1">
          {course.faculty.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>
                {f.user.name} ({f.user.email})
              </span>
              <form action={unassignFacultyAction}>
                <input type="hidden" name="userId" value={f.userId} />
                <button type="submit" className="text-xs text-red-700 underline">
                  Remove
                </button>
              </form>
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
        <h2 className="mb-3 font-medium">Proctors ({course.proctors.length})</h2>
        <ul className="mb-3 flex flex-col gap-1">
          {course.proctors.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>
                {p.user.name} ({p.user.email})
              </span>
              <form action={unassignProctorAction}>
                <input type="hidden" name="userId" value={p.userId} />
                <button type="submit" className="text-xs text-red-700 underline">
                  Remove
                </button>
              </form>
            </li>
          ))}
          {course.proctors.length === 0 && <li className="text-sm text-gray-500">No proctors assigned yet.</li>}
        </ul>
        {proctorUsers.length > 0 ? (
          <form action={assignProctorAction} className="flex items-center gap-2">
            <select name="userId" required className="flex-1 rounded border px-3 py-2 text-sm">
              {proctorUsers.map((u) => (
                <option key={u.id} value={u.id} disabled={assignedProctorIds.has(u.id)}>
                  {u.name} ({u.email}) {assignedProctorIds.has(u.id) ? "— already assigned" : ""}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-black px-3 py-2 text-sm text-white">
              Assign
            </button>
          </form>
        ) : (
          <p className="text-sm text-gray-500">
            No proctor accounts yet — <a href="/users" className="underline">add one</a> first.
          </p>
        )}
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-3 font-medium">Students ({course.enrollments.length})</h2>
        <ul className="mb-3 flex flex-col gap-1">
          {course.enrollments.map((e) => (
            <li key={e.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>
                {e.user.name} ({e.user.email})
              </span>
              <form action={unenrollStudentAction}>
                <input type="hidden" name="userId" value={e.userId} />
                <button type="submit" className="text-xs text-red-700 underline">
                  Remove
                </button>
              </form>
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
