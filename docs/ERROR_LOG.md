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

---

## ERROR-006

### Symptom
Immediately after `npx prisma migrate dev --name add_proctor_workflow` (adding the `CourseProctor` model for Milestone 5), running `npm run seed` — a brand-new `tsx` process, not a long-lived one — crashed with `TypeError: Cannot read properties of undefined (reading 'upsert')` at the first `db.courseProctor.upsert(...)` call.

### Root Cause
A sharper case of ERROR-002: that entry assumed `migrate dev` reliably regenerates `@prisma/client` for *fresh* processes and only stales out already-running ones. That's not what happened here — `db.courseProctor` was `undefined` even in a brand-new process, meaning `migrate dev` had not regenerated the client at all this time (adding a wholly new model, not just new columns on an existing one, may be what changed the behavior; not confirmed). Running `npx prisma generate` explicitly fixed it immediately.

### Fix
No code fix — same workflow discipline as ERROR-002, restated more strongly: **never assume `prisma migrate dev` regenerated the client — always run `npx prisma generate` explicitly right after, before running anything (seed script, tests, dev server) that imports `@prisma/client`.** Don't rely on "it usually does it automatically."

### Regression Test
Not applicable (workflow, not code).

### Status
RESOLVED (as a process discipline) — see ERROR-002 for the earlier, narrower version of this lesson.

---

## ERROR-007

### Symptom
Live E2E verification of Milestone 5's real proctor gate: a proctor approving a student's start request (confirmed in Postgres — `proctorApprovedAt` set within ~2s of the request) never unblocked the student. The page stayed on "Waiting for proctor approval…" forever — no error shown, no console output, no navigation — even minutes later.

### Root Cause
`ExamEntryGate.tsx`'s proctor-wait step polled `checkProctorApprovalAction` in a loop, guarded by a `cancelledRef` set to `true` in a `useEffect` cleanup so navigating away mid-poll wouldn't keep polling in the background. Next.js dev mode runs React in Strict Mode, which **double-invokes every effect on mount** (mount → cleanup → mount again) specifically to surface exactly this class of bug. That synthetic cleanup ran `cancelledRef.current = true` before the student ever clicked "Start Exam" — and since it's a ref (not state reset on remount), it stayed `true` for the rest of the component's real lifetime. The poll loop's `while (!approved && !cancelledRef.current)` condition was therefore false from the very first iteration, and `if (cancelledRef.current) return;` silently parked the UI on "proctor" step forever with no error path taken.

### Fix
Removed the `cancelledRef`/`useEffect` unmount guard entirely (`src/components/ExamEntryGate.tsx`) — it was speculative hardening the rest of this component never needed (nothing else in the gate sequence guards against unmounting either; a `router.push` after unmount is a harmless no-op). The poll loop now just runs `while (!approved)` until it either succeeds or the request itself throws.

### Regression Test
Not covered by a unit test — this is client-only React lifecycle behavior that only manifests under Strict Mode's double-invoke, which vitest's environment doesn't reproduce. Caught by `tests/e2e/exam-lifecycle.spec.ts`'s updated golden-path test, which now drives a real second proctor and would hang (and eventually time out) if this regressed. **General lesson for this codebase: a `useEffect` cleanup that flips a ref/flag meant to signal "the real unmount happened" is unsafe in dev — Strict Mode's synthetic double-invoke runs that same cleanup before any real unmount. Don't add unmount-cancellation guards speculatively; only add one if there's an actual bug it fixes, and if you do, verify it survives a Strict Mode double-invoke, not just a real unmount.**

### Status
RESOLVED

---

## ERROR-008

### Symptom
After fixing ERROR-007, live E2E verification still failed at the final step: the proctor's "Approve to finish" click (confirmed via a direct script call that `verifySubmission()` itself works correctly) never set `Submission.verifiedAt` for the test's own attempt.

### Root Cause
Not an application bug — a test-scoping bug. `Submission.verifiedAt` had never been set by any code path before this milestone, so **every historical SUBMITTED/GRADED attempt ever made against a course the demo proctor is assigned to** (accumulated across many prior live-verification sessions on this project) showed up in the proctor dashboard's "Waiting for your sign-off to finish" queue — 10 items at the time this was diagnosed, not 1. The test's `page.click('button:has-text("Approve to finish")')` used Playwright's legacy selector-string form, which (unlike a `locator(...).click()` chain) does not enforce strict mode and silently clicked the *first* matching button on the page — an old historical attempt, not the one this test run just submitted.

### Fix
Scoped both proctor-dashboard clicks in `tests/e2e/exam-lifecycle.spec.ts` to the specific `<li>` row for this run's unique exam title AND containing the specific button (`getByRole("listitem").filter({ hasText: examTitle }).filter({ has: button })`) instead of a bare `button:has-text(...)` selector. No application code changed — `verifySubmission()` and `approveProctorStart()` were correct the whole time.

### Regression Test
This *is* the regression test — `tests/e2e/exam-lifecycle.spec.ts` now passes reliably (verified 2/2 in a row) with the scoped selectors. **General lesson: once a queue/list can accumulate across sessions (as any proctor/review queue naturally will), an E2E test must never select "the button with this text" — it must select "the button in the row for this specific record," even the first time a feature is built, not just after a flake is observed.**

### Status
RESOLVED

---

## ERROR-009

### Symptom
The exam time limit was not enforced by any server write path. A student could save an answer and have it awarded full credit **hours after the deadline had passed**. Found during the world-class readiness audit (`docs/WORLD_CLASS_AUDIT.md` finding A-01), not by a user report or a failing test.

Reproduced against real Postgres before fixing — a 1-minute exam, written 2 hours after start:

```
saveAnswers accepted:   true
submitAttempt accepted: true
final attempt status:   GRADED
points awarded:         1      <- full credit, 119 minutes late
```

### Root Cause
Two separate things, and the second is why it survived so long.

1. **No deadline check on any write path.** `saveAnswers()` and `submitAttempt()` guarded only `status !== "IN_PROGRESS"`. `timeRemainingSeconds` was written once at attempt creation and **never read anywhere in the codebase**. `timeLimitMinutes` never appeared in an enforcement branch. The attempt *page* did check expiry on render — but a page render is not a security boundary: a stale tab, a direct server-action call, or simply not reloading bypasses it entirely.

2. **A docstring that asserted the control existed.** `ExamCountdown.tsx` claimed *"submitAttempt re-derives the deadline server-side regardless of what this component displays."* That was false. Anyone auditing the timer would read that comment and stop looking — which is exactly what appears to have happened. **A confidently wrong comment on a security control is worse than no comment, because it terminates the reviewer's investigation.**

### Fix
- Added `expiresAt` (authoritative deadline) and `pausedAt` to `ExamAttempt` — additive nullable migration, no data loss.
- `expiresAt` is set where the clock genuinely starts (`startAttempt`, and `beginBookedAttempt`'s NOT_STARTED→IN_PROGRESS transition), never at row creation — booking and the entry gate still burn no exam time.
- `attemptDeadline()` / `isAttemptExpired()` in `attempts.ts` are the single source of truth. They fall back to `startedAt + timeLimitMinutes` for pre-migration rows, so legacy attempts are enforced rather than silently exempt.
- `saveAnswers()` now refuses a post-deadline write with `AttemptExpiredError` **and** finalizes the attempt, so one abandoned mid-exam (closed laptop, dead connection) can't sit `IN_PROGRESS` forever.
- `submitAttempt()` deliberately does **not** refuse a late submit: submitting accepts no new answer data, it only grades what was saved in time. Refusing it would discard legitimately-completed work over network latency on the auto-submit round trip.
- **Pause fairness:** naively enforcing `startedAt + limit` would have charged a student for time spent under integrity review — including a review that *clears* them. `recordAttemptEvent` now stamps `pausedAt` on the 3-strike pause, and `resolveIntegrityReview`'s REINSTATE credits that duration back onto `expiresAt`.
- Corrected the `ExamCountdown` docstring to state plainly that it is a courtesy display, not an enforcement mechanism.

Also fixed in passing: `finalizeAttempt()` now claims the status transition with a conditional `updateMany` instead of read-then-write, so two concurrent submissions produce exactly one `Submission` row (partially addresses audit finding A-03).

### Regression Test
`src/lib/__tests__/attempt-expiry.test.ts` — 9 tests. The headline case is the exact scenario reproduced above: a late `saveAnswers` must throw `AttemptExpiredError`, the answer must not land, and the attempt must not be left `IN_PROGRESS`. Also covers the `expiresAt`-over-derived precedence, the legacy-row fallback, the strict boundary (expired *after* the deadline, not on it), paused-time credit on reinstatement, and the concurrent-submit guard.

**General lesson: when a comment claims a security control exists, verify the control, not the comment.** This gap sat inside a fully green suite (139/139 unit, 7/7 E2E) because nothing tested for it — a passing suite only proves the things it actually asserts.

### Status
RESOLVED

---

## ERROR-010

### Symptom
Immediately after the ERROR-009 migration, the student exam-taking E2E test failed at the proctor-approval → navigation step, in isolation and with a single worker (so not the parallel-contention flake seen earlier in the same session). Unit tests covering the same function all passed.

### Root Cause
Not a code defect. The `next dev` server had been running since **before** the migration, so it held a stale in-memory Prisma client with no knowledge of the new columns — `PrismaClientValidationError: Unknown argument 'expiresAt'`. Vitest passed because it spawns fresh processes that load the regenerated client. Playwright's `reuseExistingServer: true` attached to the stale server instead of starting a fresh one.

### Fix
Restarted the dev server. All 7 E2E tests then passed, including the failing one.

### Regression Test
None warranted — this is an environment/tooling behaviour, not application logic. **General lesson: after any `prisma migrate`, restart any long-running `next dev` process before trusting an E2E result. `reuseExistingServer: true` will silently reuse a server running against a stale client, and the resulting failure looks exactly like an application bug.**

### Status
RESOLVED

---

## ERROR-011

### Symptom
Deactivating a user did not end their session. `isActive` was checked once at login and never again, so an account deactivated mid-session kept full access until its JWT expired — up to **30 days**, since no explicit `maxAge` was set and Auth.js defaults to that. Role changes were equally stale: a demoted admin kept admin claims for the same window. Found during the world-class readiness audit (`docs/WORLD_CLASS_AUDIT.md` finding A-02).

The practical impact: "deactivate" is precisely the lever an institution reaches for during an incident — a student caught cheating mid-term, a faculty member who left, a compromised admin — and it did not do what its name implies.

### Root Cause
The session strategy is stateless JWT with no Prisma adapter (a deliberate architecture choice, see `docs/ARCHITECTURE_DECISIONS.md`). That means **there is no session table to delete from** — so revocation has to be enforced by re-checking the user on each request. The `jwt` callback only ever copied claims off the `user` object at initial sign-in:

```ts
jwt({ token, user }) {
  if (user) { token.role = user.role; token.institutionId = user.institutionId; }
  return token;   // no re-check of isActive, role, or tenant, ever
}
```

Nothing was wrong with the login path; the gap was that nothing revisited the decision afterward.

### Fix
- Added `User.sessionsValidAfter` (additive nullable migration) — a hard cutoff instant. Any session established before it is rejected on its next request.
- The `jwt` callback now revalidates against the database (at most once per 30s, to avoid a lookup on literally every request) and returns `null` — which invalidates the session — when the account is gone, inactive, or predates a forced cutoff. It also refreshes `role`/`institutionId`, so a demotion or tenant move takes effect without re-login.
- Explicit `session.maxAge` of **8 hours**, replacing the 30-day default. Long enough for a full exam day, short enough to bound a stolen token.
- `setUserActive(false)` and `resetUserPassword()` both stamp `sessionsValidAfter`, making revocation immediate rather than waiting for the 30s revalidation. Password reset revoking sessions matters most: if the reason for the reset is a compromised account, leaving the attacker's existing token working defeats the entire point.
- Reactivating a user clears the cutoff.
- `token.loginAt` records the original sign-in and is **never rewritten** — it is what `sessionsValidAfter` is compared against, so a rolling token refresh cannot slide it forward past a revocation.

The revocation *decision* was deliberately extracted into `src/lib/session-validity.ts` as a pure function rather than left inline in the framework callback, so it is unit-testable without standing up NextAuth. Every branch that cannot positively confirm a session is still good returns "revoke" — including a cutoff-bearing user whose token has no `loginAt` claim to compare against.

### Regression Test
`src/lib/__tests__/session-validity.test.ts` — 14 tests covering the pure decision logic (deactivated, deleted, no-subject, before/after cutoff, missing-loginAt) and the DB-level wiring (deactivation stamps a cutoff, reactivation clears it, password reset revokes prior sessions but permits a fresh login).

**General lesson: with a stateless JWT session, every authorization fact baked into the token is a snapshot that keeps being true until the token dies.** Anything an operator can change — active status, role, tenant — needs either a revalidation path or an explicit revocation marker. "We check it at login" is not the same as "we enforce it".

### Status
RESOLVED
