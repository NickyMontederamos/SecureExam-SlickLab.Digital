# Database — CM-Law SecureExam

Schema source of truth: `app/prisma/schema.prisma`. This document explains
the *why* behind the shape — read the schema file itself for exact field
types/defaults.

## Engine and access

PostgreSQL, via Prisma 7 with the `@prisma/adapter-pg` driver adapter (see
ADR-003 in `ARCHITECTURE_DECISIONS.md`). All application code accesses the
database through `src/lib/tenant-db.ts`'s `forTenant()` / `forPlatform()` —
never through a raw `PrismaClient` instance imported directly, so tenant
scoping can't be bypassed by accident. See `ARCHITECTURE.md` for how that
enforcement actually works.

## Entity groups

**Identity & tenancy** — `Institution`, `User`. Every tenant-scoped table
below carries an `institutionId`. `User.institutionId` is nullable — only
`SUPER_ADMIN`/`PLATFORM_ADMIN` are allowed a null value, since they operate
across tenants by design (enforced in application code, not a DB
constraint — see `src/lib/institutions.ts`).

**Course structure** — `Course`, `CourseFaculty` (who teaches what),
`Enrollment` (who's taking what). Both join tables carry their own
`institutionId` denormalized from the parent `Course`, so tenant-scoped
queries against them don't need an extra join just to filter correctly.

**Question bank** — `Question` (stable identity: type, tags, difficulty,
who authored it) + `QuestionVersion` (the actual gradeable content: prompt,
choices, answer key, points). Split this way so an exam attempt can
permanently reference the exact wording and answer key it was graded
against, even if the question is later edited — editing a question creates
a new `QuestionVersion`, it never mutates an old one that's already
attached to a past exam.

**Exam structure** — `Exam` (identity + lifecycle status: DRAFT →
PUBLISHED → ARCHIVED) + `ExamVersion` (the actual configuration: time
limit, instructions, randomization flags, security policy) +
`ExamQuestion` (join table pinning a specific `QuestionVersion` into a
specific `ExamVersion`, with its own point value and order — an exam can
award different points for a question than the question bank's default).
Phase 1 only ever creates one `ExamVersion` per exam and freezes it at
publish time (see `PROJECT_STATUS.md` "Known Limitations") — the schema
supports multiple versions per exam for a future "revise a published exam"
flow that doesn't exist yet.

**Attempts & grading** — `ExamAttempt` (one per student per exam version,
enforced by `@@unique([examVersionId, studentId])` — this is how "no
retakes" is enforced at the data layer, not just in application logic) +
`ExamAnswer` (one per question per attempt, carries both the student's
`responseJson` and the grading fields: `pointsAwarded`, `autoGraded`,
`gradedAt`, `gradedById`) + `Submission` (the finalization record —
`receiptId`, `uploadedAt`; `encryptedPayloadRef`/`signature` exist for
Phase 2's offline package security and are unused/null in Phase 1).

**Audit & device** — `AuditLog` (WHO/WHAT/WHEN/RESULT, append-only by
convention — no application code path updates or deletes a row) +
`DeviceRegistration` (schema exists for Phase 2 device-binding; not
populated by any Phase 1 code path yet).

## Key constraints worth knowing about

- `Institution.slug` — unique, used as the human-readable tenant identifier (e.g. `college-of-maasin-law`).
- `Course` — unique on `(institutionId, code, academicYear)`, so the same course code can exist in different institutions or different years without colliding.
- `ExamAttempt` — unique on `(examVersionId, studentId)`: the no-retake guarantee.
- `ExamAnswer` — unique on `(attemptId, examQuestionId)`: one answer per question per attempt, upserted by `saveAnswers`.
- `QuestionVersion` / `ExamVersion` — both unique on `(parentId, versionNumber)`, and versions are never updated in place once created (immutability by convention, not a DB trigger).

## Migrations

Standard Prisma migrations, in `app/prisma/migrations/`. Applied with
`npx prisma migrate dev` in development. **After any schema change, also
run `npx prisma generate` explicitly and restart any running `next dev`
process** — see ERROR-002 in `ERROR_LOG.md` for why this bit twice.

For a production deployment, use `npx prisma migrate deploy` (applies
pending migrations without the interactive dev-only prompts) as part of
the release process — not yet wired into any CI/CD pipeline (Phase 1 has
none yet, see `PROJECT_STATUS.md`).

## Seeding

`npm run seed` (`app/prisma/seed.ts`) creates one demo institution (College
of Maasin — College of Law) with a `SUPER_ADMIN`, `INSTITUTION_ADMIN`,
`FACULTY`, and `STUDENT` account, one course, and enrolls the student in
it. Idempotent (`upsert` throughout) — safe to re-run. All seeded passwords
are `DemoPass!2026`, printed on run — never reuse as real credentials.
