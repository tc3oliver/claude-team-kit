# Configuration

CTK is configured with a **profile**: a small JSON document. You never have to write one by
hand; `ctk config` edits it and applies the result. This page lists every field, its default,
where it ends up, and where CTK keeps its files.

## Layers

The effective profile is built from three layers, later layers winning key by key:

```
CTK Defaults  ->  User Profile  ->  Device Overrides
(built in)        (synced)          (this machine only)
```

| Layer | File | Synced by `ctk sync` |
|---|---|---|
| CTK Defaults | built into the package | no |
| User Profile | `<config>/ctk/profile.json` | yes (published as `profiles/<name>.json`) |
| Device Overrides | `<config>/ctk/devices/<device>.json` | **never** |

Merging rules: objects merge recursively; arrays (`skills`) and scalars are replaced by the
later layer. A layer may contain any subset of the fields below. Unknown keys are rejected,
both in a layer and in the combined result. Examples of each layer are in `examples/profiles/`
(`default.json`, `lean.json`, `device-laptop.json`).

Two names are resolved per run:

- **Device**: `--device <name>`, otherwise the host name lower-cased, `.local` removed, and
  anything outside `a-z 0-9 _ -` replaced by `-` (at most 48 characters).
- **Profile name** (the file inside the profile repo): `--profile <name>`, default
  `default`; lowercase letters, digits, `-` and `_`, at most 48 characters.

## Editing

```
ctk config list                              # the user layer's own values (not the defaults)
ctk config get team.maxWorkers
ctk config set team.maxWorkers 2
ctk config set routing.reviewer.model haiku
ctk config set hud.band false --device-layer # this machine only
ctk config unset team.maxWorkers
```

- Paths are dotted: `routing.highRisk.model`.
- A value is parsed as JSON first (`2`, `true`, `["a"]`) and falls back to a plain string, so
  `haiku` needs no quotes; use `'"3"'` to force a string.
- `set` and `unset` validate the layer *and* the combined profile before writing anything.
- After a change CTK re-applies the profile to `settings.json` under the ownership rules in
  [ARCHITECTURE](ARCHITECTURE.md#ownership-the-ledger-and-transactions). Use `--no-apply`
  to edit the profile only, `--dry-run` to see what would change.
- `list` and `get` read one layer. With no flag that is the user layer; with `--device-layer`
  it is the device layer for `--device`.

If a key CTK would manage already holds a different value that CTK did not write, the change
is reported as a conflict, the key is left alone, and the command exits `2`.

## Fields

`schemaVersion` is `1`. Every other field has a default, so an empty layer is valid.

### Team

| Field | Type | Default | Constraint | Plugin option |
|---|---|---|---|---|
| `team.maxWorkers` | integer | `3` | 1 to 12 | `maxWorkers` |

The most teammates alive at once. A spawn beyond it is denied with `TEAM_CAPACITY_REACHED`.

### Routing

| Field | Type | Default | Plugin option |
|---|---|---|---|
| `routing.explorer.model` | string | `haiku` | `explorerModel` |
| `routing.implementer.model` | string | `sonnet` | `implementerModel` |
| `routing.reviewer.model` | string | `sonnet` | `reviewerModel` |
| `routing.highRisk.model` | string | `opus` | `highRiskModel` |

`model` is a model alias, a full model id, or `inherit` (use the session's model). It is applied
only when a spawn names a CTK agent type (`ctk:explorer`, `ctk:implementer`, `ctk:reviewer`,
`ctk:high-risk-reviewer`) and gives no `model` of its own. An explicit model is never
overridden.

**Effort is not a profile field.** Each agent's reasoning effort comes only from the `effort:`
line in its definition (`plugin/ctk/agents/*.md`): `medium` for `explorer`, `implementer` and
`reviewer`, `high` for `high-risk-reviewer`. A profile cannot change it, because Claude Code's
spawn hook can set a model but not an effort; a layer containing `routing.<role>.effort` is
rejected. To use a different effort, edit or fork the agent files.

### HUD and statistics

| Field | Type | Default | Meaning | Plugin option |
|---|---|---|---|---|
| `hud.band` | boolean | `true` | Draw the one-line team band above the prompt (needs mods). | `hudBand` |
| `hud.statusLine` | `auto` or `off` | `auto` | `auto`: install the status line fallback and set `statusLine` if you have none. `off`: do not manage `statusLine`. | none |
| `stats.record` | boolean | `true` | Write per-session counters to `<config>/ctk/stats/` for `ctk stats`. | `recordStats` |

### Claude Code

| Field | Type | Default | Meaning |
|---|---|---|---|
| `claude.enableAgentTeams` | boolean | `true` | Set `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` to `"1"` in `settings.json` when it is absent. An existing value is never replaced. |

Agent Teams are an experimental Claude Code feature and need this flag.
`ctk install --no-enable-teams` stores `false` here (in the device layer);
`ctk install --no-statusline` stores `hud.statusLine = "off"` there.

### Portable settings

`portable.settings` carries a short whitelist of Claude Code settings so they follow you
between machines. Default: empty (nothing is written).

| Key | Type | Written to `settings.json` as |
|---|---|---|
| `model` | string | `model` |
| `effortLevel` | `low` `medium` `high` `xhigh` | `effortLevel` |
| `teammateMode` | `auto` `in-process` `tmux` `iterm2` | `teammateMode` |
| `outputStyle` | string | `outputStyle` |
| `language` | string | `language` |

Nothing else can be synced this way: credentials, `env`, hooks, permissions, history and
caches are not in the whitelist and the schema rejects other keys. A key removed from the
profile is restored to the value it held before CTK wrote it, provided it still holds what CTK
wrote.

### Skills

| Field | Type | Default | Meaning |
|---|---|---|---|
| `skills` | array of names | `[]` | Skills from the profile repo (`skills/<name>/`) to install into `<config>/skills/<name>/`. Names match `^[a-z0-9][a-z0-9_-]{0,47}$`. |

Used by `ctk sync`; see [ARCHITECTURE](ARCHITECTURE.md#sync).

## How fields reach the plugin

The plugin declares seven `userConfig` options in `plugin/ctk/.claude-plugin/plugin.json`.
CTK writes the effective values to `settings.json`, one key each, under
`/pluginConfigs/ctk@ctk-kit/options/`:

| `settings.json` key | Profile field | Default | Allowed |
|---|---|---|---|
| `maxWorkers` | `team.maxWorkers` | `3` | number, 1-12 |
| `explorerModel` | `routing.explorer.model` | `haiku` | alias, model id or `inherit` |
| `implementerModel` | `routing.implementer.model` | `sonnet` | same |
| `reviewerModel` | `routing.reviewer.model` | `sonnet` | same |
| `highRiskModel` | `routing.highRisk.model` | `opus` | same |
| `hudBand` | `hud.band` | `true` | boolean |
| `recordStats` | `stats.record` | `true` | boolean |

The plugin defaults in `plugin.json` equal the CTK defaults (a test enforces this), so the
plugin behaves the same if you install it without the CLI. The mod re-validates what it
receives: a missing or invalid value falls back to the default, and `maxWorkers` is clamped
to 1-12.

## `settings.json` keys CTK may write

| Key | When |
|---|---|
| `pluginConfigs["ctk@ctk-kit"].options.*` | always (the seven options above) |
| `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | absent and `claude.enableAgentTeams` |
| `statusLine` | absent (or already CTK's) and `hud.statusLine = auto` |
| `model`, `effortLevel`, `teammateMode`, `outputStyle`, `language` | set in `portable.settings` |

`enabledPlugins` and `extraKnownMarketplaces` are written by `claude plugin`, not by CTK.
See [ARCHITECTURE](ARCHITECTURE.md#ownership-the-ledger-and-transactions) for what happens when a
key already has a value, and [ROLLBACK](ROLLBACK.md) for undoing changes.

## File locations

`<config>` is `--config-dir`, then `$CLAUDE_CONFIG_DIR`, then `~/.claude`.

| Path | Purpose |
|---|---|
| `<config>/settings.json` | Claude Code's user settings; CTK edits only the keys above. |
| `<config>/ctk/ledger.json` | What CTK changed, the prior values, and the transaction list. |
| `<config>/ctk/profile.json` | User layer, as last applied on this machine. |
| `<config>/ctk/devices/<device>.json` | Device layer. Never synced. |
| `<config>/ctk/bin/ctk-statusline.mjs` | Status line fallback script. |
| `<config>/ctk/stats/<sessionId>.json` | Per-session counters written by the mod. |
| `<config>/ctk/backups/<id>/` | `manifest.json` plus `files/`: copies taken before each change. Never deleted by CTK. |
| `<config>/ctk/sync/config.json` | Remote URL and branch. |
| `<config>/ctk/sync/repo/` | Local clone of the profile repo. |
| `<config>/ctk/sync/base.json` | Last synced snapshot (merge ancestor). |
| `<config>/ctk/sync/conflicts.json` | Unresolved sync conflicts, if any. |
| `<config>/skills/<name>/` | Skills installed by sync, each with a `.ctk-managed` marker. |
| `<config>/plugins/installed_plugins.json`, `known_marketplaces.json` | Claude Code's own plugin registry; written by `claude plugin`, backed up by CTK before it runs. |

`ctk uninstall` removes everything under `<config>/ctk` except `backups/`, `devices/` and `sync/`
(it prints the paths it kept).

## Environment

| Variable | Effect |
|---|---|
| `CLAUDE_CONFIG_DIR` | Config directory when `--config-dir` is not given. Also read by the mod to find where to write stats. |
| `CTK_COLOR=1` | Enable bold in the status line fallback (off by default). |
| `COLUMNS` | The status line fallback truncates to this width. |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | Set by Claude Code's `env` block; required for Agent Teams. |
| `GIT_ALLOW_PROTOCOL` | `ctk sync` passes `file:git:http:https:ssh` unless you set it. |

## Global CLI options

```
--config-dir <dir>   --profile <name>   --device <name>
--dry-run            --json             --yes
-h, --help           -v, --version
```

`--dry-run` prints the plan. CTK writes nothing; Claude Code itself may still create `.claude.json` and `backups/` in the config directory or normalize `settings.json` (for example `"opus"` becoming `"opus[1m]"`) when CTK runs its `claude` commands. `--yes` is accepted for scripts; the current
commands do not prompt.
