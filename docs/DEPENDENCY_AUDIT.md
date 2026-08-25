# Dependency Audit — CM-Law SecureExam (Phase 1)

## Known issues

### `deepmerge-ts` stack exhaustion (via `@prisma/config` → `prisma` CLI)
- **Severity:** npm reports "high".
- **Where:** transitive dependency of the `prisma` CLI package (dev-time only — not part of the built app or runtime dependency tree).
- **Real-world exposure:** low. `deepmerge-ts` is used internally by Prisma's CLI to merge our own `prisma.config.ts` with defaults at `prisma migrate`/`generate` time. It isn't reachable from any request our deployed app serves.
- **Action:** tracked, not fixed — no patched Prisma release exists yet as of this writing (`prisma@7.9.1` is current stable; `8.0.0-rc.10` is a prerelease we deliberately avoided, see below). Re-run `npm audit` before each Prisma upgrade and drop this note once resolved upstream.

## Deliberate version choices

### Prisma pinned to `7.9.1`, not `8.0.0-rc.10`
`npm install prisma@latest` initially pulled `8.0.0-rc.10` — a prerelease with a substantially different CLI (`prisma orm`, `prisma migration`, `prisma db` subcommands replace the classic `prisma migrate dev`). Per master prompt §6 ("never perform destructive dependency upgrades without compatibility analysis"), we pinned to the latest **stable** release, `7.9.1`, instead. Revisit once 8.0.0 leaves release-candidate status and its migration guide is read in full.

### Prisma 7's driver-adapter model
Prisma 7 stable removed `datasource.url` from `schema.prisma` in favor of `prisma.config.ts` + a driver adapter (`@prisma/adapter-pg` + `pg`) passed into `new PrismaClient({ adapter })`. This is the officially documented path (verified against prisma.io/docs, not inferred), not a workaround — see `app/prisma.config.ts` and `app/src/lib/prisma.ts`.

## Process
Re-run `npm audit` and `npx prisma --version` (checking for a stable, non-RC update) before starting each new work session, per master prompt §6. Update this file whenever a dependency decision is made or an audit finding changes status.
