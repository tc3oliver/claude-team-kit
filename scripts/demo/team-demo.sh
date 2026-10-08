#!/usr/bin/env bash
# Reproduces docs/assets/team-demo.*: one real, live /ctk:team session on the wordkit fixture,
# recorded with record.mjs and rendered with render-svg.mjs / render-video.mjs.
# bash + tmux, macOS or Linux. It spends real money (a few US dollars) and needs a logged-in,
# dedicated Claude Code config dir. Never point it at ~/.claude (record.mjs refuses).
#
#   CTK_DEMO_CONFIG_DIR=<dedicated config dir> CTK_DEMO_MASKS_FILE=<masks.json> scripts/demo/team-demo.sh [prepare|record|render|all]
#
# CTK_DEMO_RUN=b reproduces "Run B": the same session with the task list enabled through CTK's opt-in
# (`ctk config set claude.enableTaskTools true`); its files are docs/assets/team-demo-b.*. Without it the
# files are docs/assets/team-demo.* (Run A, task tools left at Claude Code's default).
#
# CTK_DEMO_RUN=c reproduces "Run C": the plugin installed the native way, with no ctk CLI at all
# (`claude plugin marketplace add tc3oliver/claude-team-kit`, `claude plugin install ctk@ctk-kit`), the two
# one-time settings in settings.json, and a recording that ends with /ctk-stats and /ctk-doctor. Its files are
# docs/assets/team-demo-c.*. `prepare` for run c needs the real HOME for git over ssh while it adds the marketplace.
#
# The recorder kills the session if more than 3 teammates are busy or the status line shows a cost of
# $2.00 or more (test/demo-render.test.ts checks the pattern).
#
# One-time, by hand (first-run screens cannot be scripted safely): run
#   CLAUDE_CONFIG_DIR=<dedicated config dir> claude
# in /tmp/ctk-demo/wordkit (after `prepare`), log in, pick a theme, press Enter on the security
# notes, answer "Yes, I trust this folder", answer "No, keep accept edits" to the auto mode offer,
# then run /ctk-stats once and /exit.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd -P)
DEMO=${CTK_DEMO_DIR:-/tmp/ctk-demo}          # short paths keep personal paths off the screen
CLAUDE_REAL=${CTK_DEMO_CLAUDE:-$HOME/.local/bin/claude}   # the binary, never a shell alias
ASSETS=$ROOT/docs/assets
STAGE=${1:-all}
RUN=${CTK_DEMO_RUN:-a}
case $RUN in b) PREFIX=team-demo-b ;; c) PREFIX=team-demo-c ;; *) PREFIX=team-demo ;; esac
CFG=$DEMO/config
SESSION_PATH=$DEMO/bin:/usr/bin:/bin

# prepare and record need a dedicated config dir and masks; render only reads the frames file
require_inputs() {
  : "${CTK_DEMO_CONFIG_DIR:?set CTK_DEMO_CONFIG_DIR to a dedicated, logged-in Claude Code config dir}"
  case $(cd "$CTK_DEMO_CONFIG_DIR" && pwd -P) in
    "$HOME"/.claude*) echo "team-demo: refusing a config dir inside ~/.claude*" >&2; exit 2 ;;
  esac
  if [ -z "${CTK_DEMO_MASKS_FILE:-}" ] && [ "${CTK_DEMO_NO_MASKS:-}" != 1 ]; then
    echo "team-demo: set CTK_DEMO_MASKS_FILE (JSON [{match, replace, label}] for account name, email, org, plan)" >&2
    echo "           or CTK_DEMO_NO_MASKS=1 if you have checked the screen shows nothing personal" >&2
    exit 2
  fi
}

session_env() { env -i HOME="$DEMO/home" PATH="$SESSION_PATH" TERM=xterm-256color LANG=en_US.UTF-8 CLAUDE_CONFIG_DIR="$CFG" "$@"; }

prepare_native() {
  # Run C: nothing but Claude Code's own plugin commands touches the config, apart from two plain JSON edits.
  local marketplace=${CTK_DEMO_MARKETPLACE:-tc3oliver/claude-team-kit} real
  mkdir -p "$DEMO"/{bin,home,out,work}
  ln -sfn "$CTK_DEMO_CONFIG_DIR" "$CFG"
  ln -sfn "$(command -v node)" "$DEMO/bin/node"
  ln -sfn "$CLAUDE_REAL" "$DEMO/bin/claude"
  for tool in npm npx; do
    real=$(node -p 'require("fs").realpathSync(process.argv[1])' "$(command -v "$tool")")
    printf '#!/bin/sh\nexec "%s" "$@"\n' "$real" > "$DEMO/bin/$tool"
    chmod +x "$DEMO/bin/$tool"
  done
  rm -rf "$DEMO/wordkit"
  cp -R "$ROOT/scripts/demo/fixture" "$DEMO/wordkit"
  ( cd "$DEMO/wordkit" && git init -q && git add -A \
    && git -c user.name=demo -c user.email=demo@example.invalid -c commit.gpgsign=false commit -q -m "wordkit: initial modules" )
  session_env "$DEMO/bin/claude" auth status | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!d.loggedIn){console.error("team-demo: the demo config is not logged in");process.exit(1)}'

  # fresh plugin state: remove ctk and its marketplace if present, and leftovers of the CLI's own directory
  CLAUDE_CONFIG_DIR=$CFG "$CLAUDE_REAL" plugin uninstall ctk@ctk-kit >/dev/null 2>&1 || true
  CLAUDE_CONFIG_DIR=$CFG "$CLAUDE_REAL" plugin marketplace remove ctk-kit >/dev/null 2>&1 || true
  [ -d "$CTK_DEMO_CONFIG_DIR/ctk" ] && rm -r "$CTK_DEMO_CONFIG_DIR/ctk"
  # the native flow; the real HOME is only used here, for git over ssh
  ( cd "$DEMO/work" && CLAUDE_CONFIG_DIR=$CFG "$CLAUDE_REAL" plugin marketplace add "$marketplace" \
    && CLAUDE_CONFIG_DIR=$CFG "$CLAUDE_REAL" plugin install ctk@ctk-kit )
  # the installed copy must be the checkout's (the cache is keyed by version, so a stale one would pass unnoticed)
  diff -q "$CFG/plugins/cache/ctk-kit/ctk/"*/skills/team/SKILL.md "$ROOT/plugins/ctk/skills/team/SKILL.md" \
    || { echo "team-demo: the installed team skill differs from this checkout; reinstall or push first" >&2; exit 1; }

  # the two one-time settings, a plain JSON edit, plus the allow rules; no statusLine from CTK
  node -e '
    const fs = require("fs"), p = process.argv[1] + "/settings.json"
    const s = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {}
    delete s.statusLine
    s.env = { ...(s.env || {}), CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" }
    s.permissions = { ...(s.permissions || {}), defaultMode: "acceptEdits",
      allow: ["Read", "Write", "Edit", "Bash(npm test:*)", "Bash(node --test:*)", "Bash(ls:*)", "Bash(cat:*)"] }
    fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n")' "$CFG"
  ( cd "$DEMO/wordkit" && session_env "$DEMO/bin/claude" -p "/ctk-doctor" )
}

prepare() {
  require_inputs
  if [ "$RUN" = c ]; then prepare_native; return; fi
  mkdir -p "$DEMO"/{bin,home,out}
  ln -sfn "$CTK_DEMO_CONFIG_DIR" "$CFG"
  ln -sfn "$ROOT" "$DEMO/ctk-kit"
  ln -sfn "$(command -v node)" "$DEMO/bin/node"
  ln -sfn "$CLAUDE_REAL" "$DEMO/bin/claude"
  for tool in npm npx; do
    real=$(node -p 'require("fs").realpathSync(process.argv[1])' "$(command -v "$tool")")
    printf '#!/bin/sh\nexec "%s" "$@"\n' "$real" > "$DEMO/bin/$tool"
    chmod +x "$DEMO/bin/$tool"
  done
  printf '#!/bin/sh\nexec node --preserve-symlinks --preserve-symlinks-main %s/dist/src/cli/bin.js "$@"\n' "$DEMO/ctk-kit" > "$DEMO/bin/ctk"
  chmod +x "$DEMO/bin/ctk"

  ( cd "$ROOT" && npm run build >/dev/null )
  rm -rf "$DEMO/wordkit"
  cp -R "$ROOT/scripts/demo/fixture" "$DEMO/wordkit"
  ( cd "$DEMO/wordkit" && git init -q && git add -A \
    && git -c user.name=demo -c user.email=demo@example.invalid -c commit.gpgsign=false commit -q -m "wordkit: initial modules" )

  session_env "$DEMO/bin/claude" auth status | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!d.loggedIn){console.error("team-demo: the demo config is not logged in");process.exit(1)}'
  ( cd "$DEMO/work" 2>/dev/null || { mkdir -p "$DEMO/work"; cd "$DEMO/work"; }; session_env "$DEMO/bin/ctk" install )
  if [ "$RUN" = b ]; then ( cd "$DEMO/work" && session_env "$DEMO/bin/ctk" config set claude.enableTaskTools true && session_env "$DEMO/bin/ctk" doctor | grep task-tools ); fi
  # Allow rules so the lead and its workers are not stopped by prompts; CTK's own keys stay untouched.
  node -e '
    const fs = require("fs"), p = process.argv[1] + "/settings.json"
    const s = JSON.parse(fs.readFileSync(p, "utf8"))
    s.permissions = { ...(s.permissions || {}), defaultMode: "acceptEdits",
      allow: ["Read", "Write", "Edit", "Bash(npm test:*)", "Bash(node --test:*)", "Bash(ls:*)", "Bash(cat:*)"] }
    fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n")' "$CFG"
  echo "team-demo: prepared. If this config has never run claude in $DEMO/wordkit, do the one-time first run (see the header)."
}

record() {
  require_inputs
  local masks=() extra=() script=team-demo.script.json
  if [ "$RUN" = c ]; then script=team-demo-c.script.json; extra=(--meta "install=native (marketplace add ${CTK_DEMO_MARKETPLACE:-tc3oliver/claude-team-kit})"); fi
  [ -n "${CTK_DEMO_MASKS_FILE:-}" ] && masks=(--mask-file "$CTK_DEMO_MASKS_FILE")
  CLAUDE_CONFIG_DIR=$CFG node "$ROOT/scripts/demo/record.mjs" \
    --out "$ASSETS/$PREFIX.frames.jsonl" --cols 120 --rows 34 \
    --cwd "$DEMO/wordkit" --home "$DEMO/home" --path "$SESSION_PATH" --claude-bin "$DEMO/bin/claude" \
    --script "$ROOT/scripts/demo/$script" \
    --model 'Sonnet 5.5 lead (claude --model sonnet); workers by ctk roles' \
    --meta "attempts=${CTK_DEMO_ATTEMPTS:-1}" --meta "run=$RUN" "${extra[@]}" \
    --approve '❯ 1\. Yes' --abort-on '(?:[4-9]|\d{2,}) busy|· \$[2-9]\.\d\d|· \$\d{2,}' \
    --idle 180000 --limit 600000 --interval 250 --slow-interval 1000 \
    "${masks[@]}" -- "$DEMO/bin/claude" --model sonnet
}

render() {
  local f=$ASSETS/$PREFIX.frames.jsonl svg="$ROOT/scripts/demo/render-svg.mjs"
  # the lead's closing words differ per run; pick the frame that shows them with the status line
  local summary='Crunched for[\s\S]*team 0 busy' workers='team 3 busy .*\n[\s\S]*◯ w-roman'
  [ "$RUN" = b ] && summary='Run /ctk:review if you want[\s\S]*team 0 busy'
  node "$svg" "$f" --out "$ASSETS/$PREFIX.svg" --target-seconds 40 --max-gap 2 --title 'ctk team: one real session'
  # key frames, picked from the real recording by what is on screen
  node "$svg" "$f" --static-out "$ASSETS/$PREFIX-workers.svg" --at-regex "$workers" --title 'ctk team: workers running'
  if [ "$RUN" = c ]; then
    node "$svg" "$f" --static-out "$ASSETS/$PREFIX-tasks.svg" --at-regex 'blocked by #3, #4, #5[\s\S]*tasks 2/6' --title 'ctk team: the task list and the HUD tasks segment'
    node "$svg" "$f" --static-out "$ASSETS/$PREFIX-doctor.svg" --at-regex 'stats recording: on[\s\S]*ready' --title 'ctk team: /ctk-doctor'
  else
    node "$svg" "$f" --static-out "$ASSETS/$PREFIX-approval.svg" --at-regex 'Do you want to proceed' --title 'ctk team: a worker asks to run a command'
  fi
  node "$svg" "$f" --static-out "$ASSETS/$PREFIX-summary.svg" --at-regex "$summary" --title 'ctk team: the lead reports'
  node "$svg" "$f" --static-out "$ASSETS/$PREFIX-stats.svg" --at-regex 'per-worker cost: not available' --title 'ctk team: /ctk-stats'
  node "$ROOT/scripts/demo/render-video.mjs" "$f" --work-dir "$DEMO/video-$RUN" --gif "$ASSETS/$PREFIX.gif" --mp4 "$ASSETS/$PREFIX.mp4" --target-seconds 40 --title 'ctk team: one real session'
}

case $STAGE in
  prepare) prepare ;;
  record) record ;;
  render) render ;;
  all) prepare; record; render ;;
  *) echo "usage: team-demo.sh [prepare|record|render|all]" >&2; exit 1 ;;
esac
