# Project Status — CM-Law SecureExam

## Current Phase
Phase 1 — Cloud SaaS Core (online-only examination management). See `docs/ARCHITECTURE.md` for the phased roadmap and why the offline Windows client is deferred to Phase 2.

## Overall Completion
~65-70% of the full master-prompt scope (which includes the offline Windows client, out of scope for Phase 1 — see ADR-002). Within Phase 1's own boundary, the **entire admin-to-result pipeline is now real, not just seeded**: SUPER_ADMIN onboards an institution → its admin creates courses and user accounts and builds a roster → faculty authors questions and exams → publishes → student takes the exam → auto-grade + manual grade → student sees result. One round of adversarial security testing done (rate limiting, cross-tenant attack simulation, security headers), and the golden path is now also covered by an automated Playwright E2E suite, not just manual verification.

## Completed (each item below has a passing automated test or a live manual verification against the real local stack — see `docs/ARCHITECTURE.md` "What's verified")
- [x] Next.js 16 + TypeScript + Tailwind app, PostgreSQL via Prisma 7 (Docker Compose locally).
- [x] Tenant isolation enforced at the query layer via a Prisma Client Extension, including `upsert` (added this round) — **11/11 integration tests passing**.
- [x] Password hashing, RBAC permission matrix, rate limiter — **14/14 unit tests passing**.
- [x] Auth (Auth.js v5), institution branding (real transparent-PNG logos + SlickLab.Digital credit).
- [x] Question bank, exam builder (immutable on publish) — **10/10 integration tests**, live-verified.
- [x] Student exam-taking + auto/manual grading — **8/8 integration tests**, two full live walkthroughs (auto-graded and manually-graded paths).
- [x] Security hardening: rate limiting, HTTP headers, a real cross-tenant attack simulation (six attempts, zero leaked) — see `docs/SECURITY.md`.
- [x] Institution onboarding (SUPER_ADMIN creates a new institution + its first admin) — **6/6 integration tests**, live-verified.
- [x] **Institution admin console**: an INSTITUTION_ADMIN can create courses, create user accounts (any non-platform role), and manage a course's roster (assign/unassign faculty, enroll/unenroll students) — all through real UI, not just the seed script. Edit a course's name/year, and delete a course *if and only if it has no questions or exams attached* (real academic records are never silently destroyable — the delete button doesn't even render otherwise, with an explanation of why). `src/lib/users.ts` + `src/lib/courses.ts` — **15/15 integration tests passing** (6 users, 9 courses incl. edit/delete/roster-removal), plus a full live walkthrough including the protected-delete case (tried deleting a course with real content, got refused with a clear reason instead of an error).
- [x] Also caught and fixed while building the admin console: the `tenant-db.ts` extension didn't handle `upsert` (needed for idempotent faculty/student assignment) — extended it with the same rigor as create/update, 3 new tenant-isolation tests. And: the grading page rendered an editable grade form for INSTITUTION_ADMIN (who can *view* grades but not *assign* them per rbac.ts) — clicking "Save grade" would have thrown an unhandled `ForbiddenError`. Found by walking through the admin's actual permissions before writing a test guide, not by a user report. Fixed — read-only status for roles that can't grade.
- [x] Real transparent-background institution logos + SlickLab.Digital credit; app background now stays white regardless of OS/browser dark-mode setting (was following `prefers-color-scheme`, which is why it went dark for one tester).
- [x] **User lifecycle**: activate/deactivate (blocks login, enforced at the auth layer, verified live) and admin-initiated password reset (there's still no self-service email reset flow — see DEPLOYMENT.md). No hard user deletion, deliberately — same academic-records reasoning as course deletion.
- [x] **CSV question bank import** (`src/lib/question-import.ts`): faculty upload a CSV against a fixed, documented template (downloadable from the question bank page) instead of typing questions one at a time. All-or-nothing — if any row is invalid, nothing is imported and the exact row/reason is shown; no partial-garbage imports. **16/16 tests** (12 pure-parser unit tests covering every validation rule, 4 integration tests against real Postgres incl. atomicity and cross-tenant refusal), **plus 2 new Playwright E2E tests that upload a real file through a real browser** — the one interaction this session's other verification tooling (the Browser pane) structurally can't drive, since it can't operate a native file picker.
- [x] Playwright E2E suite (`npm run test:e2e`, 4 tests): the golden path (author → publish → take → auto-grade) plus CSV import (valid file succeeds, invalid file is rejected cleanly). Caught and fixed a real race condition in the test itself (ERROR-003) — the kind of bug class manual testing alone (ERROR-001, ERROR-002) had already shown this project needs automated coverage for.
- [x] **Bulk exam-building** — found live: adding questions to an exam one dropdown-pick at a time doesn't scale once the bank has 50 questions in it (confirmed live: a real 50-question CSV import, then 29 manual one-by-one adds). Added `addExamQuestions` (checkbox multi-select, each question at its own default points) and extended `importQuestionsFromCsv` with an optional `examId` so a CSV upload can create the questions in the reusable course bank *and* attach all of them to one exam in the same atomic transaction — for the common case of "this file is for this exam" without losing the bank's reusability across other exams. 8 new tests (2 exams.test.ts, 2 question-import-db.test.ts w/ atomicity-on-refusal), plus live verification: bulk-checked 2 questions into the user's real 29-question exam, both landed at their own default points and the exam UI updated to 31 correctly.
- [x] Full documentation set per master prompt §33: ARCHITECTURE.md, ARCHITECTURE_DECISIONS.md, SECURITY.md, DATABASE.md, API.md, DEPLOYMENT.md, TESTING.md, ERROR_LOG.md, DEPENDENCY_AUDIT.md.
- [x] `npm run build`, `npm test` (85/85), `npx eslint .` all pass clean.

## In Progress
- Nothing actively in progress; next priority below.

## Blocked
- [ ] No confirmed engagement with the College of Maasin — College of Law yet. This build is speculative/pitch-stage. See `docs/ARCHITECTURE_DECISIONS.md` ADR-000.

## Critical Risks
- Building a full custom Windows lockdown/offline exam client (master prompt §12–19) is a multi-month, security-critical effort on its own. Deferred to Phase 2 — see ADR-002.
- No confirmed budget, timeline, or point of contact at the institution. Time invested past a pitch-ready demo is currently speculative.
- Anti-cheat/lockdown claims must never overstate what's achievable (master prompt §14 says this explicitly — agreed).

## Known Bugs
- None currently known. ERROR-001, ERROR-002, ERROR-003 found via live/automated testing and fixed same session — see `docs/ERROR_LOG.md`.

## Known Limitations (deliberate, not bugs)
- Exam versioning is single-version-per-exam in Phase 1: once published, no "revise a published exam" flow yet. Schema supports it; the workflow doesn't exist yet.
- Publishing an exam is one-way in Phase 1 — no unpublish/archive action.
- No retake policy — a student gets exactly one attempt, ever, once started.
- Timer enforcement is checked on page load / save / submit, not via a live client-side countdown or a background job.
- Objective auto-grading is full-credit-or-nothing (no partial credit for multi-select).
- User management has no bulk invite/CSV import — one account at a time via `/users`.
- No offline capability, encryption, device binding, or lockdown — that's the entirety of Phase 2 (master prompt §12–14), not built.

## Security Issues
- `deepmerge-ts` (transitive, via the `prisma` CLI dev dependency) has a known high-severity stack-exhaustion advisory. Dev-tooling-only exposure; tracked in `docs/DEPENDENCY_AUDIT.md`.
- No Content-Security-Policy yet (needs nonce-based middleware wiring to do correctly with Next.js — see `docs/SECURITY.md`).
- Rate limiter is in-memory/per-process — fine for Phase 1's single instance, would need a shared store (Redis) before a multi-instance production deployment.
- No MFA, no password reset flow.
- This slice has had one round of adversarial testing by the same session that built it — a second set of eyes (human review, or a separate audit pass) is still warranted before any real deployment. Full posture documented in `docs/SECURITY.md`.

## Test Status
- Unit tests: 26/26 passing (password, RBAC, rate limiter, CSV parser)
- Integration tests: 55/55 passing (11 tenant isolation + 4 question bank + 6 exam builder + 8 attempts/grading + 6 institution onboarding + 7 users + 9 courses + 4 CSV import, all against real Postgres)
- E2E tests: 4/4 passing (Playwright — golden path: author/publish/take/auto-grade; CSV import: valid file succeeds, invalid file rejected cleanly)

## Last Validation
2026-08-25 (AppHeader + BrandCredit pass) — `npm run build` (pass), `npx eslint .` (pass), `npm test` (85/85 pass), `npm run test:e2e` (4/4 pass), plus a live browser walkthrough: login → dashboard → a course's manage page (three levels deep), confirming the header (branding + name/role + sign-out) and the corner credit both render and don't block interaction.

2026-08-25 (bulk-exam-building session) — `npm run build` (pass), `npx eslint .` (pass), `npm test` (81/81 pass), `npm run test:e2e` (4/4 pass), plus live browser walkthroughs of: the complete exam lifecycle (both grading paths), a rate-limit test, a cross-tenant attack simulation, institution onboarding, the full admin console including edit/delete/roster-removal and user activate/deactivate/password-reset (all verified live). Three real bugs found and fixed this session (ERROR-001, ERROR-002, ERROR-003), plus a fourth caught before any user hit it (the admin grading-page ForbiddenError) — all found by actually running the thing, none by the type checker or a passing build alone.

## Next Priority
1. Content-Security-Policy via nonce-based middleware (deferred — see `docs/SECURITY.md`).
2. Expand the Playwright E2E suite beyond the one golden-path spec (institution onboarding, admin console, essay grading path).
3. Basic analytics (score distributions, per-question difficulty) — master prompt §22, not started.
4. Scope and price a pitch-ready demo cut of the above with the user, given ADR-000's blocked item (no confirmed engagement yet).

## Recently Completed — see `NEXT_PHASE_PLAN.md` for full rationale
- [x] **Shared `<AppHeader />`**: every authenticated route (dashboard, courses, exams, attempts, admin, users) now sits under a `src/app/(app)/` route group with one header — institution seal+crest+name top-left, current user's name/role + sign-out top-right. `/login` sits outside the group, unchanged. Previously only `/dashboard` and `/admin` had any sign-out control at all; a user three clicks deep had none.
- [x] **Ownership credit, scoped down from the original "for-sale watermark" ask**: rather than a tiled "FOR SALE" overlay on every screen (including the exam-taking view), shipped a small fixed-corner `<BrandCredit />` ("Built by SlickLab.Digital", reusing the existing `slicklab-digital-watermark.png`) — promoted from login-only to site-wide. Rationale: a loud ownership overlay in front of a prospective institutional client undercuts the same pitch it's meant to protect; see `NEXT_PHASE_PLAN.md` Ask 1 for the full discussion. Toggleable via `NEXT_PUBLIC_SHOW_BRAND_CREDIT=false`.
- [x] `npm run build`, `npx eslint .`, `npm test` (85/85), `npm run test:e2e` (4/4) all pass after the restructuring; live-verified login → dashboard → three-levels-deep course page with the header and credit both present and non-blocking.
