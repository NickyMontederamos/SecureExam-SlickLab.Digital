# CM-Law SecureExam — Dean Pitch Roadmap

**Status:** Active plan. Written 2026-08-26 after a scoping discussion covering: the real
lead (College of Maasin — College of Law is actively looking for an Examplify-style
dev build), a firsthand student account of a real secure-exam app's UX (via a
practicing attorney), and the anti-cheat consequence model. Supersedes the
open questions in `NEXT_PHASE_PLAN.md` and `LACKING.txt` for anything they overlap on.

**See `docs/LIVE_TEST_REPORT.md`** for a fully screenshotted walkthrough of everything
through Milestone 2 (booking, the exam-taking UI, the 3-strike anti-cheat core, and
both faculty review outcomes) — 29 real screenshots from an actual run against the dev
server, not mockups.

## Why this plan exists, and what it deliberately isn't

This is **not** a race to Examplify feature parity. `docs/ARCHITECTURE_DECISIONS.md`
ADR-002 already deferred native OS lockdown to Phase 2, and independent research
(`similarAPPS_research.txt`) landed on the same conclusion from vendor documentation:
governance, reliability, and transparent integrity beat OS-lockdown parity as a
first move, because a browser genuinely cannot enforce OS-level guarantees no
matter how much anti-cheat code is added to it.

The project's own rationale doc (`CM-Law_SecureExam_Project_Rationale.docx`) is
explicit about what actually matters to the institution: **institutional control,
cost independence from third-party vendors, and assessment formats that fit legal
education** (essays and case analysis, not just multiple choice) — not "cheating is
impossible."

**Decisions this plan is built on (confirmed 2026-08-26):**
- **Audience & scope:** a single-institution-shaped prototype for the CM-Law Dean.
  No multi-tenant productization (billing, self-serve onboarding) yet — if this
  pitch succeeds, the College of Maasin BSN department and other local schools are
  the next expansion, not before.
- **Timeline:** no fixed date. Build for credibility, not for a deadline.
- **Fidelity:** a few signature features fully real and working; the heaviest
  infrastructure (live proctor video, real ID document verification) simulated
  just enough to show the vision, not built for real yet.
- **Anti-cheat consequence:** at the warning threshold, the exam **auto-pauses
  immediately** (real-time protection) but a **faculty member confirms** before
  it becomes a final failing grade — matches the strict deterrent a real
  competitor's student described, while keeping a human in the loop before any
  transcript is touched.
- **Proctor gating:** simulated (a scripted "waiting for proctor" delay), not a
  real live console — that needs real-time infra and an actual staffing
  commitment from the College, neither of which exists yet.
- **This plan includes** the two law-school-specific differentiators (structured
  legal-analysis grading, bar-subject-tagged analytics) alongside the anti-cheat/
  exam-taking flow — together they're what make this "interesting" rather than a
  generic anti-cheat clone, which was the point of this whole exercise.

## Source of the UX blueprint

A practicing attorney's firsthand account of a real secure-exam app he used as a
law student, captured verbatim in conversation:

> Login → Check exam list → Select Exam → **Book Exam** → Read Exam Rules →
> device/app check (won't start if other apps are open) → **waiting for
> proctor, can't start without one** → identification → **not allowed: Alt+Tab
> (3 warnings → auto-fail), wrist watch, messy surroundings** → in-app tools:
> Time, Calculator, Notepad, Proctor Chat → actions: Flag question, Next,
> Previous.

This is market precedent, not a spec to copy blindly — it's used below to decide
what "looks and feels like a real secure exam" concretely means, filtered through
the fidelity decision above (some of it built real, some simulated).

**Open, deliberately unanswered:** whether CM-Law faculty actually grade essays
in IRAC (Issue-Rule-Application-Conclusion) format. Nobody at CM-Law has
confirmed this — it's an assumption from how Philippine legal education is
generally taught. Milestone 3 is designed so the label/structure can be adjusted
after asking the Dean, without redoing the underlying mechanism. **This is a
good live question to ask during the pitch itself**, not a blocker to design
around now.

---

## Milestone 1 — It looks and feels like a real secure exam

Cheapest, highest-visibility pass. Builds on infrastructure that already exists
(exam-taking page, `ExamAnswer.isFlagged` — already in the schema, unused,
`ExamVersion.allowBacktracking` — already in the schema, unused).

- [x] **Exam Rules acknowledgment screen** — a checkbox agreement (no exam-specific
      rules engine yet, just an explicit "I have read and agree" gate) before a
      student can start. Merged with the "Book Exam" item below into one screen.
- [x] **Live client-side countdown timer**, ticking in the browser, synced against
      the existing server-authoritative deadline, auto-submitting at zero
      (`src/components/ExamCountdown.tsx`). Closes the documented "no live
      countdown" limitation; the server remains authoritative regardless of what
      the client displays.
- [x] **Flag question** — wired up the existing `isFlagged` field on `ExamAnswer`.
      Supports flagging a question before it's answered (`responseJson` stays
      null, never overwritten by a later flag-only save) — see the new test in
      `attempts.test.ts`.
- [x] **In-exam tools: Calculator + Notepad** — `src/components/ExamToolbar.tsx`,
      floating client-side widgets, no backend needed.
- [x] **Real booking flow, superseding the earlier "merge into one screen" call**:
      Book (see the exam's available window) → Confirm Booking → Receipt → Exam
      Rules → gate sequence → exam. Uses `ExamVersion.availableFrom`/`availableUntil`
      (already in the schema, now exposed on exam creation) and the previously-unused
      `AttemptStatus.NOT_STARTED` for the booked-but-not-begun state. New
      `bookAttempt()`/`beginBookedAttempt()` in `attempts.ts`, alongside the
      original `startAttempt()` (kept as-is so existing tests/call sites are
      unaffected). Confirmation code shown on the receipt is the attempt id.
      **Noted for later hardening, explicitly deferred by the user's own call**:
      the booked window doesn't gate *when* Start Exam can be clicked yet —
      it's available immediately after booking, on purpose, while the app is
      still being tested. A real deployment should disable Start Exam until
      the window opens; tracked here so it isn't forgotten.
- [x] **One question at a time**, with a numbered palette to jump between
      questions and flagged ones marked with a dot (`src/components/ExamQuestionPager.tsx`).
      Client-side only — every question's fieldset stays mounted in the one
      underlying form, so Save Progress/Submit Exam are untouched by this change.
- [x] **Toolbar moved to top-left** (was bottom-left) — also incidentally fixes
      the dev-mode-badge collision noted below.

  **Verified:** `npm run build`, `npx eslint .`, `npm test` (86/86, incl. a new
  flag-without-answer test), `npm run test:e2e` (4/4, updated to check the new
  rules checkbox), **plus a full live click-through**: created and published a
  fresh exam as faculty, then as a student booked it through the Exam Rules
  screen, watched the countdown tick down and turn red under a minute, flagged
  the essay question and confirmed the "Flagged" badge persisted through a
  Save Progress round-trip, exercised the Calculator and Notepad widgets, and
  let the exam auto-submit at zero — landed on the result page with the
  objective question auto-graded (1/1) and the essay correctly left pending.

## Milestone 2 — The exam actively protects itself

The anti-cheat core. Built as an **event log**, not a bare counter — this is the
one architectural point worth doing right the first time, per
`similarAPPS_research.txt`'s central recommendation, and it's cheap to do now
versus retrofitting later. The schema already has unused scaffolding for exactly
this: `AttemptStatus.INTERRUPTED` and `ExamVersion.securityPolicy Json?`.

- [x] **`AttemptEvent` table** (new, additive — does not replace `ExamAttempt`/
      `ExamAnswer`): records `WINDOW_BLUR`, `VISIBILITY_HIDDEN`, `FULLSCREEN_EXIT`,
      and `NETWORK_OFFLINE`/`NETWORK_ONLINE` signals (`src/lib/integrity.ts`).
      Not tenant-scoped directly, same pattern as `ExamAnswer` — ownership
      verified via the parent attempt.
- [x] **Network connectivity is logged, never a strike** — a dropped
      connection shows up in the faculty review trail labeled "Network
      connection lost/restored" with a "Context only — not a strike" tag, but
      `STRIKE_EVENT_TYPES` (exported from `integrity.ts`, the one place this
      is defined) excludes it from both the visible warning counter and the
      auto-pause threshold. A bad wifi connection can never fail a student.
- [x] **Alt+Tab made explicit in the review UI** — `WINDOW_BLUR` displays as
      "Alt+Tab or window switch detected" rather than generic phrasing.
- [x] **Fullscreen enforcement** (browser Fullscreen API) — soft, folded into
      `ExamEntryGate`'s device-check step; exiting fullscreen during the exam
      counts as a warning via `IntegrityMonitor`.
- [x] **Visible warning counter** ("Warning X of 3") on the student's exam
      screen (`src/components/IntegrityMonitor.tsx`), derived by reading the
      event log fresh on every report — never cached on the attempt row.
- [x] **Auto-pause at the 3rd warning** — attempt flips to `INTERRUPTED`
      immediately; the exam-taking page renders a distinct "paused, pending
      review" screen instead of the exam (no further answering possible).
- [x] **Faculty "Pending Integrity Review" screen**
      (`attempts/[attemptId]/review/page.tsx`) — shows the full event trail
      with timestamps; faculty confirms violation (→ new `TERMINATED` status)
      or reinstates (→ back to `IN_PROGRESS`, student resumes with answers intact).
      Explicitly blocked for STUDENT role even for their own attempt — this is
      evidence for someone else's decision, not a result.
- [x] Honesty framing carried into the UI itself, not just the pitch script:
      the review screen's own copy says "evidence for a human decision, not an
      automatic verdict" — matches every vendor researched (ExamSoft included).
- [x] Trigger set restricted to tab-switch/window-blur/fullscreen-exit only —
      copy/paste is deliberately NOT wired to a strike, so pasting into the
      Notepad tool never costs a warning.

  **Verified:** `npm run build`, `npx eslint .`, `npm test` (94/94 — added
  `integrity.test.ts`: warning counting, auto-pause at exactly 3, the faculty
  review queue, reinstate, terminate, a stray post-termination event being a
  no-op, network events logged but never counted, and the
  student-can-never-view-review permission check; added booking-flow tests
  to `attempts.test.ts`: book is idempotent, begin refuses an unbooked
  attempt, begin starts the timer and resuming doesn't reset it, finished
  attempts refuse both), `npm run test:e2e` (4/4, updated for the new
  booking → receipt → rules → gate sequence). **Full live click-through**,
  redone against the new booking flow: created an exam with a booking
  window as faculty, booked it as the student and confirmed the window
  showed correctly on both the booking screen and the receipt, continued
  through Exam Rules into the gate sequence and confirmed the timer only
  started once the exam actually began (not at booking), dispatched a
  blur/offline/blur/online/blur sequence and confirmed the visible counter
  only ever reflected the 3 real strikes (never bumped by the 2 network
  events), auto-paused correctly, and confirmed the faculty review trail
  showed all 5 events with "Alt+Tab or window switch detected" /
  "Network connection lost" / "Network connection restored" labels, the
  network ones tagged "Context only — not a strike."

  **A real bug found in that pass**: the grading-list summary chip showed
  "5 warning(s)" (the total event count) instead of the strike count,
  contradicting the review page's own "context only" distinction one click
  away. Fixed by exporting `STRIKE_EVENT_TYPES` from `integrity.ts` and
  having both the list chip and the review page read from the same
  definition instead of each risking their own copy.

  **Real bug found and fixed during that live pass** (not caught by
  build/lint/tests): the device-check step's `requestFullscreen()` call hung
  forever in the verification browser instead of resolving or rejecting — a
  `try/catch` doesn't protect against a promise that never settles. Fixed
  with a timeout race; see `docs/ERROR_LOG.md` ERROR-005.

## Milestone 3 — Built for legal education, not generic quizzing

The two differentiators from the earlier strategy discussion — this is what
makes the pitch memorable instead of "another anti-cheat app."

- [ ] **Structured legal-analysis answers**: an exam author can mark an essay
      question as requiring structured analysis, which gives the student four
      labeled input sections instead of one blob textarea, and mirrors the same
      four sections in the faculty grading view (`src/app/(app)/attempts/[attemptId]/grade/page.tsx`).
      Default labels are Issue / Rule / Application / Conclusion (IRAC), but kept
      as configurable copy, not hardcoded — the exact labels are the open question
      above, and should be confirmed with the Dean or faculty before this ships
      as final rather than guessed.
- [ ] **Bar-subject tagging**: extend the question-creation UI (currently only CSV
      import writes to the already-existing `Question.tags` field) with a fixed
      picklist of Philippine Bar subjects (Civil Law, Political Law, Labor Law,
      Criminal Law, Remedial Law, Legal Ethics, Taxation, Commercial Law).
- [ ] **Bar-subject performance dashboard**: a simple breakdown (average score per
      tag, across attempts) on the course or exam view — ties directly to a law
      school's actual top-level KPI (bar passage rate) in a way no generic quiz
      platform does.

## Milestone 4 — It feels secure at the door

**Pulled forward and built alongside Milestone 2**, with one scope change from
what's written below: ID verification and room scan ended up **fully mocked**
(no real camera access at all), not the "real, simple" webcam capture
originally planned — reversed deliberately so a missing/blocked camera on the
demo device can never derail a live pitch. All of it lives in
`src/components/ExamEntryGate.tsx`.

- [x] ~~Identity snapshot (real, simple): capture one webcam photo~~ →
      **built as a fully simulated "Capturing ID… Verified" step, no
      `getUserMedia` call at all.** Real capture is still the better version
      long-term (something faculty could actually review), but not worth the
      live-demo risk before there's a confirmed pilot.
- [x] **"Waiting for proctor" simulated gate** — a scripted "Waiting for
      proctor approval…" pause before the exam unlocks. Built exactly as scoped.
- [x] **Soft device/app check** — fullscreen requested (not required) during
      the gate's "Checking your device…" step; exiting fullscreen once the
      exam starts feeds into Milestone 2's warning counter rather than being a
      separate, disconnected check.
- [x] **Room scan** — also built as a simulated visual step ("Scanning your
      surroundings… Clear"), matching the proctor-wait screen's style, rather
      than the plain Exam-Rules-checklist bullet originally scoped — more
      convincing for a demo, per the same call as the ID-verification change above.

## Milestone 5 — A real proctor feature (supersedes the mocked gate)

**Built 2026-08-26.** Reverses part of Milestone 4's "fully mocked, no real proctor"
call — see `NEXT_PHASE_PLAN.md` (repo root) for the original breakdown and open
questions; all five were answered directly by the user before any code was written:
time picker within the existing window (not faculty-defined slots), proctors assigned
per course/exam via a new `CourseProctor` table (mirrors `CourseFaculty`), no proctor
available blocks indefinitely (no timeout/escalation — matches Phase 1 having no
staffing commitment yet), the student must stay on the result page until verified (not
free to close the tab), and ~5s polling is fine (this app has no WebSocket/SSE
infrastructure anywhere, so polling is the pattern-consistent choice).

- [x] **Real scheduling** — a `datetime-local` picker on the booking form, shown only
      when the exam has a window, constrained via `min`/`max` to
      `availableFrom`/`availableUntil`. Stored on the new `ExamAttempt.scheduledFor`;
      server-side validated too (`ScheduledTimeOutOfWindowError` in `attempts.ts`), not
      just a browser-enforced input attribute. Exams without a window keep the old
      "book anytime" behavior unchanged — `scheduledFor` stays optional throughout.
- [x] **Proctor dashboard** (`/proctor`, `src/lib/proctoring.ts`) — three queues, each
      scoped to the proctor's `CourseProctor` assignments only, never institution-wide:
      booked/upcoming attempts, requests waiting on approval to start, and submissions
      waiting on approval to finish. `PROCTOR` is now redirected here from `/dashboard`
      instead of the generic course-list view, which isn't its job.
- [x] **Real wait-for-proctor-approval gate** — replaces the scripted "Waiting for
      proctor…" delay in `ExamEntryGate.tsx`. The student's finished device/ID/room
      steps call `requestProctorApproval()` (sets `ExamAttempt.proctorRequestedAt`),
      then poll every 5s until a proctor calls `approveProctorStart()` (sets
      `proctorApprovedAt`) from their dashboard. `beginBookedAttempt()` now refuses to
      start the timer without `proctorApprovedAt` set — a new
      `ProctorApprovalRequiredError`, the actual enforcement point (nothing stopped a
      student from calling it directly before this).
- [x] **Post-submission proctor approval** — the result page now checks
      `Submission.verifiedAt` (existing field, never set by any code path before this)
      for every non-`TERMINATED` attempt; unset shows a waiting screen with 5s polling
      instead of the score. `verifySubmission()` in `proctoring.ts` sets it, scoped the
      same way as the approval gate — a proctor can only verify attempts in courses
      they're assigned to.

  **Verified:** `npm run build`, `npx eslint .`, `npm test` (104/104 — added
  `proctoring.test.ts` covering queue scoping by course assignment, the approval gate
  refusing an unassigned proctor, `beginBookedAttempt` refusing without approval,
  submission-verification scoping and idempotency, plus windowed-scheduling coverage
  in `attempts.test.ts`), `npm run test:e2e` (updated the golden-path spec to drive a
  second Playwright browser context as the seeded demo proctor — approving the start
  request mid-gate and the finish request mid-wait — since nothing auto-approves
  either step anymore). New demo account: `proctor@cmlaw.demo`, pre-assigned to LAW101
  in `prisma/seed.ts`.

## Milestone 5.5 — Faculty course/exam/grading management, easier

**Built 2026-08-26**, same day as Milestone 5, on direct request: "proceed the faculty
opportunity improvements and other fix like easy (course, exam and grading) management
and more — assess it yourself." Self-assessed by reading every faculty-facing page
(course manage, question bank, exam builder, grading list, grade-attempt) and picking
the gaps that actually blocked "manage this easily," not a redesign.

- [x] **Institution admins now have every faculty permission**, on direct instruction
      ("admin also have faculty access") — course/exam/grading management, on top of
      their existing admin-only permissions (institution/user/audit-log). An admin no
      longer needs a separate faculty account to author or grade an exam. See
      `rbac.ts` — kept as one explicit list per role, not a role-inheritance mechanism,
      matching this file's existing "no implicit permission composition" style.
- [x] **Exam edit, question removal, and exam delete — DRAFT only**: the exam builder
      previously had no way to fix a typo'd title/time-limit, remove a wrongly-added
      question, or delete a mis-created exam — only add-and-publish, one-way. All three
      are safe unconditionally while DRAFT (a draft can never have a student attempt
      against it, since booking/starting both require PUBLISHED), so none needed a
      confirmation dialog beyond the existing plain-button style used elsewhere in this
      app. Removing a question renumbers the rest so Q1/Q2/... never shows a gap.
- [x] **Question bank edit/delete — unused questions only**: a question already
      attached to an exam is append-only (master prompt §11's reasoning — a past exam
      must keep the exact wording it was graded against), so edit/delete are only ever
      offered for a question no exam has referenced yet (`QuestionInUseError` if
      violated server-side, not just hidden client-side). The bank list now shows
      "Used in an exam" instead of Edit/Delete for those.
  - [x] Exam total points shown next to the question count, not just per-question.
- [x] **Grading is actually readable now**: the grade-attempt page previously showed
      every response as a raw `JSON.stringify()` dump — an essay answer read as
      `{"text":"..."}`, and a multiple-choice answer as `{"choiceIds":["2"]}` instead of
      the choice text. Both now render as plain, readable text.
  - [x] Grading list: pending-count chips read "X of Y question(s) pending" (was a bare
        number with no context — the exact live-testing complaint this addresses), plus
        a submission-level summary line ("N of M submissions still need grading").
  - [x] Grade-attempt page: a pending-count line under the status header, so a grader
        doesn't have to scroll the whole exam to see how much is left.

  **Verified:** `npm run build`, `npx eslint .`, `npm test` (112/112 — added coverage
  in `exams.test.ts` for `updateExam`/`removeExamQuestion`/`deleteExam` including the
  "refuses once published" cases and the renumber-after-removal behavior,
  `questions.test.ts` for `updateQuestion`/`deleteQuestion` including
  `QuestionInUseError`, and `rbac.test.ts` for the admin/faculty permission merge),
  `npm run test:e2e` (4/4, confirming the existing faculty create/publish and full
  proctor-gate flows are unaffected by the additions).

## Milestone 6 — UI/UX pass: shared design system, real navigation, branding everywhere

**Built 2026-08-26**, same day, on direct request: "scan all the app folder and files,
research and document UI/UX user friendly, brainstorm how to apply it to all app
pages... upgrade UI/UX of admin, faculty, proctor and student... make it an optimized
app, effective branding logo display and app logic." Self-assessed by reading every
page in the app (17 routes across all 4 roles) before touching anything.

**What the scan found:** no shared component library — every page hand-rolled its own
`rounded border p-3 text-sm` markup, with small style drifts between pages doing the
same thing. No real navigation — the only way "home" was a plain-text back link; nothing
in the UI pointed to `/users` or `/proctor` except the dashboard page itself. Institution
branding (`primaryColor`/`secondaryColor`, set per-tenant in `Institution`) was used in
exactly one place in the entire app — the login button — nowhere else, including the
header. The root `/` route was still the **unedited `create-next-app` boilerplate**
(Vercel/Next.js marketing links, "To get started, edit page.tsx") — anyone landing on
the bare domain saw a generic template instead of this app.

- [x] **Shared design system** (`src/components/ui.tsx`, new) — `Button`/`LinkButton`
      (5 variants), `Card`, `Badge` (6 tones), `Alert` (4 tones), `PageHeader`,
      `Section`, `EmptyState`, plus shared `inputClassName`/`labelClassName`. One
      definition per pattern instead of N slightly-different copies; every page in the
      app now uses these instead of ad-hoc Tailwind strings.
- [x] **Branding wired app-wide, not just the login button** — `globals.css` now
      defines `--brand-primary`/`--brand-secondary` CSS custom properties (with sane
      fallbacks pre-login), set per-request from the signed-in institution's colors in
      `(app)/layout.tsx`, and consumed via `bg-brand-primary`/`text-brand-primary`
      Tailwind utilities everywhere — every primary button, link hover, focus ring, and
      the header's accent bar across the whole app now reflect the actual tenant.
      Required `export const dynamic = "force-dynamic"` on that layout — a plain DB call
      there (unlike `auth()`'s `cookies()` access) isn't a signal Next.js treats as
      dynamic on its own, so without this `next build` attempted to statically
      prerender the shell and run a real Postgres query at build time (breaks whenever
      Postgres isn't reachable during build — exactly the concern `docs/DEPLOYMENT.md`
      already raised about production build environments).
- [x] **Real navigation** (`AppHeader.tsx`, rebuilt) — a proper nav bar (Dashboard,
      Users, Proctor Queue, Platform Admin — each gated by the same `can()` check its
      destination page already enforces server-side), a larger/more prominent
      seal+crest lockup, and a brand-colored bottom accent border.
- [x] **Root route fixed** — `/` now redirects to `/dashboard` or `/login` instead of
      rendering the Next.js template.
- [x] **Every one of the 17 pages** (admin, users, dashboard, course manage/exams/
      questions, exam builder/grading, attempt taking/grade/review/result, proctor
      dashboard, login) rebuilt on the shared components — consistent spacing, status
      colors, card shadows, hover/focus transitions, and a live score display on the
      student result page instead of a plain sentence. `courses/[courseId]/manage`'s
      three near-identical roster blocks (Faculty/Proctor/Students) collapsed into one
      `RosterSection` helper instead of three copy-pasted forms.

  **Verified:** `npm run build` and `npx eslint .` clean throughout. Postgres was
  unreachable for most of this pass (Docker Desktop's service needs admin rights this
  session didn't have — the user started it manually partway through) — once it came
  up: `npm test` (112/112, no regressions from the redesign), `npm run test:e2e` (4/4,
  twice in a row for stability). One real (non-functional) break the live run caught
  that grep couldn't: the result page's redesign replaced the old "Score: 1 / 1"
  sentence with a large score number + a "Final score" label, which broke the e2e
  test's exact-text regex — the score itself displayed correctly the whole time, only
  the test's assertion needed updating to match the new (clearer) markup, done in
  `tests/e2e/exam-lifecycle.spec.ts`. Also fixed along the way: a recurring dev-console
  image-aspect-ratio warning on the crest logo (Tailwind's `img{height:auto}` reset
  fighting next/image's explicit dimensions), silenced by adding a matching `h-auto`
  class. Live screenshots captured via a throwaway Playwright script across all four
  roles (login, faculty dashboard/question-bank/exam-builder, institution-admin
  dashboard/users/course-manage, proctor dashboard, student dashboard/exams) confirm the
  design system, real navigation, and per-institution branding all render correctly
  against real seeded + live demo data — not just build/lint passing in the abstract.

## Milestone 6.5 — Institution admin gets real proctor authority + reset actions

**Built 2026-08-26**, same day, on direct request: "reset all exams and pending items.
UPGRADE ADMIN ACCESS and ACTIONS FIRST." The reset itself was a one-off dev-database
cleanup (every Exam/ExamVersion/ExamQuestion/ExamAttempt/ExamAnswer/AttemptEvent/
Submission wiped across every institution, `Institution`/`User`/`Course`/
`CourseFaculty`/`CourseProctor`/`Enrollment`/the question bank all left untouched) — not
a repeatable feature, so not itself listed below. The "upgrade admin access" half is:

- [x] **Institution admins now have real proctor authority, institution-wide** — not
      scoped to a `CourseProctor` assignment the way a plain `PROCTOR` is.
      `exam_attempt: ["read", "approve", "delete"]` added to `INSTITUTION_ADMIN` in
      `rbac.ts`. `proctoring.ts`'s `scopedCourseIds()` returns `null` (no course
      filter) for any non-`PROCTOR` role reaching these functions instead of the
      proctor's assigned-course list — an admin doesn't need (and normally won't have)
      a `CourseProctor` row of their own. The `/proctor` dashboard and its "Proctor
      Queue" nav link both now show for `INSTITUTION_ADMIN` too, with a subtitle
      distinguishing "Scoped to your assigned courses" (PROCTOR) from "Institution-wide
      oversight" (admin).
- [x] **`cancelAttempt()`** (new, `proctoring.ts`) — admin-only (`exam_attempt:
      "delete"`), deletes a booking/attempt outright (events, answers, submission
      cascade with it) and frees the slot for a fresh booking. Distinct from
      `resolveIntegrityReview`'s TERMINATE path on purpose: that's a real academic
      decision that keeps the record; this is cleanup for a stuck/wrong/test attempt
      that erases it. Wired as a "Cancel" button on every row of the proctor
      dashboard's three queues, admin-only.
- [x] **Admin can force-delete a non-draft exam** — `deleteExam()` in `exams.ts` still
      refuses a non-DRAFT delete for a plain `exam:"delete"` holder (FACULTY, including
      an admin acting through the FACULTY-permission merge, would be wrong to trust
      here) but now checks for `exam_attempt:"delete"` specifically and, if present,
      cascades every attempt/answer/event/submission along with the exam in one
      `$transaction`. Surfaced as a red "Danger zone (admin only)" card on the exam
      builder page, separate from the existing DRAFT-only delete section, with copy
      that's explicit this is for cleaning up test/demo data, not a real academic
      record.

  **Verified:** `npm test` (116/116 — added coverage in `proctoring.test.ts` for
  institution-wide queue visibility and `approveProctorStart`/`verifySubmission`
  working with zero `CourseProctor` rows, `cancelAttempt` succeeding for admin and
  throwing `ForbiddenError` for FACULTY, and the freed slot accepting a fresh booking;
  `exams.test.ts` for `deleteExam` cascading a real attempt for admin while still
  refusing FACULTY on the same published exam; `rbac.test.ts` for the two new
  permissions), `npm run build` and `npx eslint .` clean, `npx playwright test` 4/4.
  Live screenshots confirm the "Proctor Queue" nav link and the institution-wide-scoped
  empty dashboard render correctly for `admin@cmlaw.demo`.

## Milestone 6.6 — "Assigned courses only" was a UX filter, not a boundary (fixed)

**Found and fixed 2026-08-26**, while scoping the sections/batches feature request
below — re-reading `listCoursesForUser`'s own docstring ("This is a UX/relevance
filter, not an authorization boundary") made it worth actually checking whether that
was still just a documented, deliberate scope decision or a real gap. It was a real
gap: any `FACULTY` account could open `/courses/<any-course-id>/exams` for a course
they don't teach — just by knowing or guessing its id — and both view *and create*
exam/question content there, because every course-scoped and exam-scoped page/action
only ever checked role-level `exam:`/`question:` permissions (shared by every `FACULTY`
user in the institution), never whether *this* faculty member is actually assigned to
*this* course.

- [x] **`assertFacultyAssignedToCourse()`** (new, `courses.ts`) — the real enforcement.
      No-ops for every role except `FACULTY` (institution admins, via the
      Milestone-5.5 permission merge, and any other role that reaches course content
      are institution-wide by design, same reasoning as `proctoring.ts`'s
      `hasInstitutionWideAuthority`). Throws `CourseAccessDeniedError` for a `FACULTY`
      actor with no matching `CourseFaculty` row.
- [x] **Wired into every course-scoped and exam-scoped mutation and read path**:
      `listExamsForCourse`, `getExam`, `createExam`, `addExamQuestion`,
      `addExamQuestions`, `updateExam`, `removeExamQuestion`, `deleteExam`,
      `publishExam` (all `exams.ts`), `listQuestionsForCourse`, `createQuestion`,
      `updateQuestion`, `deleteQuestion` (all `questions.ts`) — not just the entry
      pages, so a direct server-action call (bypassing a page's own GET render) is
      refused too, not only a page-load redirect.
  - Every real call site already passed the full `session.user` object (which
    includes `id`), so no page changed — this was purely a `lib/*.ts` fix. Test
    fixtures across six files needed a `CourseFaculty` row added for their faculty
    actor, since the tests exercise these functions directly and had never modeled
    that assignment before (there was no reason to, until it started being checked).

  **Verified:** `npm test` (118/118 — added two new regression tests, in `exams.test.ts`
  and `questions.test.ts`, that create a second faculty account deliberately left
  unassigned to the course and confirm every listed function above throws
  `CourseAccessDeniedError` for it, while the assigned faculty account is unaffected),
  `npm run build` and `npx eslint .` clean, `npx playwright test` 4/4 (the seeded demo
  faculty account is assigned to LAW101 in `prisma/seed.ts`, so the existing golden-path
  flows are unaffected by the fix).

---

## Milestone 6.7 — Course-home page (roster + grading rollup) and the audit log viewer

**Built 2026-08-26**, the two unambiguous items from the faculty-management
improvement request: "once a course is opened, it should show sections/batches
(roster), pending grading, and exam results" — plus admin visibility into the
`AuditLog` table that `auth.ts` had been writing to since Milestone 5.5 with no
read path anywhere in the app.

- [x] **Course-home page** (`app/(app)/courses/[courseId]/page.tsx`, new route) —
      `FACULTY`/`INSTITUTION_ADMIN` only (students still land on their own
      course-exams list, proctors/platform roles keep their own landing pages).
      Three sections: a faculty/proctor summary line, a student roster table
      (`getCourseWithRoster`), and a per-exam grading rollup (`submitted` /
      `pending` / `graded` / `terminated` counts plus a class average once
      graded) with a "Grade now" shortcut when anything is pending.
  - **`getCourseExamSummaries()`** (new, `grading.ts`) — the rollup query.
    Reuses `assertFacultyAssignedToCourse` (Milestone 6.6) since this is a
    second entry point into course grading data, not just `/exams/[id]/grading`'s
    own already-guarded path.
  - Dashboard's `courseLinkPath` now sends `FACULTY`/`INSTITUTION_ADMIN` here
    instead of straight to `/questions` or `/manage`; `/manage`'s own roster-CRUD
    page is unchanged and still reachable from the course-home page's subtitle
    for admins (`course:"update"` gate, so `FACULTY` correctly doesn't see it).
- [x] **Audit log viewer** (`/audit`, new route + `listAuditLog()` in `audit.ts`) —
      gated by the `audit_log:"read"` permission that already existed in
      `rbac.ts` (`SUPER_ADMIN`/`PLATFORM_ADMIN`/`INSTITUTION_ADMIN`) but had no
      UI. Tenant-scoped via `forTenant()` — rows with a null `institutionId`
      (e.g. a failed login before the tenant was resolved) are correctly
      excluded, they never belonged to this tenant. Filterable by result
      (`SUCCESS`/`DENIED`/`ERROR`) and by action prefix. Nav link added to
      `AppHeader.tsx` alongside Users/Proctor Queue.

  **Verified:** `npm test` (124/124, including new `grading.test.ts` and
  `audit.test.ts` covering the course-assignment guard, the pending→graded
  transition and average-score math, tenant scoping, and the result/action
  filters), `npx tsc --noEmit`, `npx eslint .`, and `npm run build` all clean
  (`/courses/[courseId]` and `/audit` both compile as new routes). Live-checked
  against the dev server's real accumulated demo/e2e data (not just fixtures):
  `faculty@cmlaw.demo` on `/courses/<LAW101 id>` correctly shows its 2 enrolled
  students and both exams' real `1 submitted · 1 graded · avg 100%` figures, the
  "Manage roster" link is present for `admin@cmlaw.demo` and absent for faculty,
  and `admin@cmlaw.demo` on `/audit?result=DENIED` correctly filters 194 events
  down to the 10 real `bad_password` denials logged during this session's testing.
  `npx playwright test` caught the one real fallout of the dashboard routing
  change: 3 of 4 e2e specs clicked "LAW101" and asserted an immediate landing on
  `/questions`, which is no longer true for `FACULTY` now that course-home is the
  landing page — fixed by updating `exam-lifecycle.spec.ts` and
  `question-import.spec.ts` to assert the course-home URL first, then click
  through "Question bank" (this is a test-assertion update for an intentional
  routing change, not an app bug). 4/4 passing after the fix.

---

## Milestone 6.8 — Roster CSV import + roster tables (ADMIN request)

**Built 2026-08-26.** Two admin-facing asks: bulk-assign a course roster from a
CSV instead of one dropdown-select at a time, and make the roster lists on
`/courses/[courseId]/manage` look like organized tables instead of stacked
cards.

- [x] **`roster-import.ts`** (new) — `parseRosterCsv()` (pure, unit-tested)
      validates `email,role` rows (role must be `FACULTY` or `STUDENT`, no
      duplicate email+role pairs); `importRosterFromCsv()` resolves every
      email against an *existing* account of the matching role and only
      writes if every row resolves — same all-or-nothing contract as
      `importQuestionsFromCsv`. Deliberately does not create accounts from
      the CSV: that would mean choosing/distributing a password, which stays
      the `/users` page's job, not a side effect of a roster upload — an
      unknown email is a row error ("No FACULTY account found for …"), not a
      silent skip or an auto-created account.
  - Wired into `/courses/[courseId]/manage` as a new "Import roster from
    CSV" section, with a downloadable `course-roster-template.csv`, above
    the existing per-role assign/unassign controls (which are unchanged and
    still work — the CSV is a bulk shortcut, not a replacement).
- [x] **Roster tables** — `RosterSection`'s member list (previously a
      `<ul>` of cards) is now a real `<table>` (Name / Email / Remove
      columns), matching the table pattern established on the course-home
      page (Milestone 6.7). Same component, same props — just the internal
      markup, so Faculty/Proctors/Students all got the change at once.

  **Verified (first pass, existing-accounts-only):** `npm test` (135/135),
  clean typecheck/lint/build, `npx playwright test` 6/6. Live-checked
  in-browser as `admin@cmlaw.demo` on LAW101's manage page: both roster
  tables render with real data, the CSV import section and template link are
  present, and existing assign/remove actions on the table rows still work.

  **Revised same day** after the admin tested it with a real 57-row roster
  of people with no accounts yet — it correctly refused (existing-accounts-
  only was the original design), but the admin's actual intent was bulk
  *onboarding*, not just bulk-assigning pre-existing accounts. Confirmed via
  `AskUserQuestion` before changing behavior (this is exactly the kind of
  account-creation/credential-security fork that shouldn't be decided
  unilaterally): **yes, auto-create missing accounts with a generated temp
  password, shown once.**
  - `importRosterFromCsv` now resolves each row three ways: existing account
    of the matching role → attach; email already registered under a
    *different* role or a *different institution* → still a hard row error
    (roster CSV never reassigns a role or moves a tenant); unknown email →
    create a new account (name from an optional CSV `name` column, or
    derived from the email's local part — "tatum.davis" → "Tatum Davis")
    with `generateTempPassword()` (new, `password.ts` — a 12-char generator
    avoiding visually ambiguous characters).
  - Temp passwords are **never persisted in plaintext or logged** — only
    the bcrypt hash goes to the database. The plaintext lives only in a
    process-local, read-once in-memory stash (`consumeCreatedCredentials`,
    10-minute TTL) keyed by a random token that travels through the
    redirect URL — the passwords themselves never do. The manage page reads
    the token once, renders the new accounts + temp passwords in an amber
    "shown once" table with a CSV download, and a page refresh cannot bring
    it back. This is honestly a single-process, single-instance mechanism
    (documented as such in the code) — adequate for this project's current
    Phase 1 deployment shape, not a general-purpose secrets vault.
  - Still all-or-nothing: a bad row anywhere in the batch (including one
    that would've created a brand-new account) means nothing is written —
    no orphaned accounts from a partially-failed import.

  **Verified (revised behavior):** `npm test` (139/139 — rewrote
  `roster-import.test.ts`'s DB suite for the three-way resolution, added
  coverage for temp-password creation + hash verification, the derived vs.
  explicit name, the one-time read-once contract on
  `consumeCreatedCredentials`, all-or-nothing across a mixed
  create-plus-conflict batch, and the cross-institution-email refusal),
  `npx tsc --noEmit`, `npx eslint .`, `npm run build` clean, and
  `npx playwright test` 7/7 (rewrote `roster-import.spec.ts`'s error-path
  spec into a real account-creation spec that also confirms the credentials
  table disappears on reload — the read-once contract — using a real
  browser since file upload can't be driven by the Browser pane tool).

  **Also this pass:** the "Question bank · Exams · Manage roster" page-header
  links across all four course pages (course-home, manage, exams, questions)
  were plain underlined text — upgraded to real secondary-variant buttons
  via `PageHeader`'s existing `actions` slot, per direct admin feedback on a
  screenshot. Verified via computed-style check in the live browser (real
  border/background/padding, not just link-colored text).

## Milestone 6.9 — Every clickable action is a visible button

**Built 2026-08-26**, admin follow-up: "make all clickable buttons visible."
Swept the whole app (`grep -rn "underline-offset-2"`) for every action still
styled as plain underlined text instead of real button chrome, across
`manage`, `questions`, `exams/[examId]`, `users`, and `audit` pages:

- Table-row **Remove**/**Delete** actions → `Button variant="danger"` (small,
  `px-2.5 py-1 text-xs` to fit the row).
- **Edit** (question bank) → `LinkButton variant="secondary"`.
- **Deactivate/Activate**/**Reset password** (Users page) → `Button`.
- Every **"Download the template"** CSV-import link → moved out of the
  description prose into its own `LinkButton` inside the card, above the
  file picker (roster import, question bank import, exam-CSV import) — the
  description text no longer carries a link at all, just the explanation.
- **"Download as CSV"** (new-account credentials) → `LinkButton`.
- Inline prose links inside empty-state messages ("add one first", "add
  some on the question bank page") → restructured into a short sentence
  plus an adjacent small `LinkButton`, rather than a link embedded mid-
  sentence.
- Course-home's exam-card title (`/courses/[courseId]/page.tsx`) was a bare
  `<a>` — replaced with a plain (non-link) title plus an explicit **"View
  exam"** button, alongside **"Grade now"** when grading is pending.
- **Apply** (audit log filter form) was a hand-rolled `<button>` with
  button-shaped classes already — switched to the shared `Button` component
  for consistency, no visual change.

Deliberately left alone: `PageHeader`'s "← Back" link (universal back-nav
convention), whole-card list links on the dashboard and course-exams pages
(already visually interactive via `Card interactive`'s hover shadow, and
wrapping them in a button would be redundant with the "View exam" pattern
above), the branding logo link, and the exam-taking UI's `Calculator` /
`Notepad` / question-pager controls in `ExamToolbar.tsx` /
`ExamQuestionPager.tsx` — those were already real button-styled chrome
(bordered, shadowed), just not routed through the shared component, and
sit inside the anti-cheat/exam-taking surface this project treats as
higher-risk to touch for a cosmetic-only reason (see `CLAUDE.md`'s
Autonomy Guardrails exclusion list).

**Verified:** post-sweep `grep -rn "underline-offset-2"` returns zero
matches. `npm test` (139/139, unaffected — this was UI-only), `npx tsc
--noEmit`, `npx eslint .`, `npm run build` all clean, `npx playwright test`
7/7 (confirms the CSV-import specs' `text=` selectors for template
links/buttons still resolve correctly after the markup changes).

---

## Milestone 7 — Friendlier design system: tactile buttons, real loading states, softer everything

**Built 2026-08-26**, on explicit admin direction to make the whole app feel
"friendly, approachable, and seamless." Rather than hand-editing 17 pages
individually, this went through the shared design-system layer that 20 of
the app's 26 page/component files already compose from
(`src/components/ui.tsx`) — one systemic change instead of thirty scattered
ones, which also kept the diff small enough to verify with confidence
against the existing 139-test unit suite and 7-spec e2e suite.

- [x] **`Button.tsx`** (new, split out of `ui.tsx` as a client component) —
      the one primitive that actually needed client JS. Wires `react-dom`'s
      `useFormStatus` (React 19) so **every `type="submit"` Button
      auto-shows a spinner and disables itself while its form is
      in-flight**, with zero per-page wiring — every server action in this
      app is a plain `<form action={...}>`, so this covers all of them at
      once. Verified safe against the exam-taking UI's `type="button"`
      instances (`ExamEntryGate`, `ExamQuestionPager`) — `useFormStatus` is
      a documented no-op outside a `<form>`, and the spinner only gates on
      `type === "submit"` regardless.
- [x] **`button-styles.ts`** (new) — `BUTTON_BASE`/`BUTTON_VARIANTS` moved
      here so both `Button.tsx` (client) and `ui.tsx`'s `LinkButton`
      (server-safe, plain navigation) share one definition without forcing
      `LinkButton` into the client bundle too.
- [x] **Tactile feedback across the board**: `active:scale-[0.97]` press
      depth, `transition-all duration-200 ease-in-out` everywhere (was
      `transition-colors duration-150`, color-only), `hover:shadow-md` +
      `hover:-translate-y-0.5` lift on interactive Cards, `rounded-xl`
      buttons/inputs and `rounded-2xl` Cards (was `rounded-lg`/`rounded-xl`).
- [x] **One global focus ring** (`globals.css`) — replaced the plain
      `outline: 2px solid` with a box-shadow ring (inner shadow matched to
      the page background standing in for `ring-offset`, so it follows each
      element's own border-radius instead of squaring it off). Deliberately
      global rather than per-component Tailwind classes: it's the only way
      to correctly cover the app's whole-card `<a>` wrappers (dashboard,
      course-exams list) that aren't built from a shared component, without
      risking a doubled-up ring on the ones that are.
- [x] **`Alert`** fades/slides in on mount (`animate-fade-in`, `transform` +
      `opacity` only — compositor-only, never triggers layout thrashing;
      respects `prefers-reduced-motion`).
- [x] **`EmptyState`** gets an icon accent (inline SVG, no new dependency)
      in a soft circular badge instead of being a bare paragraph — reads as
      an intentional empty state, not a broken page.
- [x] Body `line-height` bumped to 1.6 for readability.

**Deliberately not done this pass** (flagged rather than rushed):
a full slate→warm-neutral gray palette swap (hundreds of scattered
`text-slate-*`/`bg-slate-*` occurrences, no single leverage point — a mass
find-replace here is a real regression risk for a cosmetic-only payoff, and
belongs as a separate reviewable pass) and exhaustive per-page 44x44px
touch-target auditing (the *shared* buttons/inputs are close — `py-2.5`
puts most at ~42px — but literally every element across 17 pages wasn't
individually re-measured).

**Verified:** `npx tsc --noEmit`, `npx eslint .`, `npm run build` all clean
(Button's new client boundary doesn't break any route). `npm test`
(139/139, unaffected — UI-only). `npx playwright test` 7/7 — one transient
timeout on a shared/contended dev server under 3 parallel workers, which
reproduced as a clean pass both in isolation and in a subsequent full
3-worker run, confirming it was resource contention, not a design-system
regression. Live-checked computed styles in-browser:
`getComputedStyle().borderRadius` reads 16px on Cards (`rounded-2xl`) and
12px on Buttons (`rounded-xl`), `transitionDuration` reads `0.2s` with
`transitionProperty: all` on both, matching the new tokens exactly.

---


## Explicitly deferred (documented, not built, not simulated)

Said out loud so it's a decision, not an oversight:

- Live real-time proctor console + Proctor Chat — needs real-time infrastructure
  and an actual staffing commitment from the College. Revisit once there's a
  signed pilot, not before.
- True ID document verification / liveness detection.
- AI-based room-scan analysis.
- Native Windows lockdown client — unchanged from ADR-002, still Phase 2.
- Full offline/IndexedDB attempt journaling, LTI/Canvas/Moodle integration —
  real ideas from `similarAPPS_research.txt`, genuinely Phase 2/3 scope; building
  them now would be solving problems the College hasn't confirmed it has.

## Also worth doing, lower priority (from `LACKING.txt`)

Ops hygiene, not pitch-narrative-critical — pick up if time allows after
Milestones 1–4, or as a fast-follow after a successful pitch:

- [ ] Self-service or admin-triggered password reset (no email infra exists yet —
      needs a provider decision first).
- [ ] Configurable retake/attempt limits (currently hard-enforced at exactly one
      attempt via a DB constraint — a real schema change, not a toggle).
- [x] Grading list visibility — flagged during live testing of Milestone 5
      (2026-08-26), fixed the same day as part of the faculty-management pass below:
      pending-count chips now read "X of Y question(s) pending" (was a bare number
      with no context), plus a submission-level summary line at the top of the
      grading list ("N of M submissions still need grading").

---

## Working agreement for this plan

- Each milestone should be verified live in the browser and covered by tests
  before moving to the next, per this project's existing testing discipline.
- Update this file's checkboxes as items land; log non-obvious decisions in
  `SOLUTIONS_LOG.md` as usual.
- If the Dean pitch gets a firm date, re-sequence remaining checkboxes around it
  rather than trying to finish everything.
