# SecureExam — World-Class Roadmap

**Derived from:** `docs/WORLD_CLASS_AUDIT.md` (2026-08-26, commit `e1d7580`)
**Current maturity:** 62/100
**Target after P0+P1:** ~80/100 — "defensibly runs real high-stakes exams"

Priorities are ordered by **risk retired per unit of effort**, not by feature appeal.

---

## Sequencing principle

> **Close the integrity gaps before adding capability.**

A-01 (unenforced time limit) and A-02 (unrevocable sessions) are cheap to fix today and become *expensive and reputationally awkward* to fix after an institution has run graded exams on the platform. Every P0 item below is a correctness or trust issue in something the product already claims to do — not a new feature.

Second principle: **do not add features to a platform whose audit trail is empty.** A-05 gates institutional trust more than any analytics dashboard will.

---

## P0 — Integrity & security (before any new feature work)

| ID | Item | Audit ref | Est. | Risk if skipped |
|---|---|---|---:|---|
| P0-1 | **Server-enforce the exam time limit** in `saveAnswers` + `submitAttempt`; auto-finalise expired attempts; correct the false docstring in `ExamCountdown.tsx` | A-01 | M | Students can write past the deadline. The core promise of timed assessment is unenforced. |
| P0-2 | **Make sessions revocable** — re-validate `isActive`/`role`/`institutionId` in the `jwt` callback, explicit short `maxAge`, `sessionsValidAfter` for mass revocation | A-02 | M | Deactivation doesn't deactivate. Incident response has no working lever. |
| P0-3 | **Atomic submission** — conditional status transition + idempotency key | A-03 | S | Duplicate/ambiguous submissions on the one operation that must be exact. |
| P0-4 | **Nonce-based CSP** via middleware + header-assertion test | A-04 | M | XSS reaches a page holding exam content and session tokens. |
| P0-5 | **Audit coverage for every mutating domain service** — structural (decorator/helper), not per-call-site | A-05 | M | "Who changed this grade?" is unanswerable. Blocks institutional trust. |

**P0 exit criteria**
- [ ] Regression test: save + submit after simulated expiry are both refused
- [ ] Regression test: deactivated user's existing session is rejected on next request
- [ ] Regression test: concurrent double-submit produces exactly one submission
- [ ] Automated assertion that CSP header is present and nonce-based
- [ ] Every mutating service in `lib/` writes an audit record, asserted in tests
- [ ] Full gate green: `tsc` · `eslint` · `test` · `build` · `test:e2e`

---

## P1 — Production readiness

| ID | Item | Audit ref | Est. | Note |
|---|---|---|---:|---|
| P1-1 | **Shared-store rate limiter** (Redis/Postgres) | A-06 | S | Hard gate before any multi-instance deploy. |
| P1-2 | **Self-service password reset** — non-disclosing, token-based, expiring | A-07 | M | Load-bearing now that roster import creates accounts in bulk. |
| P1-3 | **Reconcile documentation with reality** — fold/regenerate `PROJECT_STATUS.md`, make `PITCH_ROADMAP.md` canonical | A-08 | S | Cheap. Currently two sources of truth disagree. |
| P1-4 | **Observability** — request correlation IDs, structured logs, never log secrets/PII/answer keys | — | M | Prerequisite for diagnosing a failed exam sitting. |
| P1-5 | **Expand E2E** — institution onboarding, admin console, essay grading, integrity escalation, tenant-isolation attack specs | — | M | Brief's Phase 17. Highest regression-resistance per hour. |
| P1-6 | **Authorization matrix tests** — every (role × resource × action) asserted, incl. IDOR and cross-tenant | — | M | Turns S-02/S-03 from "believed correct" into "proven correct". |
| P1-7 | **MFA architecture** (design + optional TOTP for admin roles) | A-07 | M | Design now, enforce for privileged roles first. |
| P1-8 | Clear the `deepmerge-ts` advisory when upstream Prisma allows | A-09 | XS | Track, don't force. |

---

## P2 — Institutional capability

| ID | Item | Audit ref | Est. | Note |
|---|---|---|---:|---|
| P2-1 | **Assessment analytics** — score distribution, mean/median/σ, pass rate, difficulty index, discrimination index, distractor performance | A-10 | L | **Highest institutional value in the roadmap.** Schema already supports the queries. Charts must have accessible tables beneath. |
| P2-2 | **Connection resilience** — local answer cache, sync queue, idempotent replay, reconnect recovery | A-14 | L | Depends on P0-3's idempotency keys. Prevents the worst-case UX: lost answers. |
| P2-3 | **Retake / attempt policy** — configurable limits, availability windows, grace periods | A-11 | M | Real academic workflows need more than one-attempt-ever. |
| P2-4 | **Partial credit** for multi-select + configurable scoring | A-12 | M | Must version cleanly — never retroactively alter a sat exam's scoring. |
| P2-5 | **Live proctor control center** — active students, status, elapsed time, integrity events; pause/resume/extend/force-submit, all RBAC-gated and audited | — | L | Extends the existing proctor queue. Justify any realtime transport before adding one. |
| P2-6 | **Reporting** — student/exam/class/course/integrity reports; PDF + CSV, server-side, authorization-checked | — | L | |
| P2-7 | **Question lifecycle** — DRAFT → REVIEW → APPROVED → PUBLISHED → RETIRED, with review metadata | — | M | |

---

## P3 — Differentiation

| ID | Item | Audit ref | Est. |
|---|---|---|---:|
| P3-1 | **Learning outcomes / competency engine** — map question → outcome → competency; student & class mastery, exam coverage | A-13 | L |
| P3-2 | **Integrity policy engine** — configurable severity thresholds and institution-set escalation rules; every automated decision auditable and reviewable | — | M |
| P3-3 | **Versioned API platform** (`/api/v1`), OpenAPI, pagination, idempotency, rate limits | — | L |
| P3-4 | **LMS / SSO integration architecture** (SAML/OIDC) + one reference implementation | — | L |
| P3-5 | Data-privacy program — classification, retention, export/deletion. *Do not claim legal compliance without an actual audit.* | — | M |

---

## P4 — Future innovation

| ID | Item | Est. | Hard constraint |
|---|---|---:|---|
| P4-1 | **Phase 2 native secure client** — Windows kiosk/lockdown, device binding, tamper detection | XL | **Must stay architecturally separate from the web SaaS.** The web app must never claim OS-level lockdown. |
| P4-2 | **Offline encrypted examination** — encrypted exam package, offline attempt, secure sync, server verification | XL | Use established cryptographic libraries and a written threat model. Never roll bespoke crypto. |
| P4-3 | **Responsible AI layer** — question generation assist, distractor analysis, outcome mapping suggestions | L | Human review mandatory for any high-impact decision. No silent AI grading of high-stakes essays. No AI cheating accusations. Provider-agnostic abstraction. |

---

## The one architectural line that must not blur

```
PHASE 1 — Cloud SaaS (this repo)         PHASE 2 — Native Secure Client
├─ browser-level integrity signals       ├─ OS-level kiosk lockdown
├─ server-authoritative exam state       ├─ offline encrypted delivery
├─ proctor workflow                      ├─ device binding
└─ honest about its limits               └─ tamper detection
```

The repository is currently **scrupulously honest** about this distinction (ADR-002, `PITCH_ROADMAP.md`, the integrity-event docstrings). Browser signals are treated as *signals*, not proof; the roadmap never claims kiosk behaviour from JavaScript.

**That honesty is a competitive asset, not a limitation.** It is the difference between a vendor an institution's IT department trusts and one it doesn't. Preserve it through every phase — including under pressure to make a pitch sound stronger.

---

## Definition of done (per milestone)

No milestone is complete until **all** of:

- [ ] `npx tsc --noEmit` clean
- [ ] `npx eslint .` clean
- [ ] `npm test` green
- [ ] `npm run build` clean
- [ ] `npx playwright test` green
- [ ] Security review question answered in writing: *what happens if the client lies, replays, or races this?*
- [ ] Tenant-isolation + authorization tests still pass
- [ ] Audit records written for any new mutating operation
- [ ] Documentation updated to match what actually shipped — **no aspirational documentation**
- [ ] `docs/ERROR_LOG.md` updated for any bug found; `SOLUTIONS_LOG.md` for any architectural discovery

---

## Explicitly rejected (for now)

Recorded so these read as decisions, not oversights:

- **Mass palette/design refactor** — Milestone 7 delivered the design system; a warm-neutral repaint is cosmetic and carries real regression risk for no trust gain.
- **Realtime (WebSocket) infrastructure** — not until P2-5 demonstrably needs it. Polling is pattern-consistent and adequate today.
- **Feature parity chasing** — per the brief's anti-feature-chaos rule, every item above answers *what problem, for whom, with what failure mode, tested how, audited how*.
- **Native lockdown inside the web app** — architecturally impossible to do honestly. Phase 2 or nothing.
