# Next Phase Plan — Real Proctor Feature & Guided Scheduling

Written 2026-08-26, right after Milestones 1 and 2 (plus the pulled-forward parts of
Milestone 4) shipped, were fully live-tested, and were watched live by the user in the
same session — see `docs/LIVE_TEST_REPORT.md` (29 real screenshots) and
`docs/PITCH_ROADMAP.md` for everything already built and verified. This file is the
entry point for the next conversation — read this first, no need to re-derive context
from git log.

## Why a new conversation

Same reasoning that's worked every other time on this project: this is real
design/architecture work — a new role's UI (`PROCTOR`), a genuine wait-for-approval
gate, and a new post-submission step — not a small bugfix. Worth a clean context rather
than continuing in an already-long conversation.

## What just shipped (context, don't re-litigate this)

- **Booking**: single availability window, confirm-only. The student sees the window
  and books it as-is — no time picker, no discrete slots.
- **Entry gate** (`src/components/ExamEntryGate.tsx`): a fully mocked
  device-check → ID-verification → room-scan → "waiting for proctor" sequence. No real
  camera access, no real proctor, just scripted delays — a deliberate choice so a
  missing/blocked camera on a demo device could never derail a live pitch.
- **3-strike anti-cheat core**: a real event log (`AttemptEvent`), auto-pause at the
  3rd strike, a faculty "Pending Integrity Review" screen that resolves either
  Reinstate or Confirm Violation (new `TERMINATED` status). Network connectivity drops
  are logged for context but never count as a strike.
- All of the above is live-tested with screenshots in `docs/LIVE_TEST_REPORT.md`, and
  was also watched live in the Browser pane in the same session, including both
  integrity-review outcomes.

## New requirement, from the user directly (verbatim, this matters — don't paraphrase away detail)

> Proctor feature should be applied.
>
> Student should select available time and dates. the booked exams should display on
> the proctor side. And should receive receipt. Student should wait for Proctor and
> comply other requirements. Student after submitting the exam should send approval to
> proctor to Finish the exam.

This reverses part of the Milestone 4 "fully mocked, no real proctor" decision — that
was the right call when the goal was a safe, self-contained pitch demo; now the ask is
a real proctor workflow. Both were correct calls for what they were solving at the time.

## What this actually requires, broken down

1. **Real scheduling, not just confirm-the-one-window.** The student needs to pick a
   date/time, not just confirm a fixed window. Smallest version: a time picker
   constrained to fall inside the exam's existing `availableFrom`/`availableUntil`.
   Bigger version: faculty defines several discrete bookable slots and the student
   picks between them (needs a new slots concept — real schema work). **Ask which one
   before building** — the last session deliberately chose the cheaper option for cost
   reasons; this ask reopens that call and deserves a fresh answer, not an assumption.

2. **A real `PROCTOR`-facing screen.** The `PROCTOR` role already exists in
   `Role` (`prisma/schema.prisma`) and already has `exam_attempt: ["read"]` in
   `src/lib/rbac.ts`'s permission matrix — but there is currently **zero** UI for it.
   No dashboard route exists, and there's no course/exam assignment mechanism for
   proctors the way `CourseFaculty` (`src/lib/courses.ts`) handles faculty rosters.
   Investigate that pattern before designing this — a proctor probably needs to be
   scoped to specific courses/exams the same way, not see every institution's exams by
   default. This dashboard needs to show **booked** attempts (`NOT_STARTED`, scheduled)
   — not just in-progress or paused ones, which is all any current screen shows.

3. **A real wait-for-proctor-approval gate**, replacing `ExamEntryGate.tsx`'s scripted
   "Waiting for proctor…" delay. The student's booked attempt needs to signal
   "ready to start, waiting for approval"; the proctor's dashboard needs to show that
   request; approving it needs to be the thing that actually unlocks
   `beginBookedAttempt()` (`src/lib/attempts.ts`) — which right now any student can call
   the moment they've booked, with no gate at all. This likely needs a new status or a
   new boolean/timestamp field on `ExamAttempt` (e.g. `proctorApprovedAt`) — there
   isn't an obvious existing unused field for this one, unlike the next item.

4. **A real "approve to finish" step after submission.** New territory: today
   `submitAttempt()` (`src/lib/attempts.ts`) finalizes everything itself and the
   student goes straight to their result. The schema already has a field that looks
   built for exactly this and has never been set by any code path:
   `Submission.verifiedAt: DateTime?` (`prisma/schema.prisma`). Likely shape: submission
   still auto-grades and creates the `Submission` row as today, but the student sees a
   "waiting for your proctor to close out your session" screen until a proctor marks
   it verified — only then do they see their normal result page.

5. **How "real-time" actually gets built.** This app has no WebSocket/SSE
   infrastructure — server actions + `revalidatePath` is the only pattern used
   anywhere in the codebase so far. The pragmatic, consistent-with-everything-else
   answer is short-interval client polling (a `setInterval` re-checking status every
   few seconds) on both the student's waiting screens and the proctor's queue — not a
   new real-time transport. This is a real trade-off (a few seconds of lag vs. a
   bigger infrastructure lift) and should be confirmed, not assumed.

## Open questions the new session should ask before writing code

Same discipline as every other pass on this project — ask on anything with a real
cost/scope fork, don't guess and rebuild later.

1. **Scheduling**: student picks a time within the existing window, or faculty defines
   discrete slots?
2. **Proctor assignment**: does a `PROCTOR` need to be assigned to specific
   courses/exams (like faculty), or is institution-wide visibility acceptable for a
   pitch demo?
3. **No proctor available**: does "waiting for proctor" block indefinitely with no
   fallback, or does it need a timeout/escalation path? Relevant because Phase 1 has no
   staffing commitment yet (see `docs/ARCHITECTURE_DECISIONS.md` ADR-002 and the
   fidelity discussion already logged in `docs/PITCH_ROADMAP.md`).
4. **Post-submission wait**: must the student stay on the page until the proctor
   approves finishing, or can they safely close the tab and check back later for
   their result?
5. **Polling interval**: a few seconds of lag is cheap to build; sub-second isn't,
   without real-time infrastructure this project doesn't have. Confirm a few seconds
   is fine before committing to the polling approach in point 5 above.

## Suggested opening move for the new session

1. Read this file, then `docs/PITCH_ROADMAP.md` (especially Milestone 2 and the
   fidelity/proctor-gating decisions already made) and `docs/LIVE_TEST_REPORT.md` for
   what's already built and verified — don't re-derive or second-guess it.
2. Ask the 5 questions above before designing or writing anything.
3. Explore `src/lib/rbac.ts`, `src/lib/courses.ts` (the `CourseFaculty` roster-
   assignment pattern), and the `Submission` model in `prisma/schema.prisma` before
   deciding how proctor-assignment and approve-to-finish should actually work.
4. Build with the same discipline as every prior pass on this project: tests alongside
   the code, live verification in the browser afterward, a screenshotted report if the
   change is demo-facing, commit with a clear message.
