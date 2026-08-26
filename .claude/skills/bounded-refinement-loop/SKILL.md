---
name: bounded-refinement-loop
description: Orchestrate one bounded cycle of test-run, regression-fix, and logging for a CI refinement pass on CM-Law SecureExam. On-demand only for this project — never invoke on a schedule. Trigger with "run refinement cycle", "ci refinement pass".
---

# bounded-refinement-loop

## Instructions
1. Run `ci-baseline-guard` first. If no regressions and no failing tests, report "clean" and stop — do not invent work.
2. If regressions exist, fix at most 3 per cycle, in order of: (a) regressions with a clear, localized root cause, (b) regressions blocking other tests, (c) everything else. Skip anything requiring a schema/API/dependency change without explicit user sign-off first.
3. Hard cap: 5 fix attempts per regression. If unresolved after 5 attempts, stop working that issue, log it via `solutions-log` as "unresolved — needs human input" with what was tried and why it didn't work, and move on. Never loop indefinitely on a single failure.
4. After each fix, re-run only the affected test(s) to confirm before moving to the next regression — don't batch unverified fixes.
5. **Excluded from auto-fix — flag for human review instead, never change directly.** This project is a secure exam platform; a "small fix" in the wrong file is a security or integrity bug, not a refactor. Never modify:
   - Authentication/authorization: `app/src/auth.ts`, `app/src/lib/rbac.ts`, `app/src/lib/tenant-db.ts`, `app/src/lib/courses.ts`'s `assertFacultyAssignedToCourse` and any other `assertCan`/course-assignment guard call site (in `exams.ts`, `questions.ts`, `grading.ts`, etc. — the guard call itself, not unrelated code in the same file).
   - Anti-cheat and the exam-taking path: `app/src/lib/attempts.ts`, `app/src/lib/integrity.ts`, `app/src/lib/proctoring.ts`, `app/src/components/ExamEntryGate.tsx`, `app/src/components/IntegrityMonitor.tsx`, `app/src/components/ExamCountdown.tsx`, `app/src/components/ExamToolbar.tsx`, `app/src/components/ExamQuestionPager.tsx`.
   - Grading/scoring: `app/src/lib/grading.ts`.
   - Credentials: `app/src/lib/password.ts`, `app/src/lib/rate-limit.ts`.
   - Schema/migrations: `app/prisma/schema.prisma` and anything under `app/prisma/migrations/`.
   If a regression's only fix touches one of these, stop, log it via `solutions-log` as "needs human sign-off — touches exam-integrity-critical code", describe the fix you'd make, and move on without applying it.
6. Hard limits, non-negotiable regardless of how this skill is invoked:
   - Never commit directly to main/master. Work on a branch named `ci-refinement/<date>`.
   - Never force-push, never push to a branch you didn't create this run.
   - Never auto-merge a PR.
   - Never touch CI/CD pipeline config, secrets, credentials, or dependency versions with security implications without explicit user confirmation first.
   - Cap total diff size per cycle at roughly 200 changed lines; if a fix needs more than that, stop, log why, and leave it for human review rather than pushing a large autonomous change.
7. At the end of the cycle: run `solutions-log` for anything fixed, then hand off to `pr-description-sync` if there are committed changes on the branch. `gh` may not be authenticated in this environment — if `pr-description-sync` reports it can't open a PR for that reason, that's expected, not a failure of this skill; still report the branch name and what's on it so the user can open the PR themselves. Report a summary: regressions found, fixed, flagged-for-human, unresolved, and the branch name.
8. This project runs this skill **on-demand only** — there is no scheduled/unattended invocation to support here. If asked to schedule this, say that's not set up for this project and point back to the on-demand trigger phrases above.
9. "Self-upgrade" in this loop means: after a cycle, reflect on what worked/what didn't in `solutions-log`, and if a real friction point was found, propose and draft a new project skill to address it — not autonomous goal generation. Only add a new skill when a concrete, observed friction point motivates it; don't invent skills speculatively.
