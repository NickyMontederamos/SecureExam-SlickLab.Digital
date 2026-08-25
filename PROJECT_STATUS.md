# Project Status — CM-Law SecureExam

## Current Phase
Phase 1 — Cloud SaaS Core (online-only examination management). See `docs/ARCHITECTURE.md` for the phased roadmap and why the offline Windows client is deferred to Phase 2.

## Overall Completion
~27-30%. Foundational slice plus a complete draft-to-published exam authoring flow (data model, tenant isolation, auth, RBAC, audit log, institution branding, question bank, exam builder) is built and genuinely tested. Exam-taking (the student side), grading, analytics, and the entire offline client are not started.

## Completed (each item below has a passing automated test or a live manual verification against the real local stack — see `docs/ARCHITECTURE.md` "What's verified")
- [x] Project rationale and master prompt captured (source docs).
- [x] Git repository initialized for this project (separate from ClaudeSlickAI).
- [x] Next.js 16 + TypeScript + Tailwind app scaffolded (`app/`).
- [x] Prisma schema for institutions/users/RBAC/courses/questions/exams/attempts/audit_logs, migrated against a real local Postgres (Docker Compose).
- [x] Tenant isolation enforced at the query layer via a Prisma Client Extension — **8/8 integration tests passing** against real Postgres, proving Tenant A cannot read/list/update/delete/create-into Tenant B's data through any code path.
- [x] Password hashing (bcrypt) — 3/3 unit tests passing.
- [x] RBAC permission matrix (role → resource → action) — 8/8 unit tests passing.
- [x] Auth (Auth.js v5, credentials + JWT session) — verified live: correct login succeeds, wrong password is rejected with a clear error, both outcomes write an audit log row.
- [x] Audit logging — verified live, real rows in Postgres for both login outcomes.
- [x] Institution branding (College of Maasin seal + College of Law crest + brand colors) rendered on login and dashboard — verified live in browser.
- [x] Question bank: create question + first version atomically, list questions for a course, correct-answer parsing from a simple choices form — **4/4 integration tests passing**, plus verified live end-to-end as faculty (form submit → row in Postgres with correct JSON).
- [x] Exam builder: create exam (DRAFT + immutable v1), add questions from the bank, publish — publishing freezes the version and refuses further edits, refuses publishing with zero questions, refuses cross-tenant exam access — **6/6 integration tests passing**, plus a full live run (create → add question → publish → confirmed in Postgres, edit form correctly disappears once published).
- [x] One working end-to-end page (`/dashboard`) proving the full stack: session → RBAC-aware role display → tenant-scoped Prisma query → rendered UI.
- [x] Seed script for a demo institution + admin/faculty/student users, now with real branding.
- [x] `npm run build`, `npm test`, `npx eslint .` all pass clean.

## In Progress
- Nothing actively in progress; next priority below.

## Blocked
- [ ] No confirmed engagement with the College of Maasin — College of Law yet. This build is speculative/pitch-stage. See `docs/ARCHITECTURE_DECISIONS.md` ADR-000.

## Critical Risks
- Building a full custom Windows lockdown/offline exam client (master prompt §12–19) is a multi-month, security-critical effort on its own. Deferred to Phase 2 — see ADR-002.
- No confirmed budget, timeline, or point of contact at the institution. Time invested past a pitch-ready demo is currently speculative.
- Anti-cheat/lockdown claims must never overstate what's achievable (master prompt §14 says this explicitly — agreed).

## Known Bugs
- None currently known. ERROR-001 (session.user.id missing, silently broke question creation) found via live browser testing and fixed same session — see `docs/ERROR_LOG.md`.

## Known Limitations (deliberate, not bugs)
- Exam versioning is single-version-per-exam in Phase 1: once published, a version is frozen and there is no "revise a published exam" flow yet (would create ExamVersion #2). Schema already supports it; the workflow doesn't exist yet. See `src/lib/exams.ts` doc comment.
- Publishing an exam is one-way in Phase 1 — no unpublish/archive action yet.

## Security Issues
- `deepmerge-ts` (transitive, via the `prisma` CLI dev dependency) has a known high-severity stack-exhaustion advisory. Dev-tooling-only exposure (not in the runtime/build artifact); tracked in `docs/DEPENDENCY_AUDIT.md`, no fix available upstream yet.
- Everything else in this slice (auth, tenant isolation, RBAC) has been built and tested but has NOT had a dedicated adversarial security review — treat as functionally correct, not yet security-audited.

## Test Status
- Unit tests: 11/11 passing (password hashing, RBAC matrix)
- Integration tests: 18/18 passing (8 tenant isolation + 4 question bank + 6 exam builder, all against real Postgres)
- E2E tests: 0 automated (login, question-creation, and exam-builder flows were verified manually via browser, not yet scripted as Playwright/Cypress tests)

## Last Validation
2026-08-25 — `npm run build` (pass), `npx eslint .` (pass, zero warnings), `npm test` (29/29 pass), manual browser verification of: login success/failure, tenant-scoped dashboard render, audit log rows, institution branding rendering, full question-creation flow, and the full exam-authoring flow (create draft exam → add a bank question → publish → verified in Postgres → confirmed edit UI correctly locks after publish). One real bug (ERROR-001) found and fixed earlier in this session, none found in this round.

## Next Priority
1. Student-facing exam-taking flow: student views a published exam, starts an `ExamAttempt`, answers questions, submits (master prompt §17-19) — this is the other half of the exam lifecycle and currently has zero UI.
2. Grading: auto-grade objective question types on submission, manual grading UI for essay/short-answer (master prompt §21).
3. Institution onboarding flow (SUPER_ADMIN/PLATFORM_ADMIN creates a new institution via `forPlatform()`) — currently only seedable via script.
4. Script the manually-verified flows (login, question creation, exam authoring) as automated E2E tests (Playwright) — worth prioritizing given ERROR-001 was only caught by live testing, not the type checker or unit tests.
5. Scope and price a pitch-ready demo cut of the above with the user before going further, given ADR-000's blocked item (no confirmed engagement yet).
