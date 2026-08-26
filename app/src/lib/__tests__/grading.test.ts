import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CourseAccessDeniedError } from "../courses";
import { forPlatform } from "../tenant-db";
import { createQuestion } from "../questions";
import { addExamQuestion, createExam, publishExam } from "../exams";
import { saveAnswers, startAttempt, submitAttempt } from "../attempts";
import { gradeAnswer, getCourseExamSummaries } from "../grading";

describe("getCourseExamSummaries (course-home grading rollup)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let courseA: { id: string };
  let faculty: { id: string };
  let unassignedFaculty: { id: string };
  let student: { id: string };
  let examId: string;
  let mcExamQuestionId: string;
  let essayExamQuestionId: string;

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Tenant A ${runId}`, slug: `grading-tenant-a-${runId}` },
    });
    courseA = await platform.course.create({
      data: { institutionId: institutionA.id, code: "LAW501", name: "Remedies", academicYear: "2026-2027" },
    });
    faculty = await platform.user.create({
      data: { institutionId: institutionA.id, email: `grading-faculty-${runId}@test.local`, name: "Faculty", role: "FACULTY", passwordHash: "x" },
    });
    await platform.courseFaculty.create({ data: { institutionId: institutionA.id, courseId: courseA.id, userId: faculty.id } });
    unassignedFaculty = await platform.user.create({
      data: { institutionId: institutionA.id, email: `grading-unassigned-${runId}@test.local`, name: "Unassigned", role: "FACULTY", passwordHash: "x" },
    });
    student = await platform.user.create({
      data: { institutionId: institutionA.id, email: `grading-student-${runId}@test.local`, name: "Student", role: "STUDENT", passwordHash: "x" },
    });
    await platform.enrollment.create({ data: { institutionId: institutionA.id, courseId: courseA.id, userId: student.id } });

    const { exam } = await createExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      title: "Rollup Test Exam",
      timeLimitMinutes: 60,
    });
    examId = exam.id;

    const { question: mcQuestion } = await createQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      type: "MULTIPLE_CHOICE",
      prompt: "Pick the correct choice.",
      choices: [{ id: "0", text: "Right" }, { id: "1", text: "Wrong" }],
      correctAnswer: { choiceIds: ["0"] },
      points: 2,
    });
    const mcExamQuestion = await addExamQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, { examId, questionId: mcQuestion.id, points: 2 });
    mcExamQuestionId = mcExamQuestion.id;

    const { question: essayQuestion } = await createQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, {
      courseId: courseA.id,
      type: "ESSAY",
      prompt: "Discuss.",
      points: 10,
    });
    const essayExamQuestion = await addExamQuestion(institutionA.id, { id: faculty.id, role: "FACULTY" }, { examId, questionId: essayQuestion.id, points: 10 });
    essayExamQuestionId = essayExamQuestion.id;

    await publishExam(institutionA.id, { id: faculty.id, role: "FACULTY" }, examId);
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.submission.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
    await platform.examAnswer.deleteMany({ where: { attempt: { institutionId: institutionA.id } } });
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

  it("refuses a faculty member who isn't assigned to the course", async () => {
    await expect(
      getCourseExamSummaries(institutionA.id, { id: unassignedFaculty.id, role: "FACULTY" }, courseA.id)
    ).rejects.toThrow(CourseAccessDeniedError);
  });

  it("counts a submitted-but-not-fully-graded attempt as pending", async () => {
    const attempt = await startAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, examId);
    await saveAnswers(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id, [
      { examQuestionId: mcExamQuestionId, responseJson: { choiceIds: ["0"] } },
      { examQuestionId: essayExamQuestionId, responseJson: { text: "Draft" } },
    ]);
    await submitAttempt(institutionA.id, { id: student.id, role: "STUDENT" }, attempt.id);

    const [summary] = await getCourseExamSummaries(institutionA.id, { id: faculty.id, role: "FACULTY" }, courseA.id);
    expect(summary.examId).toBe(examId);
    expect(summary.submittedCount).toBe(1);
    expect(summary.pendingCount).toBe(1);
    expect(summary.gradedCount).toBe(0);
    expect(summary.averageScorePercent).toBeNull();

    const essayAnswerId = await answerIdFor(institutionA.id, attempt.id, essayExamQuestionId);
    await gradeAnswer(institutionA.id, { id: faculty.id, role: "FACULTY" }, essayAnswerId, 10);

    const [graded] = await getCourseExamSummaries(institutionA.id, { id: faculty.id, role: "FACULTY" }, courseA.id);
    expect(graded.pendingCount).toBe(0);
    expect(graded.gradedCount).toBe(1);
    expect(graded.averageScorePercent).toBe(100);
  });
});

async function answerIdFor(institutionId: string, attemptId: string, examQuestionId: string): Promise<string> {
  const platform = forPlatform();
  const answer = await platform.examAnswer.findFirst({ where: { attemptId, examQuestionId } });
  if (!answer) throw new Error("answer not found in test fixture");
  return answer.id;
}
