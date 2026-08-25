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

---

## ERROR-004

### Symptom
After adding a shared `readAnswersFromForm` helper inside the exam-taking Server Component (`attempts/[attemptId]/page.tsx`) and calling it from both `saveProgressAction` and `submitExamAction`, the E2E suite's "student takes the exam" test hung indefinitely with zero CPU activity — no test failure, no timeout message, just silence. `npm run build` and `npx eslint .` both passed clean; the bug only surfaced by actually clicking through the exam in a running dev server (or exercising it via Playwright), where the dev server log showed: `Error: Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server"`.

### Root Cause
`readAnswersFromForm` was a plain function (no `"use server"`) defined inside the page's render body, closed over by two different `"use server"` inline actions in the same component. Next.js serializes a server action's closure to reconstruct it on each invocation; a plain function reference captured in that closure isn't serializable data, and only the runtime action-invocation path detects this — not the type checker, not the build's static analysis. Two actions sharing one non-action helper via closure was enough to trip it, even though each action calling its own inline duplicate logic (the pattern before this refactor) never had.

### Fix
Hoisted `readAnswersFromForm` to module scope (same level as the file's other form-parsing helper, `parseAnswerFromForm`, which already safely worked this way), taking `examQuestions` as an explicit parameter instead of closing over `attempt`. A server action may still call a plain module-level function — the failure mode is specifically about the action's *closure* capturing a function reference, not about calling one.

### Regression Test
`tests/e2e/exam-lifecycle.spec.ts`'s "student takes the exam" test now passes reliably (4/4 in the full suite) and exercises this exact code path — flagging a question, saving progress, and submitting all route through `readAnswersFromForm`.

### Status
RESOLVED — general lesson for this codebase: don't extract a shared plain-function helper across two inline `"use server"` actions in the same Server Component. Either give the helper its own `"use server"` in a dedicated file (see `attempts/[attemptId]/actions.ts`), or keep it at module scope taking explicit parameters.

---

## ERROR-005

### Symptom
`ExamEntryGate`'s mocked device-check step ("Checking your device…") hung indefinitely during live verification — no error, no console output, no progress to the next step (ID verification). Reproduced consistently, not a one-off flake.

### Root Cause
The device-check step calls `document.documentElement.requestFullscreen()` and `await`s it inside a `try/catch`, on the assumption it would either resolve or reject quickly. In the browser context used for verification, the returned promise did neither — it stayed pending forever. A `try/catch` only protects against a *rejection*; it does nothing for a promise that never settles at all, so the `await` blocked the entire gate sequence permanently. This directly undermined the "soft check, never blocks the exam" design intent from `docs/PITCH_ROADMAP.md` — the intent was right, the implementation only guarded half of the actual failure mode.

### Fix
Added a `withTimeout()` helper (`Promise.race` against a plain delay) and wrapped the `requestFullscreen()` call in it (1.5s cap) in `src/components/ExamEntryGate.tsx`. A hung fullscreen request now times out and the gate sequence proceeds exactly as if it had failed outright.

### Regression Test
Not covered by an automated test — Playwright's own browser context didn't reproduce the hang (its `requestFullscreen()` apparently settles fine), so this was only caught by manual live verification in the actual verification tooling used for this session. Documented here so the general lesson survives even without a repro in CI: **any promise from a browser permission/capability API that's part of a "soft" check must be raced against a timeout, not just wrapped in try/catch** — rejection and "never settles" are different failure modes and need different handling.

### Status
RESOLVED
