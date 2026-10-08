#!/usr/bin/env node
// ctk status line fallback: reads the status line JSON Claude Code writes to
// stdin and prints one line. Reads only .git/HEAD and the repo's git config
// files, and runs one `git status` for the dirty marker. No network, no
// credentials, no transcript.
// Works where Mods do not render (WSL, `-p`, older builds).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SEP = ' · '
const BOLD = ['\x1b[1m', '\x1b[22m']
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g
const CONFIG_LIMIT = 64 * 1024
// A repo's own config can make git run commands (fsmonitor, filters, hooks, pagers, ...).
// If any of these appear, skip the dirty marker; the branch is still shown.
const UNSAFE_CONFIG =
  /fsmonitor|\[\s*filter|\bfilter\.|hookspath|textconv|\[\s*include|\bpager\b|sshcommand|askpass|\[\s*alias|\beditor\s*=|\bexternal\s*=|\[\s*gpg|\bprogram\s*=|credential/i

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const pct = v => (v === null ? '–' : `${Math.round(v)}%`)
const str = v => {
  if (typeof v !== 'string') return null
  return v.replace(CONTROL, '') || null
}

const elapsed = ms => {
  if (ms === null || ms < 0) return '–'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

const findDotGit = dir => {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return join(d, '.git')
    if (dirname(d) === d) return null
  }
}

// A linked worktree has a `.git` file: `gitdir: <path>` pointing at its own HEAD.
const headDir = dotGit => {
  if (statSync(dotGit).isDirectory()) return dotGit
  const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))
  return m ? resolve(dirname(dotGit), m[1].trim()) : null
}

const branchOf = dotGit => {
  const gd = headDir(dotGit)
  if (!gd) return null
  const head = readFileSync(join(gd, 'HEAD'), 'utf8').trim()
  const ref = /^ref:\s*(.+)$/.exec(head)
  if (ref) return str(ref[1].replace(/^refs\/heads\//, ''))
  return /^[0-9a-f]{7,64}$/.test(head) ? head.slice(0, 7) : null
}

// Repo-local config that git would read for this worktree: the gitdir's own
// config, config.worktree, and for a linked worktree the common dir's config.
const repoConfigFiles = gd => {
  const files = [join(gd, 'config'), join(gd, 'config.worktree')]
  const common = join(gd, 'commondir')
  if (existsSync(common)) files.push(join(resolve(gd, readFileSync(common, 'utf8').trim()), 'config'))
  return files.filter(f => existsSync(f))
}

const repoConfigSafe = dotGit => {
  const gd = headDir(dotGit)
  if (!gd) return false
  return repoConfigFiles(gd).every(f => statSync(f).size <= CONFIG_LIMIT && !UNSAFE_CONFIG.test(readFileSync(f, 'utf8')))
}

const gitEnv = () => {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' }
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_EXTERNAL_DIFF']) delete env[k]
  return env
}

const isDirty = dir => {
  try {
    const out = execFileSync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.hooksPath=',
        '--no-optional-locks',
        'status',
        '--porcelain',
        '-uno',
        '--ignore-submodules=all',
      ],
      { cwd: dir, env: gitEnv(), timeout: 250, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' },
    )
    return out.trim() !== ''
  } catch {
    return false
  }
}

const gitSegment = dir => {
  try {
    const dotGit = findDotGit(dir)
    const branch = dotGit && branchOf(dotGit)
    if (!branch) return null
    return branch + (repoConfigSafe(dotGit) && isDirty(dir) ? '*' : '')
  } catch {
    return null
  }
}

// Truncates the visible text to COLUMNS - 1 characters plus `…`. Each piece is
// wrapped as a whole, so a cut never lands inside an ANSI sequence.
const fit = (pieces, cols) => {
  const total = pieces.reduce((n, p) => n + p.text.length, 0)
  if (cols === null || total <= cols) return pieces.map(p => p.open + p.text + p.close).join('')
  let budget = cols - 1
  let out = ''
  for (const p of pieces) {
    if (budget <= 0) break
    const text = p.text.slice(0, budget)
    out += p.open + text + p.close
    budget -= text.length
  }
  return out + '…'
}

export const render = (input, env = {}) => {
  const cw = input?.context_window ?? {}
  const rl = input?.rate_limits ?? {}
  const ctx = num(cw.used_percentage)
  const five = num(rl.five_hour?.used_percentage)
  const seven = num(rl.seven_day?.used_percentage)
  const cost = num(input?.cost?.total_cost_usd)
  const ms = num(input?.cost?.total_duration_ms)
  const model = str(input?.model?.display_name) ?? str(input?.model?.id) ?? '–'
  const effort = str(input?.effort?.level) ?? ''
  const dir = str(input?.workspace?.current_dir) ?? str(input?.cwd)
  const color = env.CTK_COLOR === '1'
  const cols = Number.parseInt(env.COLUMNS, 10)

  const segments = [
    { text: effort ? `${model} ${effort}` : model, bold: true },
    { text: `ctx ${pct(ctx)}` },
    { text: `5h ${pct(five)}` },
    { text: `7d ${pct(seven)}` },
    { text: cost === null ? '–' : `$${cost.toFixed(2)}` },
    { text: elapsed(ms) },
  ]
  const git = dir === null ? null : gitSegment(dir)
  if (git !== null) segments.push({ text: git })

  const pieces = segments.flatMap((s, i) => (i ? [{ text: SEP }, s] : [s])).map(s => ({
    text: s.text,
    open: color && s.bold ? BOLD[0] : '',
    close: color && s.bold ? BOLD[1] : '',
  }))
  return fit(pieces, Number.isFinite(cols) && cols > 0 ? cols : null)
}

const main = async () => {
  let raw = ''
  try {
    for await (const chunk of process.stdin) raw += chunk
  } catch {
    // Unreadable stdin: fall through and print the empty-state line.
  }
  let input = {}
  try {
    input = JSON.parse(raw)
  } catch {
    // Malformed input: still print a line rather than nothing.
  }
  let line
  try {
    line = render(input, process.env)
  } catch {
    line = '–'
  }
  process.stdout.write(line + '\n')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main()
}
