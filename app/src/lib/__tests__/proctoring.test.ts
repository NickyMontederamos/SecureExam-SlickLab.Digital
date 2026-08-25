import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forPlatform } from "../tenant-db";
import { createQuestion } from "../questions";
import { addExamQuestion, createExam, publishExam } from "../exams";
import { beginBookedAttempt, bookAttempt, saveAnswers, submitAttempt } from "../attempts";
import {
  approveProctorStart,
  checkProctorApproval,
  listBookedAttemptsForProctor,
  listPendingApprovalsForProctor,
  listPendingVerificationsForProctor,
  ProctorNotAssignedError,
  requestProctorApproval,
  SubmissionNotFoundError,
  verifySubmission,
} from "../proctoring";

describe("proctoring (dashboard queues, approval gate, verification)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let courseA: { id: string };
  let faculty: { id: string };
  let assignedProctor: { id: string };
  let unassignedProctor: { id: string };
  let student: { id: string };
  let examId: string;
  let secondExamId: string;

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Proctoring Tenant ${runId}`, slug: `proctoring-tenant-${runId}` },
    });
    courseA = await platform.course.create({
      data: { institutionId: institutionA.id, code: "LAW701", name: "Proctoring Test Course", academicYear: "2026-2027" },
    });
    faculty = await platform.user.create({
      data: { institutionId: institutionA.id, email: `proctoring-faculty-${runId}@test.local`, name: "Faculty", role: "FACULTY", passwordHash: "x" },
    });
    assignedProctor = await platform.user.create({
      data: { institutionId: institutionA.id, email: `proctoring-assigned-${runId}@test.local`, name: "Assigned Proctor", role: "PROCTOR", passwordHash: "x" },
    });
    unassignedProctor = await platform.user.create({
      data: { institutionId: institutionA.id, email: `proctoring-unassigned-${runId}@test.local`, name: "Unassigned Proctor", role: "PROCTOR", passwordHash: "x" },
    });
    student = await platform.user.create({
      data: { institutionId: institutionA.id, email: `proctoring-student-${runId}@test.local`, name: "Student", role: "STUDENT", passwordHash: "x" },
    });
    await platform.enrollment.create({ data: { institutionId: institutionA.id, courseId: courseA.id, userId: student.id } });
    // Only assignedProctor is scoped to courseA — unassignedProctor exists in
    // the same institution but has no CourseProctor row, proving the queues
    // and gate are scoped per-course, not "any PROCTOR in the institution".
    await platform.courseProctor.create({ data: { institutionId: institutionA.id, courseId: courseA.id, userId: assignedProctor.id } });

    const { exam } = await createExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      title: "Proctoring Test Exam",
      timeLimitMinutes: 30,
    });
    examId = exam.id;

    const { question } = await createQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      type: "MULTIPLE_CHOICE",
      prompt: "Pick one.",
      choices: [{ id: "0", text: "A" }, { id: "1", text: "B" }],
      correctAnswer: { choiceIds: ["0"] },
      points: 1,
    });
    await addExamQuestion(institutionA.id, { role: "FACULTY" }, { examId, questionId: question.id, points: 1 });
    await publishExam(institutionA.id, { role: "FACULTY" }, examId);

    // A student gets exactly one attempt per exam (no retakes) — the
    // verification test below needs its own exam so it isn't reusing (and
    // colliding with) the attempt the approval-gate test already advanced.
    const { exam: secondExam } = await createExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      title: "Proctoring Verification Exam",
      timeLimitMinutes: 30,
    });
    secondExamId = secondExam.id;
    await addExamQuestion(institutionA.id, { role: "FACULTY" }, { examId: secondExamId, questionId: question.id, points: 1 });
    await publishExam(institutionA.id, { role: "FACULTY" }, secondExamId);
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.attemptEvent.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
    await platform.submission.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
    await platform.examAnswer.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
    await platform.examAttempt.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.examQuestion.deleteMany({ where: { examVersion: { exam: { institutionId: institutionA.id } } } });
    await platform.examVersion.deleteMany({ where: { exam: { institutionId: institutionA.id } } });
    await platform.exam.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.questionVersion.deleteMany({ where: { question: { institutionId: institutionA.id } } });
    await platform.question.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.courseProctor.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.enrollment.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.user.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.course.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.institution.deleteMany({ where: { id: institutionA.id } });
  });

  it("scopes the booked queue to a proctor's assigned courses only", async () => {
    const booked = await bookAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId);

    const forAssigned = await listBookedAttemptsForProctor(institutionA.id, { id: assignedProctor.id, role: "PROCTOR" });
    expect(forAssigned.some((a) => a.id === booked.id)).toBe(true);

    const forUnassigned = await listBookedAttemptsForProctor(institutionA.id, { id: unassignedProctor.id, role: "PROCTOR" });
    expect(forUnassigned.some((a) => a.id === booked.id)).toBe(false);
  });

  it("requestProctorApproval surfaces the request on the assigned proctor's queue only, and gates approval by assignment", async () => {
    const booked = await bookAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId);

    expect(await checkProctorApproval(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id)).toBe(false);

    await requestProctorApproval(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id);

    const pendingForAssigned = await listPendingApprovalsForProctor(institutionA.id, { id: assignedProctor.id, role: "PROCTOR" });
    expect(pendingForAssigned.some((a) => a.id === booked.id)).toBe(true);
    const pendingForUnassigned = await listPendingApprovalsForProctor(institutionA.id, { id: unassignedProctor.id, role: "PROCTOR" });
    expect(pendingForUnassigned.some((a) => a.id === booked.id)).toBe(false);

    await expect(
      approveProctorStart(institutionA.id, { id: unassignedProctor.id, role: "PROCTOR" }, booked.id)
    ).rejects.toThrow(ProctorNotAssignedError);

    await approveProctorStart(institutionA.id, { id: assignedProctor.id, role: "PROCTOR" }, booked.id);
    expect(await checkProctorApproval(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id)).toBe(true);

    const begun = await beginBookedAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id);
    expect(begun.status).toBe("IN_PROGRESS");
  });

  it("gates the result behind proctor verification, scoped by course assignment, and is idempotent", async () => {
    const booked = await bookAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, secondExamId);
    await requestProctorApproval(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id);
    await approveProctorStart(institutionA.id, { id: assignedProctor.id, role: "PROCTOR" }, booked.id);
    await beginBookedAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id);

    await expect(
      verifySubmission(institutionA.id, { id: assignedProctor.id, role: "PROCTOR" }, booked.id)
    ).rejects.toThrow(SubmissionNotFoundError);

    await saveAnswers(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id, [
      { examQuestionId: (await forPlatform().examAnswer.findFirst({ where: { attemptId: booked.id } }))?.examQuestionId ?? "", responseJson: { choiceIds: ["0"] } },
    ]);
    await submitAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, booked.id);

    const pendingForAssigned = await listPendingVerificationsForProctor(institutionA.id, { id: assignedProctor.id, role: "PROCTOR" });
    expect(pendingForAssigned.some((a) => a.id === booked.id)).toBe(true);
    const pendingForUnassigned = await listPendingVerificationsForProctor(institutionA.id, { id: unassignedProctor.id, role: "PROCTOR" });
    expect(pendingForUnassigned.some((a) => a.id === booked.id)).toBe(false);

    await expect(
      verifySubmission(institutionA.id, { id: unassignedProctor.id, role: "PROCTOR" }, booked.id)
    ).rejects.toThrow(ProctorNotAssignedError);

    const verified = await verifySubmission(institutionA.id, { id: assignedProctor.id, role: "PROCTOR" }, booked.id);
    expect(verified.verifiedAt).not.toBeNull();

    // A second call must not error and must not change the recorded time.
    const verifiedAgain = await verifySubmission(institutionA.id, { id: assignedProctor.id, role: "PROCTOR" }, booked.id);
    expect(verifiedAgain.verifiedAt?.getTime()).toBe(verified.verifiedAt?.getTime());
  });
});
