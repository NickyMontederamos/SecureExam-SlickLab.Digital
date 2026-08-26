---
name: ci-baseline-capture
description: Regenerate .claude/ci-baseline.json from the test runner's own structured report (JUnit XML where available) instead of hand-transcribing terminal output. Use whenever ci-baseline-guard needs to establish or update the baseline, for any detected stack (pytest, PHPUnit, Jest, Vitest, Node's built-in test runner, etc.).
---

# ci-baseline-capture

## Why this exists
Hand-typing per-test pass/fail results into `ci-baseline.json` from reading terminal output doesn't scale and is error-prone — it depends on correctly transcribing every test name and status by eye, every cycle. This skill replaces that manual step with a real parse of the test runner's own structured output, whatever the stack.

## Instructions
1. Determine the test command(s) already recorded in CLAUDE.md's `## CI Commands` section (set by `ci-baseline-guard`). A project can have more than one stack (e.g. PHP + JS in the same repo) — run each and merge into one baseline (see step 4). Based on the runner, request a structured report using the flag native to that runner:
   - **pytest**: `--junitxml=<scratch>/report.xml`
   - **PHPUnit**: `--log-junit <scratch>/report.xml`
   - **Node's built-in test runner** (`node --test`, no framework/dependency): `--test-reporter=junit --test-reporter-destination=<scratch>/report.xml`. Prefer this over adding Jest/Vitest/Mocha when the project has no existing JS test framework and no `package.json` — it needs zero new dependencies.
   - **Vitest**: `--reporter=junit --outputFile=<scratch>/report.xml`
   - **Jest**: requires the `jest-junit` reporter package to be installed and configured. If it isn't present in the project's devDependencies/config, say so explicitly and ask before adding a new dev dependency — do not silently fall back to hand-transcription.
   - **Mocha**: requires `mocha-junit-reporter`; same rule as Jest.
   - **Any other runner**: check its `--help` output or docs for a JUnit XML or machine-readable JSON report flag before assuming one doesn't exist. If genuinely none exists, stop and tell the user rather than fabricating one.
2. Write each report to a scratch path outside the repo (not inside `.claude/`), so no `.gitignore` changes are needed.
3. Parse each report into the baseline schema. Node-id format varies by runner and even by version within a runner — verify empirically against the actual output the first time you use this on a given stack, don't assume:
   - If the report gives a `file` attribute directly, use it (confirmed present in both PHPUnit's and Node's built-in test runner's JUnit output).
   - If it only gives a dotted/namespaced classname (e.g. pytest's `classname="tests.test_calculator"`), reconstruct the file path from it and sanity-check against the real file layout before trusting it.
   - Status per test: `passed` / `failed` / `skipped`, read from the report's own failure/error/skipped markers — never inferred from memory of the terminal output.
4. Write `.claude/ci-baseline.json`. Use a single `command` string for a single-stack project, or `commands` (an object keyed by stack name) for a multi-stack project — merge all stacks' results into one `results` map and one `summary`, so `ci-baseline-guard` still does one diff over everything:
   ```json
   {
     "recorded_at": "<today's date>",
     "command": "<the actual test command used>",
     "results": { "<node id>": "passed|failed|skipped", ... },
     "summary": { "passed": N, "failed": N, "skipped": N }
   }
   ```
   or, multi-stack:
   ```json
   {
     "recorded_at": "<today's date>",
     "commands": { "php": "...", "js": "..." },
     "results": { "<node id>": "passed|failed|skipped", ... },
     "summary": { "passed": N, "failed": N, "skipped": N }
   }
   ```
5. Delete the scratch report file(s) after parsing — they're intermediate artifacts, not something to keep around or commit.
6. If no structured report is obtainable for a detected stack (no JUnit/JSON output flag, and no reporter package willing to be added), stop and tell the user. Do not hand-type results as a fallback — that defeats the entire purpose of this skill.

## Known gotchas (found in practice, not documentation)
- `node --test <directory>` does **not** reliably work as a bare directory path on all Node versions — pass a glob (`tests/js/**/*.test.js`) or explicit file list instead. Verify with a quick real run before trusting a directory-path invocation in CLAUDE.md.
