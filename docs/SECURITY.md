# Security — CM-Law SecureExam (Phase 1)

Status as of this writing. Describes what's actually built and verified —
not aspirational. See `PROJECT_STATUS.md` for what's still open.

## Authentication
- Credentials (email + password) via Auth.js v5, bcrypt (12 salt rounds), JWT session strategy.
- Login is rate-limited: 5 failed attempts per email per 15-minute window, then refused regardless of correctness — verified live (see below), not just unit-tested.
- **Known gap:** the rate limiter is in-memory and per-process. Fine for Phase 1's single-instance deployment; a multi-instance production deployment needs a shared store (Redis) instead, or the limiter does nothing once there's more than one server behind a load balancer. See `src/lib/rate-limit.ts`.
- **Known gap:** no MFA. No password reset flow yet (an admin would need to update `passwordHash` directly via a script in Phase 1).

## Authorization
- Server-side only, everywhere. Every route/action calls `assertCan(role, resource, action)` (`src/lib/rbac.ts`) before touching data. There is no client-side authorization check anywhere — hiding a button is UX, not security, and this codebase doesn't rely on it.
- RBAC is tested: 8 unit tests covering every role/resource/action combination that matters.

## Tenant isolation
- Enforced at the Prisma query layer (`src/lib/tenant-db.ts`), not per-route — see `docs/ARCHITECTURE.md` for the mechanism.
- Verified two ways:
  1. **8 automated integration tests** against a real Postgres database proving Tenant A cannot read/list/update/delete/create-into Tenant B's data through the tenant-scoped client, for every relevant Prisma operation.
  2. **A live attack simulation** (this session): created a second institution with its own FACULTY user, logged in as that user, and attempted six direct cross-tenant accesses against real Tenant-A resource IDs — an exam detail page, its grading queue, an individual graded attempt, the questions API, the courses API, and the course-exams page. Every attempt returned either a 404 or an empty result; none leaked Tenant A's data. The throwaway attack-test tenant was deleted afterward.

## Exam integrity (Phase 1 scope — online only)
- The answer key (`QuestionVersion.correctAnswer`) is stripped from every student-facing view, verified by an automated test that inspects the actual object returned to a STUDENT actor (`attempts.test.ts`).
- A student can only ever act on their own attempt — ownership is checked independently of tenant scoping and RBAC (`AttemptOwnershipError`), tested against another student's attempt.
- One attempt per student per exam version (database-level unique constraint) — no retakes.
- Exam timing is server-authorized: remaining time is computed from `startedAt` + the exam's configured limit, recalculated on every request, never trusted from the client. **Known gap:** enforcement is checked on page load / save / submit, not via a live countdown or a background job — a student who starts an exam and abandons the tab won't be auto-submitted until something next hits the server for that attempt.
- Published exam versions are immutable — publishing refuses further edits (`ExamNotEditableError`), tested.

## HTTP security headers
Set globally via `next.config.ts`, verified live with `curl -I`:
- `X-Frame-Options: DENY` (exam pages must never be frameable — clickjacking risk)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`

**Known gap:** no Content-Security-Policy yet. Next.js's bootstrap scripts need either `'unsafe-inline'` (weak) or a nonce wired through middleware (correct, more setup) — a half-correct CSP was judged worse than none for this pass. Tracked in `PROJECT_STATUS.md`.

## Audit logging
- Append-only `AuditLog` table. Every login attempt (success, bad password, rate-limited, inactive account) is logged with WHO/WHAT/RESULT. Verified live — queried the actual rows out of Postgres after triggering each outcome, including the rate-limit case.
- **Known gap:** exam-specific audit events (publish, download, launch, interruption, focus loss, submission, grading, result modification — master prompt §20's full list) are not all wired up yet; only auth events are currently logged.

## Dependency scanning
- `npm audit`: 3 high-severity findings, all the same transitive `deepmerge-ts` stack-exhaustion advisory via the `prisma` CLI (dev-tooling only, not in the runtime/build artifact). No fix available upstream as of this writing. Tracked in `docs/DEPENDENCY_AUDIT.md`.
- Nothing found in application-runtime dependencies.

## Explicitly out of scope for Phase 1 (see ADR-000/ADR-002)
- Offline exam packages, encryption, digital signatures, device binding, replay protection for offline submission — the entirety of master prompt §12–14.
- A dedicated adversarial penetration test by someone other than the person who built the feature. Everything above was verified by the same session that built it — a second set of eyes (human or a separate review pass) is still warranted before any real deployment.
