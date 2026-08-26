import type { Role } from "@prisma/client";
import { assertCan, can } from "./rbac";
import { forTenant } from "./tenant-db";
import { CourseNotFoundError } from "./questions";
import { assertFacultyAssignedToCourse } from "./courses";

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

export class ExamQuestionNotFoundError extends Error {
  constructor(examQuestionId: string) {
    super(`Question ${examQuestionId} is not on this exam`);
    this.name = "ExamQuestionNotFoundError";
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
  /** Booking window shown to students (see docs/PITCH_ROADMAP.md's booking flow) — optional; a version with neither set has no advertised window. */
  availableFrom?: Date;
  availableUntil?: Date;
}

/** Creates an exam and its first (DRAFT, active) version atomically. */
export async function createExam(institutionId: string, actor: { id: string; role: Role }, input: CreateExamInput) {
  assertCan(actor.role, "exam", "create");

  const db = forTenant(institutionId);

  const course = await db.course.findFirst({ where: { id: input.courseId } });
  if (!course) {
    throw new CourseNotFoundError(input.courseId);
  }
  await assertFacultyAssignedToCourse(institutionId, actor, input.courseId);

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
        availableFrom: input.availableFrom,
        availableUntil: input.availableUntil,
      },
    });

    return { exam, version };
  });
}

/**
 * Students only ever see PUBLISHED exams — draft exams are invisible to
 * them, not merely uneditable. FACULTY must actually be assigned to this
 * course (assertFacultyAssignedToCourse) — see its docstring in courses.ts
 * for why role-level exam:"read" alone isn't enough.
 */
export async function listExamsForCourse(institutionId: string, actor: { id: string; role: Role }, courseId: string) {
  assertCan(actor.role, "exam", "read");
  await assertFacultyAssignedToCourse(institutionId, actor, courseId);

  const db = forTenant(institutionId);
  return db.exam.findMany({
    where: { courseId, status: actor.role === "STUDENT" ? "PUBLISHED" : undefined },
    include: {
      versions: { where: { isActive: true }, include: { examQuestions: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getExam(institutionId: string, actor: { id: string; role: Role }, examId: string) {
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
  await assertFacultyAssignedToCourse(institutionId, actor, exam.courseId);
  return exam;
}

/**
 * Attaches a question's current version to the exam's active version.
 * questionId is caller-supplied and re-verified against this tenant here —
 * same defense-in-depth reasoning as courseId in questions.ts.
 */
export async function addExamQuestion(
  institutionId: string,
  actor: { id: string; role: Role },
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
  await assertFacultyAssignedToCourse(institutionId, actor, exam.courseId);
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

/**
 * Bulk version of addExamQuestion — attaches several bank questions at
 * once (each at its own default points, from the question's latest
 * version) instead of one dropdown-pick-and-click per question. Every
 * question is verified to belong to this tenant before any attachment
 * happens; if one id is bogus, nothing is attached.
 */
export async function addExamQuestions(institutionId: string, actor: { id: string; role: Role }, examId: string, questionIds: string[]) {
  assertCan(actor.role, "exam", "update");
  if (questionIds.length === 0) {
    return [];
  }

  const db = forTenant(institutionId);

  const exam = await db.exam.findFirst({
    where: { id: examId },
    include: { versions: { where: { isActive: true }, take: 1 } },
  });
  if (!exam) {
    throw new ExamNotFoundError(examId);
  }
  await assertFacultyAssignedToCourse(institutionId, actor, exam.courseId);
  if (exam.status !== "DRAFT") {
    throw new ExamNotEditableError(examId);
  }
  const activeVersion = exam.versions[0];
  if (!activeVersion) {
    throw new ExamNotEditableError(examId);
  }

  const questions = await db.question.findMany({
    where: { id: { in: questionIds } },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  const missing = questionIds.find((id) => !questions.some((q) => q.id === id));
  if (missing) {
    throw new QuestionNotFoundError(missing);
  }

  let order = await db.examQuestion.count({ where: { examVersionId: activeVersion.id } });

  return db.$transaction(
    questions.map((question) => {
      const latest = question.versions[0];
      return db.examQuestion.create({
        data: {
          examVersionId: activeVersion.id,
          questionId: question.id,
          questionVersionId: latest.id,
          order: order++,
          points: latest.points,
        },
      });
    })
  );
}

export interface UpdateExamInput {
  title: string;
  timeLimitMinutes: number;
  instructions?: string;
  availableFrom?: Date;
  availableUntil?: Date;
}

/** Edits an exam's title and its active version's settings — DRAFT only, same editability rule as adding questions. */
export async function updateExam(institutionId: string, actor: { id: string; role: Role }, examId: string, input: UpdateExamInput) {
  assertCan(actor.role, "exam", "update");

  const db = forTenant(institutionId);

  const exam = await db.exam.findFirst({
    where: { id: examId },
    include: { versions: { where: { isActive: true }, take: 1 } },
  });
  if (!exam) {
    throw new ExamNotFoundError(examId);
  }
  await assertFacultyAssignedToCourse(institutionId, actor, exam.courseId);
  if (exam.status !== "DRAFT") {
    throw new ExamNotEditableError(examId);
  }
  const activeVersion = exam.versions[0];
  if (!activeVersion) {
    throw new ExamNotEditableError(examId);
  }

  const [updatedExam] = await db.$transaction([
    db.exam.update({ where: { id: examId }, data: { title: input.title } }),
    db.examVersion.update({
      where: { id: activeVersion.id },
      data: {
        timeLimitMinutes: input.timeLimitMinutes,
        instructions: input.instructions,
        availableFrom: input.availableFrom ?? null,
        availableUntil: input.availableUntil ?? null,
      },
    }),
  ]);

  return updatedExam;
}

/**
 * Detaches one question from the exam's active version — DRAFT only, same
 * as adding one. Renumbers the remaining questions' `order` so the
 * displayed Q1/Q2/... never has a gap.
 */
export async function removeExamQuestion(institutionId: string, actor: { id: string; role: Role }, examId: string, examQuestionId: string) {
  assertCan(actor.role, "exam", "update");

  const db = forTenant(institutionId);

  const exam = await db.exam.findFirst({
    where: { id: examId },
    include: { versions: { where: { isActive: true }, take: 1 } },
  });
  if (!exam) {
    throw new ExamNotFoundError(examId);
  }
  await assertFacultyAssignedToCourse(institutionId, actor, exam.courseId);
  if (exam.status !== "DRAFT") {
    throw new ExamNotEditableError(examId);
  }
  const activeVersion = exam.versions[0];
  if (!activeVersion) {
    throw new ExamNotEditableError(examId);
  }

  const examQuestion = await db.examQuestion.findFirst({ where: { id: examQuestionId, examVersionId: activeVersion.id } });
  if (!examQuestion) {
    throw new ExamQuestionNotFoundError(examQuestionId);
  }

  await db.examQuestion.delete({ where: { id: examQuestionId } });

  const remaining = await db.examQuestion.findMany({
    where: { examVersionId: activeVersion.id },
    orderBy: { order: "asc" },
  });
  await db.$transaction(
    remaining
      .map((eq, index) => ({ eq, index }))
      .filter(({ eq, index }) => eq.order !== index)
      .map(({ eq, index }) => db.examQuestion.update({ where: { id: eq.id }, data: { order: index } }))
  );
}

/**
 * Deletes a DRAFT exam outright, questions and all. Safe unconditionally —
 * a DRAFT exam can never have a student attempt against it (booking/starting
 * both require PUBLISHED), so there's nothing downstream to protect, unlike
 * deleteCourse's content check in courses.ts.
 */
/**
 * DRAFT-only for the normal caller (FACULTY, or an INSTITUTION_ADMIN acting
 * as one) — safe unconditionally, since a draft can never have a student
 * attempt against it. An actor who also holds exam_attempt:"delete" (in
 * practice only INSTITUTION_ADMIN — see rbac.ts) can force-delete *any*
 * status, cascading every attempt/answer/event/submission along with it —
 * real admin "reset this exam" power, not something FACULTY gets even
 * though they share exam:"delete". $transaction here isn't optional: this
 * touches five tables in FK-dependency order, and a partial failure midway
 * would leave orphaned rows no UI could reach again.
 */
export async function deleteExam(institutionId: string, actor: { id: string; role: Role }, examId: string) {
  assertCan(actor.role, "exam", "delete");

  const db = forTenant(institutionId);

  const exam = await db.exam.findFirst({ where: { id: examId } });
  if (!exam) {
    throw new ExamNotFoundError(examId);
  }
  await assertFacultyAssignedToCourse(institutionId, actor, exam.courseId);

  const canForceDelete = can(actor.role, "exam_attempt", "delete");
  if (exam.status !== "DRAFT" && !canForceDelete) {
    throw new ExamNotEditableError(examId);
  }

  if (exam.status === "DRAFT") {
    await db.$transaction([
      db.examQuestion.deleteMany({ where: { examVersion: { examId } } }),
      db.examVersion.deleteMany({ where: { examId } }),
      db.exam.delete({ where: { id: examId } }),
    ]);
    return;
  }

  await db.$transaction([
    db.attemptEvent.deleteMany({ where: { attempt: { examVersion: { examId } } } }),
    db.submission.deleteMany({ where: { attempt: { examVersion: { examId } } } }),
    db.examAnswer.deleteMany({ where: { attempt: { examVersion: { examId } } } }),
    db.examAttempt.deleteMany({ where: { examVersion: { examId } } }),
    db.examQuestion.deleteMany({ where: { examVersion: { examId } } }),
    db.examVersion.deleteMany({ where: { examId } }),
    db.exam.delete({ where: { id: examId } }),
  ]);
}

/** Freezes the active version and marks the exam PUBLISHED. Irreversible in Phase 1 — no unpublish. */
export async function publishExam(institutionId: string, actor: { id: string; role: Role }, examId: string) {
  assertCan(actor.role, "exam", "publish");

  const db = forTenant(institutionId);

  const exam = await db.exam.findFirst({
    where: { id: examId },
    include: { versions: { where: { isActive: true }, include: { examQuestions: true } } },
  });
  if (!exam) {
    throw new ExamNotFoundError(examId);
  }
  await assertFacultyAssignedToCourse(institutionId, actor, exam.courseId);
  if (exam.status !== "DRAFT") {
    throw new ExamNotEditableError(examId);
  }

  const activeVersion = exam.versions[0];
  if (!activeVersion || activeVersion.examQuestions.length === 0) {
    throw new EmptyExamError(examId);
  }

  return db.exam.update({ where: { id: examId }, data: { status: "PUBLISHED" } });
}
