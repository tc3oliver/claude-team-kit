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
import { appendFileSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { cellWidth } from './render-svg.mjs'

const USAGE = `usage: CLAUDE_CONFIG_DIR=<scratch dir> record.mjs --out <file.frames.jsonl> [options] -- <command> [args...]
  --cols N / --rows N   terminal size (default 110x32)
  --cwd DIR             working directory of the session
  --script FILE         JSON array of steps: {at:ms | waitFor:regex | waitForLine:regex, stable:ms, timeout:ms, softTimeout:true (a timeout ends the wait instead of failing), delay:ms, keys:text, typed:msPerChar, key:name|[names], click:{text:regex, offset:cells, last:bool}}
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
  --mask REGEX=REPLACEMENT   rewrite matches in every captured frame (repeatable; split at the last '=')
  --mask-file FILE      JSON array of {"match": regex, "replace": text, "label": "what it hides"}; keeps personal
                        strings out of the command line and the repo. The meta line records labels and a count, never the patterns.
  --abort-on REGEX      kill the session at once if the screen matches (exit code 4)
                        (exit code 5: nothing was captured, usually a command that ends at once)
  --approve REGEX       when the screen matches (a permission prompt), press Enter; each approval is listed in the meta line
  --slow-interval MS    sample this slowly once the first 15 s are over and no keys were sent for 3 s (keeps long recordings small)
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
  const o = { cols: 110, rows: 32, idle: 5000, limit: 120000, interval: 250, env: [], meta: [], mask: [], model: 'none (no model call)', claudeBin: 'claude' }
  const num = new Set(['cols', 'rows', 'idle', 'limit', 'interval', 'slow-interval'])
  const str = new Set(['out', 'cwd', 'script', 'until', 'home', 'path', 'model', 'claude-bin', 'mask-file', 'abort-on', 'approve'])
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
      const key = name.replace(/-(\w)/g, (_, c) => c.toUpperCase())
      o[key] = Number(val())
      if (!Number.isFinite(o[key]) || o[key] <= 0) die(`${a} must be a positive number`)
    } else if (str.has(name)) o[name.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = val()
    else if (name === 'env' || name === 'meta' || name === 'mask') o[name].push(val())
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

/**
 * Where a regex first (or last) matches on a plain screen capture, as a 1-based terminal cell {col, row}
 * `offset` cells into the match; null when it does not match. Used to aim a mouse click.
 */
export const locateText = (plainScreen, re, offset = 0, last = false) => {
  const lines = plainScreen.split('\n')
  const order = last ? [...lines.keys()].reverse() : [...lines.keys()]
  for (const row of order) {
    const m = new RegExp(re).exec(lines[row])
    if (m) return { col: [...lines[row].slice(0, m.index)].reduce((n, ch) => n + cellWidth(ch.codePointAt(0)), 0) + offset + 1, row: row + 1 }
  }
  return null
}

/** The bytes of one left click (press then release) at a cell, as an xterm SGR mouse report. */
export const sgrClick = ({ col, row }) => `\x1b[<0;${col};${row}M\x1b[<0;${col};${row}m`

function validateScript(steps) {
  if (!Array.isArray(steps)) throw new Error('script must be a JSON array')
  steps.forEach((s, n) => {
    const where = `script step ${n}`
    if (typeof s !== 'object' || s === null) throw new Error(`${where}: not an object`)
    if (s.at !== undefined && !(Number.isFinite(s.at) && s.at >= 0)) throw new Error(`${where}: "at" must be ms >= 0`)
    for (const k of ['waitFor', 'waitForLine']) if (s[k] !== undefined) new RegExp(s[k])
    if (['at', 'waitFor', 'waitForLine', 'delay', 'keys', 'key', 'click'].every(k => s[k] === undefined)) throw new Error(`${where}: empty step`)
    if (s.click !== undefined) {
      if (typeof s.click !== 'object' || s.click === null || typeof s.click.text !== 'string') throw new Error(`${where}: "click" needs {text: regex}`)
      new RegExp(s.click.text)
    }
    if (s.stable !== undefined && !(Number.isFinite(s.stable) && s.stable > 0)) throw new Error(`${where}: "stable" must be ms > 0`)
    if (s.keys !== undefined && typeof s.keys !== 'string') throw new Error(`${where}: "keys" must be a string`)
  })
  return steps
}

/** Compiles mask specs [{match, replace, label}] into the form the recorder applies. */
export function compileMasks(specs) {
  return specs.map(s => {
    if (typeof s.match !== 'string' || typeof s.replace !== 'string') throw new Error('mask needs string "match" and "replace"')
    return { one: new RegExp(s.match), all: new RegExp(s.match, 'g'), replace: s.replace, label: s.label ?? 'masked text' }
  })
}

/** Builds the capture-time masks from --mask and --mask-file. */
function loadMasks(o) {
  const specs = o.mask.map(m => {
    const at = m.lastIndexOf('=')
    if (at < 1) die(`--mask expects REGEX=REPLACEMENT, got ${m.length > 40 ? 'a long value' : m}`)
    return { match: m.slice(0, at), replace: m.slice(at + 1), label: 'masked text' }
  })
  if (o.maskFile) specs.push(...JSON.parse(readFileSync(o.maskFile, 'utf8')))
  return compileMasks(specs)
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
  const abortOn = o.abortOn ? new RegExp(o.abortOn) : null
  const approve = o.approve ? new RegExp(o.approve) : null
  let masks = []
  try {
    masks = loadMasks(o)
  } catch (e) {
    die(`bad mask: ${e.message}`)
  }
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
  if (masks.length > 0) meta.masked = [...new Set(masks.map(m => m.label))]
  let maskedCount = 0
  // Replacements are counted per stored frame (see the capture loop), not per capture: the same screen
  // sampled twice must not count twice, or the figure would depend on how fast the sampler happened to run.
  const applyMasks = text => {
    let n = 0
    const out = masks.reduce((t, m) => t.replace(m.all, found => { n++; return found.replace(m.one, m.replace) }), text)
    return { text: out, n }
  }
  const maskQuietly = text => masks.reduce((t, m) => t.replace(m.all, found => found.replace(m.one, m.replace)), text)
  const partial = `${o.out}.partial`
  rmSync(partial, { force: true })

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
  let scriptDoneAt = 0
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
    return { ...applyMasks(lines.join('\n')), dead }
  }
  let lastKeyAt = -Infinity
  const send = (...a) => {
    lastKeyAt = now()
    return tmux('send-keys', '-t', target, ...a)
  }
  const approvals = []
  let lastApprovalAt = -Infinity
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
        // with "stable" the condition must hold without a break for that long
        let since = null
        for (;;) {
          if (stop) break
          if (rx.test(src())) {
            since ??= now()
            if (now() - since >= (s.stable ?? 0)) break
          } else since = null
          if (now() > deadline && s.softTimeout === true) break
          if (now() > deadline) throw new Error(`script step ${n}: ${k} /${re}/ not seen within ${s.timeout ?? 30000} ms`)
          await sleep(50)
        }
      }
      if (s.delay) await sleep(s.delay)
      if (stop) return
      if (s.keys !== undefined) await typeText(s.keys, s.typed ?? 0)
      if (s.key !== undefined) for (const k of [].concat(s.key)) send(k)
      if (s.click !== undefined) {
        // A click is aimed at what is on screen now, so a layout change cannot make it miss silently.
        const at = locateText(plain, s.click.text, s.click.offset ?? 0, s.click.last === true)
        if (at === null) throw new Error(`script step ${n}: click target /${s.click.text}/ is not on screen`)
        send('-l', '--', sgrClick(at))
      }
      // let the sampler see the effect before the next step looks at the screen
      await sleep(o.interval * 1.5)
    }
  }
  const scriptRun = runScript().then(() => { scriptDone = true; scriptDoneAt = now() }, e => { scriptError = e; stop ??= 'script-error' })

  try {
    for (;;) {
      const t = now()
      const snap = capture()
      if (snap === null) { stop ??= 'session-gone'; break }
      if (snap.text !== lastText) {
        maskedCount += snap.n
        frames.push({ t, text: snap.text })
        appendFileSync(partial, JSON.stringify({ t, text: snap.text }) + '\n')
        lastText = snap.text
        lastChange = t
        plain = stripAnsi(snap.text)
      }
      if (abortOn?.test(plain)) { stop ??= 'abort'; meta.abortedOn = (plain.split('\n').find(l => abortOn.test(l)) ?? '').trim().slice(0, 160) }
      else if (approve && !snap.dead && t - lastApprovalAt > 2000 && approve.test(plain)) {
        lastApprovalAt = t
        approvals.push({ t, line: (plain.split('\n').find(l => approve.test(l)) ?? '').trim().slice(0, 160) })
        send('Enter')
      }
      if (stop) { /* already stopping: abort or signal */ }
      else if (snap.dead) { stop ??= 'exit'; meta.exitStatus = Number(tmux('display-message', '-p', '-t', target, '#{pane_dead_status}').stdout.trim()) }
      else if (t >= o.limit) stop ??= 'limit'
      else if (scriptDone && until?.test(plain)) stop ??= 'until'
      // idle counts from the later of the last change and the end of the script, so a script
      // that finishes long after the last change still gets a full idle window to see its effect
      else if (scriptDone && t - Math.max(lastChange, scriptDoneAt) >= o.idle) stop ??= 'idle'
      if (stop) break
      const slow = o.slowInterval && now() > 15000 && now() - lastKeyAt > 3000
      await sleep(Math.max(0, (slow ? o.slowInterval : o.interval) - (now() - t)))
    }
    await Promise.race([scriptRun, sleep(100)])
  } finally {
    const socket = tmux('display-message', '-p', '#{socket_path}').stdout.trim()
    tmux('kill-server')
    if (socket.endsWith(sock)) rmSync(socket, { force: true })
  }
  for (const k of ['command', 'model']) meta[k] = maskQuietly(meta[k])
  meta.stopReason = stop
  if (masks.length > 0) meta.maskedReplacements = maskedCount
  if (approve) meta.permissionApprovals = approvals
  meta.durationMs = now()
  meta.frames = frames.length
  writeFileSync(o.out, [JSON.stringify({ meta }), ...frames.map(f => JSON.stringify(f))].join('\n') + '\n')
  rmSync(partial, { force: true })
  console.error(`record: ${frames.length} frame(s), ${meta.durationMs} ms, stopped on ${stop} -> ${o.out}`)
  if (scriptError) die(scriptError.message)
  if (stop === 'limit') process.exitCode = 3
  if (stop === 'abort') process.exitCode = 4
  // tmux can drop a session whose command exits within milliseconds (seen on tmux 3.4); an empty recording must not look like a success
  if (frames.length === 0 && !process.exitCode) { console.error('record: no frame was captured (the command ended before the first capture); give it something that stays alive until --until matches'); process.exitCode = 5 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main()
}
