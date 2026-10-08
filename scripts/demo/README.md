# Demo tooling

Turns real terminal sessions into README-friendly assets. No npm dependencies: Node >= 20, plus the
`tmux` binary for recording.

## The rule

Assets are produced only by `record.mjs` from real runs. Nothing is drawn, edited or replayed by
hand. Every asset ships with:

- its `.frames.jsonl` recording, the source of truth the SVG is rendered from;
- a metadata line (the first line of that file): date, Claude Code version, ctk commit, model.
  A commit ending in `-dirty` means the recording was made from a working tree with uncommitted
  changes; re-record from a clean commit before a release.

Frames may be merged or dropped to fit the size budget, but every frame shown was captured from a
real session. The synthetic frames in `test/demo-render.test.ts` exist only to test the renderer
and are never published.

## Recording: `record.mjs`

```sh
CLAUDE_CONFIG_DIR=/tmp/ctk-demo/cfg node scripts/demo/record.mjs \
  --out docs/assets/install.frames.jsonl --script scripts/demo/install.script.json \
  --cols 110 --rows 26 --cwd /tmp/ctk-demo/work --home /tmp/ctk-demo/home \
  --path /tmp/ctk-demo/bin:/usr/bin:/bin --env 'PS1=$ ' --idle 1500 \
  -- /bin/bash --noprofile --norc
```

- It runs the command inside a detached tmux session of fixed size, on a private tmux socket with no
  user config, with a clean environment (`env -i`): `HOME`, `PATH`, `TERM=xterm-256color`, `LANG`,
  `CLAUDE_CONFIG_DIR` and any `--env K=V`.
- It samples `tmux capture-pane -p -e -J` (ANSI colours kept) every 250 ms and stores a frame only
  when the screen changed, as `{"t": ms, "text": "..."}` lines after one `{"meta": {...}}` line.
- It stops when the pane's command exits, when `--until REGEX` matches (after the script is done), after
  `--idle` ms without change (after the script is done), or at `--limit` ms (exit code 3). The tmux
  server is always killed.
- Safety guard: it refuses to start unless `CLAUDE_CONFIG_DIR` is set to a path that is not inside
  `~/.claude*` (symlinks are resolved). Point it at a scratch directory.

### Keystroke scripts

A script is a JSON array of steps, run in order. Each step first waits, then sends keys:

| Field | Meaning |
|---|---|
| `at` | wait until this many ms after the start |
| `waitFor` | wait until the screen matches this regex |
| `waitForLine` | wait until the last non-empty line matches (for example `\\$$` for a shell prompt) |
| `timeout` | ms to wait for `waitFor*` before failing (default 30000) |
| `delay` | pause in ms before sending |
| `keys` | literal text; `\n` presses Enter |
| `typed` | ms between characters, so typing is visible (default: all at once) |
| `key` | tmux key name or a list of them (`C-c`, `Tab`) |

A failed wait aborts the recording with an error. The frames captured so far are still written.

### Live sessions: masks, approvals, abort

For a real, paid session (`team-demo.sh`) the recorder has a few more options:

- `--mask-file FILE` (or `--mask 'REGEX=REPLACEMENT'`): every captured frame is rewritten before it is
  stored or matched, so account name, email, organisation id and plan never reach the frames file. The
  file is JSON, `[{"match": "<regex>", "replace": "<text>", "label": "email"}]`, and lives outside the
  repo. The meta line records the labels (`masked`) and how many replacements happened
  (`maskedReplacements`), never the patterns. Masks match the raw ANSI text, so a string split by a
  colour change is not caught: grep the result.
- `--approve REGEX`: when the screen matches (for example `❯ 1\. Yes`, a permission prompt) the recorder
  presses Enter, at most once every 2 s. Every approval is listed in the meta line as
  `permissionApprovals` with its time, so the recording discloses that a human-equivalent approval was needed.
- `--abort-on REGEX`: kills the session at once if the screen matches, exit code 4 (a spend or
  spawn-count guard, for example `(?:[4-9]|\d{2,}) busy|· \$\d{2,}\.\d\d`).
- `--slow-interval MS`: after the first 15 s, and whenever no key was sent for 3 s, sample at this
  slower rate. A ten-minute Claude Code session at 250 ms is tens of megabytes of frames.
- Script steps accept `stable: ms` next to `waitFor`: the condition must hold without a break for that long.
- While recording, frames are also appended to `<out>.partial`, so a killed run still leaves evidence.

### Keeping paths private

Anything printed on screen ends up in the asset. Record from short scratch paths, never under a home
directory: a symlink such as `/tmp/ctk-demo/cfg -> <scratch>/cfg`, `/tmp/ctk-demo/ctk-kit -> <checkout>`
(run node with `--preserve-symlinks --preserve-symlinks-main` through a small `ctk` wrapper on the
session `PATH`), and a throwaway `--home`. After rendering, grep the SVG and the `.frames.jsonl` for the
user name and the home path.

## Rendering: `render-svg.mjs`

```sh
node scripts/demo/render-svg.mjs docs/assets/install.frames.jsonl \
  --out docs/assets/install.svg --title 'ctk install, doctor, stats'
node scripts/demo/render-svg.mjs docs/assets/install.frames.jsonl \
  --static-out docs/assets/doctor.svg --at-regex 'all checks passed'
```

- Animated SVG (`--out`): CSS keyframes only. Each frame is shown for its real duration divided by
  `--speed` (default 1); any gap longer than `--max-gap` seconds (default 2) is capped; the last frame
  holds for `--end-pause` seconds (default 3), then the animation loops. A viewer that does not animate
  shows the final frame.
- Static SVG (`--static-out`): one frame chosen with `--frame N` (negative counts from the end) or
  `--at-regex RE`; the last frame by default.
- ANSI: 16, 256 and truecolor foregrounds and backgrounds, bold, dim, italic, underline, strike and inverse.
  Lines that `capture-pane -J` joined are wrapped again at the recorded width.
- Layout: dark theme with a window title bar, a fixed cell grid (every run of text is placed at its
  exact column), monospace font stack, XML-escaped text. The window is cropped to the rows actually used.
- Only rows that change are animated, and identical rows are merged. If an SVG would exceed
  `--max-bytes` (default 400000) frames are coalesced progressively; if it still does not fit, the
  render fails.
- The SVG has no scripts and no external references, so GitHub keeps it intact. The metadata line is
  kept in its `<desc>`.

## GIF and MP4: `render-video.mjs`

```sh
node scripts/demo/render-video.mjs docs/assets/team-demo.frames.jsonl --work-dir /tmp/ctk-demo/video \
  --gif docs/assets/team-demo.gif --mp4 docs/assets/team-demo.mp4 --target-seconds 40
```

It uses the same timing as the animated SVG (`--speed` or `--target-seconds`, `--max-gap`,
`--end-pause`). Each distinct frame is rendered as a static SVG; headless Chrome screenshots them
(`--tile` frames stacked per page, so one Chrome run covers eight frames); ffmpeg crops the tiles
apart and stitches them with the concat demuxer. The underlying commands, for reference:

```sh
chrome --headless=new --hide-scrollbars --user-data-dir=$WORK/profile \
  --screenshot=$WORK/page0.png --window-size=$W,$((H*8+150)) file://$WORK/page0.html
ffmpeg -i page0.png -vf crop=$W:$H:0:$((i*H)) -frames:v 1 f0000.png            # per tile
ffmpeg -f concat -safe 0 -i frames.txt -t $TOTAL \
  -vf "fps=8,scale=1040:-2:flags=lanczos,format=yuv420p" -c:v libx264 -crf 30 -preset slow -movflags +faststart out.mp4
ffmpeg -f concat -safe 0 -i frames.txt -t $TOTAL \
  -vf "fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" -loop 0 out.gif
```

Headless Chrome does not always exit after writing the screenshot, so the script waits for the file
to stop growing and then kills the process. `render-svg.mjs --target-seconds N` picks the `--speed`
that makes the capped timeline last about N seconds.

## The team demo

`team-demo.sh` rebuilds the whole `docs/assets/team-demo.*` set from scratch; the prose is in
`docs/DEMO.md`. It needs a dedicated, logged-in config dir, a masks file, tmux, ffmpeg and Chrome, and it
spends real money.

## Assets

| File | Recorded by |
|---|---|
| `docs/assets/install.svg`, `install.frames.jsonl` | `install.script.json`: `ctk install --dry-run`, `ctk install`, `ctk doctor`, `claude -p "/ctk-stats"` in a scratch config dir. No model call and no login. |

## Tests

`node --test test/demo-render.test.ts` covers the renderer with a tiny synthetic recording (XML
structure, colour mapping, escaping, gap capping, size limit), the recorder's config-dir guard, and one
real tmux session (skipped when tmux is missing).
