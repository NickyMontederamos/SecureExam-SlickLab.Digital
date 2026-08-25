# Project Status — CM-Law SecureExam

## Current Phase
Phase 1 — Cloud SaaS Core (online-only examination management). See `docs/ARCHITECTURE.md` for the phased roadmap and why the offline Windows client is deferred to Phase 2.

## Overall Completion
~45-50% of the full master-prompt scope (which includes the offline Windows client, out of scope for Phase 1 — see ADR-002). Within Phase 1's own boundary, the **complete exam lifecycle now works end-to-end**: institution → course → question bank → exam authoring → publish → student takes exam → auto-grade + manual grade → student sees result. Institution onboarding, analytics, and hardening/E2E automation are the remaining Phase 1 gaps.

## Completed (each item below has a passing automated test or a live manual verification against the real local stack — see `docs/ARCHITECTURE.md` "What's verified")
- [x] Project rationale and master prompt captured (source docs).
- [x] Git repository initialized for this project (separate from ClaudeSlickAI).
- [x] Next.js 16 + TypeScript + Tailwind app scaffolded (`app/`).
- [x] Prisma schema for institutions/users/RBAC/courses/questions/exams/attempts/grading/audit_logs, migrated against a real local Postgres (Docker Compose).
- [x] Tenant isolation enforced at the query layer via a Prisma Client Extension — **8/8 integration tests passing** against real Postgres.
- [x] Password hashing (bcrypt) — 3/3 unit tests passing.
- [x] RBAC permission matrix (role → resource → action) — 8/8 unit tests passing.
- [x] Auth (Auth.js v5, credentials + JWT session) — verified live, including audit logging of both outcomes.
- [x] Institution branding rendered on login and dashboard — verified live in browser.
- [x] Question bank — **4/4 integration tests passing**, plus verified live end-to-end as faculty.
- [x] Exam builder (create/add-questions/publish, immutable on publish) — **6/6 integration tests passing**, plus a full live run.
- [x] Role-appropriate dashboard course listing (students see enrollments, faculty see courses taught, admin sees everything).
- [x] **Student exam-taking**: start (enforces enrollment + published-only + no retakes), answer with auto-save, server-authorized timer (auto-submits on expiry, checked on load), submit. Answer key is stripped from every student-facing view — verified structurally via test, not just by omission in the UI.
- [x] **Grading**: objective questions (MC/MR/TF) auto-graded full-credit-or-nothing on submit; essay/short-answer queued for manual grading; attempt transitions SUBMITTED → GRADED automatically once every answer has a grade; grades are clamped to each question's max points.
- [x] **Faculty grading UI**: per-exam submission queue, per-answer grading form.
- [x] All of the above — **8/8 new integration tests** (`attempts.test.ts`) — **plus a full live walkthrough covering both grading paths**: (a) an MC-only exam that auto-grades straight to GRADED, and (b) an essay exam that stays SUBMITTED until a faculty member grades it through the UI, confirmed the student's result page updates correctly after.
- [x] `npm run build`, `npm test` (37/37), `npx eslint .` all pass clean.

## In Progress
- Nothing actively in progress; next priority below.

## Blocked
- [ ] No confirmed engagement with the College of Maasin — College of Law yet. This build is speculative/pitch-stage. See `docs/ARCHITECTURE_DECISIONS.md` ADR-000.

## Critical Risks
- Building a full custom Windows lockdown/offline exam client (master prompt §12–19) is a multi-month, security-critical effort on its own. Deferred to Phase 2 — see ADR-002.
- No confirmed budget, timeline, or point of contact at the institution. Time invested past a pitch-ready demo is currently speculative.
- Anti-cheat/lockdown claims must never overstate what's achievable (master prompt §14 says this explicitly — agreed).

## Known Bugs
- None currently known. ERROR-001 and ERROR-002 found via live testing and fixed same session — see `docs/ERROR_LOG.md`.

## Known Limitations (deliberate, not bugs)
- Exam versioning is single-version-per-exam in Phase 1: once published, no "revise a published exam" flow yet. Schema supports it; the workflow doesn't exist yet.
- Publishing an exam is one-way in Phase 1 — no unpublish/archive action.
- No retake policy — a student gets exactly one attempt, ever, once started.
- Timer enforcement is checked on page load / save / submit, not via a live client-side countdown or a background job — a student who starts an exam and never returns to the tab won't be auto-submitted until *something* hits the server again. Server-authorized (can't be beaten by client clock tampering), but not proactive. Documented in `src/app/attempts/[attemptId]/page.tsx`.
- Objective auto-grading is full-credit-or-nothing (no partial credit for multi-select).
- No offline capability, encryption, device binding, or lockdown — that's the entirety of Phase 2 (master prompt §12–14), not built.

## Security Issues
- `deepmerge-ts` (transitive, via the `prisma` CLI dev dependency) has a known high-severity stack-exhaustion advisory. Dev-tooling-only exposure; tracked in `docs/DEPENDENCY_AUDIT.md`.
- This slice (auth, tenant isolation, RBAC, grading) has been built and tested but has NOT had a dedicated adversarial security review — treat as functionally correct, not yet security-audited. A real security pass (rate limiting, security headers, dependency scanning, an actual attempted-attack round per master prompt §35 Round 5) is still on the roadmap.

## Test Status
- Unit tests: 11/11 passing (password hashing, RBAC matrix)
- Integration tests: 26/26 passing (8 tenant isolation + 4 question bank + 6 exam builder + 8 attempts/grading, all against real Postgres)
- E2E tests: 0 automated — every flow above (login, question creation, exam authoring, student exam-taking, both grading paths) was verified manually via browser against the real dev server and database, not yet scripted as Playwright tests

## Last Validation
2026-08-25 — `npm run build` (pass), `npx eslint .` (pass, zero warnings), `npm test` (37/37 pass), manual browser walkthrough of the complete exam lifecycle twice (once auto-graded, once manually graded), confirmed against Postgres at each step. Two real bugs found and fixed during this session's live verification (ERROR-001: missing session.user.id; ERROR-002: stale Prisma client in the running dev server after a schema migration) — neither would have been caught by the build or test suite alone.

## Next Priority
1. Institution onboarding flow (SUPER_ADMIN/PLATFORM_ADMIN creates a new institution) — currently only seedable via script; needed before this could plausibly onboard a second institution.
2. Security hardening pass: rate limiting on login, security headers (CSP, etc.), a dependency vulnerability scan, and a deliberate attempted-attack round (unauthorized access, tenant crossover, IDOR probing) per master prompt §35 Round 5 — everything so far has been built and functionally tested but not adversarially tested.
3. Script the manually-verified flows as automated E2E tests (Playwright) — worth prioritizing given two real bugs were only caught by live testing.
4. Remaining documentation set per master prompt §33 (SECURITY.md, API.md, DATABASE.md, DEPLOYMENT.md, TESTING.md).
5. Basic analytics (score distributions, per-question difficulty) — master prompt §22, not started.
6. Scope and price a pitch-ready demo cut of the above with the user, given ADR-000's blocked item (no confirmed engagement yet).
