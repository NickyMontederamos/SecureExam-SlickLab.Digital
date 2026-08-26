# CM-Law SecureExam

See `docs/PITCH_ROADMAP.md` for the active plan and milestone history, `docs/ARCHITECTURE_DECISIONS.md`
for ADRs, and `docs/ERROR_LOG.md` for genuine app-logic bugs found and fixed during development.

## CI Commands
- Install: `npm install` (run from `app/`)
- Test: `npm test` (vitest against real Postgres via Docker Compose — see `docker-compose.yml`)
- Lint: `npx eslint .`
- Typecheck: `npx tsc --noEmit`
- Build: `npm run build`
- E2E: `npx playwright test` (fixed to `localhost:3010`, reuses an already-running dev server — see `playwright.config.ts`)
- Seed demo data: `npm run seed`

All commands run from `app/` (the Next.js project root), not the repo root.

## Project Memory
- `SOLUTIONS_LOG.md` (repo root, created on first use) — durable log of non-obvious fixes and
  architecture decisions from CI-refinement passes, written by the `solutions-log` skill.
- `docs/ERROR_LOG.md` — curated log of real app-logic bugs found during manual/live testing.
  Keep these two logs distinct: `ERROR_LOG.md` is for bugs a human found by using the app;
  `SOLUTIONS_LOG.md` is for what an automated refinement cycle found and fixed.
- `app/.claude/ci-baseline.json` — test/lint/build baseline used to detect regressions (gitignored).

## Autonomy Guardrails

On-demand CI refinement passes run via the `bounded-refinement-loop` skill — **on-demand only**,
never scheduled/unattended for this project. Hard limits enforced by that skill regardless of how
it's invoked:

- No direct commits to `main`/`master` — work happens on `ci-refinement/<date>` branches.
- No force-push, no push to branches not created by the current run.
- No auto-merge — PRs open as **drafts** via `pr-description-sync` for human review.
  (Note: `gh` is not authenticated in this environment as of 2026-08-26 — run
  `gh auth login` before expecting a draft PR to actually open; until then, the loop
  will fix and commit to the branch but stop short of opening the PR and say so.)
- **Excluded from auto-fix — flag for human review instead, never change directly:**
  exam-integrity-critical code, meaning: authentication/authorization
  (`src/auth.ts`, `src/lib/rbac.ts`, `src/lib/tenant-db.ts`, `src/lib/courses.ts`'s
  `assertFacultyAssignedToCourse` and any `assertCan`/course-assignment guard call site),
  anti-cheat and the exam-taking path (`src/lib/attempts.ts`, `src/lib/integrity.ts`,
  `src/lib/proctoring.ts`, `src/components/ExamEntryGate.tsx`, `src/components/IntegrityMonitor.tsx`,
  `src/components/ExamCountdown.tsx`, `src/components/ExamToolbar.tsx`,
  `src/components/ExamQuestionPager.tsx`), grading/scoring (`src/lib/grading.ts`), and
  credentials (`src/lib/password.ts`, `src/lib/rate-limit.ts`). Also never touch
  `prisma/schema.prisma` or run a migration without explicit sign-off.
- No changes to CI/CD pipeline config, secrets, credentials, or security-sensitive dependency
  versions without explicit sign-off.
- Diff size capped at roughly 200 changed lines per cycle; larger fixes stop and get logged
  for human review instead.

To run a pass: ask for "run refinement cycle" or "ci refinement pass" (triggers
`bounded-refinement-loop`). It runs once and reports — it does not loop on its own.
