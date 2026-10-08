# Probe patterns

Pick the cheapest probe that can refute a hypothesis.

## Where does it break
- Bisect the pipeline: print the value at the midpoint; recurse into the failing half.
- Bisect history: `git bisect run <repro command>` when it worked before.
- Bisect input: halve the input until the smallest failing case remains.

## What is actually true
- Print the real value and its type at the failing line, not what the code should produce.
- Check the environment: versions, working directory, env vars, which binary resolves.
- Read the full stack trace bottom-up; the first frame in your code is the lead.

## Flaky or timing-related
- Run the repro 20 times; note the failure rate before and after each change.
- Vary ordering and parallelism; serialize to confirm a race, then find the shared state.

## Rules
- One probe, one variable. Do not change the code and the probe together.
- Write down each result before the next probe.
- Delete probes before the fix; re-run the repro to confirm nothing depended on them.
- A hypothesis you cannot refute with a probe is a guess: turn it into one that can be.
