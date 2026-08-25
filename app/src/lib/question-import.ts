import { parse } from "csv-parse/sync";
import type { Prisma, QuestionType, Role } from "@prisma/client";
import { assertCan } from "./rbac";
import { forTenant } from "./tenant-db";
import { CourseNotFoundError } from "./questions";

const VALID_TYPES: QuestionType[] = ["MULTIPLE_CHOICE", "MULTIPLE_RESPONSE", "TRUE_FALSE", "ESSAY", "SHORT_ANSWER"];
const CHOICE_COLUMNS = ["choice1", "choice2", "choice3", "choice4", "choice5", "choice6"];

export interface ParsedQuestionRow {
  type: QuestionType;
  prompt: string;
  choices?: Prisma.InputJsonValue;
  correctAnswer?: Prisma.InputJsonValue;
  points: number;
  difficulty?: string;
  tags: string[];
}

export interface RowError {
  /** 1-indexed against the CSV file including the header, so row 2 is the first data row — matches what a spreadsheet program shows. */
  row: number;
  message: string;
}

export interface ParseResult {
  rows: ParsedQuestionRow[];
  errors: RowError[];
}

/**
 * Pure parsing/validation — no database access, so it's cheap to unit
 * test exhaustively. `importQuestionsFromCsv` below is the thin
 * DB-touching wrapper that only runs once this reports zero errors.
 */
export function parseQuestionCsv(csvText: string): ParseResult {
  const errors: RowError[] = [];
  let records: Record<string, string>[];

  try {
    records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return { rows: [], errors: [{ row: 0, message: `Could not parse CSV: ${(err as Error).message}` }] };
  }

  const rows: ParsedQuestionRow[] = [];

  records.forEach((record, index) => {
    const rowNumber = index + 2; // header is row 1
    const typeRaw = (record.type ?? "").trim().toUpperCase().replace(/\s+/g, "_");
    const type = typeRaw as QuestionType;
    const prompt = (record.prompt ?? "").trim();
    const pointsRaw = (record.points ?? "").trim();
    const points = Number(pointsRaw);

    if (!VALID_TYPES.includes(type)) {
      errors.push({ row: rowNumber, message: `Invalid type "${record.type}" — must be one of ${VALID_TYPES.join(", ")}` });
      return;
    }
    if (!prompt) {
      errors.push({ row: rowNumber, message: "Missing prompt" });
      return;
    }
    if (!pointsRaw || Number.isNaN(points) || points <= 0) {
      errors.push({ row: rowNumber, message: `Invalid points "${record.points}" — must be a positive number` });
      return;
    }

    const tags = (record.tags ?? "")
      .split(";")
      .map((t) => t.trim())
      .filter(Boolean);
    const difficulty = (record.difficulty ?? "").trim() || undefined;

    const isChoiceBased = type === "MULTIPLE_CHOICE" || type === "MULTIPLE_RESPONSE" || type === "TRUE_FALSE";

    if (!isChoiceBased) {
      rows.push({ type, prompt, points, difficulty, tags });
      return;
    }

    const choiceTexts = CHOICE_COLUMNS.map((col) => (record[col] ?? "").trim()).filter(Boolean);
    if (choiceTexts.length < 2) {
      errors.push({ row: rowNumber, message: `${type} needs at least 2 non-empty choice columns` });
      return;
    }

    const correctRaw = (record.correct_choices ?? "").trim();
    if (!correctRaw) {
      errors.push({ row: rowNumber, message: "Missing correct_choices (1-based choice number(s), e.g. \"1\" or \"1,3\")" });
      return;
    }
    const correctIndices = correctRaw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
    const invalidIndex = correctIndices.some((n) => n < 1 || n > choiceTexts.length);
    if (correctIndices.length === 0 || invalidIndex) {
      errors.push({ row: rowNumber, message: `correct_choices "${correctRaw}" must reference existing choice numbers (1-${choiceTexts.length})` });
      return;
    }
    if (type !== "MULTIPLE_RESPONSE" && correctIndices.length !== 1) {
      errors.push({ row: rowNumber, message: `${type} must have exactly one correct choice` });
      return;
    }

    const choices = choiceTexts.map((text, i) => ({ id: String(i), text }));
    const correctAnswer = { choiceIds: correctIndices.map((n) => String(n - 1)) };

    rows.push({ type, prompt, points, difficulty, tags, choices, correctAnswer });
  });

  return { rows, errors };
}

export class QuestionImportValidationError extends Error {
  constructor(public readonly errors: RowError[]) {
    super(`CSV has ${errors.length} invalid row(s) — nothing was imported`);
    this.name = "QuestionImportValidationError";
  }
}

/**
 * All-or-nothing: if any row fails validation, nothing is imported. A
 * partially-imported question bank from a bad file is worse than a clear
 * "fix these rows and re-upload" — no confirm/preview step to build, and
 * no risk of half-garbage data landing in the bank.
 */
export async function importQuestionsFromCsv(
  institutionId: string,
  actor: { id: string; role: Role },
  courseId: string,
  csvText: string
): Promise<{ imported: number }> {
  assertCan(actor.role, "question", "create");

  const { rows, errors } = parseQuestionCsv(csvText);
  if (errors.length > 0) {
    throw new QuestionImportValidationError(errors);
  }

  const db = forTenant(institutionId);
  const course = await db.course.findFirst({ where: { id: courseId } });
  if (!course) {
    throw new CourseNotFoundError(courseId);
  }

  await db.$transaction(async (tx) => {
    for (const row of rows) {
      const question = await tx.question.create({
        data: {
          courseId,
          type: row.type,
          difficulty: row.difficulty,
          tags: row.tags,
          learningObjectives: [],
          createdById: actor.id,
        } as never,
      });
      await tx.questionVersion.create({
        data: {
          questionId: question.id,
          versionNumber: 1,
          prompt: row.prompt,
          choices: row.choices,
          correctAnswer: row.correctAnswer,
          points: row.points,
        },
      });
    }
  });

  return { imported: rows.length };
}
