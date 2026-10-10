---
name: debug
description: "CTK debug for failing tests or behavior: reproduce, diagnose, fix, regression. Use when CTK debugging is requested, or when no standalone debugging skill is installed."
argument-hint: "<symptom or failing command>"
---

Symptom: $ARGUMENTS. Work the phases in order; do not skip ahead to a fix.

Use this CTK diagnosis flow when explicitly selected or delegated inside a CTK team. If a separate standalone debugging Skill is available for an ordinary non-CTK request, follow **one** full diagnosis protocol, not both. BetFirst may provide one bounded, reversible probe within the feedback loop; it never bypasses reproduction or final verification. Neither Backlog nor BetFirst is required.

## 1. Reproduce
Write the failing command or test first and run it. Record the exact error.
If it does not fail, you do not have the bug yet: get more detail from the user, do not guess.

## 2. Minimize
Shrink input, config and code path until the failure remains with the least surface.
Note what you removed that made it pass or fail.

## 3. Diagnose
- List 2-4 hypotheses, most likely first, each with the observation that would refute it.
- Run one probe per hypothesis (a log line, a print, a narrower test). One variable at a time.
- Record result per hypothesis: confirmed, refuted, unclear.
- After three refuted hypotheses, stop and ask the user. Report what you ruled out.
Probe patterns: `references/probes.md`.

## 4. Fix
Change the root cause, not the symptom. Smallest diff. Remove every probe you added.

## 5. Regression test
The reproduction from phase 1 becomes a permanent test. Run it red-before (stash the fix) and
green-after, then run the surrounding suite. Report: cause, fix, test, commands and results.
