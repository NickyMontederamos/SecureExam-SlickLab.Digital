import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Exercises the actual browser file-upload path — the Browser pane tool
 * used for manual verification during this project can't drive a native
 * file picker, so this is the only thing that proves formData.get("file")
 * really receives what a user selects, not just that the underlying
 * import logic works (that's covered separately by
 * question-import-db.test.ts against real Postgres).
 */

const DEMO_PASSWORD = "DemoPass!2026";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', "faculty@cmlaw.demo");
  await page.fill('input[name="password"]', DEMO_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/dashboard/);
}

test("faculty imports a valid CSV question bank", async ({ page }) => {
  const runId = Date.now().toString(36);
  const prompt = `E2E CSV question ${runId}`;
  const csvPath = path.join(os.tmpdir(), `import-${runId}.csv`);
  fs.writeFileSync(
    csvPath,
    [
      "type,prompt,choice1,choice2,choice3,choice4,choice5,choice6,correct_choices,points,difficulty,tags",
      `MULTIPLE_CHOICE,"${prompt}",Right,Wrong,,,,,1,1,easy,e2e`,
    ].join("\n")
  );

  await login(page);
  await page.click("text=LAW101");
  await expect(page).toHaveURL(/\/courses\/[^/]+$/);
  await page.click("text=Question bank");
  await expect(page).toHaveURL(/questions/);

  await page.setInputFiles('input[name="file"]', csvPath);
  await page.click('button:has-text("Import")');

  await expect(page.getByText(/Imported 1 question/)).toBeVisible();
  await expect(page.getByText(prompt)).toBeVisible();

  fs.unlinkSync(csvPath);
});

test("an invalid CSV imports nothing and shows the row error", async ({ page }) => {
  const runId = Date.now().toString(36);
  const csvPath = path.join(os.tmpdir(), `import-bad-${runId}.csv`);
  fs.writeFileSync(
    csvPath,
    [
      "type,prompt,choice1,choice2,choice3,choice4,choice5,choice6,correct_choices,points,difficulty,tags",
      "NOT_A_REAL_TYPE,\"Should never import\",,,,,,,,,1,,",
    ].join("\n")
  );

  await login(page);
  await page.click("text=LAW101");
  await expect(page).toHaveURL(/\/courses\/[^/]+$/);
  await page.click("text=Question bank");
  await expect(page).toHaveURL(/questions/);

  await page.setInputFiles('input[name="file"]', csvPath);
  await page.click('button:has-text("Import")');

  await expect(page.getByText(/Import failed/)).toBeVisible();
  await expect(page.getByText("Should never import")).not.toBeVisible();

  fs.unlinkSync(csvPath);
});
