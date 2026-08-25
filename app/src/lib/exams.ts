import type { Role } from "@prisma/client";
import { assertCan } from "./rbac";
import { forTenant } from "./tenant-db";
import { CourseNotFoundError } from "./questions";

export class ExamNotFoundError extends Error {
  constructor(examId: string) {
    super(`Exam ${examId} not found in this institution`);
    this.name = "ExamNotFoundError";
  }
}

export class QuestionNotFoundError extends Error {
  constructor(questionId: string) {
    super(`Question ${questionId} not found in this institution`);
    this.name = "QuestionNotFoundError";
  }
}

/**
 * Phase 1 versioning is intentionally simple: an exam has exactly one
 * ExamVersion (versionNumber 1) for as long as it's DRAFT, and that version
 * becomes permanently frozen at publish time — no further edits to it, ever
 * (master prompt §11: "Do not silently mutate the active exam version").
 * The schema already supports multiple versions per exam for when a real
 * "revise a published exam" flow is built (Phase 3 candidate); Phase 1 just
 * doesn't offer that flow yet.
 */
export class ExamNotEditableError extends Error {
  constructor(examId: string) {
    super(`Exam ${examId} is not editable — it has already been published or archived`);
    this.name = "ExamNotEditableError";
  }
}

export class EmptyExamError extends Error {
  constructor(examId: string) {
    super(`Exam ${examId} has no questions and cannot be published`);
    this.name = "EmptyExamError";
  }
}

export interface CreateExamInput {
  courseId: string;
  title: string;
  timeLimitMinutes: number;
  instructions?: string;
  allowBacktracking?: boolean;
  randomizeQuestions?: boolean;
  randomizeAnswers?: boolean;
}

/** Creates an exam and its first (DRAFT, active) version atomically. */
export async function createExam(institutionId: string, actor: { id: string; role: Role }, input: CreateExamInput) {
  assertCan(actor.role, "exam", "create");

  const db = forTenant(institutionId);

  const course = await db.course.findFirst({ where: { id: input.courseId } });
  if (!course) {
    throw new CourseNotFoundError(input.courseId);
  }

  return db.$transaction(async (tx) => {
    const exam = await tx.exam.create({
      // institutionId omitted deliberately — see questions.ts for why.
      data: {
        courseId: input.courseId,
        title: input.title,
        status: "DRAFT",
        createdById: actor.id,
      } as never,
    });

    const version = await tx.examVersion.create({
      data: {
        examId: exam.id,
        versionNumber: 1,
        isActive: true,
        instructions: input.instructions,
        timeLimitMinutes: input.timeLimitMinutes,
        allowBacktracking: input.allowBacktracking ?? true,
        randomizeQuestions: input.randomizeQuestions ?? false,
        randomizeAnswers: input.randomizeAnswers ?? false,
      },
    });

    return { exam, version };
  });
}

export async function listExamsForCourse(institutionId: string, actor: { role: Role }, courseId: string) {
  assertCan(actor.role, "exam", "read");

  const db = forTenant(institutionId);
  return db.exam.findMany({
    where: { courseId },
    include: {
      versions: { where: { isActive: true }, include: { examQuestions: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getExam(institutionId: string, actor: { role: Role }, examId: string) {
  assertCan(actor.role, "exam", "read");

  const db = forTenant(institutionId);
  const exam = await db.exam.findFirst({
    where: { id: examId },
    include: {
      versions: {
        where: { isActive: true },
        include: {
          examQuestions: {
            include: { questionVersion: true },
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });
  if (!exam) {
    throw new ExamNotFoundError(examId);
  }
  return exam;
}

/**
 * Attaches a question's current version to the exam's active version.
 * questionId is caller-supplied and re-verified against this tenant here —
 * same defense-in-depth reasoning as courseId in questions.ts.
 */
export async function addExamQuestion(
  institutionId: string,
  actor: { role: Role },
  input: { examId: string; questionId: string; points: number }
) {
  assertCan(actor.role, "exam", "update");

  const db = forTenant(institutionId);

  const exam = await db.exam.findFirst({
    where: { id: input.examId },
    include: { versions: { where: { isActive: true }, take: 1 } },
  });
  if (!exam) {
    throw new ExamNotFoundError(input.examId);
  }
  if (exam.status !== "DRAFT") {
    throw new ExamNotEditableError(input.examId);
  }
  const activeVersion = exam.versions[0];
  if (!activeVersion) {
    throw new ExamNotEditableError(input.examId);
  }

  const question = await db.question.findFirst({
    where: { id: input.questionId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  const latestQuestionVersion = question?.versions[0];
  if (!question || !latestQuestionVersion) {
    throw new QuestionNotFoundError(input.questionId);
  }

  // ExamQuestion has no institutionId of its own (see tenant-db.ts) — safe
  // here because examVersionId/questionVersionId were just verified above.
  const order = await db.examQuestion.count({ where: { examVersionId: activeVersion.id } });

  return db.examQuestion.create({
    data: {
      examVersionId: activeVersion.id,
      questionId: question.id,
      questionVersionId: latestQuestionVersion.id,
      order,
      points: input.points,
    },
  });
}

/** Freezes the active version and marks the exam PUBLISHED. Irreversible in Phase 1 — no unpublish. */
export async function publishExam(institutionId: string, actor: { role: Role }, examId: string) {
  assertCan(actor.role, "exam", "publish");

  const db = forTenant(institutionId);

  const exam = await db.exam.findFirst({
    where: { id: examId },
    include: { versions: { where: { isActive: true }, include: { examQuestions: true } } },
  });
  if (!exam) {
    throw new ExamNotFoundError(examId);
  }
  if (exam.status !== "DRAFT") {
    throw new ExamNotEditableError(examId);
  }

  const activeVersion = exam.versions[0];
  if (!activeVersion || activeVersion.examQuestions.length === 0) {
    throw new EmptyExamError(examId);
  }

  return db.exam.update({ where: { id: examId }, data: { status: "PUBLISHED" } });
}
