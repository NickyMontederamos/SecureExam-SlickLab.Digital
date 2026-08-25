# Live Test Report — Booking → Anti-Cheat → Integrity Review

**Date:** 2026-08-26
**Commit tested:** `4809d6c` (feat: real booking flow, network-connectivity logging in integrity review)
**Scope:** Full end-to-end walkthrough of everything built in `docs/PITCH_ROADMAP.md`
Milestones 1, 2, and the pulled-forward parts of Milestone 4 — booking, the exam-taking
UI, the 3-strike anti-cheat core, and the faculty integrity review flow, including both
possible decisions (Reinstate and Confirm Violation).

## How this was tested

Two passes, both against the real dev server (`npm run dev`, not mocked data):

1. **A recorded pass** — a small headless-Playwright script drove the app end-to-end
   and saved a real screenshot at every step to `docs/screenshots/`. This is what the
   numbered screenshots below come from. (A **headed** — visible-window — browser was
   attempted first so the run could be watched directly; it failed with `spawn UNKNOWN`
   in this environment, consistent with no desktop/window-station access for spawning
   GUI processes from this session. Switched to headless, which works fine for
   screenshot capture — it just doesn't produce an on-screen window.)
2. **A live pass in the Browser pane**, driven interactively and watched in real time,
   covering the same flow plus the one branch the recorded pass didn't take: an
   integrity violation resolved as **Reinstate** instead of **Confirm Violation**,
   showing the student resuming and finishing normally. Screenshots from this pass are
   inline below (not saved as files, since the Browser pane tool doesn't support saving
   to disk — only the headless script's screenshots are permanent files).

Every screenshot in this report is a real, unedited capture of the running app — no
mockups, no hand-drawn diagrams.

---

## Part 1 — Faculty authors and publishes an exam with a booking window

### 1. Login

![Login page](screenshots/01-login-page.png)

Institution branding (College of Maasin — College of Law seal + crest), the
`AppHeader`-free login screen, and the SlickLab.Digital corner credit bottom-right.

### 2. Faculty dashboard

![Faculty dashboard](screenshots/02-faculty-dashboard.png)

### 3. Adding a question to the course's bank

![Question added to bank](screenshots/03-question-added-to-bank.png)

### 4. Creating an exam with an availability window

![Create exam form with booking window](screenshots/04-create-exam-form-with-window.png)

This is the new part: `Available from` / `Available until` fields on the exam-creation
form, writing to `ExamVersion.availableFrom`/`availableUntil` — fields that existed in
the schema from day one but were never exposed in any UI until this pass.

### 5–6. Draft exam, question attached

![Exam created as draft](screenshots/05-exam-created-draft.png)
![Question attached to the exam](screenshots/06-question-attached-to-exam.png)

### 7. Published

![Exam published](screenshots/07-exam-published.png)

---

## Part 2 — Student books the exam (Book → Confirm → Receipt)

### 8. Student dashboard

![Student dashboard](screenshots/08-student-dashboard.png)

### 9. Booking screen — shows the available window

![Book exam, available window shown](screenshots/09-book-exam-available-window.png)

The window set in Part 1 renders here exactly as configured: *"Aug 25, 2026, 7:23 PM –
Aug 26, 2026, 3:23 AM"* in the recorded run. No booking infrastructure was invented —
this reads directly from the exam version already fetched for the page.

### 10. Booking confirmed — the receipt

![Booking confirmed receipt](screenshots/10-booking-confirmed-receipt.png)

A confirmation code (the attempt's id), the exam title, and the window — the concrete
"Receive receipt" step from the requested flow. At this point the attempt exists in the
database with status `NOT_STARTED` and **no timer running** — `startedAt` is still null.

### 11. Exam Rules — a separate step from booking

![Exam Rules screen](screenshots/11-exam-rules-screen.png)

Per the real precedent this flow was modeled on (Book → *later* → Read Rules → device
checks → exam), Rules is its own screen after the receipt, not bundled into booking.

---

## Part 3 — The mocked entry-gate sequence

Four scripted steps, each a couple of seconds, between agreeing to the rules and the
exam actually starting. All are simulated — no real camera access, no real proctor —
by deliberate choice (see `docs/PITCH_ROADMAP.md`'s fidelity decision): a missing or
blocked webcam on a demo device must never be able to derail a live pitch.

### 12. Device check (the one real check — soft fullscreen request)

![Gate: device check](screenshots/12-gate-device-check.png)

### 13. Identity verification (fully mocked)

![Gate: identity verification](screenshots/13-gate-identity-verification.png)

### 14. Room scan (fully mocked)

![Gate: room scan](screenshots/14-gate-room-scan.png)

### 15. Waiting for proctor (fully mocked)

![Gate: waiting for proctor](screenshots/15-gate-waiting-for-proctor.png)

**Verified in both passes:** the exam's countdown timer does not start during this
sequence. `beginBookedAttempt()` — which sets `startedAt` — is only called after step
15 completes, not when "Start Exam" is first clicked. The receipt above and the
exam-taking screen below have different, independently-verified timestamps; the ~8
seconds of gate sequence between them cost the student nothing.

---

## Part 4 — Taking the exam

### 16. One question at a time, with a palette

![Exam taking, question 1](screenshots/16-exam-taking-question-1.png)

The countdown reads **9:59 remaining** for a 10-minute exam — confirming the timer
started only once the gate finished, per the note above. The numbered palette (`1`)
shows one question; `allowBacktracking`/pagination controls (`← Previous`, `Next →`)
sit below the question, and Calculator/Notepad are now top-left (moved from
bottom-left specifically so they stop colliding with Next.js's own dev-mode indicator
badge, which also lives bottom-left in `next dev`).

### 17. Flagging a question before answering it

![Question flagged](screenshots/17-question-flagged.png)

### 18–19. Notepad and Calculator

![Notepad open](screenshots/18-notepad-open.png)
![Calculator open](screenshots/19-calculator-open.png)

Both are client-only scratch tools — nothing here is graded or persisted, and neither
requires a server round-trip to open.

### 20. The flag survives a save

![Flag persisted after Save Progress](screenshots/20-flag-persisted-after-save.png)

A **"Flagged"** badge appears next to Q1 after clicking Save Progress — proof the flag
round-tripped through the server (`saveAnswers` → `ExamAnswer.isFlagged`) rather than
just being local UI state.

---

## Part 5 — The 3-strike anti-cheat core, with network events as context (not strikes)

This is the part of the test built specifically to answer two things asked directly:
*"does Alt+Tab actually get caught"* and *"does a dropped connection unfairly cost a
student a strike."*

### 21. Warning 1 of 3 (a real `WINDOW_BLUR` event)

![Warning 1 of 3](screenshots/21-warning-1-of-3.png)

### 22. A network drop is logged but does **not** move the counter

![Network offline logged, warning count unchanged](screenshots/22-network-offline-logged-no-warning-change.png)

This screenshot is the same "Warning 1 of 3" state as #21, captured again immediately
after dispatching a `NETWORK_OFFLINE` event — the banner is provably unchanged. Under
the hood, `recordAttemptEvent()` always recomputes the warning count from
`STRIKE_EVENT_TYPES` only (`WINDOW_BLUR`, `VISIBILITY_HIDDEN`, `FULLSCREEN_EXIT`);
`NETWORK_OFFLINE`/`NETWORK_ONLINE` are written to the same event log for later context
but are structurally excluded from that count.

### 23. Warning 2 of 3 (a second real strike, after the network event and a recovery)

![Warning 2 of 3](screenshots/23-warning-2-of-3.png)

The sequence up to this point was: strike → offline → strike → online — proving
network events can be interleaved with real strikes without ever inflating the count.

### 24. Auto-pause on the 3rd strike

![Attempt auto-paused](screenshots/24-attempt-auto-paused.png)

The exam-taking UI disappears entirely and is replaced by a plain "paused, pending
review" message — the student cannot keep answering, cannot see the questions, and the
page cannot be tricked back into the exam view by reloading (the server re-checks
`attempt.status` on every request).

**Confirmed live** (Browser-pane pass, not the recorded one): dispatching a 3rd `blur`
event paused the attempt within about a second of the event firing, with no
intermediate state — auto-pause is immediate, not eventually-consistent.

---

## Part 6 — Faculty integrity review: both possible decisions

### 25. The pending-review queue

![Faculty pending integrity review queue](screenshots/25-faculty-pending-integrity-review-queue.png)

The chip reads **"3 strike(s) — paused."** This specific number was a bug in an
earlier version of this same day's work — it originally showed the raw event count
(5, including the 2 network events), which would have overstated the violation to a
grader glancing at the list. Fixed by exporting one shared `STRIKE_EVENT_TYPES`
definition that both this chip and the detail page below read from, so they can't drift
apart again.

### 26. The event trail — Alt+Tab and network events both clearly labeled

![Integrity review event trail](screenshots/26-integrity-review-event-trail.png)

All 5 events, in order: `Alt+Tab or window switch detected` (×3), `Network connection
lost`, `Network connection restored` — the two network rows carry a distinct **"Context
only — not a strike"** tag. This is the exact ask this pass exists to prove: the
review screen visibly distinguishes what caused the pause from what's just
context, and calls Alt+Tab by name rather than a generic "activity detected" phrase.

**Decision path A — Confirm Violation (recorded pass):**

### 27. Attempt terminated

![Integrity review resolved — terminated](screenshots/27-integrity-review-resolved-terminated.png)

### 28. The grading list still shows it — not silently dropped

![Grading list shows Terminated](screenshots/28-grading-list-shows-terminated.png)

A `TERMINATED` attempt disappears from the "pending review" queue (it's resolved) but
was, before this pass, also invisible from the main submissions list — a real gap: once
resolved, the record would vanish from every screen a faculty member would think to
check. Fixed by including `TERMINATED` in `listAttemptsForExam`'s status filter
alongside `SUBMITTED`/`GRADED`, with its own red "Terminated" badge.

### 29. The student sees why, not just a blank/zero score

![Student result — terminated banner](screenshots/29-student-result-terminated-banner.png)

*"This attempt was terminated following an integrity review — a faculty member
confirmed a violation after repeated warnings during the exam. Contact your instructor
if you believe this was in error."* — a plain-language explanation, not a bare "0/1."

**Decision path B — Reinstate (live Browser-pane pass, not recorded to file):**

Using a second exam (`Audience Live Demo`), the same 3-strike sequence was triggered
live and watched in real time. On the review screen, **Reinstate** was clicked instead
of Confirm Violation:

- Attempt status flipped from `INTERRUPTED` back to `IN_PROGRESS` immediately.
- The review page itself updated to read *"This attempt is no longer pending review
  (current status: IN_PROGRESS)"* — same code path as the terminated case, different
  outcome, both handled by the one `resolveIntegrityReview()` function.
- Signing back in as the student showed a **"Continue Exam"** button (not "Book" or
  "Start" — the existing booking/attempt was picked back up, not restarted).
- The student answered the question, clicked Submit, and received a normal graded
  result: **Score: 1 / 1** — proving a reinstated attempt is fully resumable and
  behaves identically to one that was never interrupted, all the way through to a
  clean finish.

This confirms both branches of the one human decision this whole feature exists to
protect: a real integrity concern can end a student's attempt for cause, and a false
alarm (or a legitimate distraction) can be dismissed with the student losing nothing —
neither their answers nor their remaining time.

---

## What this test does *not* cover

Said explicitly, matching this project's own documentation discipline:

- **Milestone 3** (structured legal-analysis grading, bar-subject tagging) — not built
  yet, so not tested here.
- **Hard time-gating** on the booked window — by explicit instruction, the window is
  currently informational only; Start Exam works immediately after booking regardless
  of the window's start time. Tracked in `docs/PITCH_ROADMAP.md` as a deliberate,
  noted gap for later hardening.
- **Real camera/ID/room verification** — the gate sequence is, and is meant to be,
  fully simulated. This test confirms the simulation behaves correctly, not that a real
  identity-verification integration would.
- **Automated regression coverage for this exact click-path** — this report is a
  manual/scripted verification pass, not a replacement for `npm test` (94/94 passing as
  of this commit) or `npm run test:e2e` (4/4 passing), which remain the actual
  regression safety net.
