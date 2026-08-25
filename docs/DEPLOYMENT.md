# Deployment — CM-Law SecureExam (Phase 1)

**This has never been deployed anywhere but a local dev machine.**
Everything below is the intended path, worked out but not yet exercised
end-to-end against a real hosting target — flag that honestly to anyone
using this as a deployment runbook rather than presenting it as proven.

## What exists today

- `docker-compose.yml` at the repo root — local Postgres only, for
  development. Not a production deployment artifact.
- `app/.env.example` — the two required environment variables
  (`DATABASE_URL`, `AUTH_SECRET`).
- A standard Next.js 16 App Router app — deployable to any Node.js hosting
  target that supports Next.js (Vercel, a Node server behind a reverse
  proxy, a container). No Vercel-specific code, no Docker image for the
  app itself yet (only Postgres has a compose service).

## Required environment variables

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Must be a real, network-reachable Postgres instance in production — the dev `docker-compose.yml` Postgres is local-only |
| `AUTH_SECRET` | Auth.js JWT signing secret | The `.env.example` placeholder value is explicitly labeled "replace before any real deployment" — **must** be a genuinely random secret in production. Generate with `openssl rand -base64 32` or equivalent. |

## Before a real deployment (not yet done)

- [ ] Generate and set a real `AUTH_SECRET` — never reuse the dev placeholder.
- [ ] Provision a production Postgres instance; run `npx prisma migrate deploy` (not `migrate dev`) against it.
- [ ] Run `npm run seed` only if a demo/pilot institution is actually wanted in that environment — otherwise use `/admin` to onboard the real institution once a `SUPER_ADMIN` account exists (see "Bootstrapping the first SUPER_ADMIN" below).
- [ ] Set cookies to `secure` (Auth.js does this automatically when it detects HTTPS via `NEXTAUTH_URL`/the request's protocol — verify in the target environment, don't assume).
- [ ] Point `DATABASE_URL` at a connection-pooled Postgres endpoint if the hosting target uses serverless/edge functions with many concurrent short-lived connections (not a concern for a traditional long-running Node server).
- [ ] Add CI (build + lint + test) gating deploys — none exists yet, every check in this project has been run manually.
- [ ] Confirm the security header list in `next.config.ts` is appropriate for the actual hosting setup (e.g. `Strict-Transport-Security` assumes the app is only ever served over HTTPS in production).

## Bootstrapping the first SUPER_ADMIN

`/admin` (institution onboarding) requires an existing `SUPER_ADMIN` or
`PLATFORM_ADMIN` account to reach it — there's no self-serve platform-admin
signup (deliberately; this is SlickLab's own operational access, not a
tenant-facing feature). In a fresh production database with no seed data,
create the first `SUPER_ADMIN` directly via a one-off script modeled on
`prisma/seed.ts`'s `superadmin@cmlaw.demo` block, run once against the
production database, then delete/rotate.

## Backup and recovery

Not yet designed. Whatever managed Postgres the production deployment
lands on almost certainly has its own point-in-time-recovery / automated
backup offering — use that rather than building custom backup tooling for
Phase 1. A written recovery runbook (RPO/RTO targets, restore drill) is
still a gap per master prompt §34 "Deployment" checklist and should exist
before any real exam is administered.
