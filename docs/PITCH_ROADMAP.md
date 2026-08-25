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

---

## Working agreement for this plan

- Each milestone should be verified live in the browser and covered by tests
  before moving to the next, per this project's existing testing discipline.
- Update this file's checkboxes as items land; log non-obvious decisions in
  `SOLUTIONS_LOG.md` as usual.
- If the Dean pitch gets a firm date, re-sequence remaining checkboxes around it
  rather than trying to finish everything.
