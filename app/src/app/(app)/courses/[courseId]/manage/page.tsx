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
import { consumeCreatedCredentials, importRosterFromCsv, RosterImportValidationError } from "@/lib/roster-import";
import { listUsers } from "@/lib/users";
import { Alert, Button, Card, LinkButton, PageHeader, Section, inputClassName, labelClassName } from "@/components/ui";

/**
 * The faculty/proctor/student roster blocks are structurally identical
 * (a removable member list + an assign-from-dropdown form) — this was
 * copy-pasted three times with small drifts before this pass. One
 * definition instead, taking each role's server actions as props (safe:
 * this stays entirely on the server, so passing an inline "use server"
 * action reference here is just function composition, not the
 * client/server boundary that trips up sharing plain helpers — see
 * ERROR-004 in docs/ERROR_LOG.md for the actual failure mode that doesn't
 * apply here).
 */
function RosterSection({
  title,
  members,
  unassignAction,
  assignableUsers,
  assignedIds,
  assignAction,
  assignLabel,
  emptyLabel,
  noAccountsLabel,
}: {
  title: string;
  members: { id: string; userId: string; user: { name: string; email: string } }[];
  unassignAction: (formData: FormData) => Promise<void>;
  assignableUsers: { id: string; name: string; email: string }[];
  assignedIds: Set<string>;
  assignAction: (formData: FormData) => Promise<void>;
  assignLabel: string;
  emptyLabel: string;
  noAccountsLabel: string;
}) {
  return (
    <Section title={`${title} (${members.length})`}>
      <Card className="p-0">
        {members.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">{emptyLabel}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 font-medium text-slate-900">{m.user.name}</td>
                    <td className="px-4 py-2 text-slate-600">{m.user.email}</td>
                    <td className="px-4 py-2 text-right">
                      <form action={unassignAction}>
                        <input type="hidden" name="userId" value={m.userId} />
                        <Button type="submit" variant="danger" className="px-2.5 py-1 text-xs">
                          Remove
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-slate-100 p-4">
        {assignableUsers.length > 0 ? (
          <form action={assignAction} className="flex items-center gap-2">
            <select name="userId" required className={`flex-1 ${inputClassName}`}>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id} disabled={assignedIds.has(u.id)}>
                  {u.name} ({u.email}) {assignedIds.has(u.id) ? "— already assigned" : ""}
                </option>
              ))}
            </select>
            <Button type="submit">{assignLabel}</Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-slate-500">{noAccountsLabel}.</p>
            <LinkButton href="/users" variant="secondary" className="px-2.5 py-1 text-xs">
              Add one on the Users page
            </LinkButton>
          </div>
        )}
        </div>
      </Card>
    </Section>
  );
}

export default async function ManageCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ error?: string; importError?: string; imported?: string; credentials?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    redirect("/login");
  }
  if (!can(session.user.role, "course", "update")) {
    redirect("/dashboard");
  }

  const { courseId } = await params;
  const { error, importError, imported, credentials: credentialsToken } = await searchParams;
  const institutionId = session.user.institutionId;
  const newAccounts = credentialsToken ? consumeCreatedCredentials(credentialsToken) : null;

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

  async function importRosterAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }

    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) {
      redirect(`/courses/${courseId}/manage?importError=${encodeURIComponent("Choose a CSV file first")}`);
    }

    const text = await file.text();
    let result: Awaited<ReturnType<typeof importRosterFromCsv>>;
    try {
      result = await importRosterFromCsv(authSession.user.institutionId, authSession.user, courseId, text);
    } catch (err) {
      if (err instanceof RosterImportValidationError) {
        const summary = err.errors.map((e) => `Row ${e.row}: ${e.message}`).join(" · ");
        redirect(`/courses/${courseId}/manage?importError=${encodeURIComponent(summary)}`);
      }
      throw err;
    }

    revalidatePath(`/courses/${courseId}/manage`);
    const importedParam = `${result.facultyAssigned}-${result.studentsEnrolled}-${result.accountsCreated}`;
    const credentialsParam = result.credentialsToken ? `&credentials=${result.credentialsToken}` : "";
    redirect(`/courses/${courseId}/manage?imported=${importedParam}${credentialsParam}`);
  }

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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
      <PageHeader
        backHref={`/courses/${courseId}`}
        title={`${course.code} — ${course.name}`}
        subtitle="Roster management"
        actions={
          <>
            <LinkButton href={`/courses/${courseId}/questions`} variant="secondary">
              Question bank
            </LinkButton>
            <LinkButton href={`/courses/${courseId}/exams`} variant="secondary">
              Exams
            </LinkButton>
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}
      {imported &&
        (() => {
          const [facultyAssigned, studentsEnrolled, accountsCreated] = imported.split("-");
          return (
            <Alert tone="success">
              Imported roster: {facultyAssigned} faculty assignment(s), {studentsEnrolled} student enrollment(s)
              {Number(accountsCreated) > 0 ? `, ${accountsCreated} new account(s) created` : ""}.
            </Alert>
          );
        })()}
      {importError && <Alert tone="error">Import failed — nothing was added: {importError}</Alert>}

      {newAccounts && newAccounts.length > 0 && (
        <Section title="New account credentials — shown once">
          <Card className="border-amber-300 bg-amber-50">
            <p className="mb-3 text-sm text-amber-900">
              These accounts were just created with a temporary password. This is the only time it will be
              shown — copy or download it now and share it with each person out of band; reloading or
              revisiting this page will not bring it back.
            </p>
            <div className="overflow-x-auto rounded-lg border border-amber-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-amber-100 text-xs uppercase tracking-wide text-amber-800">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Email</th>
                    <th className="px-4 py-2 font-medium">Role</th>
                    <th className="px-4 py-2 font-medium">Temporary password</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {newAccounts.map((a) => (
                    <tr key={a.email}>
                      <td className="px-4 py-2 font-medium text-slate-900">{a.name}</td>
                      <td className="px-4 py-2 text-slate-600">{a.email}</td>
                      <td className="px-4 py-2 text-slate-600">{a.role}</td>
                      <td className="px-4 py-2 font-mono text-slate-900">{a.tempPassword}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <LinkButton
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(
                [
                  "email,name,role,temporary_password",
                  ...newAccounts.map((a) => `${a.email},${a.name},${a.role},${a.tempPassword}`),
                ].join("\n")
              )}`}
              download="new-account-credentials.csv"
              variant="secondary"
              className="mt-3"
            >
              Download as CSV
            </LinkButton>
          </Card>
        </Section>
      )}

      <Section title="Course details">
        <Card>
          <form action={updateCourseAction} className="flex flex-col gap-3">
            <label className={labelClassName}>
              Name
              <input name="name" required defaultValue={course.name} className={inputClassName} />
            </label>
            <label className={labelClassName}>
              Academic year
              <input name="academicYear" required defaultValue={course.academicYear} className={inputClassName} />
            </label>
            <Button type="submit" variant="secondary" className="self-start">
              Save changes
            </Button>
          </form>

          {canDelete && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              {isEmpty ? (
                <form action={deleteCourseAction}>
                  <Button type="submit" variant="danger">
                    Delete course
                  </Button>
                  <p className="mt-1 text-xs text-slate-500">This course has no questions or exams — safe to delete.</p>
                </form>
              ) : (
                <p className="text-xs text-slate-500">
                  Can&apos;t delete — this course has {course._count.questions} question(s) and {course._count.exams}{" "}
                  exam(s) attached. Those are academic records.
                </p>
              )}
            </div>
          )}
        </Card>
      </Section>

      <Section
        title="Import roster from CSV"
        description="Bulk-assign faculty and enroll students by email. An existing account is just attached to the course; an unknown email gets a new account with a temporary password (shown once, right here, after import) — it never changes an existing account's role."
      >
        <Card className="flex flex-col gap-3">
          <LinkButton href="/templates/course-roster-template.csv" download variant="secondary" className="self-start">
            Download the template
          </LinkButton>
          <form action={importRosterAction} className="flex items-center gap-2">
            <input name="file" type="file" accept=".csv,text/csv" required className="flex-1 text-sm" />
            <Button type="submit" variant="secondary">
              Import roster
            </Button>
          </form>
        </Card>
      </Section>

      <RosterSection
        title="Faculty"
        members={course.faculty}
        unassignAction={unassignFacultyAction}
        assignableUsers={facultyUsers}
        assignedIds={assignedFacultyIds}
        assignAction={assignFacultyAction}
        assignLabel="Assign"
        emptyLabel="No faculty assigned yet."
        noAccountsLabel="No faculty accounts yet"
      />

      <RosterSection
        title="Proctors"
        members={course.proctors}
        unassignAction={unassignProctorAction}
        assignableUsers={proctorUsers}
        assignedIds={assignedProctorIds}
        assignAction={assignProctorAction}
        assignLabel="Assign"
        emptyLabel="No proctors assigned yet."
        noAccountsLabel="No proctor accounts yet"
      />

      <RosterSection
        title="Students"
        members={course.enrollments}
        unassignAction={unenrollStudentAction}
        assignableUsers={studentUsers}
        assignedIds={enrolledStudentIds}
        assignAction={enrollStudentAction}
        assignLabel="Enroll"
        emptyLabel="No students enrolled yet."
        noAccountsLabel="No student accounts yet"
      />
    </main>
  );
}
