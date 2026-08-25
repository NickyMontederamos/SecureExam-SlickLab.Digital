# Architecture Decision Records — CM-Law SecureExam

## ADR-000

### Problem
The source "Autonomous Master Prompt" (`AUTONOMOUS MASTER PROMPT — SECURE EXAMINATION SAAS PLATFORM.md`) frames this as a single continuous autonomous build to a full production-ready, ExamSoft/Examplify-equivalent platform, including a native Windows offline lockdown client with encrypted exam packages, crash recovery, and a six-round final security validation gate (§34–35). That scope is realistically a multi-month, multi-person effort even for an experienced team, and there is no confirmed engagement with the College of Maasin — College of Law yet (this started from an informal lead via a relative who is a current law student there).

### Options Considered
1. Execute the master prompt literally, in order, as one continuous autonomous loop until every §34 checkbox is checked.
2. Build nothing until the institution confirms budget/timeline/scope.
3. Phase the build: stand up the cloud SaaS core first (Phase 1, no native client), treat it as both a real foundation and a pitch-ready demo, and defer the offline Windows lockdown client to Phase 2 once there's a confirmed engagement or at least strong signal.

### Decision
Option 3. Build Phase 1 now (this repo). Keep the master prompt as the long-term technical reference for later phases, not literal minute-by-minute instructions.

### Reason
A working, demoable admin/faculty/student SaaS core (question banks, exam builder, RBAC, tenant isolation, grading, audit log) delivers most of the rationale doc's stated value (`CM-Law_SecureExam_Project_Rationale.docx` §3, §6) and is something a decision-maker can actually look at. The offline lockdown client is the highest-risk, highest-effort, hardest-to-get-right part of the whole system (see ADR-002) and building it before there's a real institutional commitment is the most likely way to waste weeks of effort on the wrong thing.

### Security Impact
None directly — this is a scoping decision. It does reduce the risk of shipping a rushed, under-tested lockdown client, which would be a security *and* academic-integrity liability if it gave false confidence.

### Alternatives Rejected
Option 1 rejected: no autonomous agent (or realistically, a solo developer) can respons­ibly declare a system like this "production-ready" for real bar-track law exams without dedicated security review time; attempting the full scope in one pass would produce code that compiles but hasn't earned trust. Option 2 rejected: a rationale doc alone is weaker collateral than a working demo when approaching the institution.

---

## ADR-001

### Problem
Choose the backend architecture for Phase 1 (master prompt §7 offers NestJS, Next.js backend services, or FastAPI).

### Options Considered
1. NestJS as a separate backend service.
2. FastAPI as a separate backend service.
3. Next.js Route Handlers (App Router) as the backend, colocated with the frontend.

### Decision
Next.js Route Handlers, single deployable app for Phase 1.

### Reason
Phase 1 has one frontend consumer (the SaaS portal) and no native client yet (the Phase 2 Windows client will call the same REST/JSON API over HTTPS regardless of what serves it). A single Next.js app minimizes deployment complexity and cost for a pre-revenue pitch project, and TypeScript types can be shared end-to-end. If Phase 2 or scale requirements later demand a dedicated backend (e.g., heavier background job processing for grading/analytics), the Route Handlers can be extracted into a NestJS service without changing the data model.

### Security Impact
None negative — authorization is enforced identically whether logic lives in Route Handlers or a separate service, as long as it's server-side (master prompt §9, §23 requirement either way).

### Alternatives Rejected
NestJS/FastAPI rejected for now: added operational surface (a second service, second deploy pipeline, cross-service auth) with no Phase 1 benefit. Revisit if/when a confirmed engagement justifies the extra investment.

---

## ADR-002

### Problem
Choose the secure exam client technology for the eventual offline/lockdown Windows client (master prompt §7, §14).

### Options Considered
1. Electron.
2. Native Win32/.NET application.
3. Tauri (Rust core, web-tech UI).
4. Adopt an existing open-source lockdown browser (Safe Exam Browser) instead of building custom lockdown software, and build only the offline-package/sync layer ourselves.

### Decision
Deferred — not built in Phase 1. When Phase 2 starts: default to evaluating Tauri first (smaller attack surface than Electron, Rust core, already the chosen stack for the SlickLab AUTOMATIONS launcher project), but seriously evaluate Option 4 (Safe Exam Browser integration) before committing to a fully custom lockdown client.

### Reason
Building lockdown/anti-cheat software that's actually trustworthy is a specialized, adversarial security problem — getting it wrong (false sense of security) is worse than not attempting perfect lockdown at all, which the master prompt itself acknowledges (§14: "Do not claim the client provides perfect anti-cheating"). SEB is free, open-source, widely deployed in higher ed, and already solves the OS-lockdown problem; our differentiated value is more likely in the cloud exam-management platform, question banks, offline sync, and grading than in re-solving OS kiosk-mode lockdown from scratch.

### Security Impact
High — this is the most security-critical subsystem in the whole platform (exam integrity, encrypted offline packages, tamper detection). Deferring the decision, not the seriousness.

### Alternatives Rejected
None rejected yet — decision explicitly deferred pending Phase 2 kickoff and more research time than is appropriate to rush in Phase 1.

---

## ADR-003

### Problem
Choose the ORM/database access layer (master prompt §7, §24).

### Options Considered
1. Prisma.
2. Drizzle ORM.
3. Raw SQL with a query builder (Kysely).

### Decision
Prisma.

### Reason
Matches the master prompt's own preference (§7). Strong TypeScript inference, mature migration tooling, and — most importantly for this project — Prisma Client Extensions let us enforce tenant isolation at the query layer itself (see the tenant-scoped client in `app/src/lib/db.ts`) rather than trusting every handler to remember a `where: { institutionId }` clause. That directly serves master prompt §8's requirement that tenant isolation live in the backend/data-access layer, not the frontend.

### Security Impact
Positive — centralizing tenant scoping in one extension means a forgotten filter in a new route can't leak cross-tenant data; the extension enforces it unconditionally.

### Alternatives Rejected
Drizzle and Kysely both push tenant-scoping discipline onto every individual query author, which is exactly the failure mode master prompt §8 warns about ("Never rely solely on frontend filtering" — the same risk applies to easy-to-forget backend filtering).
