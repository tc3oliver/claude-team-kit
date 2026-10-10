# Installing Claude Team Kit (for an AI agent)

You are a coding agent, and a person asked you to install Claude Team Kit (CTK) for them. CTK is a Claude Code **plugin**
that is installed with Claude Code's own Plugin Manager. This page is the short checklist. The reference is
[docs/INSTALLATION.md](docs/INSTALLATION.md); where the two differ, that page wins, and this page only links to it.

## Rules

1. **Use only the native Plugin Manager**: `claude plugin ...` in a shell, or the `/plugin` slash commands. Do not write
   your own installer, copy files into the plugin cache, or edit `installed_plugins.json` or `known_marketplaces.json`.
2. **Run nothing from the network.** No `curl | bash`, no downloaded script, no `npm install`, no `npx`. Claude Code
   itself clones the public GitHub repository; that is the only download.
3. **Merge, never overwrite.** Change `settings.json` by adding keys with a small edit, after you have shown the change and
   the person agreed. Keep every other plugin, MCP server, hook, permission and setting exactly as it is.
4. **Remove nothing.** Do not uninstall or disable any other plugin, including Oh My Claude Code (OMC). If you find
   one, say so and leave it. [Coming from OMC](docs/MIGRATION-FROM-OMC.md) explains how the two differ.
5. **Do not read credentials** (`.credentials.json`, tokens, keychains). Installing needs no login.
6. **You cannot run slash commands yourself.** `/reload-plugins`, `/ctk-doctor` and `/plugin ...` are typed by the
   person. Say so plainly when you reach such a step.

## 1. Check first

```sh
claude --version
git --version
claude plugin list
claude plugin marketplace list
```

- **Claude Code 2.1.287 or newer** is needed for the mod (the worker cap and the team line). On an older build the skills
  and agents still install, but there is no cap and no team line: tell the person.
- **git** must exist, because Claude Code clones the repository.
- If `CLAUDE_CONFIG_DIR` is set, that directory is the Claude Code config; otherwise it is `~/.claude`
  (Windows: `%USERPROFILE%\.claude`). Use that path for every `settings.json` step below.
- From `claude plugin list`, read the installed `Version:` of `ctk@ctk-kit`, then pick **one** path. Never reinstall
  over an existing install and never remove one to "start clean": an uninstall deletes the person's plugin options
  (`maxWorkers`, the model choices, the band), and a reinstall does not restore them.
  - **Not listed** → go to step 2 (fresh install).
  - **Listed at the current release** (`v0.1.3` as of this writing; the newest tag under
    <https://github.com/tc3oliver/claude-team-kit/releases> is authoritative) → skip to step 3 and keep everything as it
    is. There is nothing to install and the options are already correct.
  - **Listed at an older version** → *update*, do not reinstall. From a shell:
    `claude plugin marketplace update ctk-kit`, then `claude plugin update ctk@ctk-kit`; in Claude Code the person types
    `/plugin update ctk@ctk-kit`, then `/reload-plugins`. An update arrives only when the plugin `version` changes, and it
    keeps every plugin option. Details: [update and remove](docs/INSTALLATION.md#update-and-remove-native).
  - **Listed but pinned to a release tag** (`claude plugin marketplace list` shows
    `tc3oliver/claude-team-kit@<tag>`, and `settings.json` records a `ref`) → that install is frozen at the tag *by
    design*; leave it running and say so. `plugin update` will not move it to a different tag. To reach a newer release the
    person must re-point the marketplace, and Claude Code refuses a second `marketplace add` at a different ref while one
    is registered — so re-pointing means `marketplace remove ctk-kit` (which also removes the plugin **and its options**),
    then add at the new tag and reinstall with `--config`. That is the person's call, not yours: note the options first
    (`/ctk-doctor` shows the cap) and see [update and remove](docs/INSTALLATION.md#update-and-remove-native).
- If `claude` is not on the PATH, or you are not allowed to run it, give the person the slash commands from step 2 instead.

## 2. Install

From a shell (no login, no model call):

```sh
claude plugin marketplace add tc3oliver/claude-team-kit
claude plugin install ctk@ctk-kit
```

Both commands are safe to repeat (they answer "already on disk" and "already installed"). The line `N userConfig options not yet set` is harmless: every option has a default (cap 5). Do not pass `--config`
unless the person asked for a value; [Options](docs/INSTALLATION.md#options) lists them.

**What you just installed.** With no tag, `marketplace add` tracks the repository's default branch (`main`), so `plugin
update` later moves to whatever `main` is at. Every CTK release so far is a **GitHub prerelease**, and a prerelease is
*not* promoted to a "stable latest" automatically — `main` is the newest code, which may be ahead of the latest release
tag. To install a known release instead of tracking `main`, pin the tag on the first command:

```sh
claude plugin marketplace add tc3oliver/claude-team-kit#<release-tag>   # e.g. #v0.1.3
```

`<release-tag>` is any tag under <https://github.com/tc3oliver/claude-team-kit/releases>; the latest is `v0.1.3`. A
pinned install stays frozen at that tag (`plugin update` will not switch it to a different one) — see the pinned case in
step 1 for how to move it later. Pin the newest release unless the person asked for a specific older one; do not pin an
old tag by default.

If you cannot run a shell, ask the person to type these in Claude Code:

```
/plugin marketplace add tc3oliver/claude-team-kit
/plugin install ctk@ctk-kit
/reload-plugins
```

## 3. Turn on Agent Teams

A plugin cannot switch Agent Teams on, and nothing above does. Read `settings.json` and look for
`env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`. If it is not `"1"`:

1. Copy `settings.json` to `settings.json.bak-ctk` next to it.
2. Show the person this exact addition and wait for a yes. Add it to the existing `env` object, or create the object
   if there is none, and change nothing else:

   ```json
   "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }
   ```

3. Optional, ask separately: on Claude 5.x models Claude Code leaves out the Task tools, so `/ctk:team` has no shared
   task list and the team line shows no task counts. `"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"` in the same `env` object adds
   them, at the cost of extra tool definitions in every session. See
   [Agent Teams](docs/INSTALLATION.md#one-time-setup-agent-teams).

## 4. Reload or restart

Tell the person which of these they need to do, because you cannot:

- After the install: `/reload-plugins`, or restart Claude Code.
- After the Agent Teams change: **restart Claude Code**. The environment is read when it starts.

## 5. Verify

Ask the person to run `/ctk-doctor` in Claude Code. It is read-only and prints one exact fix for each thing that needs
action. If the command is not recognised, the mod is not loaded and **the worker cap is not enforced**: say that, do not
call the install a success.

The `guard:` line is evidence-based, not a version check:

| It reads | It means |
|---|---|
| `ready` (`available`) | The mod is loaded and Agent Teams are on, but no agent spawn has reached the guard yet. This is the normal state right after an install. |
| `ON` (`active`) | At least one spawn has reached the guard in this session, so the cap is known to be in the path. It appears after the first team starts. |
| `ERR` | A spawn was refused because the cap could not be checked, the team list was unreadable, or more teammates are live than the cap. Follow the fix line. |
| `unavailable` | Agent Teams are off, or nothing has been read yet. Check step 3. |

`ready` after an install is correct. Do not tell the person it should already read `ON`.

Without a Claude Code session, `claude -p "/ctk-doctor"` runs the same check non-interactively and calls no model
([Verify](docs/INSTALLATION.md#verify)). `-p` has no teammates, so it will read `ready`.

## 6. Platforms

| Platform | Status |
|---|---|
| macOS | Verified by hand: install, update, the cap, Mission Control |
| Linux, Windows | **Tested in CI only**; the commands above are the same, paths differ. Not run interactively |
| Windows Terminal, VS Code terminal | **Not verified** |
| WSL | **Not verified**; Mods are reportedly not available there, so there would be no cap and no team line |

Full matrix: [Limitations](docs/LIMITATIONS.md#platforms). Agent Teams are experimental in Claude Code and Mods are
early access, so this can change under a Claude Code update.

## 7. Report back

Tell the person, briefly: the Claude Code and CTK versions you found, whether you installed or skipped, the exact
`settings.json` change you made (or that you made none), the backup file name, what they still have to do
(`/reload-plugins` or restart, then `/ctk-doctor`), and anything above you could not check. If something failed, keep
the error text and stop; do not retry with a different installer. Recovery steps are in
[update and remove](docs/INSTALLATION.md#update-and-remove-native).
