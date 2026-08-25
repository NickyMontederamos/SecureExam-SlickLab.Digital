# CM-Law SecureExam — Dean Pitch Roadmap

**Status:** Active plan. Written 2026-08-26 after a scoping discussion covering: the real
lead (College of Maasin — College of Law is actively looking for an Examplify-style
dev build), a firsthand student account of a real secure-exam app's UX (via a
practicing attorney), and the anti-cheat consequence model. Supersedes the
open questions in `NEXT_PHASE_PLAN.md` and `LACKING.txt` for anything they overlap on.

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
- [x] **"Book Exam" framing** — exams already only ever show from a student's
      enrolled courses (confirmed — no new access-control surface needed); merged
      into the Exam Rules screen as "Book & Start Exam" rather than a separate step.

  **Verified:** `npm run build`, `npx eslint .`, `npm test` (86/86, incl. a new
  flag-without-answer test), `npm run test:e2e` (4/4, updated to check the new
  rules checkbox), **plus a full live click-through**: created and published a
  fresh exam as faculty, then as a student booked it through the Exam Rules
  screen, watched the countdown tick down and turn red under a minute, flagged
  the essay question and confirmed the "Flagged" badge persisted through a
  Save Progress round-trip, exercised the Calculator and Notepad widgets, and
  let the exam auto-submit at zero — landed on the result page with the
  objective question auto-graded (1/1) and the essay correctly left pending.
  One dev-only cosmetic note: Next.js's local dev-mode indicator badge
  overlaps the toolbar's bottom-left corner in `next dev` — doesn't appear in
  a production build, not worth changing for the pitch, but noted here in
  case it's confusing during future local demos.

## Milestone 2 — The exam actively protects itself

The anti-cheat core. Built as an **event log**, not a bare counter — this is the
one architectural point worth doing right the first time, per
`similarAPPS_research.txt`'s central recommendation, and it's cheap to do now
versus retrofitting later. The schema already has unused scaffolding for exactly
this: `AttemptStatus.INTERRUPTED` and `ExamVersion.securityPolicy Json?`.

- [ ] **`AttemptEvent`-style table** (new, additive — does not replace `ExamAttempt`/
      `ExamAnswer`): records `WINDOW_BLUR`, `VISIBILITY_HIDDEN`, `FULLSCREEN_EXIT`
      client-side signals with a sequence number, tenant-scoped like every other model.
- [ ] **Fullscreen enforcement** (browser Fullscreen API) — a real, if soft, control;
      exiting fullscreen counts as a warning event.
- [ ] **Visible warning counter** ("Warning 1 of 3") on the student's exam screen,
      derived from the event log, not stored as its own source of truth.
- [ ] **Auto-pause at the 3rd warning** — attempt flips to `INTERRUPTED`, further
      answering is blocked immediately (the real-time protection piece).
- [ ] **Faculty "Pending Integrity Review" screen** — shows the event trail for a
      paused attempt; faculty confirms FAILED (final) or reinstates/resumes the
      attempt. This is where "auto-pause, human confirms" actually lives.
- [ ] Honesty check for the pitch script: describe this as *deterrence and an
      audit trail*, never as "cheating is impossible" — every vendor researched
      (ExamSoft included) explicitly avoids that claim for good reason.

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

The simulated/lightweight versions of the heavier UX-blueprint items, per the
fidelity decision — real where cheap, simulated where genuinely expensive.

- [ ] **Identity snapshot** (real, simple): capture one webcam photo at exam start
      via `getUserMedia`, attach it to the attempt for faculty to review later.
      No automated face-matching or liveness detection — that's the expensive
      part, deliberately not built.
- [ ] **"Waiting for proctor" simulated gate**: a scripted "Verifying with
      proctor..." pause screen that auto-advances after a few seconds. Demonstrates
      the concept without a live console or a staffed proctor during the demo.
- [ ] **Soft device/app check**: require fullscreen before the exam unlocks, and
      treat a focus-loss during the pre-check countdown as a blocking warning —
      a real, browser-achievable approximation of "won't start if other apps are open."
- [ ] **Exam Rules checklist items** for the physical-environment rules (no
      wrist watch, clear surroundings) — text/acknowledgment only, paired with
      the identity snapshot; no automated room-scan analysis.

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
