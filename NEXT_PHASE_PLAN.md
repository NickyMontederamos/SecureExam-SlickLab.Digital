# Next Phase Plan — Ownership Watermarking + GUI Pass

Written 2026-08-25, end of the bulk-exam-building session (85/85 tests, working
tree clean, see `PROJECT_STATUS.md` for full state). This file is the entry
point for the next conversation — read this first, no need to re-derive
context from git log.

## Why a new conversation
This project's own pattern (confirmed working well earlier this build):
settle the design here, build it fresh in a new session. These two asks are
GUI/design-judgment work touching every page, not a small bugfix — worth the
clean context.

## Current state relevant to both asks
- `src/app/layout.tsx` is bare — just fonts + `<body>`. **No shared header,
  nav, or chrome anywhere.** Every page (`dashboard`, `courses/[id]/*`,
  `exams/[id]`, `attempts/[id]/*`, `admin`, `users`) builds its own
  standalone `<main>`. This means: (a) a root-layout watermark component
  covers every page in one edit, but (b) there's no existing header to hang
  a logo on — one has to be built.
- Branding assets already in `app/public/branding/`: `college-of-law-logo.png`,
  `college-of-maasin-logo.png`, `slicklab-digital-watermark.png` (real
  transparent PNGs, user-owned, do not touch/gitignore them again).
- Only the login page currently shows any branding: institution seal+crest
  centered top, plus a small "Built by SlickLab.Digital" credit strip at the
  bottom (`src/app/login/page.tsx:82-90`). Every other page is unbranded.
- `getDemoInstitutionBranding()` (`src/lib/branding.ts`) already returns
  `logoUrl`, `sealUrl`, `primaryColor`, `secondaryColor`, `name` — reusable
  for a header component, not just login.

## Ask 1 — Ownership / for-sale watermarks on every page
User's own words: "ADD MULTIPLE OVERLAYING WATERMARKS TO ALL PAGES. (TO
INDICATE THAT I OWN THE APP AND IT IS FOR SALE)"

Proposed approach:
- One `<Watermark />` client component rendered once in `src/app/layout.tsx`
  (inside `<body>`, after `{children}`), `position: fixed`, `inset: 0`,
  `pointer-events: none`, `z-index` above content — so it never blocks any
  click/form/input on any page, including the exam-taking flow (must not
  interfere with a student's ability to answer questions).
- "Multiple overlaying" = layer two effects, not one:
  1. A repeating diagonal tiled text pattern (CSS `background-image` with an
     inline SVG data-URI, or a repeated absolutely-positioned text grid) —
     low-opacity (~6-10%), diagonal like a stock-photo watermark.
  2. The existing SlickLab.Digital corner mark, promoted from
     login-page-only to persistent-corner-badge (bottom-right, small,
     slightly higher opacity than the tile so it stays legible) — reuse
     `slicklab-digital-watermark.png`.
- Copy: needs the user's exact wording + any contact info before building
  (e.g. "FOR SALE — SlickLab.Digital" vs. "© SlickLab.Digital — Licensing
  Available" vs. include an email/URL). Ask this at the start of the new
  session rather than guessing copy that becomes visible on every screen.
- **Must be toggleable**: wrap in an env flag (e.g.
  `NEXT_PUBLIC_SALE_WATERMARK=true`), default on for now. Reason: the day
  this actually sells or goes into a real institutional pilot, the
  for-sale watermark needs to come off without a code change/redeploy
  scramble — a build-time env var handles that cleanly.
- Print/PDF consideration: if exam content or grade reports are ever printed,
  decide whether the watermark should also appear in print output (probably
  yes, for consistency with an anti-copying intent) — flag as an open
  question, not a blocker.

## Ask 2 — GUI improvement + logo placement
User's own words: "IMPROVE THE APP GUI and DECIDE WHERE TO PERFECTLY DISPLAY
THE LOGOS."

Proposed approach (recommendation, not yet built — confirm/adjust in the new
session):
- Build a shared `<AppHeader />` server component, rendered from
  `src/app/layout.tsx` above `{children}` for every authenticated route
  (skip it on `/login` — that page already has its own centered branding
  treatment which works well and shouldn't be duplicated above it).
- Header layout: institution crest + seal small, top-left, next to the app
  name; current user's name/role + a sign-out control, top-right. This
  finally gives every inner page (dashboard, courses, exams, admin, users)
  a consistent identity strip — right now a faculty member three clicks deep
  in an exam builder has no branding or "who am I logged in as" visible at
  all, which reads unfinished for a pitch demo.
- Keep the login page's current centered seal+crest treatment as-is — it
  already tested well.
- The SlickLab.Digital watermark stays out of the header (that's the
  ownership watermark's job per Ask 1) — header is institution branding only,
  to keep the "whose app is this for the end user" story clean and separate
  from "who built it / who owns it."
- This is real layout work across every page shell — budget it as its own
  focused pass, verify live in the browser afterward (dashboard, a course
  page, an exam builder, the grading page, at minimum) per this project's
  own testing discipline.

## Reference noted, no action needed
User linked the Examplify/ExamSoft product overview video and summarized its
pitch: offline download-and-take exams, blocking file/app/website access
during the exam, institutional reporting. This is already exactly what
`docs/ARCHITECTURE_DECISIONS.md` ADR-002 scoped as Phase 2 (the offline
Windows lockdown client) and deliberately deferred out of Phase 1. Nothing
new to decide here — the video confirms the roadmap's Phase 2 boundary was
drawn in the right place, not a reason to reopen it now.

## Suggested opening move for the new session
1. Confirm watermark copy/contact info with the user (the one open question
   above).
2. Build the watermark component + env flag, verify live across a few pages
   including the exam-taking view (must not block interaction).
3. Build `<AppHeader />`, wire into layout, verify live across dashboard /
   course / exam / admin pages.
4. Run `npm run build`, `npx eslint .`, `npm test`, commit.
