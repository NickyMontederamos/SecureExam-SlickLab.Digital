import { describe, expect, it } from "vitest";
import { parseQuestionCsv } from "../question-import";

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

/** Builds a CSV row from named fields, in the right column order, quoting any value containing a comma — avoids hand-counting commas in a literal string. */
function csvRow(fields: RowInput): string {
  return COLUMNS.map((col) => {
    const value = fields[col] ?? "";
    return value.includes(",") ? `"${value}"` : value;
  }).join(",");
}

function csv(...rows: RowInput[]): string {
  return [COLUMNS.join(","), ...rows.map(csvRow)].join("\n");
}

describe("parseQuestionCsv", () => {
  it("parses a valid multiple-choice row", () => {
    const text = csv({
      type: "MULTIPLE_CHOICE",
      prompt: "What is the capital of the Philippines?",
      choice1: "Manila",
      choice2: "Cebu",
      choice3: "Davao",
      correct_choices: "1",
      points: "1",
      difficulty: "easy",
      tags: "geography;basics",
    });

    const { rows, errors } = parseQuestionCsv(text);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("MULTIPLE_CHOICE");
    expect(rows[0].points).toBe(1);
    expect(rows[0].difficulty).toBe("easy");
    expect(rows[0].tags).toEqual(["geography", "basics"]);
    expect(rows[0].choices).toEqual([
      { id: "0", text: "Manila" },
      { id: "1", text: "Cebu" },
      { id: "2", text: "Davao" },
    ]);
    expect(rows[0].correctAnswer).toEqual({ choiceIds: ["0"] });
  });

  it("parses a valid multiple-response row with multiple correct choices", () => {
    const text = csv({
      type: "MULTIPLE_RESPONSE",
      prompt: "Which are prime numbers?",
      choice1: "2",
      choice2: "3",
      choice3: "4",
      choice4: "5",
      correct_choices: "1,2,4",
      points: "2",
    });

    const { rows, errors } = parseQuestionCsv(text);
    expect(errors).toHaveLength(0);
    expect(rows[0].correctAnswer).toEqual({ choiceIds: ["0", "1", "3"] });
  });

  it("parses an essay row with no choices needed", () => {
    const text = csv({
      type: "ESSAY",
      prompt: "Discuss the doctrine of forum shopping.",
      points: "10",
      tags: "essay",
    });

    const { rows, errors } = parseQuestionCsv(text);
    expect(errors).toHaveLength(0);
    expect(rows[0].type).toBe("ESSAY");
    expect(rows[0].choices).toBeUndefined();
    expect(rows[0].correctAnswer).toBeUndefined();
  });

  it("is case-insensitive and tolerant of spaces in the type column", () => {
    const text = csv({ type: "short answer", prompt: "Define grave abuse of discretion.", points: "5" });
    const { rows, errors } = parseQuestionCsv(text);
    expect(errors).toHaveLength(0);
    expect(rows[0].type).toBe("SHORT_ANSWER");
  });

  it("rejects an invalid type", () => {
    const text = csv({ type: "NOT_A_TYPE", prompt: "Prompt", points: "1" });
    const { errors } = parseQuestionCsv(text);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Invalid type/);
  });

  it("rejects a missing prompt", () => {
    const text = csv({ type: "SHORT_ANSWER", points: "1" });
    const { errors } = parseQuestionCsv(text);
    expect(errors[0].message).toMatch(/Missing prompt/);
  });

  it("rejects non-positive points", () => {
    const text = csv({ type: "SHORT_ANSWER", prompt: "Prompt", points: "0" });
    const { errors } = parseQuestionCsv(text);
    expect(errors[0].message).toMatch(/Invalid points/);
  });

  it("rejects a choice-based question with fewer than 2 choices", () => {
    const text = csv({ type: "MULTIPLE_CHOICE", prompt: "Prompt", choice1: "OnlyOne", correct_choices: "1", points: "1" });
    const { errors } = parseQuestionCsv(text);
    expect(errors[0].message).toMatch(/at least 2/);
  });

  it("rejects correct_choices pointing past the number of actual choices", () => {
    const text = csv({ type: "MULTIPLE_CHOICE", prompt: "Prompt", choice1: "A", choice2: "B", correct_choices: "5", points: "1" });
    const { errors } = parseQuestionCsv(text);
    expect(errors[0].message).toMatch(/must reference existing choice numbers/);
  });

  it("rejects more than one correct choice for a single-answer type", () => {
    const text = csv({
      type: "MULTIPLE_CHOICE",
      prompt: "Prompt",
      choice1: "A",
      choice2: "B",
      choice3: "C",
      correct_choices: "1,2",
      points: "1",
    });
    const { errors } = parseQuestionCsv(text);
    expect(errors[0].message).toMatch(/exactly one correct choice/);
  });

  it("reports row numbers matching the actual CSV line (header is row 1)", () => {
    const text = csv(
      { type: "SHORT_ANSWER", prompt: "Valid one", points: "1" },
      { type: "BOGUS", prompt: "Bad one", points: "1" }
    );
    const { errors } = parseQuestionCsv(text);
    expect(errors[0].row).toBe(3);
  });

  it("collects every invalid row, not just the first", () => {
    const text = csv(
      { type: "BOGUS", prompt: "Bad one", points: "1" },
      { type: "ANOTHER_BOGUS", prompt: "Bad two", points: "1" }
    );
    const { errors, rows } = parseQuestionCsv(text);
    expect(errors).toHaveLength(2);
    expect(rows).toHaveLength(0);
  });
});
