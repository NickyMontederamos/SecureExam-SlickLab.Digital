import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["dotenv/config"],
    // tests/e2e/*.spec.ts are Playwright tests (npm run test:e2e), not
    // Vitest's — Vitest's default include pattern would otherwise also
    // match *.spec.ts and try (and fail) to run them as unit tests.
    exclude: ["node_modules/**", "tests/e2e/**"],
  },
});
