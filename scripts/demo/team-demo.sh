#!/usr/bin/env bash
# Reproduces docs/assets/team-demo.*: one real, live /ctk:team session on the wordkit fixture,
# recorded with record.mjs and rendered with render-svg.mjs / render-video.mjs.
# bash + tmux, macOS or Linux. It spends real money (a few US dollars) and needs a logged-in,
# dedicated Claude Code config dir. Never point it at ~/.claude (record.mjs refuses).
#
#   CTK_DEMO_CONFIG_DIR=<dedicated config dir> CTK_DEMO_MASKS_FILE=<masks.json> scripts/demo/team-demo.sh [prepare|record|render|all]
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

prepare() {
  require_inputs
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
  local masks=()
  [ -n "${CTK_DEMO_MASKS_FILE:-}" ] && masks=(--mask-file "$CTK_DEMO_MASKS_FILE")
  CLAUDE_CONFIG_DIR=$CFG node "$ROOT/scripts/demo/record.mjs" \
    --out "$ASSETS/team-demo.frames.jsonl" --cols 120 --rows 34 \
    --cwd "$DEMO/wordkit" --home "$DEMO/home" --path "$SESSION_PATH" --claude-bin "$DEMO/bin/claude" \
    --script "$ROOT/scripts/demo/team-demo.script.json" \
    --model 'Sonnet 5.5 lead (claude --model sonnet); workers by ctk roles' \
    --meta "attempts=${CTK_DEMO_ATTEMPTS:-1}" \
    --approve '❯ 1\. Yes' --abort-on '(?:[4-9]|\d{2,}) busy|· \$\d{2,}\.\d\d' \
    --idle 180000 --limit 600000 --interval 250 --slow-interval 1000 \
    "${masks[@]}" -- "$DEMO/bin/claude" --model sonnet
}

render() {
  local f=$ASSETS/team-demo.frames.jsonl
  node "$ROOT/scripts/demo/render-svg.mjs" "$f" --out "$ASSETS/team-demo.svg" --target-seconds 40 --max-gap 2 --title 'ctk team: one real session'
  # key frames, picked from the real recording by what is on screen
  node "$ROOT/scripts/demo/render-svg.mjs" "$f" --static-out "$ASSETS/team-demo-workers.svg" --at-regex 'team 3 busy .*\n[\s\S]*◯ w-roman' --title 'ctk team: workers running'
  node "$ROOT/scripts/demo/render-svg.mjs" "$f" --static-out "$ASSETS/team-demo-approval.svg" --at-regex 'Do you want to proceed' --title 'ctk team: a worker asks to run a command'
  node "$ROOT/scripts/demo/render-svg.mjs" "$f" --static-out "$ASSETS/team-demo-summary.svg" --at-regex 'Crunched for[\s\S]*team 0 busy' --title 'ctk team: the lead reports'
  node "$ROOT/scripts/demo/render-svg.mjs" "$f" --static-out "$ASSETS/team-demo-stats.svg" --at-regex 'per-worker cost: not available' --title 'ctk team: /ctk-stats'
  node "$ROOT/scripts/demo/render-video.mjs" "$f" --work-dir "$DEMO/video" --gif "$ASSETS/team-demo.gif" --mp4 "$ASSETS/team-demo.mp4" --target-seconds 40 --title 'ctk team: one real session'
}

case $STAGE in
  prepare) prepare ;;
  record) record ;;
  render) render ;;
  all) prepare; record; render ;;
  *) echo "usage: team-demo.sh [prepare|record|render|all]" >&2; exit 1 ;;
esac
