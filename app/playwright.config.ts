import { defineConfig, devices } from "@playwright/test";

/**
 * Runs on a dedicated port (3010) so it never collides with a manually
 * running `next dev` (which lands on 3001 on this machine because
 * something else already holds 3000) or with the Postgres/vitest setup.
 * reuseExistingServer means a local repeat run reuses whatever's already
 * up on that port; CI always starts fresh.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3010",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- -p 3010",
    url: "http://localhost:3010",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
