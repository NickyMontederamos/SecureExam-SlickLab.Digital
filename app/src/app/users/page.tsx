import type { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { createUser, EmailTakenError, listUsers, resetUserPassword, setUserActive } from "@/lib/users";

const ASSIGNABLE_ROLES: Role[] = ["INSTITUTION_ADMIN", "FACULTY", "PROCTOR", "STUDENT"];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    redirect("/login");
  }
  if (!can(session.user.role, "user", "create")) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const institutionId = session.user.institutionId;
  const users = await listUsers(institutionId, session.user);

  async function createUserAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }

    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const role = String(formData.get("role") ?? "STUDENT") as Role;

    try {
      await createUser(authSession.user.institutionId, authSession.user, { name, email, password, role });
    } catch (err) {
      if (err instanceof EmailTakenError) {
        redirect(`/users?error=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }

    revalidatePath("/users");
  }

  async function toggleActiveAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }
    const userId = String(formData.get("userId") ?? "");
    const nextActive = formData.get("nextActive") === "true";
    if (!userId) return;
    await setUserActive(authSession.user.institutionId, authSession.user, userId, nextActive);
    revalidatePath("/users");
  }

  async function resetPasswordAction(formData: FormData) {
    "use server";
    const authSession = await auth();
    if (!authSession?.user?.institutionId) {
      redirect("/login");
    }
    const userId = String(formData.get("userId") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    if (!userId || newPassword.length < 8) return;
    await resetUserPassword(authSession.user.institutionId, authSession.user, userId, newPassword);
    revalidatePath("/users");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div>
        <a href="/dashboard" className="text-sm text-gray-500">
          ← Dashboard
        </a>
        <h1 className="text-xl font-semibold">Users ({users.length})</h1>
      </div>

      <section className="flex flex-col gap-2">
        {users.map((user) => (
          <div key={user.id} className="rounded border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span>
                {user.name} <span className="text-gray-500">({user.email})</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{user.role}</span>
                {!user.isActive && (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">inactive</span>
                )}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <form action={toggleActiveAction}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="nextActive" value={(!user.isActive).toString()} />
                <button type="submit" className="text-xs underline">
                  {user.isActive ? "Deactivate" : "Activate"}
                </button>
              </form>
              <form action={resetPasswordAction} className="flex items-center gap-1">
                <input type="hidden" name="userId" value={user.id} />
                <input
                  name="newPassword"
                  type="password"
                  placeholder="New password"
                  minLength={8}
                  className="rounded border px-2 py-1 text-xs"
                />
                <button type="submit" className="text-xs underline">
                  Reset password
                </button>
              </form>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-3 font-medium">Add a user</h2>
        {error && (
          <p role="alert" className="mb-3 rounded bg-red-100 p-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <form action={createUserAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input name="name" required className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input name="email" type="email" required className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input name="password" type="password" required minLength={8} className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Role
            <select name="role" required className="rounded border px-3 py-2" defaultValue="STUDENT">
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded bg-black px-3 py-2 text-white">
            Create user
          </button>
        </form>
      </section>
    </main>
  );
}
