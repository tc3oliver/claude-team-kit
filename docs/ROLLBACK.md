# Rollback, uninstall and recovery

Every change CTK makes to your setup is recorded, and before it writes anything it backs up the
files it is about to change. This page covers undoing the last change (`ctk rollback`),
removing CTK (`ctk uninstall`), and recovering by hand from a backup.

All output below came from the real CLI against throwaway config directories. Paths are
shortened to `<config>`.

## What CTK records

| What | Where |
|---|---|
| Ledger: every key and file CTK owns, with the value it replaced, plus a list of transactions | `<config>/ctk/ledger.json` |
| Backups, one directory per transaction | `<config>/ctk/backups/<id>/` |

A **transaction** is one `install`, `update`, `config` or `sync` run that changed
`settings.json`, the plugin or a file. A run that changes nothing (a second `ctk install`)
creates neither a backup nor a transaction. `rollback` and `uninstall` take a backup of
their own but are not transactions: a rollback marks the transaction it undid, and
`uninstall` deletes the ledger. `ctk` has no command that lists transactions; read the ledger:

```sh
node -e "for (const t of require('<config>/ctk/ledger.json').transactions) console.log(t.id, t.op, t.at, t.undoneAt ?? '-')"
```

```
muzot11o-9eced7 install 2026-10-08T15:24:21.516Z -
muzot141-825e6e config 2026-10-08T15:24:21.601Z -
```

The last column is the time the transaction was undone, or `-`.

CTK **never deletes a backup**. `ctk doctor` re-reads every backup and checks it against the
checksum in its manifest (`backups: 3 backup(s) restorable`).

## The ownership rule

For each `settings.json` key CTK wrote, the ledger stores the value that was there before (or
"absent") and the value CTK wrote. Undoing one key is a comparison of the key's **current**
value with those two:

| Current value of the key | What undo does |
|---|---|
| equals the value CTK wrote | restore the prior value (delete the key if it was absent) |
| equals the prior value already | nothing to do |
| anything else (you or another tool changed it) | **leave it**, report `conflict: <key>: changed since CTK wrote it; left as is`, stop tracking it |

The exception is `pluginConfigs["ctk@ctk-kit"].options.*` on **uninstall**: Claude Code removes
that whole entry with the plugin, so an edited value is not left in place. CTK reports it as
`removed with the plugin by Claude Code (your value ... is kept in backup <id>)` and exits `0`
([details](#user-edited-plugin-options-go-with-the-plugin)).

Files work the same way using a content hash: a file CTK created is removed only if it still
has the content CTK wrote; a file CTK replaced is restored from the backup copy; a modified
file is left and reported. A key CTK found already holding the desired value was never
claimed (`owned: false`) and is never removed.

The comparison is by value, not by who wrote it. If you set a key to exactly what CTK would
have written, CTK cannot tell and treats it as its own. Observed: after a manual edit setting
`env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` to `"1"`, rollback removed it.

Undo never touches a key CTK did not write, another plugin, or your `CLAUDE.md`.

## Roll back the last change

```sh
ctk rollback --dry-run        # print the plan, change nothing
ctk rollback
```

```
$ ctk rollback
rolled back muzot141-825e6e
  restored /model
  note: profile layer still sets portable.settings.model; run `ctk config unset portable.settings.model` or the next update/config will re-apply it
```

`ctk rollback` undoes the newest transaction that is not already undone. `--to <id>` undoes
that one and every later one, newest first. An unknown id is `error: no transaction <id>`
and an already undone one is `error: transaction <id> was already rolled back` (both exit 1).
With nothing left it says `nothing to roll back`.

A rollback is itself backed up (`<timestamp>-rollback-<suffix>`) so you can see what it changed.

Rolling back an `install` undoes its keys and the status line script, then runs
`claude plugin uninstall ctk@ctk-kit` and, only if `ctk install` added the marketplace itself,
`claude plugin marketplace remove ctk-kit`. A conflict example (after setting `statusLine`
to `echo mine` and `env.MY_VAR` by hand), exit code `2`:

```
rolled back muzot11o-9eced7
  restored /env/CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  restored /pluginConfigs/ctk@ctk-kit/options/recordStats
  restored /pluginConfigs/ctk@ctk-kit/options/hudBand
  ...
  restored <config>/ctk/bin/ctk-statusline.mjs
  restored plugin ctk@ctk-kit
  restored marketplace ctk-kit
  conflict: /statusLine: changed since CTK wrote it; left as is
```

"restored" is printed for every reversal, including deleting a key that did not exist
before, so `restored /env/...` can mean "removed".

**Rollback reverts `settings.json`, not your profile.** `<config>/ctk/profile.json` and the
device layer keep their values, so the next `ctk update` or `ctk config` applies them again.
That is what the `note:` above says: after `ctk config set portable.settings.model opus`,
rollback removed `model` from `settings.json`, and `ctk config list` still showed
`portable.settings.model = "opus"`. To make a rollback stick, also run the
`ctk config unset ...` command the note prints.

## Uninstall

```sh
ctk uninstall --dry-run
ctk uninstall
```

```
uninstalled ctk (backups kept in <config>/ctk/backups)
  restored /statusLine
  restored /env/CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  restored /pluginConfigs/ctk@ctk-kit/options/recordStats
  ...
  restored plugin ctk@ctk-kit
  restored marketplace ctk-kit
```

In order: reverse every key and file CTK owns under the ownership rule; run
`claude plugin uninstall ctk@ctk-kit`; run `claude plugin marketplace remove ctk-kit` only
when `ctk install` added it (a marketplace you registered yourself before is kept; the plugin
itself is always uninstalled); then delete the CTK-owned files in `<config>/ctk/`. A backup
named `<timestamp>-uninstall-<suffix>` is taken first.

After a clean uninstall `<config>/ctk/` holds `backups/` and, if they existed, `devices/` and
`sync/`. Those two hold things you made (your device overrides, the profile repo clone), so
uninstall keeps them and says so:

```
  note: kept <config>/ctk/devices (your device overrides / sync clone); delete it by hand if you no longer need it
```

(`stats/`, `profile.json`, `bin/` and the ledger are deleted. The
uninstall backup holds `settings.json`, Claude's two plugin registry files, the status line
script, the ledger and `profile.json`, but not `stats/`.)

Claude Code leaves empty objects behind in `settings.json`; this is cosmetic and harmless:

```json
{ "enabledPlugins": {}, "extraKnownMarketplaces": {} }
```

Other plugins are untouched. With OMC installed (and disabled) in the same config directory,
its plugin entry, marketplace and disabled state were unchanged after `ctk uninstall`.

### If uninstall cannot finish

If any step reports a conflict or fails, uninstall keeps `<config>/ctk/` **including the
ledger**, so you can fix the cause and run it again. Example: you edited
`<config>/ctk/bin/ctk-statusline.mjs`. Exit code `2`:

```
uninstall incomplete
  restored /statusLine
  ...
  restored plugin ctk@ctk-kit
  restored marketplace ctk-kit
  conflict: <config>/ctk/bin/ctk-statusline.mjs: edited since CTK wrote it; kept
  note: <config>/ctk was kept (ledger included); resolve the conflicts above and run "ctk uninstall" again
```

After the edited script was deleted, a second `ctk uninstall` finished (exit `0`,
`<config>/ctk/` left with `backups/` only).

### User-edited plugin options go with the plugin

`claude plugin uninstall` deletes the whole `pluginConfigs["ctk@ctk-kit"]` entry (reproduced
with Claude Code 2.1.294 on its own; entries for other plugins are kept). So a value you edited
there cannot survive an uninstall. CTK says so instead of claiming it left the value, and
exits `0`. Example after editing `maxWorkers` to 7 and `hudBand` to false:

```
  note: /pluginConfigs/ctk@ctk-kit/options/hudBand: removed with the plugin by Claude Code (your value false is kept in backup 2026-10-08T15-24-10-668Z-uninstall-1d7a7e)
  note: /pluginConfigs/ctk@ctk-kit/options/maxWorkers: removed with the plugin by Claude Code (your value 7 is kept in backup 2026-10-08T15-24-10-668Z-uninstall-1d7a7e)
```

and the file ends as `{ "enabledPlugins": {}, "extraKnownMarketplaces": {}, "pluginConfigs": {} }`.
Recover the values from that backup as described next. Edited keys outside
`pluginConfigs["ctk@ctk-kit"]`, such as `statusLine`, are really left alone and reported as
conflicts (exit `2`).

## Recover by hand from a backup

A backup directory looks like this:

```
<config>/ctk/backups/2026-10-08T15-24-10-668Z-uninstall-1d7a7e/
  manifest.json
  files/0  files/1  files/2 ...
```

`manifest.json` maps each number to the original path. Print the map:

```sh
node -e "const m=require('<config>/ctk/backups/<id>/manifest.json'); m.entries.forEach((e,i)=>console.log(i, e.existed?'saved ':'absent', e.path))"
```

```
0 saved  <config>/settings.json
1 saved  <config>/plugins/installed_plugins.json
2 saved  <config>/plugins/known_marketplaces.json
3 saved  <config>/ctk/bin/ctk-statusline.mjs
4 saved  <config>/ctk/ledger.json
5 absent <config>/ctk/profile.json
```

`absent` means the file did not exist when the backup was taken (no copy). `files/N` is a
byte-for-byte copy, mode 0600 on macOS and Linux. Directories under `backups/` are mode 0700.
Backups of `settings.json` can contain whatever secrets your `env` holds, so treat them like
the file itself.

To get one value back, compare, then edit `settings.json` by hand:

```sh
diff <config>/settings.json <config>/ctk/backups/<id>/files/0
```

To put a whole file back, copy it over (close Claude Code first, because it rewrites
`settings.json`):

```sh
cp <config>/ctk/backups/<id>/files/0 <config>/settings.json
```

On Windows PowerShell: `Copy-Item <config>\ctk\backups\<id>\files\0 <config>\settings.json`.
After restoring `settings.json` wholesale, `ctk doctor` will likely warn that the ledger no
longer matches. Either run `ctk uninstall` to clear CTK's records or move
`<config>/ctk/ledger.json` aside and run `ctk install` again; keys CTK finds already holding
the right value are then recorded as not owned and are never removed.

Do not restore `ledger.json` and `settings.json` from different backups.

## If the ledger is unreadable

A ledger that does not parse or validate is never silently replaced. `install`, `rollback` and
`uninstall` stop with `error: <config>/ctk/ledger.json is not valid JSON (invalid ledger: ...);
refusing to modify it`, and `ctk doctor` reports `ledger: FAIL` with the fix "move
ctk/ledger.json aside and run ctk install". A `settings.json` that is not valid JSON stops
`install`, `update`, `rollback` and `uninstall` the same way (`uninstall` was run; the others call the same
reader); fix the file first.

## Not verified

- Going back to an older CTK release (a git tag or an older tarball), as opposed to undoing a
  transaction: not tested. The safe sequence is `ctk uninstall`, check out or install the old
  version, `ctk install`.
- A rollback of an `update` that bumped the plugin version: not tested. Only same-version
  updates were run.
- Rolling back an `install` where the plugin or marketplace was registered before CTK ran: the
  plugin is only uninstalled if CTK installed it, per the code. This case was run for `uninstall`
  (the plugin was removed, the marketplace kept), not for `rollback`.
- Concurrent writes: Claude Code rewrites `settings.json` while it runs. Run `ctk rollback`
  and `ctk uninstall` with Claude Code closed. CTK writes `settings.json` atomically, but it was not
  stress-tested it against a running Claude Code.
