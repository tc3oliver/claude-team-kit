#!/usr/bin/env node
// Records a REAL terminal session: runs a command inside a detached tmux session (fixed size),
// optionally types scripted keystrokes, and samples `tmux capture-pane -p -e -J` (with ANSI)
// every ~250 ms. Only frames whose content changed are stored, as JSON lines {t, text}; the first
// line is a {"meta": {...}} header. Render the result with render-svg.mjs.
//
//   CLAUDE_CONFIG_DIR=/tmp/ctk-demo/cfg node scripts/demo/record.mjs --out docs/assets/x.frames.jsonl \
//     --script x.script.json --until 'all checks passed' -- /bin/bash --noprofile --norc
//
// Refuses to run unless CLAUDE_CONFIG_DIR is set to a path outside ~/.claude*.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const USAGE = `usage: CLAUDE_CONFIG_DIR=<scratch dir> record.mjs --out <file.frames.jsonl> [options] -- <command> [args...]
  --cols N / --rows N   terminal size (default 110x32)
  --cwd DIR             working directory of the session
  --script FILE         JSON array of steps: {at:ms | waitFor:regex | waitForLine:regex, delay:ms, keys:text, typed:msPerChar, key:name|[names]}
  --until REGEX         stop once the script is done and the screen matches
  --idle MS             stop after MS without change once the script is done (default 5000)
  --limit MS            hard time limit (default 120000)
  --interval MS         sampling interval (default 250)
  --home DIR            HOME for the session (default: the real HOME)
  --path PATH           PATH for the session (default: this process's PATH)
  --env K=V             extra environment variable for the session (repeatable)
  --claude-bin PATH     claude binary used to record its version (default: claude on PATH)
  --model TEXT          model shown in the metadata (default: "none (no model call)")
  --meta K=V            extra metadata (repeatable)
The session runs with a clean environment (env -i): HOME, PATH, TERM=xterm-256color, LANG, CLAUDE_CONFIG_DIR and --env only.`

const die = (msg, code = 1) => {
  console.error(`record: ${msg}`)
  process.exit(code)
}

/** realpath that tolerates a not-yet-existing tail. */
function realpathLoose(p) {
  let cur = resolve(p)
  const tail = []
  while (!existsSync(cur)) {
    tail.unshift(basename(cur))
    const up = dirname(cur)
    if (up === cur) break
    cur = up
  }
  return join(realpathSync(cur), ...tail)
}

/** Throws unless dir is set and is not (inside) one of the user's real Claude config dirs. */
export function assertScratchConfigDir(dir, home = homedir()) {
  if (!dir) throw new Error('CLAUDE_CONFIG_DIR must be set to a scratch directory (refusing to run without it)')
  const real = realpathLoose(dir)
  const realHome = realpathLoose(home)
  if (real === realHome) throw new Error(`CLAUDE_CONFIG_DIR must not be the home directory: ${dir}`)
  // ~/.claude, ~/.claude-local and friends: any top-level dot-claude entry in HOME.
  const top = real.startsWith(realHome + sep) ? real.slice(realHome.length + 1).split(sep)[0] : ''
  if (top.startsWith('.claude')) throw new Error(`CLAUDE_CONFIG_DIR must not be inside ~/${top}: ${dir}`)
}

function parseArgs(argv) {
  const o = { cols: 110, rows: 32, idle: 5000, limit: 120000, interval: 250, env: [], meta: [], model: 'none (no model call)', claudeBin: 'claude' }
  const num = new Set(['cols', 'rows', 'idle', 'limit', 'interval'])
  const str = new Set(['out', 'cwd', 'script', 'until', 'home', 'path', 'model', 'claude-bin'])
  let i = 0
  for (; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { i++; break }
    if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0) }
    const name = a.startsWith('--') ? a.slice(2) : ''
    const val = () => {
      const v = argv[++i]
      if (v === undefined) die(`${a} needs a value`)
      return v
    }
    if (num.has(name)) {
      o[name] = Number(val())
      if (!Number.isFinite(o[name]) || o[name] <= 0) die(`${a} must be a positive number`)
    } else if (str.has(name)) o[name === 'claude-bin' ? 'claudeBin' : name] = val()
    else if (name === 'env' || name === 'meta') o[name].push(val())
    else die(`unknown option ${a}\n${USAGE}`)
  }
  o.cmd = argv.slice(i)
  return o
}

const kv = s => {
  const at = s.indexOf('=')
  if (at < 1) die(`expected K=V, got ${s}`)
  return [s.slice(0, at), s.slice(at + 1)]
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const ANSI = /\x1b\[[0-9;:?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]/g
export const stripAnsi = s => s.replace(ANSI, '')

function validateScript(steps) {
  if (!Array.isArray(steps)) throw new Error('script must be a JSON array')
  steps.forEach((s, n) => {
    const where = `script step ${n}`
    if (typeof s !== 'object' || s === null) throw new Error(`${where}: not an object`)
    if (s.at !== undefined && !(Number.isFinite(s.at) && s.at >= 0)) throw new Error(`${where}: "at" must be ms >= 0`)
    for (const k of ['waitFor', 'waitForLine']) if (s[k] !== undefined) new RegExp(s[k])
    if (['at', 'waitFor', 'waitForLine', 'delay', 'keys', 'key'].every(k => s[k] === undefined)) throw new Error(`${where}: empty step`)
    if (s.keys !== undefined && typeof s.keys !== 'string') throw new Error(`${where}: "keys" must be a string`)
  })
  return steps
}

function gitInfo(root) {
  const run = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' })
  const head = run('rev-parse', '--short', 'HEAD')
  if (head.status !== 0) return 'unknown'
  const dirty = run('status', '--porcelain').stdout.trim() !== ''
  return head.stdout.trim() + (dirty ? '-dirty' : '')
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  try {
    assertScratchConfigDir(process.env.CLAUDE_CONFIG_DIR)
  } catch (e) {
    die(e.message, 2)
  }
  if (!o.out) die(`--out is required\n${USAGE}`)
  if (o.cmd.length === 0) die(`no command given after --\n${USAGE}`)
  const until = o.until ? new RegExp(o.until) : null
  let steps = []
  try {
    if (o.script) steps = validateScript(JSON.parse(readFileSync(o.script, 'utf8')))
  } catch (e) {
    die(`bad script: ${e.message}`)
  }

  const env = { HOME: o.home ?? homedir(), PATH: o.path ?? process.env.PATH ?? '/usr/bin:/bin', TERM: 'xterm-256color', LANG: 'en_US.UTF-8', CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }
  for (const e of o.env) {
    const [k, v] = kv(e)
    if (k === 'CLAUDE_CONFIG_DIR') die('--env cannot override CLAUDE_CONFIG_DIR')
    env[k] = v
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const ver = spawnSync(o.claudeBin, ['--version'], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR, PATH: env.PATH } })
  const meta = {
    schema: 1,
    date: new Date().toISOString(),
    cols: o.cols,
    rows: o.rows,
    claudeCodeVersion: ver.status === 0 ? ver.stdout.trim().split(/\s+/)[0] : 'unknown',
    ctkCommit: gitInfo(root),
    model: o.model,
    command: o.cmd.join(' '),
  }
  for (const m of o.meta) { const [k, v] = kv(m); meta[k] = v }

  const sock = `ctk-demo-${process.pid}`
  const sess = 'rec'
  const tmux = (...a) => spawnSync('tmux', ['-L', sock, '-f', '/dev/null', ...a], { encoding: 'utf8' })
  const envArgv = ['/usr/bin/env', '-i', ...Object.entries(env).map(([k, v]) => `${k}=${v}`)]
  const argv = o.cmd.length === 1 ? ['sh', '-c', o.cmd[0]] : o.cmd
  const started = tmux('new-session', '-d', '-s', sess, '-x', String(o.cols), '-y', String(o.rows), ...(o.cwd ? ['-c', o.cwd] : []), ...envArgv, ...argv, ';', 'set-option', '-g', 'remain-on-exit', 'on', ';', 'set-option', '-g', 'remain-on-exit-format', '')
  if (started.status !== 0) die(`tmux failed to start: ${started.stderr.trim() || started.error}`)
  meta.tmux = (spawnSync('tmux', ['-V'], { encoding: 'utf8' }).stdout || '').trim()

  const t0 = Date.now()
  const now = () => Date.now() - t0
  const frames = []
  let lastText = null
  let lastChange = 0
  let plain = ''
  let scriptDone = steps.length === 0
  let scriptError = null
  let stop = null
  const onSignal = () => { stop ??= 'signal' }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  const target = `${sess}`
  const capture = () => {
    const dead = tmux('display-message', '-p', '-t', target, '#{pane_dead}').stdout.trim() === '1'
    const r = tmux('capture-pane', '-p', '-e', '-J', '-t', target)
    if (r.status !== 0) return null
    const lines = r.stdout.split('\n').map(l => l.replace(/ +$/, ''))
    while (lines.length > 0 && lines.at(-1) === '') lines.pop()
    return { text: lines.join('\n'), dead }
  }
  const send = (...a) => tmux('send-keys', '-t', target, ...a)
  const typeText = async (text, perChar) => {
    const parts = text.split('\n')
    for (let n = 0; n < parts.length; n++) {
      if (n > 0) send('Enter')
      for (const ch of perChar > 0 ? [...parts[n]] : [parts[n]]) {
        if (ch !== '') send('-l', '--', ch)
        if (perChar > 0) await sleep(perChar)
      }
    }
  }

  const runScript = async () => {
    for (const [n, s] of steps.entries()) {
      if (stop) return
      if (s.at !== undefined) while (now() < s.at && !stop) await sleep(Math.min(50, s.at - now()))
      for (const [k, re, src] of [['waitFor', s.waitFor, () => plain], ['waitForLine', s.waitForLine, () => plain.split('\n').filter(l => l.trim() !== '').at(-1) ?? '']]) {
        if (re === undefined) continue
        const rx = new RegExp(re)
        const deadline = now() + (s.timeout ?? 30000)
        while (!rx.test(src()) && !stop) {
          if (now() > deadline) throw new Error(`script step ${n}: ${k} /${re}/ not seen within ${s.timeout ?? 30000} ms`)
          await sleep(50)
        }
      }
      if (s.delay) await sleep(s.delay)
      if (stop) return
      if (s.keys !== undefined) await typeText(s.keys, s.typed ?? 0)
      if (s.key !== undefined) for (const k of [].concat(s.key)) send(k)
      // let the sampler see the effect before the next step looks at the screen
      await sleep(o.interval * 1.5)
    }
  }
  const scriptRun = runScript().then(() => { scriptDone = true }, e => { scriptError = e; stop ??= 'script-error' })

  try {
    for (;;) {
      const t = now()
      const snap = capture()
      if (snap === null) { stop ??= 'session-gone'; break }
      if (snap.text !== lastText) {
        frames.push({ t, text: snap.text })
        lastText = snap.text
        lastChange = t
        plain = stripAnsi(snap.text)
      }
      if (snap.dead) { stop ??= 'exit'; meta.exitStatus = Number(tmux('display-message', '-p', '-t', target, '#{pane_dead_status}').stdout.trim()) }
      else if (t >= o.limit) stop ??= 'limit'
      else if (scriptDone && until?.test(plain)) stop ??= 'until'
      else if (scriptDone && t - lastChange >= o.idle) stop ??= 'idle'
      if (stop) break
      await sleep(Math.max(0, o.interval - (now() - t)))
    }
    await Promise.race([scriptRun, sleep(100)])
  } finally {
    const socket = tmux('display-message', '-p', '#{socket_path}').stdout.trim()
    tmux('kill-server')
    if (socket.endsWith(sock)) rmSync(socket, { force: true })
  }
  meta.stopReason = stop
  meta.durationMs = now()
  meta.frames = frames.length
  writeFileSync(o.out, [JSON.stringify({ meta }), ...frames.map(f => JSON.stringify(f))].join('\n') + '\n')
  console.error(`record: ${frames.length} frame(s), ${meta.durationMs} ms, stopped on ${stop} -> ${o.out}`)
  if (scriptError) die(scriptError.message)
  if (stop === 'limit') process.exitCode = 3
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main()
}
