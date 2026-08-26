import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Same reasoning as question-import.spec.ts: the Browser pane tool used for
 * manual verification can't drive a native file picker, so this is the only
 * thing that proves the roster CSV upload's formData.get("file") really
 * receives what a user selects (roster-import.test.ts covers the parsing,
 * account-creation, and credential logic directly against real Postgres).
 */

const DEMO_PASSWORD = "DemoPass!2026";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', "admin@cmlaw.demo");
  await page.fill('input[name="password"]', DEMO_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/dashboard/);
}

test("admin bulk-assigns existing accounts from a valid CSV", async ({ page }) => {
  const csvPath = path.join(os.tmpdir(), `roster-${Date.now().toString(36)}.csv`);
  fs.writeFileSync(csvPath, ["email,role", "faculty@cmlaw.demo,FACULTY", "student@cmlaw.demo,STUDENT"].join("\n"));

  await login(page);
  await page.click("text=LAW101");
  await expect(page).toHaveURL(/\/courses\/[^/]+$/);
  await page.click("text=Manage roster");
  await expect(page).toHaveURL(/manage/);

  await page.setInputFiles('input[name="file"]', csvPath);
  await page.click('button:has-text("Import roster")');

  await expect(page.getByText(/Imported roster/)).toBeVisible();

  fs.unlinkSync(csvPath);
});

test("a CSV row with an unknown email creates a new account and reveals its temp password once", async ({ page }) => {
  const runId = Date.now().toString(36);
  const newEmail = `e2e-new-${runId}@cmlaw.demo`;
  const csvPath = path.join(os.tmpdir(), `roster-new-${runId}.csv`);
  fs.writeFileSync(csvPath, ["email,role,name", `${newEmail},STUDENT,E2E New Student`].join("\n"));

  await login(page);
  await page.click("text=LAW101");
  await expect(page).toHaveURL(/\/courses\/[^/]+$/);
  await page.click("text=Manage roster");
  await expect(page).toHaveURL(/manage/);

  await page.setInputFiles('input[name="file"]', csvPath);
  await page.click('button:has-text("Import roster")');

  await expect(page.getByText(/1 new account\(s\) created/)).toBeVisible();
  const credentialsSection = page.locator("section", { hasText: "New account credentials — shown once" });
  await expect(credentialsSection).toBeVisible();
  await expect(credentialsSection.getByText(newEmail)).toBeVisible();

  // Reloading the page must not re-reveal the temp password (read-once contract).
  await page.reload();
  await expect(page.getByText("New account credentials — shown once")).not.toBeVisible();

  fs.unlinkSync(csvPath);
});

test("claiming an existing account under the wrong role imports nothing and shows the row error", async ({ page }) => {
  const csvPath = path.join(os.tmpdir(), `roster-bad-${Date.now().toString(36)}.csv`);
  fs.writeFileSync(csvPath, ["email,role", "faculty@cmlaw.demo,STUDENT"].join("\n"));

  await login(page);
  await page.click("text=LAW101");
  await expect(page).toHaveURL(/\/courses\/[^/]+$/);
  await page.click("text=Manage roster");
  await expect(page).toHaveURL(/manage/);

  await page.setInputFiles('input[name="file"]', csvPath);
  await page.click('button:has-text("Import roster")');

  await expect(page.getByText(/Import failed/)).toBeVisible();
  await expect(page.getByText(/can't change an existing account's role/)).toBeVisible();

  fs.unlinkSync(csvPath);
});
