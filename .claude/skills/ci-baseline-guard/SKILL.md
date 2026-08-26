---
name: ci-baseline-guard
description: Run the project's test/lint/build suite, compare results against the last recorded baseline, and report regressions. Trigger with "run ci", "check for regressions", "baseline check".
---

# ci-baseline-guard

## Instructions
1. Detect the project's canonical commands by checking, in order: `package.json` scripts (JS/TS — npm/yarn/pnpm), `composer.json` scripts and `phpunit.xml`/`phpunit.xml.dist` (PHP), `Makefile`, `pyproject.toml` (Python), CI config files (`.github/workflows/*.yml`, etc.). A repo may have more than one stack — detect and record each independently rather than assuming a single language. If ambiguous, ask the user once, then record the answer in CLAUDE.md under `## CI Commands` so future runs don't re-ask.
2. Look for a baseline file at `.claude/ci-baseline.json`. If it doesn't exist, run the full suite and use `ci-baseline-capture` to generate the baseline from the runner's own structured output — never hand-write it. Report "baseline established" and stop.
3. If a baseline exists, run the suite again and diff against it:
   - New failures that were previously passing = regressions. List them explicitly with the failing test name and error output.
   - Previously-failing tests still failing = known issues, not regressions. List separately, don't treat as new problems.
   - Tests that got meaningfully slower (>50% regression in timing, if timing is available) = flag as a performance regression candidate, not a hard failure.
4. Never modify code in this skill. This is read-only diagnosis. If regressions are found, stop and report them — do not attempt fixes here (that's `bounded-refinement-loop`'s job).
5. Only update `.claude/ci-baseline.json` (via `ci-baseline-capture`) to reflect a new baseline when the user explicitly confirms the current state should become the new baseline. Do not silently overwrite the baseline on every run — that would hide real regressions.
6. Output format: a short markdown summary — counts (passing/failing/regressed), then the regression list, then the known-issues list.
