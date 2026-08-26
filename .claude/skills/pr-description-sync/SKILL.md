---
name: pr-description-sync
description: Generate a PR description for the current branch's changes, referencing relevant SOLUTIONS_LOG.md entries, and open it as a draft PR. Trigger with "open PR", "generate PR description", or automatically at the end of bounded-refinement-loop.
---

# pr-description-sync

## Instructions
1. Confirm a git remote exists (`git remote -v`) and `gh` is authenticated before attempting anything. If there's no remote configured, say so and stop — don't error out partway through.
2. Only run this if there are committed changes on a non-main branch ahead of main. If nothing to PR, say so and stop.
3. Look for a PR template at `.github/PULL_REQUEST_TEMPLATE.md` and follow its structure if present. Otherwise use: Summary (bullets), Root cause / motivation, Test plan (checklist).
4. Pull context from `SOLUTIONS_LOG.md` entries added during this branch's work — summarize, don't paste the raw entries verbatim.
5. Open the PR as a draft using `gh pr create --draft`. Never mark it ready-for-review or request reviewers automatically — that's the user's call.
6. Report the PR URL when done. Do not merge, approve, or comment "LGTM" on your own PR under any circumstance.
