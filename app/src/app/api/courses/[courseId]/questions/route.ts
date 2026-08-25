import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ForbiddenError } from "@/lib/rbac";
import { listQuestionsForCourse } from "@/lib/questions";

export async function GET(_request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const session = await auth();
  if (!session?.user?.institutionId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { courseId } = await params;

  try {
    const questions = await listQuestionsForCourse(session.user.institutionId, session.user, courseId);
    return NextResponse.json({ questions });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
