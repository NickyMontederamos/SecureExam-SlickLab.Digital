import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertCan, ForbiddenError } from "@/lib/rbac";
import { forTenant } from "@/lib/tenant-db";

/**
 * First end-to-end demonstration of the Phase 1 stack: session -> RBAC ->
 * tenant-scoped data access. Deliberately minimal — this is a proof point,
 * not the real courses API (no pagination, no create/update yet).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.institutionId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    assertCan(session.user.role, "course", "read");
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const courses = await forTenant(session.user.institutionId).course.findMany({
    orderBy: { code: "asc" },
  });

  return NextResponse.json({ courses });
}
