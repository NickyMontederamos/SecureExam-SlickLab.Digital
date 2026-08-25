# API — CM-Law SecureExam

Most of this app's "API" is Next.js Server Actions (RPC-style functions
called directly from a `<form action={...}>`, not REST endpoints) — that's
a deliberate Phase 1 choice (see ADR-001) since there's exactly one
frontend consumer. A small number of REST `route.ts` handlers exist as a
worked example of the pattern for when a non-form consumer (Phase 2's
native client, eventually) needs one. Every entry below — action or route
— follows the same pipeline: **session → RBAC → tenant scope → validation
→ business logic**, per master prompt §23. None of it trusts client input
for authorization.

## Standard pipeline

1. `const session = await auth()` — no session → refuse (401 for API routes, redirect to `/login` for pages/actions).
2. Role/permission check — either `assertCan(role, resource, action)` from `src/lib/rbac.ts` (throws `ForbiddenError`), or an explicit role check for platform-level operations (`src/lib/institutions.ts`).
3. All data access goes through `forTenant(institutionId)` (see `ARCHITECTURE.md`) — never a raw Prisma client.
4. Ownership checks where RBAC alone isn't enough (e.g. a student can only touch their *own* `ExamAttempt` — `AttemptOwnershipError`, independent of tenant scoping and RBAC).

Errors are typed exceptions (`ForbiddenError`, `CrossTenantAccessError`,
`AttemptNotFoundError`, etc.) rather than generic strings — callers can
`instanceof`-check and respond appropriately (redirect, 404, 403) instead
of pattern-matching error messages.

## REST routes

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/courses` | any authenticated user | `{ courses: [...] }` — all courses in the caller's tenant |
| GET | `/api/courses/:courseId/questions` | `question:read` (FACULTY/SUPER_ADMIN; STUDENT and INSTITUTION_ADMIN don't hold this) | `{ questions: [...] }` — tenant- and course-scoped |
| * | `/api/auth/[...nextauth]` | n/a | Auth.js internals (sign-in, session, CSRF) — not hand-written, see `src/auth.ts` |

Both hand-written routes return an empty array rather than an error for a
caller who's authenticated but has no visible data (e.g. a STUDENT hitting
`/api/courses/:courseId/questions`, or any tenant querying another
tenant's `courseId`) — see the cross-tenant attack simulation in
`SECURITY.md` for why an empty result, not an error, is the correct
non-leaking response.

## Server actions (by page)

| Page | Action | Does |
|---|---|---|
| `/login` | `authenticate` | Auth.js credentials sign-in; rate-limited, audit-logged both outcomes |
| `/dashboard`, `/admin` | `signOut` | Ends the session |
| `/courses/:id/questions` | `createQuestionAction` | `createQuestion()` — question + first version, atomic |
| `/courses/:id/exams` | `createExamAction` | `createExam()` — exam + first (DRAFT) version, atomic |
| `/exams/:id` | `addQuestionAction` | `addExamQuestion()` — refuses once published |
| `/exams/:id` | `publishAction` | `publishExam()` — refuses if empty, freezes the version |
| `/exams/:id` (student view) | `startAttemptAction` | `startAttempt()` — enforces enrollment, published-only, no-retake |
| `/attempts/:id` | `saveProgressAction` | `saveAnswers()` — bulk upsert, refuses if not the caller's own IN_PROGRESS attempt |
| `/attempts/:id` | `submitExamAction` | saves, then `submitAttempt()` — auto-grades objective questions, freezes the attempt |
| `/attempts/:id/grade` | `gradeAction` | `gradeAnswer()` — clamps to max points, flips the attempt to GRADED once everything's graded |
| `/admin` | `createInstitutionAction` | `createInstitution()` — SUPER_ADMIN/PLATFORM_ADMIN only |

## Validation

Currently inline per-action (trim strings, `Number()` coerce, enum-narrow
via TypeScript, reject empty required fields) rather than a schema
validation library — `zod` is already a dependency (installed during
scaffolding) but not yet wired into every action. Worth doing before a
real deployment: form data is user-controlled and today's coercion
(`Number(formData.get(...))`) will silently produce `NaN` for garbage
input rather than a clean validation error. Tracked in `PROJECT_STATUS.md`.
