# Natural language

CTK can be used by just saying what you want, in English or Chinese. This is **best effort**:
Claude Code decides, on its own, whether a skill fits your sentence. Nothing here is guaranteed,
and every entry point keeps a slash command as the reliable fallback.

There is no extra model call, no `CLAUDE.md` injection and no prompt rewriting. Two mechanisms
apply:

- Claude Code's native skill discovery: the one-line `description` of each skill is visible to the
  model, and the model may load the skill when your request matches.
- For the team skill only, a small hint from CTK (next section).

## The team hint

The CTK mod checks your own prompt (typed and sent with Enter, or sent through Remote Control)
against a small fixed list of English and Chinese phrases: several agents, a team, parallel work,
or "use CTK". When one matches, it adds one hidden line beside your prompt that says: if the request
asks for several agents, a team or parallel work, invoke `ctk:team` first. Your text is not changed
and the line is not shown.

- It is a phrase check, not a classifier. It makes no model call and adds nothing to a prompt that
  does not match, so it has no always-on cost. A slash command, a prompt that already names
  `/ctk:team`, and anything that is not your own prompt are left alone.
- The model still decides whether to load the skill, and the skill's own intent gate still applies:
  a vague or non-team request gets one sentence back, not a team.
- The plugin option `teamHint` (on by default) turns it off: `/plugin configure ctk@ctk-kit`, or ask in plain words to set it and confirm in Mission Control.
- Not measured. In one real session the hint reached the model and `ctk:team` loaded. That is one
  observation, not a rate; the pass rates below were measured without the hint.

## What works, and what needs you

| You say (any language) | What happens | Reliable fallback |
|---|---|---|
| "use multiple agents / a team / in parallel", 「幫我用多個 Agent 重構這個模組」, 「這個功能可以平行開發嗎？」 | Claude loads `ctk:team`. The skill first checks you really asked for a team; if not, it answers with one suggestion sentence and waits. Spawns are still capped when the CTK mod is active (default 5). | `/ctk:team <goal>` |
| "review my changes", 「幫我檢查一下這次的修改」 | Claude loads `ctk:review` (risk-based). Claude Code also ships a generic `code-review` skill, so it may pick that instead. | `/ctk:review` |
| "use CTK to debug this failure", 「用 CTK 幫我診斷測試失敗」 | Explicit CTK debugging selects `ctk:debug`; generic debugging may use the standalone `diagnosing-bugs` skill when installed. | `/ctk:debug <symptom>` |
| "how is the team doing", "how much of my 5h limit is left", 「團隊進度如何」 | Claude answers from the `ctk_team_status` tool (live, cap, workers, guard, usage, tasks). A field the tool does not return is reported as unavailable, never guessed. The CTK band is the live view; `/ctk-mission` opens Mission Control. | `/ctk-mission`, `/ctk-stats` |
| "is CTK working" | Claude points you to `/ctk-doctor` or reads the status tool. | `/ctk-doctor` |
| "change the worker cap to 2", "turn off the team band" | Claude calls `ctk_config` with `{"action":"propose",...}`. **Nothing is applied**: a confirmation opens in the Mission Control pane and **you** confirm there. Claude will not edit `settings.json`. | `/plugin configure ctk@ctk-kit` |
| "sync my CTK profile to the other computer" | Needs the optional `ctk` CLI. Claude checks it exists, runs `ctk sync pull --dry-run` or `ctk sync publish --dry-run`, shows the output, and asks you in plain words before running the real command. Exit code 2 (conflicts) and the secrets scan are never bypassed. | run `ctk sync ...` yourself |

Option names for `ctk_config`: `maxWorkers`, `explorerModel`, `implementerModel`, `reviewerModel`,
`highRiskModel`, `designerModel`, `hudBand`, `hudIdle` (what the band shows before a team starts: `full`, `minimal`, `hidden`), `recordStats`, `teamHint`.

A plain task ("fix this bug in src/rle.js", "explain what slugify does") does not start a team. When both CTK and the independent `diagnosing-bugs` skill are installed, generic debugging should use one appropriate diagnosis protocol rather than run both. Explicit `/ctk:debug` remains available.
A vague big task ("refactor the whole system") does not either; if the team skill were ever
loaded for it, step 0 of the skill replies with one sentence and waits.

## Always-on cost

(The team hint above is not part of this: it is added per matching prompt only.)

The model sees one line per model-invocable skill and per agent on every turn. The `team`
skill used to be hidden (`disable-model-invocation: true`, zero cost) and is now visible; the
four agent descriptions were shortened to pay for that, and a new small `ctk` skill was added.

Measured with `claude -p "reply with the single word ok" --output-format json --model sonnet
--setting-sources project`, total = input + cache-creation + cache-read tokens, interleaved runs:

| Setup | Total tokens |
|---|---|
| No plugin | 17,978 (intermittently 16,285, a change outside the plugin; the old and new plugin never dropped) |
| Old plugin (before this change) | 18,349 (+371 over 17,978) |
| This plugin | 18,403 (+425 over 17,978) |

Re-measured after the `ctk:designer` agent was added (Claude Code, same command, five interleaved
runs per setup, each run in a fresh process; the cache state differs from the table above, so
compare within this table only):

| Setup | Total tokens (each run) |
|---|---|
| No plugin | 18,128, 18,128, 18,128, 16,435, 16,435 (the lower value is the same intermittent drop outside the plugin) |
| Plugin before the designer (4 agents) | 18,557 on all five runs (+429 over 18,128) |
| Plugin with the designer (5 agents) | 18,607 on all five runs (+479 over 18,128) |

The designer line adds **50 tokens**. The plugin's whole fixed cost is now **+479 tokens**, still
under the 500-token CI budget (`node scripts/measure-context.mjs 500` checks description text only:
about 196 tokens) but with little room; another component would need a merge or shorter text first.

This change adds **54 tokens** (old plugin to this plugin). The plugin's whole fixed cost is **+425
tokens** measured, which is **above the 250-token goal** (and was +371 before this change). Why: the model
sees one listing line for each of the 4 skills and 4 agents, plus the names of two deferred tools, and
each line carries framing around its short description; the descriptions' own text is about 176 tokens
(`node scripts/measure-context.mjs`, characters / 4). Getting under 250 would take dropping components
(the agents are the cheapest to merge), not shortening words. `claude plugin details` is a separate
estimate with a floor of about 40 tokens per component (about 320 for these 8 components); on Claude Code
2.1.294 the same command printed about 187 for the earlier 7-component build, so the numbers are not
comparable across versions.

## How it was tested

`plugins/ctk/evals/` holds 20 cases (`<case>/prompt.md` plus `graders/*.md`), in the format of
`claude plugin eval` (verified to load and run, for example
`claude plugin eval plugins/ctk --case ctk-sync-en --runs 1 --ablation none --trust-plugin`).
Each grader asserts that a `Skill` tool call with the expected name happened (positive cases) or
did not (negative cases). `plugins/ctk/evals/run.mjs` runs the same files headlessly with
`claude -p --output-format stream-json`, no dependencies:

```
CTK_EVAL_CWD=<scratch git repo> node plugins/ctk/evals/run.mjs --runs 2
```

Every run stops after the first tool calls (`--max-turns`, 1 or 3), so nothing is carried out.
No agent can spawn: runs use `--disallowedTools Agent`, or, to keep the model's real tool list,
a `PreToolUse` hook that blocks `Agent` (checked first with a canary prompt). Model: Sonnet.
Prompts were run in a scratch repo of five small JavaScript modules.

Historical results for descriptions **before the optional-skill composition update** (runs passed / runs). The updated CTK debug selection wording has **not** been re-evaluated yet:

| Group | Cases | Passed |
|---|---|---|
| Team, positive (4 cases: English multi-agent, English split-work, Chinese multi-agent, Chinese parallel) | Agent tool removed, 2 runs each | 8/8 |
| Same cases, Agent tool present but blocked by the hook | 3 runs each | 12/12 |
| Negative (fix a bug, 中文 fix a bug, explain a function, add one test, "refactor the whole system" in English and Chinese): team skill not loaded | 3 runs each | 18/18 |
| `ctk` skill: status (en, zh), config (en, zh), sync (en, zh) | 2 runs each | 12/12 |
| `review` (en, zh), `debug` (en, zh) | 2 runs each | 8/8 |

Honest notes:

- The status questions mostly reach the `ctk_team_status` tool directly (the tool is visible to the
  model), without loading the `ctk` skill. The grader accepts either route; the answer is the same.
  Config and sync questions load the `ctk` skill.
- Earlier description wordings failed, and the numbers above are after tuning: English "use multiple
  agents" prompts went straight to the native `Agent` tool (0/3 to 0/2) until the description said
  "Invoke before spawning several agents"; a shorter wording then dropped "split the work" to 0/3
  until "split" and "Keeps the worker cap" were restored. "review my changes" once chose the
  built-in `code-review` skill (1/2) before the description was reworded. The final suite was
  re-run after the last wording change, but the tuning used the same prompts, so these rates are
  an optimistic estimate for unseen phrasing.
- Two to three runs per case is small. A pass rate of 100% here means "no failure seen", not a
  guarantee.
- Skill selection was tested. The bodies were exercised only in two short runs: `ctk` sync stops
  at `ctk --version` when Bash is not approved, and a status question returned the tool's JSON
  (including `usage`) and a correct summary. The `ctk_config` propose flow and a real
  `ctk sync` round trip were not run end to end.
- `claude plugin eval` runs its own isolated harness and, as documented, copies your credentials
  into it. The runner above lets you pick the config directory yourself.

## Limits

- Loading the skill is the model's decision, with or without the hint. A question ("can this be done in parallel?") may be answered
  with analysis instead of loading the team skill; a long conversation may crowd out the hint.
  Use the slash command when it matters.
- The English and Chinese keywords are in the `team` description only because they moved the
  results; other languages are untested.
- "Use multiple agents" can still be satisfied by the model with ordinary subagents without loading
  `ctk:team`. The CTK worker cap (enforced by the Mods hook, not by the skill) gates only spawns
  that Claude Code marks as teammates; ordinary subagents are not counted. The slicing, task list
  and spawn checks of the skill do not apply to them either.
- The team skill needs Agent Teams enabled; without it, it tells you the one-time setup and spawns
  nothing. `/ctk-doctor` shows readiness.
- Both CTK tools are deferred: the skill tells Claude to load them with ToolSearch first, which the status runs below did.
- Changing a setting always needs your confirmation in Mission Control. Syncing always needs your
  explicit yes after the dry run.
