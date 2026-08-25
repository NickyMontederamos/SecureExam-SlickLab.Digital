import type { Prisma, QuestionType, Role } from "@prisma/client";
import { assertCan } from "./rbac";
import { forTenant } from "./tenant-db";

export interface CreateQuestionInput {
  courseId: string;
  type: QuestionType;
  prompt: string;
  choices?: Prisma.InputJsonValue;
  correctAnswer?: Prisma.InputJsonValue;
  points: number;
  difficulty?: string;
  tags?: string[];
  learningObjectives?: string[];
}

export class CourseNotFoundError extends Error {
  constructor(courseId: string) {
    super(`Course ${courseId} not found in this institution`);
    this.name = "CourseNotFoundError";
  }
}

/**
 * Creates a question and its first version atomically. courseId is
 * caller-supplied (from a form/request body), so it must never be trusted
 * blindly — we look it up through the tenant-scoped client first, which
 * makes "attach a question to another institution's course" impossible
 * rather than merely unlikely (the lookup returns null, we refuse, same
 * defense-in-depth idea as the tenant-isolation tests in tenant-db.ts).
 */
export async function createQuestion(
  institutionId: string,
  actor: { id: string; role: Role },
  input: CreateQuestionInput
) {
  assertCan(actor.role, "question", "create");

  const db = forTenant(institutionId);

  const course = await db.course.findFirst({ where: { id: input.courseId } });
  if (!course) {
    throw new CourseNotFoundError(input.courseId);
  }

  return db.$transaction(async (tx) => {
    const question = await tx.question.create({
      // institutionId is intentionally omitted — the tenant-scoping
      // extension injects it (and would reject a mismatched one), but the
      // generated Prisma types don't know that, hence the cast. Same
      // pattern as the "create without institutionId" case covered in
      // tenant-db.test.ts.
      data: {
        courseId: input.courseId,
        type: input.type,
        difficulty: input.difficulty,
        tags: input.tags ?? [],
        learningObjectives: input.learningObjectives ?? [],
        createdById: actor.id,
      } as never,
    });

    const version = await tx.questionVersion.create({
      data: {
        questionId: question.id,
        versionNumber: 1,
        prompt: input.prompt,
        choices: input.choices,
        correctAnswer: input.correctAnswer,
        points: input.points,
      },
    });

    return { question, version };
  });
}

/**
 * Latest version only, correctAnswer included — callers must be a role
 * that's allowed to see answer keys (FACULTY, SUPER_ADMIN). There is
 * deliberately no student-facing equivalent here yet: students see
 * questions only through an exam attempt (Phase 1 next priority), which
 * will need its own answer-key-stripped query, not a relaxed version of
 * this one.
 */
export async function listQuestionsForCourse(
  institutionId: string,
  actor: { role: Role },
  courseId: string
) {
  assertCan(actor.role, "question", "read");

  const db = forTenant(institutionId);
  return db.question.findMany({
    where: { courseId },
    include: {
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });
}
