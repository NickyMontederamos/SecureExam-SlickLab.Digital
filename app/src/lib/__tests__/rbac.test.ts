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

  it("proctors are read-only on exam attempts and cannot grade", () => {
    expect(can("PROCTOR", "exam_attempt", "read")).toBe(true);
    expect(can("PROCTOR", "grade", "grade")).toBe(false);
  });
});
