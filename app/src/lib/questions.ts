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

export class QuestionNotFoundError extends Error {
  constructor(questionId: string) {
    super(`Question ${questionId} not found in this institution`);
    this.name = "QuestionNotFoundError";
  }
}

/**
 * A question already attached to an exam is append-only (master prompt
 * §11's same reasoning as ExamVersion) — a past exam must keep the exact
 * wording/answer key it was graded against. Editing or deleting is only
 * ever safe for a question no exam has ever referenced yet.
 */
export class QuestionInUseError extends Error {
  constructor(questionId: string) {
    super(
      `Question ${questionId} is already attached to an exam and can no longer be edited or deleted — remove it from every exam first, or leave it as-is so past/current exams keep their original wording.`
    );
    this.name = "QuestionInUseError";
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
      // Drives the bank UI's edit/delete affordance — only ever offered for
      // a question no exam has attached yet, see QuestionInUseError above.
      _count: { select: { examQuestions: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export interface UpdateQuestionInput {
  prompt: string;
  points: number;
  choices?: Prisma.InputJsonValue;
  correctAnswer?: Prisma.InputJsonValue;
}

/** Edits a question's latest (and, since it's unused, only) version in place. Refuses once any exam has attached it — see QuestionInUseError. */
export async function updateQuestion(
  institutionId: string,
  actor: { role: Role },
  questionId: string,
  input: UpdateQuestionInput
) {
  assertCan(actor.role, "question", "update");

  const db = forTenant(institutionId);

  const question = await db.question.findFirst({
    where: { id: questionId },
    include: {
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      _count: { select: { examQuestions: true } },
    },
  });
  if (!question) {
    throw new QuestionNotFoundError(questionId);
  }
  if (question._count.examQuestions > 0) {
    throw new QuestionInUseError(questionId);
  }
  const latestVersion = question.versions[0];
  if (!latestVersion) {
    throw new QuestionNotFoundError(questionId);
  }

  return db.questionVersion.update({
    where: { id: latestVersion.id },
    data: {
      prompt: input.prompt,
      points: input.points,
      choices: input.choices,
      correctAnswer: input.correctAnswer,
    },
  });
}

/** Deletes a question outright. Refuses once any exam has attached it — see QuestionInUseError. */
export async function deleteQuestion(institutionId: string, actor: { role: Role }, questionId: string) {
  assertCan(actor.role, "question", "delete");

  const db = forTenant(institutionId);

  const question = await db.question.findFirst({
    where: { id: questionId },
    include: { _count: { select: { examQuestions: true } } },
  });
  if (!question) {
    throw new QuestionNotFoundError(questionId);
  }
  if (question._count.examQuestions > 0) {
    throw new QuestionInUseError(questionId);
  }

  await db.$transaction([
    db.questionVersion.deleteMany({ where: { questionId } }),
    db.question.delete({ where: { id: questionId } }),
  ]);
}
