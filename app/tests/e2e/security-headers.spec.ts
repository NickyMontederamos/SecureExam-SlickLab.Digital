import { expect, test } from "@playwright/test";

/**
 * Regression suite for docs/WORLD_CLASS_AUDIT.md finding A-04 — the app
 * shipped five security headers but no Content-Security-Policy at all.
 *
 * These assertions exist because a CSP is uniquely easy to silently break:
 * it can be removed, weakened to `unsafe-inline`, or duplicated by a stale
 * static header, and the app keeps working perfectly in every case. Only a
 * test notices.
 */

test("serves a nonce-based CSP that does not fall back to unsafe-inline scripts", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response).not.toBeNull();

  const csp = response!.headers()["content-security-policy"];
  expect(csp, "no Content-Security-Policy header was served").toBeTruthy();

  // A fresh nonce must be present — this is what makes strict-dynamic work
  // without allowing arbitrary inline script.
  expect(csp).toMatch(/script-src[^;]*'nonce-[a-f0-9]+'/);
  expect(csp).toContain("'strict-dynamic'");

  // The whole point of the nonce is to avoid this. If it ever reappears in
  // script-src, the CSP has been silently downgraded to decorative.
  const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
  expect(scriptSrc).not.toContain("'unsafe-inline'");

  // Directives that specifically matter for an exam platform: injected
  // content must not be able to post answers or credentials off-origin,
  // frame the app, or load plugins.
  expect(csp).toContain("form-action 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
});

test("issues a different nonce on every request", async ({ page }) => {
  const nonceOf = (csp: string) => csp.match(/'nonce-([a-f0-9]+)'/)?.[1];

  const first = await page.goto("/login");
  const firstNonce = nonceOf(first!.headers()["content-security-policy"]);

  const second = await page.goto("/login?cachebust=1");
  const secondNonce = nonceOf(second!.headers()["content-security-policy"]);

  expect(firstNonce).toBeTruthy();
  expect(secondNonce).toBeTruthy();
  // A reused nonce is barely better than unsafe-inline: an attacker who
  // learns it once can inject freely thereafter.
  expect(firstNonce).not.toBe(secondNonce);
});

test("still serves the baseline security headers alongside the CSP", async ({ page }) => {
  const response = await page.goto("/login");
  const headers = response!.headers();

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["strict-transport-security"]).toContain("max-age=");
});

test("the app actually renders and hydrates under the CSP", async ({ page }) => {
  // The failure mode that matters: a CSP strict enough to block Next's own
  // bootstrap scripts leaves a page that renders but never becomes
  // interactive. Asserting the header exists proves nothing about that, so
  // drive a real interaction and watch for CSP violations.
  const violations: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(text)) {
      violations.push(text);
    }
  });

  await page.goto("/login");
  await page.fill('input[name="email"]', "admin@cmlaw.demo");
  await page.fill('input[name="password"]', "DemoPass!2026");
  await page.click('button[type="submit"]');

  // Reaching the dashboard requires client-side JS to have run.
  await expect(page).toHaveURL(/dashboard/);
  expect(violations, `CSP blocked something the app needs:\n${violations.join("\n")}`).toEqual([]);
});
