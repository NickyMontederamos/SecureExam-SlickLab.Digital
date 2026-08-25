# Error Log — CM-Law SecureExam

Format and discipline per master prompt §26.

## ERROR-001

### Symptom
Faculty submitting the "Add a question" form on `/courses/[courseId]/questions` got silently bounced to `/login` instead of the question being created — no error shown, no question in the database. Reproduced live in the browser, not just theorized.

### Root Cause
`src/auth.ts`'s `session()` callback copies `role` and `institutionId` from the JWT onto `session.user`, but never copied the user's `id`. Once a custom `session()` callback is defined, Auth.js does not fall back to any default `id` population — so `session.user.id` was `undefined` on every authenticated request. `/dashboard` and `/api/courses` never actually used `session.user.id`, so this went unnoticed until `createQuestionAction` (which needs the actor's id to set `Question.createdById`) checked for it and correctly refused to proceed with a missing id, redirecting to `/login`.

### Fix
Added `session.user.id = token.sub` inside the `session()` callback (`token.sub` is the JWT subject, set from `authorize()`'s returned `user.id` at sign-in). See `src/auth.ts`.

### Regression Test
Not covered by an automated test — this is App Router request/cookie plumbing that vitest's node environment can't exercise without a much heavier test harness (a real HTTP server + cookie jar). Caught instead by live browser verification (sign in as faculty, submit the create-question form, confirm the row exists in Postgres) — see `docs/ARCHITECTURE.md`'s "what's verified" list. Any future change to `src/auth.ts`'s callbacks should be re-verified the same way, not just by `npm run build` passing.

### Status
RESOLVED

---

## ERROR-002

### Symptom
After adding grading fields to the Prisma schema (`pointsAwarded`, `autoGraded`, `gradedAt`, `gradedById` on `ExamAnswer`) and running `npx prisma migrate dev`, submitting an exam attempt in the browser threw `PrismaClientValidationError: Unknown argument 'pointsAwarded'` — even though the migration had applied successfully and a fresh `npm test` run (new process) passed all 37 tests using the same fields.

### Root Cause
`npx prisma migrate dev` applies the SQL migration but does not reliably regenerate `@prisma/client` for an *already-running* Node process — the long-lived `next dev` server process had the pre-migration client loaded in memory from before the schema change, so its `PrismaClient` type/runtime had no idea the new columns existed. Short-lived processes (a fresh `npm test` invocation, a fresh `next build`) picked up the regenerated client fine because they start clean; the dev server did not, because Node doesn't reload `node_modules` into a running process. This is the second time this exact class of staleness has bitten this project (the first was ERROR-earlier institution-branding migration, fixed the same way but not logged).

### Fix
No code fix — this is a workflow discipline issue. After every `prisma migrate dev`: (1) run `npx prisma generate` explicitly (don't assume migrate did it), and (2) restart any already-running `next dev` process before testing in the browser. Restarting via `Get-NetTCPConnection -LocalPort <port> | Select-Object OwningProcess` + `Stop-Process` (PowerShell) since this environment doesn't have `taskkill` on PATH.

### Regression Test
Not applicable (workflow, not code). Documented here so it isn't re-discovered a third time.

### Status
RESOLVED (as a process discipline, not a code change) — see `docs/ARCHITECTURE.md`'s local development section.

---

## ERROR-003

### Symptom
The new Playwright E2E golden-path test's second test (student takes the exam) failed with `Test timeout of 30000ms exceeded` waiting for the exam to appear in the student's exam list. The first test (faculty authors + publishes) reported "ok."

### Root Cause
The test clicked "Add to exam" then immediately "Publish exam" with no wait in between. Querying Postgres directly after a failing run showed the exam existed with the right title but `status: DRAFT` — the publish never actually succeeded, despite the test's own `expect(getByText("PUBLISHED")).toBeVisible()` assertion appearing to pass. The add-question server action's re-render hadn't landed yet when publish fired, so `publishExam()` was called against a still-zero-question view. This is a test-authoring bug (racing ahead of an async UI update), not an application bug — `publishExam()` already refuses to publish an empty exam, and that guarantee is covered by `exams.test.ts` and held throughout.

### Fix
Added `await expect(page.getByText("Questions (1)")).toBeVisible()` between the "Add to exam" click and the "Publish exam" click, so the test waits for the actual UI evidence that the question was attached before proceeding. Also tightened the post-publish assertion to `{ exact: true }` to remove any ambiguity about what "PUBLISHED" text was being matched.

### Regression Test
This *is* a regression test — `tests/e2e/exam-lifecycle.spec.ts` now passes reliably (verified 2/2 on the fixed version) after previously producing three orphaned DRAFT exams across repeated runs before the root cause was found.

### Status
RESOLVED
