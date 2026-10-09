# Changing CTK's options from the Mods API: evidence and rules

Status: engineering notes for the Mission Control "set an option" flow. Claude Code 2.1.295, probed 2026-10-09.

Legend: **[live]** observed against the real engine in an isolated demo config; **[types]** read from `.claude-plugin/types/claude-code/index.d.ts` only; **[unverified]** inferred, not exercised.

## Verdict

`$.config.set` can be used for CTK's own options, with three conditions:

1. The engine validates only what `plugin.json` can express. CTK must validate everything else itself (`hooks/config.ts`), because the engine accepts `maxWorkers: 2.5`, an empty model string and `"bad model; rm"`.
2. A successful `$.config.set` **reloads the CTK module** a few tens of milliseconds later. Module variables are lost, and code after the `await` may never run. State that must survive belongs in `$.state`.
3. Nothing is applied without the person's press. The model-facing tool only proposes; the Confirm button calls `$.config.set`.

If any of this proves unacceptable, the fallback is guided instructions: tell the person to run `/plugin configure ctk@ctk-kit` (or `/config`) and set the option there. No code path in CTK then writes anything.

## How it was probed

A throwaway plugin `cfgprobe` (not in the repo) carried CTK's seven `userConfig` fields copied from `plugin.json`, registered a command `/cfg-probe`, and was loaded with `--plugin-dir` in the isolated demo config (`CLAUDE_CONFIG_DIR=/tmp/ctk-demo/config`, private tmux socket). The demo `settings.json` was backed up first and restored byte-identical afterwards (`diff` clean). Only the probe's own rows and `pluginConfigs` entry were printed. For the installed `ctk@ctk-kit` rows only key, kind, provider and lock were printed, never values.

## 1. `$.config.list()` rows [live]

Row for each field of a plugin loaded with `--plugin-dir` (provider `cfgprobe@inline`):

| key | kind | value type | `options` | `isLocked` |
|---|---|---|---|---|
| `cfgprobe.maxWorkers` | `number` | number (3) | absent | false |
| `cfgprobe.explorerModel` / `implementerModel` / `reviewerModel` / `highRiskModel` | `text` | string | absent | false |
| `cfgprobe.hudBand` / `recordStats` | `boolean` | boolean | absent | false |

Each row also carries `label` (the `title`), `description`, and `provider: { plugin: "cfgprobe@inline", tier: "user" }`. The key is `<plugin name>.<field>`, with no marketplace suffix.

For the installed CTK, rows exist as `ctk.maxWorkers:number`, `ctk.explorerModel:text`, `ctk.implementerModel:text`, `ctk.reviewerModel:text`, `ctk.highRiskModel:text`, `ctk.hudBand:boolean`, `ctk.recordStats:boolean`, provider `ctk@ctk-kit`, `locked=false` [live]. This is what `optionKey(name)` returns (`ctk.<name>`). Managed settings could lock a row (`isLocked`); the integrator should check it before offering Confirm [types].

## 2. `$.config.set` behaviour [live]

It never throws for a bad value; it resolves `{ value }` or `{ deny: "<reason>" }`. It throws for an unknown key.

| call | result |
|---|---|
| `maxWorkers` 2, 4, 6, 7 | `{"value":N}` |
| `maxWorkers` 99 | `{"deny":"Max live teammates doesn't accept \"99\". It takes a number between 1 and 12."}` |
| `maxWorkers` 0 | same deny text with `"0"` |
| `maxWorkers` 2.5 | **`{"value":2.5}`** (accepted and stored; no integer check) |
| `maxWorkers` `"3"` (string) | `{"deny":"takes a number"}` |
| `hudBand` false | `{"value":false}` |
| `hudBand` `"off"` or `1` | `{"deny":"takes true or false"}` |
| `explorerModel` `"opus"`, `"claude-haiku-4-5[1m]"` | accepted |
| `explorerModel` `""` | **accepted** (empty string stored) |
| `explorerModel` `"bad model; rm"` | **accepted** and stored verbatim |
| `explorerModel` 5 | `{"deny":"takes a text"}` |
| key `cfgprobe.nope` or bare `maxWorkers` | **throws** `HooksError: cfgprobe: $.config.set: no /config row with key cfgprobe.nope ($.config.list names them)` |

So: min and max from `plugin.json` are enforced by the engine; kind (number, boolean, text) is enforced; integrality and text content are not. Setting a field to its default (`hudBand` back to `true`) stores it explicitly instead of removing it.

Consequence for `config.ts`: a model name is never sanitised by the engine, and the value ends up in `agent.spawn`'s `model` field and in the pane. `validateChange` rejects anything outside `[A-Za-z0-9._:\-\[\]]`, over 100 characters, or credential-shaped.

## 3. Where the value lands, and what a running mod sees [live]

- Settings: `pluginConfigs["cfgprobe@inline"].options.maxWorkers = 4` in the demo `settings.json`; the other fields appear only once set. The key is `<plugin>@<marketplace>`; for the installed CTK that is `ctk@ctk-kit` [unverified by write; derived from the provider name].
- `$.config.list()` returns the new value **immediately** after the set resolves.
- The `options` argument of `register(on, options)` is read once per load and does **not** change.
- The set triggers a reload of the module: a fresh `register` with the new `options`, a new module scope, and `session.start` firing again. Log excerpt (load ids differ per load):

```
[59iss] OPT state.stamp={"value":"pendingX","version":1} mark=pendingX starts=1 register-time options={"maxWorkers":7,...
[59iss] CMD set cfgprobe.maxWorkers 3
[59iss] apply: before set
[rwtat] session.start #1 register options={"maxWorkers":3,...      <- new load, 41 ms after "before set"
[rwtat] OPT state.stamp={"value":"pendingX","version":1} mark=unset starts=1 register-time options={"maxWorkers":3,...
```

  Module variable `mark` went from `pendingX` to `unset`; `$.state` survived (version 1). Reload latency was 40 to 55 ms over several runs.
- Code after `await $.config.set(...)` is **not reliable**. Called from a slash command it ran (in the old instance, racing the reload). Called from a Button `onPress` the continuation never ran: the "apply -> RESULT" log line and the `invalidate` after it were lost, and the pane showed the new value only because the new load redrew it. A deny does not reload, so the continuation runs and can report it.

### What the integrating code must do

1. Do all bookkeeping **before** the call: clear the pending change (the state machine's `confirm` already returns the cleared state), and if a result should be announced, record "applying `<key>`=`<value>`" in `$.state` first.
2. The `options` object the old instance holds is stale from the moment the set resolves: the engine does not mutate it. The reload replaces it within tens of milliseconds, so a mod that keeps a mutable copy of the options (CTK's band and cap logic does) should either overwrite that copy with the confirmed value right after a successful set (cheap, and harmless if the reload then discards it) or read `$.config.list()`. Do not wait for `options` to change in place; it never does.
3. After set, report by reading, not by continuing: the new load (or the pane's next `ui.render`) compares `options` or `$.config.list()` with the marker in `$.state` and says "applied" or "not applied", then clears the marker.
4. Handle `{ deny }` and thrown errors in the same handler: they are the only outcomes where the continuation reliably runs.
5. Re-run `validateChange(name, value, currentOptions)` immediately before `$.config.set`, because the person may have changed the row in `/config` since the proposal.
6. Pending changes held in module variables are lost on any reload (including one caused by the person changing something in `/config`). That is the safe direction: a lost proposal can only mean "nothing happens". Keep them in a module variable or in `$.state`, not in `$.store` (which is written to disk and outlives the session).
7. `register` and `session.start` therefore run again after every applied change. CTK's `session.start` is already written to be re-run (the stats and command tests cover "session.start again").

## 4. `claude plugin validate --strict` [live]

```
./register.tsx hooks: session.start, command.run{command=cfg-probe}, ui.render{component=Pane, requestId=cfgprobe}
./register.tsx answers its own command: command.run{command=cfg-probe}
./register.tsx calls: $.command.register, $.config.list, $.config.set, $.fs.read (via note), $.fs.write (via note), $.ui.invalidate, $.ui.open, $.ui.resolve
✔ Validation passed
```

`$.config.list` and `$.config.set` are listed as calls. Nothing has to be declared in the manifest or hooks.json. With `--strict` the only failure seen was a missing `author` in the manifest (a warning treated as an error); CTK has one.

A module that uses `$.state` additionally needs the `types` contract named in `plugin.json`, and its `.d.ts` may only export types (`export {}` is refused).

## 5. Button `onPress` calling `$.config.set` [live]

Both forms passed validation and worked at runtime when the button was focused (`ctrl+x`, `Tab`, `Tab`...) and pressed with Enter:

```tsx
// top level of the file
async function applyChange($: any, key: string, value: number | string | boolean) {
  // 1. bookkeeping first (clear pending, mark "applying" in $.state)
  const r = await $.config.set({ key, value })      // 2. may reload this module
  if ('deny' in r) {                                // only a deny reliably gets here
    /* record the reason, then */ $.ui.invalidate('ui.render')
  }
}

on('ui.render', { component: 'Pane', requestId: 'mission' }, async ($, e) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      <Text>{proposal.text}</Text>
      <Button key="confirm" variant="primary" onPress={() => applyChange($, proposal.key, proposal.value)}>Confirm</Button>
      <Button key="cancel" onPress={() => cancelChange($)}>Cancel</Button>
    </Box>
  )
})
```

- An inline closure `onPress={async () => { await $.config.set(...) }}` inside the hook also validated and worked. The hook's own `$` is valid inside the closure.
- The restriction bites when `$` is passed to a function that is not declared at the top of the file. Negative test, verbatim: `$ is passed to "helper", which is not a function declared at the top of this file (a function declaration, or a const bound to one)`. Declare the helper at top level, as above.
- A key-stable `Button key="..."` is the address `ui.press` reports; give each Button a fixed key, and carry the pending id in the closure (or in the key, for example `confirm:c3`) so a stale pane cannot confirm a newer proposal.
- The pane survived the reload that followed a press and redrew with the new value.

## Other surprises

- `--plugin-dir` plugins have provider `<name>@inline`; the row key is unaffected.
- `Number` rows accept fractions: CTK's own `clampMax` floors `2.5` to 2 on read, which hides the problem, but the settings file would hold `2.5` and `/config` would show it.
- A `text` row cannot be given choices; the `options` property exists only for a string field that declares `options` in `plugin.json`. CTK's model fields do not, deliberately, since a full model id is allowed.
- `$.config.set` runs the other plugins' `config.set` hooks and may be denied by them [types]; its own plugin's hooks are skipped.
- `config.set` called from a plugin carries `origin: { kind: 'plugin', name: 'ctk' }`; a `config.set` hook can tell it from the person's own `/config` edit [types]. A Mission Control press is therefore a plugin-originated change, not the person's menu change, which is why the explicit Confirm step must exist.
- `$.state.set` is refused while a `ui.render` hook draws; write from `onPress` or another event [types].

## `hooks/config.ts` summary

Pure and imports only `../shared/policy.ts`. `validateChange(name, raw, opts)` returns `{ ok: true, name, key, value, from, to, text }` or `{ ok: false, reason, code }` with `code` one of `unknown_option`, `invalid_value`, `unchanged`. A rejection never echoes a rejected string. `propose`, `confirm`, `cancel` and `sweep` return a new state and an outcome: `confirm` releases a change only for the live proposal with the matching id, once; a different id, an expired proposal (older than 10 minutes) and a second press release nothing. `confirm` takes the current time as a third argument because expiry needs a clock and the module has none.
