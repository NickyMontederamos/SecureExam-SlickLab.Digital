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
