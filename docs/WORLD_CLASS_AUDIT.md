# SecureExam — World-Class Readiness Audit

**Audit date:** 2026-08-26
**Audited commit:** `e1d7580` (master)
**Scope:** Phase 1 cloud SaaS. Phase 2 native lockdown client is architecture-only and explicitly out of scope (ADR-002).
**Method:** Full repository read + validation suite execution + targeted source tracing of security-critical paths. Every finding below cites the file/line evidence it came from. Nothing here is inferred from documentation claims — several documentation claims turned out to be wrong, which is itself finding **A-08**.

---

## 0. Baseline validation (executed, not assumed)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0) |
| `npx eslint .` | **PASS** (exit 0) |
| `npm test` | **PASS** — 139/139, 17 files |
| `npm run build` | **PASS** — 20 routes compile |
| `npx playwright test` | **PASS** — 7/7 |
| `npm audit --omit=dev` | **3 high** (all `deepmerge-ts` via Prisma CLI) |

The tree is green. **A green suite is not the same as production readiness** — every P0 below exists in a fully passing codebase, because nothing currently tests for them.

> Note: an earlier external assessment of this repo cited "85 automated tests." That was accurate at commit `300b990` and is now stale — the current figure is 139 unit/integration + 7 E2E.

---

## 1. Maturity score

### **62 / 100** — "Strong Phase 1 product, not yet production infrastructure for high-stakes assessment."

| Dimension | Score | One-line justification |
|---|---:|---|
| Architecture | 8/10 | Layered, small domain services, no god-routes. Already matches the target architecture. |
| Tenant isolation | 9/10 | Enforced at the query layer, not per-route. Best thing in the codebase. |
| Authorization | 7/10 | Explicit matrix + per-course assignment guard. Not yet exhaustively test-covered. |
| Testing | 8/10 | 139 tests against real Postgres, not mocks. Genuine regression resistance. |
| **Exam-state integrity** | **4/10** | **Time limit is not server-enforced. Submit has a race window.** |
| **Security posture** | **5/10** | **No CSP. Sessions are not revocable.** Good headers/rate-limiting/hashing otherwise. |
| **Auditability** | **3/10** | Audit table + viewer exist; only `auth.login` ever writes to them. |
| Reliability / resilience | 4/10 | No offline tolerance, no retry queue, no idempotency keys. |
| Product depth | 5/10 | No analytics, retakes, partial credit, or outcome mapping. |
| Ops readiness | 3/10 | Single-instance rate limiter, no monitoring, no correlation IDs. |
| Documentation | 6/10 | Excellent in places, but actively drifted (see A-08). |

**Reading of the score:** this is *not* a weak codebase. The foundations — tenant isolation, RBAC, immutable published exams, academic-record protection — are better than most projects at this stage, and the architecture the upgrade brief asks for is largely *already here*. The score is held down by a small number of specific, fixable integrity gaps that matter disproportionately because this is exam software.

---

## 2. Verified strengths (do not regress these)

| # | Strength | Evidence |
|---|---|---|
| S-01 | **Tenant isolation is enforced at the query layer**, not per-route. `forTenant()` forces `institutionId` into every where/create/upsert and **refuses `findUnique` entirely** because it can't be safely scoped. Unhandled operations throw rather than silently running unscoped. | `src/lib/tenant-db.ts:58-116` |
| S-02 | **RBAC is explicit and non-inherited** — every role's full permission set is listed literally, so no role silently gains a permission via hierarchy. Server-side only, by deliberate design. | `src/lib/rbac.ts:25-79` |
| S-03 | **Per-course assignment is a real boundary**, not a UX filter. `assertFacultyAssignedToCourse` is wired into every course/exam/question read *and* mutation. | `src/lib/courses.ts:54-67` |
| S-04 | **Published exams are immutable snapshots** via `ExamVersion` + `ExamQuestion.questionVersionId` — editing a question later cannot retroactively alter a sat exam. | `prisma/schema.prisma:241-281` |
| S-05 | **Academic records are protected from deletion.** Course delete refuses if questions/exams exist; force-delete is admin-only and explicitly labelled destructive. | `src/lib/courses.ts:172-193` |
| S-06 | **Answer keys are stripped server-side** for students in the taking view — not hidden client-side. | `attempts.test.ts` "strips the answer key from the taking view" |
| S-07 | **Passwords are bcrypt-hashed at cost 12**; temp passwords from roster import are never persisted or logged in plaintext (read-once in-memory reveal). | `src/lib/password.ts`, `src/lib/roster-import.ts:96-120` |
| S-08 | **Tests run against real Postgres**, including cross-tenant refusal cases — not mocked repositories. | `src/lib/__tests__/*.test.ts` |
| S-09 | Baseline security headers present (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy). | `next.config.ts:9-15` |
| S-10 | Login rate limiting with audit-logged `DENIED` outcomes. | `src/lib/rate-limit.ts`, `src/auth.ts:41-50` |

---

## 3. Findings

Severity: **P0** = blocks any real high-stakes deployment · **P1** = blocks production · **P2** = product maturity · **P3** = differentiation

---

### ✅ A-01 (P0) — The exam time limit is not enforced on the server — **FIXED 2026-08-26**

> **Resolved.** Server-side enforcement added in `saveAnswers()` via a stored
> `expiresAt` deadline, with paused-review time credited back on
> reinstatement so the fix doesn't create a fairness regression. Regression
> suite: `src/lib/__tests__/attempt-expiry.test.ts` (9 tests). Full
> write-up in `docs/ERROR_LOG.md` ERROR-009. The original finding is
> preserved below as the record of what was wrong and how it was proven.

**This was the most serious finding in the audit.**

The countdown deadline *is* correctly derived server-side from `startedAt` on page load and is never trusted from the client:

```ts
// src/app/(app)/attempts/[attemptId]/page.tsx:138-140
const elapsedSeconds = attempt.startedAt ? Math.floor((now - attempt.startedAt.getTime()) / 1000) : 0;
const remainingSeconds = Math.max(0, timeLimitSeconds - elapsedSeconds);
const deadlineEpochMs = now + remainingSeconds * 1000;
```

But **no server-side write path checks that deadline.** Traced exhaustively:

- `saveAnswers()` guards `attempt.status !== "IN_PROGRESS"` — and nothing else. No expiry check. (`src/lib/attempts.ts`)
- `submitAttempt()` guards the same status — and nothing else. No expiry check. (`src/lib/attempts.ts:380-382`)
- `timeRemainingSeconds` is written **only** at attempt creation (`attempts.ts:110`, `:183`) and **never read again anywhere in the codebase**.
- `timeLimitMinutes` never appears in any enforcement branch — only in creation, display, and the page-load deadline calculation.

**Consequence:** the timer is a *courtesy UI*, not a control. A student who disables JavaScript, closes the tab before zero, or replays the save/submit request keeps full write access to their attempt indefinitely past the time limit. The auto-submit is a `document.getElementById(...).click()` in the browser — trivially preventable by the person it constrains.

**Empirically proven, not inferred.** A throwaway integration test was run against real Postgres: a **1-minute** exam, with `startedAt` backdated **2 hours** (exactly the state of a student who left the tab open or disabled JS), then a normal save + submit as that student:

```
===== A-01 EVIDENCE =====
time limit:             1 minute
elapsed when writing:   ~120 minutes
saveAnswers accepted:   true
submitAttempt accepted: true
final attempt status:   GRADED
points awarded:         1
=========================
```

The answer was accepted, the attempt was submitted, auto-graded, and awarded **full credit** — 119 minutes after the exam should have closed. The scratch test was deleted after capturing this; it is reproducible in minutes if needed for a fix's regression test.

**Aggravating factor:** `ExamCountdown.tsx`'s own docstring asserts the opposite —

> *"a stale client clock can only make this fire early/late by its own drift, never extend a student's time, since submitAttempt re-derives the deadline server-side regardless of what this component displays."*

That claim is **false as written**. A reviewer reading that comment would reasonably conclude the control exists. A wrong comment on a security control is worse than no comment, because it terminates the reviewer's investigation.

**Fix shape:** derive the deadline from `startedAt + timeLimitMinutes` inside both `saveAnswers` and `submitAttempt`; reject late writes and auto-finalise the attempt server-side. Add a background sweeper (or lazy-on-read finalisation) so an abandoned attempt still terminates. Correct the docstring. Regression test: save/submit after a simulated expiry must be refused.

---

### ✅ A-02 (P0) — Deactivating a user does not end their session — **FIXED 2026-08-26**

> **Resolved.** The `jwt` callback now revalidates against the database and
> returns null (invalidating the session) for a deleted, deactivated, or
> forcibly-revoked account, and refreshes role/tenant claims. Session
> `maxAge` cut from the 30-day default to 8 hours. `User.sessionsValidAfter`
> makes deactivation and password reset revoke existing sessions
> immediately. Regression suite:
> `src/lib/__tests__/session-validity.test.ts` (14 tests). Full write-up in
> `docs/ERROR_LOG.md` ERROR-011. Original finding preserved below.

`isActive` is checked in exactly one place — the login path:

```ts
// src/auth.ts:54
if (!user || !user.isActive) { ...deny... }
```

The `jwt()` callback never re-validates against the database:

```ts
// src/auth.ts — jwt callback
jwt({ token, user }) {
  if (user) { token.role = user.role; token.institutionId = user.institutionId; }
  return token;   // no re-check of isActive, role, or tenant
}
```

Session strategy is `"jwt"` with **no explicit `maxAge`**, so Auth.js's 30-day default applies.

**Consequence:** deactivation only prevents *future logins*. A user who is already signed in — the student caught cheating mid-term, the faculty member who left, the compromised admin account — retains full access for up to 30 days. "Deactivate" is precisely the lever an institution reaches for in an incident, and it currently does not do what its name implies. The same staleness applies to **role changes and tenant reassignment**: a demoted admin keeps admin claims until their token expires.

**Fix shape:** re-validate `isActive`/`role`/`institutionId` in the `jwt` callback on a short interval (or every request, given the low user count), set an explicit short `maxAge` with rolling refresh, and add a `sessionsValidAfter` timestamp on `User` for immediate mass revocation.

---

### 🟠 A-03 (P0/P1 boundary) — Submission has a check-then-act race window

`submitAttempt` reads the attempt, checks `status === "IN_PROGRESS"` in application code, then writes inside a transaction. There is no atomic guard — no `updateMany({ where: { status: "IN_PROGRESS" } })` gate, no optimistic-concurrency version column, no idempotency key.

Two concurrent submits (double-click, a retry, a flaky connection replay) can both observe `IN_PROGRESS` before either commits. Under the current single-instance deployment with Postgres default isolation this is narrow, but it is real, and it widens under load or multi-instance deployment.

**Consequence:** duplicate grading passes / duplicated submission side effects on the exact operation that must never be ambiguous.

**Fix shape:** make the status transition the atomic gate (conditional `updateMany` returning affected-count, treat 0 as "already submitted") and accept a client-supplied idempotency key on submit.

---

### 🟠 A-04 (P1) — No Content-Security-Policy

Confirmed absent: there is **no `middleware.ts`** anywhere in the app, and `next.config.ts` ships five security headers with CSP deliberately excluded.

The existing code comment is honest and correct about *why* it was deferred (a half-correct CSP is worse than none; Next.js needs nonce wiring). That reasoning was sound as a deferral — it is no longer sound as a permanent state for a platform handling exam content and credentials.

**Fix shape:** nonce-based CSP via middleware, `strict-dynamic`, no blanket `unsafe-inline`. Add a header-assertion test so it cannot silently regress.

---

### ✅ A-05 (P1) — The audit trail is built but almost entirely unwired — **FIXED 2026-08-26**

> **Resolved.** `logAudit()` is now called from every mutating domain
> service: exam publish/delete, grade assignment (with the previous value),
> proctor approve/verify/cancel, integrity-review decisions, user
> create/deactivate/password-reset, and roster import. Action names are
> centralised in `AUDIT_ACTIONS` so they stay filterable. Regression suite:
> `src/lib/__tests__/audit-coverage.test.ts` (6 tests), including an
> assertion that no password ever reaches the audit log. Original finding
> preserved below.

`AuditLog` is a well-designed, tenant-scoped, append-only-by-convention model (`schema.prisma:380-397`), and Milestone 6.7 shipped a filterable viewer at `/audit`. But a full call-site trace shows **`logAudit()` is called from exactly four places, all in `src/auth.ts`, all `auth.login`.**

Nothing writes an audit record for: exam publish, exam force-delete, grade assignment or modification, proctor approve/cancel/force-submit, integrity-review decisions, user create/deactivate/password-reset, roster CSV import (including bulk account creation), course create/update/delete, or institution onboarding.

**Consequence:** the one question an institution will ask after a disputed exam — *"who changed this grade, and when?"* — is currently unanswerable. The audit viewer shows logins and nothing else. This is a credibility gap as much as a technical one: the feature *looks* delivered.

**Fix shape:** an audit decorator/helper at the domain-service layer so coverage is structural rather than remembered per call site; assert coverage in tests for every mutating service.

---

### 🟡 A-06 (P1) — Rate limiter is per-process, in memory

`src/lib/rate-limit.ts` holds state in a module-level map. Correct and honest for a single instance; provides **zero** protection the moment a second instance or a serverless deployment exists, because each process has its own counter.

**Fix shape:** Redis or Postgres-backed counter before any horizontally-scaled deployment. Document the constraint in `DEPLOYMENT.md` as a hard gate.

---

### 🟡 A-07 (P1) — No self-service password reset, no MFA

Password reset is admin-initiated only (`resetUserPassword`). With Milestone 6.8's roster import now able to create dozens of accounts with generated temp passwords, the absence of a self-service reset path becomes an operational load-bearing problem, not just a missing convenience: every forgotten password routes through an administrator.

Note for whoever builds it: the reset flow must not disclose whether an email exists.

---

### 🟡 A-08 (P1) — Documentation has drifted from reality

`PROJECT_STATUS.md` is materially out of date and would mislead a reviewer, an auditor, or a buyer:

- Claims **"85/85"** tests and **"4/4"** E2E — actual: **139** and **7**.
- Lists as *not built* several things that shipped in Milestones 2–7: the 3-strike anti-cheat core, the real proctor workflow, the audit log viewer, roster CSV import, bulk user creation.
- "Next Priority" list is stale relative to `docs/PITCH_ROADMAP.md`, which *is* current.

Separately, `ExamCountdown.tsx`'s docstring documents a server-side control that does not exist (see A-01).

**Consequence:** the brief's own rule — *"Documentation must describe what actually exists"* — is currently violated. Two sources of truth disagree, and the stale one is the file named `PROJECT_STATUS`.

**Fix shape:** make `PITCH_ROADMAP.md` the single narrative source and reduce `PROJECT_STATUS.md` to a generated//short pointer, or fold them together. Add doc-freshness to the definition of done.

---

### 🟡 A-09 (P1) — Known dependency vulnerability

3 high-severity advisories, all `deepmerge-ts` reached via `@prisma/config` → `prisma`. Already tracked in `docs/DEPENDENCY_AUDIT.md`. Exposure is build/CLI tooling, not request-path, but it should not sit indefinitely — track the upstream Prisma release that clears it.

---

### 🔵 A-10 → A-14 (P2/P3) — Product depth gaps

These are **absences, not defects** — correctly scoped out of Phase 1, and all confirmed absent:

| ID | Gap | Note |
|---|---|---|
| A-10 | No analytics (score distribution, difficulty/discrimination index, pass rate) | Highest institutional-value gap. Schema already supports the queries. |
| A-11 | No retake/attempt policy — exactly one attempt, ever | `PROJECT_STATUS.md` documents this as deliberate. |
| A-12 | No partial credit on multi-select | Full-credit-or-nothing (`autoGradePoints`). |
| A-13 | No learning-outcome / competency mapping | `Question.learningObjectives` field exists and is unused — groundwork present. |
| A-14 | No offline/connection resilience — no local cache, retry queue, or idempotent replay | Compounds A-03. A dropped connection mid-exam currently risks answer loss. |

---

### ✅ Explicitly checked and **not** found (no action needed)

- No plaintext password storage anywhere.
- No committed secrets (`.env*` is gitignored).
- No client-side-only authorization — every domain function calls `assertCan` first.
- No answer-key leakage to students (server-side strip, test-covered).
- No destructive auto-migrations; six ordered migrations, all additive.
- No overclaiming of OS-level lockdown — ADR-002 and the roadmap are scrupulously honest that browser ≠ kiosk. **This is a genuine credibility asset; preserve it.**

---

## 4. Architecture assessment

The layered architecture the upgrade brief specifies is **already substantially implemented**:

```
Presentation      app/(app)/**  — server components, thin
      ↓
Application       server actions + 3 API routes
      ↓
Authorization     rbac.ts (assertCan) + courses.ts (assertFacultyAssignedToCourse)
      ↓
Domain services   lib/*.ts — 18 modules, largest 478 LOC, no god-objects
      ↓
Persistence       tenant-db.ts — Prisma extension, tenant scoping is structural
      ↓
PostgreSQL        17 models, 6 migrations, 25 indexes/uniques
```

Cross-cutting concerns present: security headers, rate limiting, RBAC, tenant scoping, validation, a design system. **Absent:** observability (no correlation IDs, no structured logging), feature flags, and — critically — audit as a cross-cutting concern rather than four hand-placed calls (A-05).

**Assessment:** the structure does not need rework. It needs the missing cross-cutting layers threaded through it, and the P0 integrity gaps closed. That is a far better position than most codebases at this maturity.

---

## 5. What I would tell an institutional buyer today

**Honest positioning:** this is a credible, well-architected Phase 1 assessment platform with unusually strong tenant isolation and genuine test discipline. It is ready to *demo*, and ready to *pilot* on low-stakes assessments.

**It is not yet ready to run a high-stakes, credit-bearing law examination**, for two specific and fixable reasons: the time limit is not enforced server-side (A-01), and deactivating a compromised account does not end its session (A-02). Both are days of work, not months.

Fixing A-01 through A-05 moves this from **62** to roughly **80** — the threshold where "we run real exams on this" becomes a defensible claim.

---

## 6. Recommended sequence

See **`docs/WORLD_CLASS_ROADMAP.md`** for the prioritised roadmap (P0–P4) derived from these findings.

The single most important sequencing rule: **A-01 and A-02 before any new feature work.** They are cheap to fix now and become expensive-to-impossible to retrofit credibly after an institution has run real exams on the platform.
