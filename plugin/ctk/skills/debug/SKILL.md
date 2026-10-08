---
name: debug
description: Disciplined bug diagnosis: reproduce, minimize, diagnose by hypothesis, fix, add a regression test.
argument-hint: "<symptom or failing command>"
---

Symptom: $ARGUMENTS. Work the phases in order; do not skip ahead to a fix.

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
