# Project Status — CM-Law SecureExam

## Current Phase
Phase 1 — Cloud SaaS Core (online-only examination management). See `docs/ARCHITECTURE.md` for the phased roadmap and why the offline Windows client is deferred to Phase 2.

## Overall Completion
~10-12%. Foundational slice (data model, tenant isolation, auth, RBAC, audit log, one working end-to-end page) is built and genuinely tested. Everything else in the master prompt (question banks, exam builder, exam-taking, grading, analytics, offline client) is not started.

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
- [x] One working end-to-end page (`/dashboard`) proving the full stack: session → RBAC-aware role display → tenant-scoped Prisma query → rendered UI.
- [x] Seed script for a demo institution + admin/faculty/student users.
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
- None currently known.

## Security Issues
- `deepmerge-ts` (transitive, via the `prisma` CLI dev dependency) has a known high-severity stack-exhaustion advisory. Dev-tooling-only exposure (not in the runtime/build artifact); tracked in `docs/DEPENDENCY_AUDIT.md`, no fix available upstream yet.
- Everything else in this slice (auth, tenant isolation, RBAC) has been built and tested but has NOT had a dedicated adversarial security review — treat as functionally correct, not yet security-audited.

## Test Status
- Unit tests: 11/11 passing (password hashing, RBAC matrix)
- Integration tests: 8/8 passing (tenant isolation, against real Postgres)
- E2E tests: 0 automated (login flow was verified manually via browser, not yet scripted as a Playwright/Cypress test)

## Last Validation
2026-08-25 — `npm run build` (pass), `npx eslint .` (pass, zero warnings), `npm test` (19/19 pass), manual browser verification of login success + login failure + tenant-scoped dashboard render + audit log rows in Postgres.

## Next Priority
1. Institution onboarding flow (SUPER_ADMIN/PLATFORM_ADMIN creates a new institution via `forPlatform()`) — currently only seedable via script.
2. Question bank CRUD (create/edit/list questions with versioning) scoped to FACULTY within their courses.
3. Exam builder: create exam → immutable versions → publish (master prompt §11).
4. Script the manually-verified login flow as an automated E2E test (Playwright) so it stops depending on manual browser checks.
5. Scope and price a pitch-ready demo cut of the above with the user before going further, given ADR-000's blocked item (no confirmed engagement yet).
