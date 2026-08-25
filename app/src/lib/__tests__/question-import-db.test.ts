import type { Role } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../rbac";
import { forPlatform } from "../tenant-db";
import { CourseNotFoundError } from "../questions";
import { importQuestionsFromCsv, QuestionImportValidationError } from "../question-import";

const COLUMNS = [
  "type",
  "prompt",
  "choice1",
  "choice2",
  "choice3",
  "choice4",
  "choice5",
  "choice6",
  "correct_choices",
  "points",
  "difficulty",
  "tags",
] as const;

type RowInput = Partial<Record<(typeof COLUMNS)[number], string>>;

function csvRow(fields: RowInput): string {
  return COLUMNS.map((col) => {
    const value = fields[col] ?? "";
    return value.includes(",") ? `"${value}"` : value;
  }).join(",");
}

function csv(...rows: RowInput[]): string {
  return [COLUMNS.join(","), ...rows.map(csvRow)].join("\n");
}

describe("importQuestionsFromCsv", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let institutionB: { id: string };
  let courseA: { id: string };
  let courseB: { id: string };
  let faculty: { id: string; role: Role };

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Tenant A ${runId}`, slug: `import-tenant-a-${runId}` },
    });
    institutionB = await platform.institution.create({
      data: { name: `Tenant B ${runId}`, slug: `import-tenant-b-${runId}` },
    });
    courseA = await platform.course.create({
      data: { institutionId: institutionA.id, code: "LAW501", name: "Import Test", academicYear: "2026-2027" },
    });
    courseB = await platform.course.create({
      data: { institutionId: institutionB.id, code: "LAW501", name: "Import Test (B)", academicYear: "2026-2027" },
    });
    faculty = await platform.user.create({
      data: { institutionId: institutionA.id, email: `import-faculty-${runId}@test.local`, name: "Faculty", role: "FACULTY", passwordHash: "x" },
    });
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.questionVersion.deleteMany({ where: { question: { institutionId: institutionA.id } } });
    await platform.question.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.user.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.course.deleteMany({ where: { institutionId: { in: [institutionA.id, institutionB.id] } } });
    await platform.institution.deleteMany({ where: { id: { in: [institutionA.id, institutionB.id] } } });
  });

  it("imports every valid row atomically", async () => {
    const text = csv(
      { type: "MULTIPLE_CHOICE", prompt: "Capital of the Philippines?", choice1: "Manila", choice2: "Cebu", correct_choices: "1", points: "1" },
      { type: "ESSAY", prompt: "Discuss forum shopping.", points: "10" }
    );

    const result = await importQuestionsFromCsv(institutionA.id, faculty, courseA.id, text);
    expect(result.imported).toBe(2);

    const questions = await forPlatform().question.findMany({ where: { courseId: courseA.id } });
    expect(questions).toHaveLength(2);
  });

  it("imports nothing if any row is invalid (all-or-nothing)", async () => {
    const before = await forPlatform().question.count({ where: { courseId: courseA.id } });

    const text = csv(
      { type: "MULTIPLE_CHOICE", prompt: "Valid row", choice1: "Manila", choice2: "Cebu", correct_choices: "1", points: "1" },
      { type: "BOGUS_TYPE", prompt: "Invalid row", points: "1" }
    );

    await expect(importQuestionsFromCsv(institutionA.id, faculty, courseA.id, text)).rejects.toThrow(
      QuestionImportValidationError
    );

    const after = await forPlatform().question.count({ where: { courseId: courseA.id } });
    expect(after).toBe(before); // nothing was added
  });

  it("refuses to import into another tenant's course", async () => {
    const text = csv({ type: "ESSAY", prompt: "Should never land", points: "10" });
    await expect(importQuestionsFromCsv(institutionA.id, faculty, courseB.id, text)).rejects.toThrow(
      CourseNotFoundError
    );
  });

  it("refuses import for a role without question:create permission", async () => {
    const text = csv({ type: "ESSAY", prompt: "Should never land", points: "10" });
    await expect(
      importQuestionsFromCsv(institutionA.id, { id: faculty.id, role: "STUDENT" }, courseA.id, text)
    ).rejects.toThrow(ForbiddenError);
  });
});
