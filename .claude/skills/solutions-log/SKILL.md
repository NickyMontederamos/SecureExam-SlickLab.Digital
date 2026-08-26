---
name: solutions-log
description: Record a bug fix, regression resolution, or architectural decision into the project's persistent SOLUTIONS_LOG.md so future sessions start from the accumulated context instead of re-deriving it. Trigger after fixing a non-trivial bug, or when explicitly asked to "log this" or "record this decision".
---

# solutions-log

## Instructions
1. If `SOLUTIONS_LOG.md` doesn't exist at the project root, create it with a one-line header explaining its purpose: a running log of non-obvious fixes and architecture decisions, newest entries at the top.
2. Only log things that aren't obvious from reading the code or from git history/commit messages. Skip trivial fixes (typos, one-line null checks). Log: root causes that took real investigation to find, decisions with a non-obvious "why" (tradeoffs rejected, constraints that forced an approach), and any fix to a regression caught by `ci-baseline-guard`.
3. Entry format (prepend, newest first):
   ```
   ## [date] Short title
   **Symptom:** what was observed (test failure, bug report, error)
   **Root cause:** the actual underlying reason, not just the symptom
   **Fix:** what changed, with file:line references
   **Why this approach:** tradeoffs considered and rejected, if any
   ```
4. Do not duplicate entries — before adding, check if a similar issue is already logged and update/supersede it instead of creating a near-duplicate.
5. This file is meant to be committed to git and read by humans too, not just future Claude sessions — keep entries terse and skimmable, not a transcript.
6. Process-retro entries (after a `bounded-refinement-loop` cycle) use a variant format: **What went well**, **What I misjudged**, **Pattern to repeat**, **Pattern to avoid**, **New skill added** (if any). Same rules apply — skip it if there's nothing genuinely non-obvious to report.
