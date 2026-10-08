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

## Assets

| File | Recorded by |
|---|---|
| `docs/assets/install.svg`, `install.frames.jsonl` | `install.script.json`: `ctk install --dry-run`, `ctk install`, `ctk doctor`, `claude -p "/ctk-stats"` in a scratch config dir. No model call and no login. |

## Tests

`node --test test/demo-render.test.ts` covers the renderer with a tiny synthetic recording (XML
structure, colour mapping, escaping, gap capping, size limit), the recorder's config-dir guard, and one
real tmux session (skipped when tmux is missing).
