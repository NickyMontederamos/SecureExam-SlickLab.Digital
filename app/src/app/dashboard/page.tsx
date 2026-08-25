import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { forTenant } from "@/lib/tenant-db";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const courses = session.user.institutionId
    ? await forTenant(session.user.institutionId).course.findMany({ orderBy: { code: "asc" } })
    : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Welcome, {session.user.name}</h1>
          <p className="text-sm text-gray-500">
            Role: {session.user.role} · Institution-scoped session (institutionId: {session.user.institutionId})
          </p>
        </div>
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

      <section>
        <h2 className="mb-2 font-medium">Courses (tenant-scoped)</h2>
        <ul className="flex flex-col gap-1">
          {courses.map((course) => (
            <li key={course.id} className="rounded border px-3 py-2 text-sm">
              {course.code} — {course.name} ({course.academicYear})
            </li>
          ))}
          {courses.length === 0 && <li className="text-sm text-gray-500">No courses yet.</li>}
        </ul>
      </section>
    </main>
  );
}
