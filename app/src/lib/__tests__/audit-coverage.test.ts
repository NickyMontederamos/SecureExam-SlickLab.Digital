import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forPlatform } from "../tenant-db";
import { AUDIT_ACTIONS } from "../audit";
import { createUser, resetUserPassword, setUserActive } from "../users";
import { createQuestion } from "../questions";
import { addExamQuestion, createExam, deleteExam, publishExam } from "../exams";
import { startAttempt, submitAttempt } from "../attempts";
import { gradeAnswer } from "../grading";
import { importRosterFromCsv } from "../roster-import";

/**
 * Regression suite for docs/WORLD_CLASS_AUDIT.md finding A-05 — the
 * AuditLog table and the /audit viewer both existed, but `logAudit()` was
 * only ever called from auth.ts. Every mutating domain action (grade
 * changes, exam publish/delete, proctor decisions, user management, roster
 * import) went unrecorded, so "who changed this grade?" was unanswerable
 * while the feature *looked* delivered.
 *
 * These tests assert the record is actually written. They deliberately
 * check the audit row's contents, not just its existence — an audit entry
 * that doesn't identify the actor or the resource is not an audit trail.
 */
describe("A-05 regression: mutating actions write audit records", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let courseA: { id: string };
  let admin: { id: string };
  let faculty: { id: string };
  let student: { id: string };

  async function auditRowsFor(action: string) {
    return forPlatform().auditLog.findMany({
      where: { institutionId: institutionA.id, action },
      orderBy: { createdAt: "desc" },
    });
  }

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Audit ${runId}`, slug: `audit-cov-${runId}` },
    });
    courseA = await platform.course.create({
      data: { institutionId: institutionA.id, code: "AUD1", name: "Audit", academicYear: "2026-2027" },
    });
    admin = await platform.user.create({
      data: { institutionId: institutionA.id, email: `aud-admin-${runId}@test.local`, name: "Admin", role: "INSTITUTION_ADMIN", passwordHash: "x" },
    });
    faculty = await platform.user.create({
      data: { institutionId: institutionA.id, email: `aud-fac-${runId}@test.local`, name: "Fac", role: "FACULTY", passwordHash: "x" },
    });
    await platform.courseFaculty.create({
      data: { institutionId: institutionA.id, courseId: courseA.id, userId: faculty.id },
    });
    student = await platform.user.create({
      data: { institutionId: institutionA.id, email: `aud-stu-${runId}@test.local`, name: "Stu", role: "STUDENT", passwordHash: "x" },
    });
    await platform.enrollment.create({
      data: { institutionId: institutionA.id, courseId: courseA.id, userId: student.id },
    });
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.auditLog.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.submission.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
    await platform.examAnswer.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
    await platform.attemptEvent.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
    await platform.examAttempt.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.examQuestion.deleteMany({ where: { examVersion: { exam: { institutionId: institutionA.id } } } });
    await platform.examVersion.deleteMany({ where: { exam: { institutionId: institutionA.id } } });
    await platform.exam.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.questionVersion.deleteMany({ where: { question: { institutionId: institutionA.id } } });
    await platform.question.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.enrollment.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.courseFaculty.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.user.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.course.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.institution.deleteMany({ where: { id: institutionA.id } });
  });

  it("records exam publication with the version it froze", async () => {
    const { exam } = await createExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      title: `Audited Exam ${runId}`,
      timeLimitMinutes: 60,
    });
    const { question } = await createQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      type: "MULTIPLE_CHOICE",
      prompt: "Q?",
      choices: [{ id: "0", text: "A" }, { id: "1", text: "B" }],
      correctAnswer: { choiceIds: ["0"] },
      points: 1,
    });
    await addExamQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, { examId: exam.id, questionId: question.id, points: 1 });
    await publishExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, exam.id);

    const rows = await auditRowsFor(AUDIT_ACTIONS.examPublish);
    const row = rows.find((r) => r.resourceId === exam.id);
    expect(row).toBeDefined();
    expect(row!.actorUserId).toBe(faculty.id);
    expect(row!.result).toBe("SUCCESS");
    expect((row!.metadata as Record<string, unknown>).questionCount).toBe(1);
  });

  it("records a grade change WITH the previous value — the appeal-critical detail", async () => {
    const { exam } = await createExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      title: `Grade Exam ${runId}`,
      timeLimitMinutes: 60,
    });
    const { question } = await createQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      type: "ESSAY",
      prompt: "Discuss.",
      points: 10,
    });
    await addExamQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, { examId: exam.id, questionId: question.id, points: 10 });
    await publishExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, exam.id);

    const attempt = await startAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, exam.id);
    await submitAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id);

    const answer = await forPlatform().examAnswer.findFirst({ where: { attemptId: attempt.id } });
    await gradeAnswer(institutionA.id, { id: faculty.id, role: "FACULTY" }, answer!.id, 7);
    await gradeAnswer(institutionA.id, { id: faculty.id, role: "FACULTY" }, answer!.id, 9);

    const rows = (await auditRowsFor(AUDIT_ACTIONS.gradeAssign)).filter((r) => r.resourceId === answer!.id);
    expect(rows).toHaveLength(2);

    // Newest first — the regrade from 7 to 9 must be fully reconstructable.
    const regrade = rows[0].metadata as Record<string, unknown>;
    expect(regrade.previousPoints).toBe(7);
    expect(regrade.newPoints).toBe(9);
    expect(rows[0].actorUserId).toBe(faculty.id);
  });

  it("clamps out-of-range grades and records that it did", async () => {
    const { exam } = await createExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      title: `Clamp Exam ${runId}`,
      timeLimitMinutes: 60,
    });
    const { question } = await createQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      type: "ESSAY",
      prompt: "Discuss.",
      points: 5,
    });
    await addExamQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, { examId: exam.id, questionId: question.id, points: 5 });
    await publishExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, exam.id);

    const platform = forPlatform();
    const student2 = await platform.user.create({
      data: { institutionId: institutionA.id, email: `aud-stu2-${runId}@test.local`, name: "Stu2", role: "STUDENT", passwordHash: "x" },
    });
    await platform.enrollment.create({
      data: { institutionId: institutionA.id, courseId: courseA.id, userId: student2.id },
    });

    const attempt = await startAttempt(institutionA.id, { id: student2.id, role: "STUDENT" }, exam.id);
    await submitAttempt(institutionA.id, { id: student2.id, role: "STUDENT" }, attempt.id);
    const answer = await platform.examAnswer.findFirst({ where: { attemptId: attempt.id } });

    await gradeAnswer(institutionA.id, { id: faculty.id, role: "FACULTY" }, answer!.id, 999);

    const rows = (await auditRowsFor(AUDIT_ACTIONS.gradeAssign)).filter((r) => r.resourceId === answer!.id);
    const meta = rows[0].metadata as Record<string, unknown>;
    expect(meta.requestedPoints).toBe(999);
    expect(meta.newPoints).toBe(5);
    expect(meta.wasClamped).toBe(true);
  });

  it("records a force-delete of a published exam, including how many attempts it destroyed", async () => {
    const { exam } = await createExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      title: `Doomed Exam ${runId}`,
      timeLimitMinutes: 60,
    });
    const { question } = await createQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      type: "MULTIPLE_CHOICE",
      prompt: "Q?",
      choices: [{ id: "0", text: "A" }, { id: "1", text: "B" }],
      correctAnswer: { choiceIds: ["0"] },
      points: 1,
    });
    await addExamQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, { examId: exam.id, questionId: question.id, points: 1 });
    await publishExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, exam.id);

    const platform = forPlatform();
    const student3 = await platform.user.create({
      data: { institutionId: institutionA.id, email: `aud-stu3-${runId}@test.local`, name: "Stu3", role: "STUDENT", passwordHash: "x" },
    });
    await platform.enrollment.create({
      data: { institutionId: institutionA.id, courseId: courseA.id, userId: student3.id },
    });
    await startAttempt(institutionA.id, { id: student3.id, role: "STUDENT" }, exam.id);

    // Admin force-delete (exam_attempt:"delete" — see rbac.ts).
    await deleteExam(institutionA.id, { id: admin.id, role: "INSTITUTION_ADMIN" }, exam.id);

    const row = (await auditRowsFor(AUDIT_ACTIONS.examDelete)).find((r) => r.resourceId === exam.id);
    expect(row).toBeDefined();
    expect(row!.actorUserId).toBe(admin.id);
    const meta = row!.metadata as Record<string, unknown>;
    expect(meta.forced).toBe(true);
    expect(meta.destroyedAttempts).toBe(1);
  });

  it("records user creation, deactivation and password reset — without ever storing the password", async () => {
    const created = await createUser(institutionA.id, { id: admin.id, role: "INSTITUTION_ADMIN" }, {
      name: "Audited User",
      email: `aud-new-${runId}@test.local`,
      password: "SuperSecret!2026",
      role: "STUDENT",
    });

    const createRow = (await auditRowsFor(AUDIT_ACTIONS.userCreate)).find((r) => r.resourceId === created.id);
    expect(createRow?.actorUserId).toBe(admin.id);

    await setUserActive(institutionA.id, { id: admin.id, role: "INSTITUTION_ADMIN" }, created.id, false);
    const deactivateRow = (await auditRowsFor(AUDIT_ACTIONS.userDeactivate)).find((r) => r.resourceId === created.id);
    expect(deactivateRow).toBeDefined();
    expect((deactivateRow!.metadata as Record<string, unknown>).sessionsRevoked).toBe(true);

    await resetUserPassword(institutionA.id, { id: admin.id, role: "INSTITUTION_ADMIN" }, created.id, "AnotherSecret!2026");
    const resetRow = (await auditRowsFor(AUDIT_ACTIONS.userPasswordReset)).find((r) => r.resourceId === created.id);
    expect(resetRow).toBeDefined();

    // The audit log must never contain a password in any form.
    const allRows = await forPlatform().auditLog.findMany({ where: { institutionId: institutionA.id } });
    const serialized = JSON.stringify(allRows);
    expect(serialized).not.toContain("SuperSecret!2026");
    expect(serialized).not.toContain("AnotherSecret!2026");
  });

  it("records a roster import's created accounts, but not their temp passwords", async () => {
    const email = `aud-roster-${runId}@test.local`;
    const result = await importRosterFromCsv(
      institutionA.id,
      { id: admin.id, role: "INSTITUTION_ADMIN" },
      courseA.id,
      ["email,role,name", `${email},STUDENT,Roster Person`].join("\n")
    );
    expect(result.accountsCreated).toBe(1);

    const row = (await auditRowsFor(AUDIT_ACTIONS.rosterImport))[0];
    expect(row).toBeDefined();
    expect(row.actorUserId).toBe(admin.id);
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.accountsCreated).toBe(1);
    expect(JSON.stringify(meta.createdAccounts)).toContain(email);

    // The generated temp password lives only in the read-once in-memory
    // stash — it must never reach the audit log.
    const revealed = result.credentialsToken;
    expect(revealed).not.toBeNull();
    const allRows = await forPlatform().auditLog.findMany({ where: { institutionId: institutionA.id } });
    expect(JSON.stringify(allRows)).not.toContain("tempPassword");
  });
});
