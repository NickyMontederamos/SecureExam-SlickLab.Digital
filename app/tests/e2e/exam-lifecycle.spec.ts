import { expect, test, type Page } from "@playwright/test";

/**
 * The golden path, scripted: this is what caught neither ERROR-001 nor
 * ERROR-002 automatically — those were only found by manually clicking
 * through the app. Running this suite would have caught both. Uses a
 * unique run ID per invocation so repeated local runs don't collide with
 * each other or with the seeded demo data's no-retake constraint.
 */

const DEMO_PASSWORD = "DemoPass!2026";
const runId = Date.now().toString(36);
const questionPrompt = `E2E test question ${runId}`;
const examTitle = `E2E Test Exam ${runId}`;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', DEMO_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/dashboard/);
}

test.describe.serial("full exam lifecycle", () => {
  test("faculty authors a question and exam, publishes it", async ({ page }) => {
    await login(page, "faculty@cmlaw.demo");

    await page.click("text=LAW101");
    await expect(page).toHaveURL(/questions/);

    await page.selectOption('select[name="type"]', "MULTIPLE_CHOICE");
    await page.fill('textarea[name="prompt"]', questionPrompt);
    await page.fill('textarea[name="choicesText"]', "*Correct\nWrong");
    await page.fill('input[name="points"]', "1");
    await page.click('button:has-text("Add question")');
    await expect(page.getByText(questionPrompt)).toBeVisible();

    await page.click("text=Exams");
    await page.fill('input[name="title"]', examTitle);
    await page.fill('input[name="timeLimitMinutes"]', "60");
    await page.click('button:has-text("Create exam")');
    await expect(page.getByText(examTitle)).toBeVisible();

    await page.click(`text=${examTitle}`);
    await page.selectOption('select[name="questionId"]', { label: `[MULTIPLE_CHOICE] ${questionPrompt}` });
    await page.fill('input[name="points"]', "1");
    await page.click('button:has-text("Add to exam")');
    // Wait for the add-question server action's re-render to actually land
    // before publishing — clicking "Publish" immediately after "Add to
    // exam" raced ahead of it in testing (Next.js dev-mode server action
    // re-renders aren't always synchronous from Playwright's click()
    // perspective), leaving the exam published with zero questions
    // attached. This assertion is the fix, not a workaround for an app bug
    // — publishExam() already rejects an empty exam (see exams.test.ts).
    await expect(page.getByText("Questions (1)")).toBeVisible();
    await page.click('button:has-text("Publish exam")');
    await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible();
  });

  test("student takes the exam and sees an auto-graded result", async ({ page }) => {
    await login(page, "student@cmlaw.demo");

    await page.click("text=LAW101");
    await page.click(`text=${examTitle}`);
    await page.check('input[type="checkbox"]'); // agree to the exam rules
    await page.click('button:has-text("Start Exam")');

    await page.locator('input[type="radio"]').first().check(); // the seeded correct choice is first
    await page.click('button:has-text("Submit Exam")');

    await expect(page.getByText(/Score: 1 \/ 1/)).toBeVisible();
  });
});
