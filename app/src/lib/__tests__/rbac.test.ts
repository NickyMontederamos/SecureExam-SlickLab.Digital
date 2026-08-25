import { describe, expect, it } from "vitest";
import { assertCan, can, ForbiddenError } from "../rbac";

describe("rbac permission matrix", () => {
  it("allows faculty to create exams", () => {
    expect(can("FACULTY", "exam", "create")).toBe(true);
  });

  it("does not allow students to create exams", () => {
    expect(can("STUDENT", "exam", "create")).toBe(false);
  });

  it("does not allow students to grade", () => {
    expect(can("STUDENT", "grade", "grade")).toBe(false);
  });

  it("allows faculty to grade", () => {
    expect(can("FACULTY", "grade", "grade")).toBe(true);
  });

  it("allows students to take an exam attempt but not read audit logs", () => {
    expect(can("STUDENT", "exam_attempt", "take")).toBe(true);
    expect(can("STUDENT", "audit_log", "read")).toBe(false);
  });

  it("assertCan throws ForbiddenError for a denied action", () => {
    expect(() => assertCan("STUDENT", "exam", "delete")).toThrow(ForbiddenError);
  });

  it("assertCan does not throw for an allowed action", () => {
    expect(() => assertCan("INSTITUTION_ADMIN", "user", "create")).not.toThrow();
  });

  it("proctors can read and approve exam attempts but cannot grade", () => {
    expect(can("PROCTOR", "exam_attempt", "read")).toBe(true);
    expect(can("PROCTOR", "exam_attempt", "approve")).toBe(true);
    expect(can("PROCTOR", "grade", "grade")).toBe(false);
  });

  it("only proctors can approve exam attempts", () => {
    expect(can("FACULTY", "exam_attempt", "approve")).toBe(false);
    expect(can("STUDENT", "exam_attempt", "approve")).toBe(false);
  });

  it("institution admins have every faculty permission (course/exam/grading management) on top of their own", () => {
    expect(can("INSTITUTION_ADMIN", "question", "create")).toBe(true);
    expect(can("INSTITUTION_ADMIN", "question", "update")).toBe(true);
    expect(can("INSTITUTION_ADMIN", "question", "delete")).toBe(true);
    expect(can("INSTITUTION_ADMIN", "exam", "create")).toBe(true);
    expect(can("INSTITUTION_ADMIN", "exam", "update")).toBe(true);
    expect(can("INSTITUTION_ADMIN", "exam", "delete")).toBe(true);
    expect(can("INSTITUTION_ADMIN", "grade", "grade")).toBe(true);
    // Still keeps its own admin-only permissions faculty doesn't have.
    expect(can("INSTITUTION_ADMIN", "user", "delete")).toBe(true);
    expect(can("FACULTY", "user", "delete")).toBe(false);
  });

  it("faculty can now delete a draft exam (not just create/update/publish)", () => {
    expect(can("FACULTY", "exam", "delete")).toBe(true);
  });
});
