import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../rbac";
import { CourseNotFoundError } from "../courses";
import { forPlatform } from "../tenant-db";
import { verifyPassword } from "../password";
import { consumeCreatedCredentials, importRosterFromCsv, parseRosterCsv, RosterImportValidationError } from "../roster-import";

function csv(...rows: { email?: string; role?: string; name?: string }[]): string {
  return ["email,role,name", ...rows.map((r) => `${r.email ?? ""},${r.role ?? ""},${r.name ?? ""}`)].join("\n");
}

describe("parseRosterCsv (pure)", () => {
  it("parses valid faculty and student rows", () => {
    const { rows, errors } = parseRosterCsv(csv({ email: "a@test.local", role: "FACULTY" }, { email: "b@test.local", role: "student" }));
    expect(errors).toHaveLength(0);
    expect(rows).toEqual([
      { row: 2, email: "a@test.local", role: "FACULTY", name: undefined },
      { row: 3, email: "b@test.local", role: "STUDENT", name: undefined },
    ]);
  });

  it("carries an optional name through", () => {
    const { rows } = parseRosterCsv(csv({ email: "a@test.local", role: "FACULTY", name: "Jordan Reyes" }));
    expect(rows[0].name).toBe("Jordan Reyes");
  });

  it("rejects a missing or malformed email", () => {
    const { errors } = parseRosterCsv(csv({ email: "not-an-email", role: "FACULTY" }));
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
  });

  it("rejects an invalid role", () => {
    const { errors } = parseRosterCsv(csv({ email: "a@test.local", role: "PROCTOR" }));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/FACULTY or STUDENT/);
  });

  it("rejects a duplicate email+role row", () => {
    const { errors } = parseRosterCsv(csv({ email: "a@test.local", role: "STUDENT" }, { email: "a@test.local", role: "STUDENT" }));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Duplicate/);
  });

  it("allows the same email as both faculty and student (not a duplicate across roles)", () => {
    const { rows, errors } = parseRosterCsv(csv({ email: "a@test.local", role: "FACULTY" }, { email: "a@test.local", role: "STUDENT" }));
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });
});

describe("importRosterFromCsv (DB)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let institutionB: { id: string };
  let courseA: { id: string };
  let courseB: { id: string };
  let faculty: { id: string; email: string };
  let student: { id: string; email: string };

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Tenant A ${runId}`, slug: `roster-import-a-${runId}` },
    });
    institutionB = await platform.institution.create({
      data: { name: `Tenant B ${runId}`, slug: `roster-import-b-${runId}` },
    });
    courseA = await platform.course.create({
      data: { institutionId: institutionA.id, code: "LAW601", name: "Roster Import Test", academicYear: "2026-2027" },
    });
    courseB = await platform.course.create({
      data: { institutionId: institutionB.id, code: "LAW601", name: "Roster Import Test (B)", academicYear: "2026-2027" },
    });
    faculty = await platform.user.create({
      data: { institutionId: institutionA.id, email: `roster-faculty-${runId}@test.local`, name: "Faculty", role: "FACULTY", passwordHash: "x" },
    });
    student = await platform.user.create({
      data: { institutionId: institutionA.id, email: `roster-student-${runId}@test.local`, name: "Student", role: "STUDENT", passwordHash: "x" },
    });
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.enrollment.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.courseFaculty.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.user.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.course.deleteMany({ where: { institutionId: { in: [institutionA.id, institutionB.id] } } });
    await platform.institution.deleteMany({ where: { id: { in: [institutionA.id, institutionB.id] } } });
  });

  it("assigns faculty and enrolls students from a valid CSV of existing accounts", async () => {
    const text = csv({ email: faculty.email, role: "FACULTY" }, { email: student.email, role: "STUDENT" });

    const result = await importRosterFromCsv(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseA.id, text);
    expect(result).toEqual({ facultyAssigned: 1, studentsEnrolled: 1, accountsCreated: 0, credentialsToken: null });

    const cf = await forPlatform().courseFaculty.findFirst({ where: { courseId: courseA.id, userId: faculty.id } });
    expect(cf).not.toBeNull();
    const enrollment = await forPlatform().enrollment.findFirst({ where: { courseId: courseA.id, userId: student.id } });
    expect(enrollment).not.toBeNull();
  });

  it("is idempotent — re-importing the same rows doesn't duplicate or error", async () => {
    const text = csv({ email: faculty.email, role: "FACULTY" });
    const result = await importRosterFromCsv(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseA.id, text);
    expect(result.facultyAssigned).toBe(1);

    const count = await forPlatform().courseFaculty.count({ where: { courseId: courseA.id, userId: faculty.id } });
    expect(count).toBe(1);
  });

  it("creates a missing account with a working temp password, derives a name from the email, and one-time-reveals the credential", async () => {
    const newEmail = `roster-new-${runId}@test.local`;
    const text = csv({ email: newEmail, role: "STUDENT" });

    const result = await importRosterFromCsv(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseA.id, text);
    expect(result.studentsEnrolled).toBe(1);
    expect(result.accountsCreated).toBe(1);
    expect(result.credentialsToken).not.toBeNull();

    const user = await forPlatform().user.findUnique({ where: { email: newEmail } });
    expect(user).not.toBeNull();
    expect(user!.institutionId).toBe(institutionA.id);
    expect(user!.role).toBe("STUDENT");
    expect(user!.name.startsWith("Roster New")).toBe(true); // derived from the "roster-new-<runid>" local part

    const enrollment = await forPlatform().enrollment.findFirst({ where: { courseId: courseA.id, userId: user!.id } });
    expect(enrollment).not.toBeNull();

    const revealed = consumeCreatedCredentials(result.credentialsToken!);
    expect(revealed).toHaveLength(1);
    expect(revealed![0].email).toBe(newEmail);
    const validPassword = await verifyPassword(revealed![0].tempPassword, user!.passwordHash);
    expect(validPassword).toBe(true);

    // Read-once: a second consume of the same token must come back empty.
    expect(consumeCreatedCredentials(result.credentialsToken!)).toBeNull();
  });

  it("uses the CSV's explicit name over the derived one when creating an account", async () => {
    const newEmail = `roster-named-${runId}@test.local`;
    const text = csv({ email: newEmail, role: "FACULTY", name: "Jordan Reyes" });

    await importRosterFromCsv(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseA.id, text);

    const user = await forPlatform().user.findUnique({ where: { email: newEmail } });
    expect(user!.name).toBe("Jordan Reyes");
  });

  it("creates nothing if any row in the batch is invalid (all-or-nothing, including new accounts)", async () => {
    const beforeUsers = await forPlatform().user.count({ where: { institutionId: institutionA.id } });
    const goodEmail = `roster-batch-good-${runId}@test.local`;

    // The second row claims an existing account's email under the wrong role — a real conflict — mixed
    // with a row that would otherwise create a brand-new account.
    const text = csv({ email: goodEmail, role: "STUDENT" }, { email: faculty.email, role: "STUDENT" });

    await expect(importRosterFromCsv(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseA.id, text)).rejects.toThrow(
      RosterImportValidationError
    );

    const afterUsers = await forPlatform().user.count({ where: { institutionId: institutionA.id } });
    expect(afterUsers).toBe(beforeUsers); // the good row's account was never created
    const created = await forPlatform().user.findUnique({ where: { email: goodEmail } });
    expect(created).toBeNull();
  });

  it("refuses to change an existing account's role instead of creating a duplicate", async () => {
    // faculty.email exists, but as FACULTY — claiming it as STUDENT should be refused, not silently enroll the faculty account as a student.
    const text = csv({ email: faculty.email, role: "STUDENT" });
    await expect(importRosterFromCsv(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseA.id, text)).rejects.toThrow(
      RosterImportValidationError
    );
  });

  it("refuses an email already registered to a different institution", async () => {
    const otherInstitutionEmail = `roster-cross-tenant-${runId}@test.local`;
    await forPlatform().user.create({
      data: { institutionId: institutionB.id, email: otherInstitutionEmail, name: "Other Tenant", role: "STUDENT", passwordHash: "x" },
    });

    const text = csv({ email: otherInstitutionEmail, role: "STUDENT" });
    await expect(importRosterFromCsv(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseA.id, text)).rejects.toThrow(
      RosterImportValidationError
    );
  });

  it("refuses to import into another tenant's course", async () => {
    const text = csv({ email: faculty.email, role: "FACULTY" });
    await expect(importRosterFromCsv(institutionA.id, { role: "INSTITUTION_ADMIN" }, courseB.id, text)).rejects.toThrow(
      CourseNotFoundError
    );
  });

  it("refuses import for a role without course:update permission", async () => {
    const text = csv({ email: faculty.email, role: "FACULTY" });
    await expect(importRosterFromCsv(institutionA.id, { role: "FACULTY" }, courseA.id, text)).rejects.toThrow(
      ForbiddenError
    );
  });
});
