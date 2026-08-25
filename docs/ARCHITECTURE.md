# Architecture — CM-Law SecureExam

## Phased roadmap (see ADR-000)

- **Phase 1 — Cloud SaaS core (this repo, in progress).** Institutions, users, RBAC, courses, question banks, exam builder/versioning, online-only delivery, grading, audit log. No native client. Good enough to demo and to run real online (non-lockdown) exams.
- **Phase 2 — Offline-capable secure exam client.** Native Windows app (tech choice deferred, see ADR-002), encrypted offline exam packages, auto-save, crash recovery, device binding. Only starts once there's a confirmed institutional engagement — it's the highest-risk, highest-effort subsystem and shouldn't be built speculatively.
- **Phase 3 — Multi-tenant hardening & commercialization.** Cross-tenant automated pen-testing, analytics, billing, onboarding self-serve flow for additional institutions.

## Phase 1 stack

- **App:** Next.js 16 (App Router) + TypeScript + Tailwind, single deployable (ADR-001).
- **Database:** PostgreSQL via Prisma 7 + `@prisma/adapter-pg` driver adapter (ADR-003).
- **Auth:** Auth.js (NextAuth v5), Credentials provider, bcrypt password hashing, JWT session strategy (no adapter/Account/Session tables — not needed for credentials-only auth).
- **Tenant isolation:** enforced at the query layer via a Prisma Client Extension (`src/lib/tenant-db.ts`) — see below.
- **RBAC:** explicit role → resource → action matrix (`src/lib/rbac.ts`), checked server-side only.
- **Audit log:** append-only `AuditLog` table, written via `src/lib/audit.ts`.

## Tenant isolation — how it's actually enforced

`forTenant(institutionId)` (in `src/lib/tenant-db.ts`) returns a Prisma client wrapped in a `$extends` query extension. For every tenant-scoped model (`User`, `Course`, `CourseFaculty`, `Enrollment`, `Question`, `Exam`, `ExamAttempt`, `AuditLog`, `DeviceRegistration`):

- `findMany` / `findFirst` / `count` / `updateMany` / `deleteMany` get `institutionId` merged into `where` unconditionally.
- `update` / `delete` get `institutionId` merged into their unique `where` (Prisma's "extended where unique input" supports this).
- `create` gets `institutionId` forced into `data`; a caller-supplied `institutionId` that doesn't match the tenant throws `CrossTenantAccessError` instead of being silently overwritten.
- `findUnique` / `findUniqueOrThrow` are refused outright (thrown as `CrossTenantAccessError`) because Prisma's unique-only where clause can't safely be merged with a tenant filter — call sites must use `findFirst` with an explicit id instead.
- Any other operation (`aggregate`, `groupBy`, `upsert`, `createMany`, ...) is refused until explicitly handled, rather than silently passing through unscoped.

`forPlatform()` returns the raw, unscoped Prisma client for `SUPER_ADMIN` / `PLATFORM_ADMIN` cross-tenant operations only. Every call site must be guarded by an explicit role check.

This is proven by an automated integration test against a real Postgres database, not just asserted in prose: `src/lib/__tests__/tenant-db.test.ts` (8 tests, all passing as of this writing) creates two institutions and proves tenant A cannot read, list, update, delete, or create-into tenant B's data through any of the above operations.

## Local development

```bash
docker compose up -d          # Postgres, from the repo root
cd app
cp .env.example .env          # already done in this checkout
npm install
npx prisma migrate dev
npm run seed                  # demo institution + admin/faculty/student users
npm run dev                   # http://localhost:3000 (or next available port)
npm test                      # vitest — all tests hit the real local database
npm run build                 # production build + typecheck
```

Seeded demo accounts (local only — see `prisma/seed.ts`): `admin@cmlaw.demo`, `faculty@cmlaw.demo`, `student@cmlaw.demo`, all with password `DemoPass!2026`.

## What's verified vs. what's UNVALIDATED right now

Verified with a passing automated test or a manual browser check against the real local stack:
- Tenant isolation (8 integration tests).
- Password hashing/verification (3 unit tests).
- RBAC permission matrix (8 unit tests).
- Login (correct and incorrect password), session carrying role + institutionId, tenant-scoped course listing rendering correctly, audit log rows written for both outcomes — all checked live in a browser against the real dev server and database.
- Production build + typecheck + lint all pass.

UNVALIDATED (not yet built, so not yet tested):
- Institution/user/course/question/exam CRUD UI and API beyond the one read-only `/api/courses` example.
- Exam builder, versioning, randomization, scheduling.
- Grading, results, analytics.
- Everything in Phase 2 (offline client, lockdown, encrypted packages, crash recovery).
