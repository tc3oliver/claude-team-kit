# Mission Control showcase

Screenshots of the real Mission Control pane, drawn by a real Claude Code terminal, from fixed
synthetic data. Nothing is drawn by hand and no model is called, so no tokens are spent.

Every picture carries the line `SYNTHETIC DATA - UI showcase, not a live agent run` inside the pane, and
a metadata line (ctk commit, Claude Code version, commit date, terminal width). It is not a recording of a
live agent run and says nothing about how a team behaves.

## How it works

`render.mjs` generates a scratch mod from two parts: the pure modules of the checkout being shown
(`plugins/ctk/hooks/*` except `register.tsx`, and `plugins/ctk/shared`) and `plugin/` here (a one-command mod
plus the scene fixtures). The mod's pane hook calls the checkout's own `renderMission` with a `Mission`
built by the checkout's own `buildMission` from fixture stats, roster and task board (`plugin/scenes.ts`).
It then starts `claude --plugin-dir <that mod>` in a private tmux session through `scripts/demo/record.mjs`,
types `/showcase`, waits for the pane, and renders the captured screen with `scripts/demo/render-svg.mjs`.
The real CTK mod is switched off for those sessions (`--settings` disables `ctk@ctk-kit`).

Scenes: `empty` (true empty state), `team` (four workers, overview), `workers`, `dag` (a diamond, a running owner, a ready task), `usage`,
`guard` (five of five teammates live, two spawns refused), `many` (14 tasks, list fallback), `config` (a pending change), `stats`, `doctor`.

## Run

```sh
node scripts/showcase/render.mjs --out docs/assets/mission-control-ui --name after
node scripts/showcase/render.mjs --out docs/assets/mission-control-ui --name before --ctk <checkout of an older commit>
```

For a BEFORE set, make a worktree of the old commit and pass it as `--ctk`; the working tree is never read
for it. The metadata line takes the commit and its commit date from `--ctk` (`-dirty` when `plugins/ctk` has
uncommitted changes), so the same commit renders the same bytes. Two runs are identical.

Needs `~/.local/bin/claude`, tmux and Node 20+. `--config` is a scratch Claude Code config dir that is
logged in (default `~/Developer/scratch/ctk-demo/config`) and `--cwd` a directory that config already
trusts (default `/private/tmp/ctk-demo/wordkit`); the recorder refuses any config dir under `~/.claude*`.
About 70 s for 30 terminals.

## Output

`<out>/<name>/`:

- `<scene>.svg`: the pane at 100 columns; `<scene>[-<width>].frames.jsonl`: the single captured frame each picture is
  rendered from (with its metadata line);
- `<scene>-widths.svg`: the same scene at 60, 80, 100, 130 and 200 columns, one below the other;
- `METADATA.txt`: the label and the metadata line.

Terminals up to about 110 columns draw the pane as a box above the prompt, and only that box is kept. Wider
terminals dock it beside the transcript (the docked pane is a fixed width of about 58 cells), so those
pictures keep the whole screen down to the pane's last row.

## Tests

`node --test test/showcase.test.ts`: the label and metadata line, the generated mod, the crop, and that every
published SVG carries both. Running the render twice and diffing the directories is the determinism check.
