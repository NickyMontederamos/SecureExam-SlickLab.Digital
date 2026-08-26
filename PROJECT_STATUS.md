# Project Status — CM-Law SecureExam

> **This file is a pointer, not a second source of truth.**
>
> It used to duplicate the milestone narrative and drifted badly out of date —
> it claimed 85 tests when there were 139, and listed shipped features
> (the anti-cheat core, the proctor workflow, the audit viewer, roster
> import) as not-yet-built. That drift was itself finding **A-08** in
> `docs/WORLD_CLASS_AUDIT.md`. It is now deliberately thin, so there is
> little here left to go stale.
>
> **Canonical sources:**
> - `docs/PITCH_ROADMAP.md` — what has been built, milestone by milestone
> - `docs/WORLD_CLASS_AUDIT.md` — readiness assessment and open findings
> - `docs/WORLD_CLASS_ROADMAP.md` — prioritised P0–P4 plan
> - `docs/ERROR_LOG.md` — every real bug found, its root cause, its regression test

**Last updated:** 2026-08-26

---

## Current phase

Phase 1 — cloud SaaS. The Phase 2 native Windows lockdown client is
architecture-only and deliberately out of scope (ADR-002). The web app must
never claim OS-level lockdown.

## Where it stands

Audited 2026-08-26 at **62/100** readiness. All five **P0** findings from
that audit have since been fixed:

| ID | Finding | Status |
|---|---|---|
| A-01 | Exam time limit not enforced server-side | ✅ fixed (ERROR-009) |
| A-02 | Deactivation did not end an existing session | ✅ fixed (ERROR-011) |
| A-03 | Submission had a check-then-act race | ✅ fixed (atomic claim) |
| A-04 | No Content-Security-Policy | ✅ fixed (nonce-based) |
| A-05 | Audit trail built, but only `auth.login` wrote to it | ✅ fixed |

**Honest read:** that moves it from "strong Phase 1 product" toward
"defensible for real exams", but the audit's remaining **P1** items —
shared-store rate limiter, self-service password reset, MFA, observability,
exhaustive authorization tests — are still open, and they are what stand
between this and a production deployment. See `docs/WORLD_CLASS_ROADMAP.md`.

## Validation gates

Run all five before believing anything is done:

```bash
cd app
npx tsc --noEmit && npx eslint . && npm test && npm run build && npx playwright test
```

Current: **168/168** unit/integration, **11/11** E2E, clean typecheck, lint
and build.

> After any `prisma migrate`, restart a long-running `next dev` before
> trusting an E2E result — a stale in-memory Prisma client produces failures
> that look exactly like application bugs. See ERROR-010.

## Known limitations (deliberate, not defects)

- One attempt per exam, ever — no retake policy yet.
- Objective auto-grading is full-credit-or-nothing (no partial credit).
- No analytics, no learning-outcome mapping.
- No offline capability or connection resilience — a dropped connection
  mid-exam can still lose unsaved answers.
- Rate limiter is in-memory and per-process; correct for one instance only.
- No self-service password reset, no MFA.
- `style-src` still permits `unsafe-inline` (Tailwind v4 / next/font).

## Open security items

Tracked in `docs/WORLD_CLASS_AUDIT.md` — chiefly A-06 (rate-limiter store),
A-07 (password reset / MFA), and A-09 (the `deepmerge-ts` advisory reached
via the Prisma CLI; dev-tooling exposure, not request-path).

This slice has had adversarial review by the same sessions that built it. A
genuinely independent review is still warranted before any real deployment.
