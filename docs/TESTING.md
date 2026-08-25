# Testing — CM-Law SecureExam

## What actually exists

**46 automated tests** (`app/src/lib/__tests__/*.test.ts`), run with `npm
test` (Vitest). All of them — including the ones labeled "unit" — run
against a real local Postgres database (via Docker Compose), not mocks.
That was a deliberate choice: this codebase's highest-value guarantee is
tenant isolation, and a mocked Prisma client would happily let a bug in
the real query logic pass. Breakdown:

| File | Tests | Covers |
|---|---|---|
| `password.test.ts` | 3 | bcrypt hash/verify round-trip |
| `rbac.test.ts` | 8 | every role/resource/action combination that matters |
| `rate-limit.test.ts` | 3 | fixed-window limiter: blocks, per-key isolation, reset |
| `tenant-db.test.ts` | 8 | the core tenant-isolation guarantee, every Prisma operation |
| `questions.test.ts` | 4 | question+version creation, cross-tenant course refusal |
| `exams.test.ts` | 6 | exam lifecycle, publish-freezing, cross-tenant refusal |
| `attempts.test.ts` | 8 | enrollment/no-retake/ownership/timer/auto-grading |
| `institutions.test.ts` | 6 | onboarding, duplicate refusal, platform-role restriction |

Run: `npm test` (from `app/`, requires `docker compose up -d` from the
repo root first). Each test file creates its own throwaway
institutions/users with a random run ID and cleans up in `afterAll` — safe
to run repeatedly, and tests don't interfere with each other or with the
seeded demo data.

## What's verified but NOT automated

Every user-facing flow has been manually walked through in a real browser
against the real dev server and database at least once (see
`PROJECT_STATUS.md` for the full list and dates), but none of it is
scripted as an automated E2E test yet:

- Login (success, failure, rate-limit lockout)
- Question bank authoring
- Exam authoring → publish
- Full student exam-taking → auto-grade
- Full student exam-taking → manual grade (essay)
- Institution onboarding
- The live cross-tenant attack simulation in `SECURITY.md`

**This is the biggest testing gap.** Two real bugs this session (ERROR-001,
ERROR-002) were caught only by manual browser verification — the build and
the unit/integration test suite both passed cleanly while the bugs were
live. A Playwright (or equivalent) E2E suite covering at minimum the golden
path (onboard institution → author exam → student takes it → grade → see
result) would catch this class of bug automatically and is the top
priority in `PROJECT_STATUS.md`'s "Next Priority" list.

## What's NOT tested at all

- Load/performance testing.
- Accessibility testing (no automated a11y checks; manual keyboard/screen-reader pass not done).
- Cross-browser testing (only verified in the one browser used for manual verification this session).
- Anything in Phase 2 (offline client — doesn't exist yet).

## Running the full local check

```bash
docker compose up -d      # from the repo root
cd app
npm test                  # 46 tests, real Postgres
npm run build              # production build + full TypeScript check
npx eslint .                # lint, zero warnings expected
```

All three currently pass clean — see `PROJECT_STATUS.md` "Last
Validation" for the date this was last confirmed.
