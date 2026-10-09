#!/usr/bin/env node
// ctk status line: reads the status line JSON Claude Code writes to stdin and prints one
// line (model, 5h and weekly usage with reset countdowns, context, cost, git branch), laid
// out for the terminal width Claude Code reports in $COLUMNS. Reads only .git/HEAD and the
// repo's git config files, and runs one `git status` for the dirty marker. No network, no
// credentials, no transcript, no tool or agent counts (Claude Code does not put them in the
// JSON; the Mods band counts them and shows them above the prompt).
// It also works on builds where Mods do not render (older builds; WSL is reported unsupported for mods but untested).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CONTROL = /[\x00-\x1f\x7f-\x9f]/g
const CONFIG_LIMIT = 64 * 1024
// A repo's own config can make git run commands (fsmonitor, filters, hooks, pagers, ...).
// If any of these appear, skip the dirty marker; the branch is still shown.
const UNSAFE_CONFIG =
  /fsmonitor|\[\s*filter|\bfilter\.|hookspath|textconv|\[\s*include|\bpager\b|sshcommand|askpass|\[\s*alias|\beditor\s*=|\bexternal\s*=|\[\s*gpg|\bprogram\s*=|credential/i

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = v => {
  if (typeof v !== 'string') return null
  return v.replace(ANSI, '').replace(CONTROL, '') || null
}

// --- Width-aware layout ------------------------------------------------------------------
// Kept identical in behaviour to plugins/ctk/shared/hudline.ts (the Mods band uses that one);
// this file is installed alone, so it carries its own copy. The test suite runs both on the same
// inputs. Change them together.

const DASH = '–'
const SEP = ' │ '
const DEFAULT_COLUMNS = 80
const MIN_TIER_SEGMENTS = 3
const BOLD = ['\x1b[1m', '\x1b[22m']
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

const tierOf = columns => (columns >= 120 ? 0 : columns >= 80 ? 1 : 2)
const stripAnsi = s => s.replace(ANSI, '')
const inRanges = (cp, ranges) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi)

const ZERO = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a], [0x064b, 0x065f],
  [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x20d0, 0x20ff], [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f], [0xe0100, 0xe01ef],
]
const WIDE = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x2e80, 0x303e], [0x3041, 0x33ff],
  [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
]
const AMBIGUOUS = [
  [0x00a1, 0x00a1], [0x00a4, 0x00a4], [0x00a7, 0x00a8], [0x00aa, 0x00aa], [0x00ad, 0x00ae],
  [0x00b0, 0x00b4], [0x00b6, 0x00ba], [0x00bc, 0x00bf], [0x00d7, 0x00d7], [0x00f7, 0x00f7],
  [0x2010, 0x2027], [0x2030, 0x203b], [0x2190, 0x21ff], [0x2460, 0x24ff], [0x2500, 0x257f],
  [0x25a0, 0x25ff],
]

const charWidth = (cp, ambiguous = 1) => {
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return 0
  if (cp < 0x300) return ambiguous === 2 && inRanges(cp, AMBIGUOUS) ? 2 : 1
  if (inRanges(cp, ZERO)) return 0
  if (inRanges(cp, WIDE)) return 2
  return ambiguous === 2 && inRanges(cp, AMBIGUOUS) ? 2 : 1
}

const displayWidth = (s, ambiguous = 1) => {
  let w = 0
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0) ?? 0, ambiguous)
  return w
}

const truncateToWidth = (s, max, ambiguous = 1) => {
  if (max < 1) return ''
  const plain = stripAnsi(s)
  if (displayWidth(plain, ambiguous) <= max) return plain
  const ell = charWidth(0x2026, ambiguous)
  let out = ''
  let used = 0
  for (const ch of plain) {
    const w = charWidth(ch.codePointAt(0) ?? 0, ambiguous)
    if (used + w + ell > max) break
    out += ch
    used += w
  }
  return ell > max ? '' : `${out}…`
}

const fmtPct = v => {
  const n = num(v)
  return n === null || n < 0 ? DASH : `${Math.round(n)}%`
}

// Claude Code gives epoch seconds; an ISO string is accepted too. Anything else is null.
const resetMs = v => {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null
    return v < 1e11 ? v * 1000 : v
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

const fmtCountdown = (resetAtMs, nowMs) => {
  if (resetAtMs === null || !Number.isFinite(nowMs) || resetAtMs <= nowMs) return null
  const mins = Math.floor((resetAtMs - nowMs) / 60_000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h${String(mins % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

const windowFigures = (w, nowMs) => {
  const stale = w.resetsAtMs !== null && Number.isFinite(nowMs) && w.resetsAtMs <= nowMs
  const pct = stale ? DASH : fmtPct(w.pct)
  return { pct, countdown: stale ? null : fmtCountdown(w.resetsAtMs, nowMs), missing: pct === DASH }
}

const usageSegment = (id, label, prio, w, nowMs) => {
  const f = windowFigures(w, nowMs)
  if (f.missing) return { id, prio, missing: true, forms: [`${label} ${DASH}`, `${label} ${DASH}`, `${label} ${DASH}`] }
  const base = `${label} ${f.pct}`
  return {
    id,
    prio,
    forms: f.countdown === null ? [base, base, base] : [`${base} (${f.countdown})`, `${base} ${f.countdown}`, `${base} ${f.countdown}`],
  }
}

const effective = s => (s.missing === true ? s.prio - 1000 : s.prio)

const layoutLine = (segments, opts) => {
  const columns = Number.isFinite(opts.columns) && opts.columns >= 1 ? Math.floor(opts.columns) : DEFAULT_COLUMNS
  const amb = opts.ambiguous === 2 ? 2 : 1
  const tier = tierOf(Number.isFinite(opts.tierColumns) && opts.tierColumns >= 1 ? opts.tierColumns : columns)
  const sepWidth = displayWidth(SEP, amb)
  const width = items => items.reduce((n, i) => n + displayWidth(i.text, amb), 0) + sepWidth * Math.max(0, items.length - 1)

  let items = segments.map(s => ({ s, text: s.forms[tier] })).filter(i => i.text !== '')
  if (tier === 2 && items.length > MIN_TIER_SEGMENTS) {
    const keep = new Set(
      [...items]
        .sort((a, b) => effective(b.s) - effective(a.s))
        .slice(0, MIN_TIER_SEGMENTS)
        .map(i => i.s.id),
    )
    items = items.filter(i => keep.has(i.s.id))
  }
  while (items.length > 1 && width(items) > columns) {
    let drop = 0
    let lowest = Infinity
    items.forEach((item, i) => {
      if (effective(item.s) <= lowest) {
        lowest = effective(item.s)
        drop = i
      }
    })
    items = items.filter((_, i) => i !== drop)
  }
  const only = items.length === 1 ? items[0] : undefined
  if (only !== undefined && width(items) > columns) {
    let text = only.text
    for (let t = tier + 1; t <= 2 && displayWidth(text, amb) > columns; t++) {
      const form = only.s.forms[t]
      if (form !== undefined && form !== '') text = form
    }
    items = [{ s: only.s, text: truncateToWidth(text, columns, amb) }]
  }
  return items.map(i => (opts.color === true && i.s.bold === true ? `${BOLD[0]}${i.text}${BOLD[1]}` : i.text)).join(SEP)
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
  // System and global config are honoured on purpose (Git for Windows ships core.autocrlf=true in the system config). Only repo-local config is distrusted, see repoConfigSafe.
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' }
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

// Segments in display order; `prio` is what survives a narrow terminal (higher is kept longer).
// Tools and agents are not here on purpose: Claude Code's status line JSON has no such counts and
// reading the transcript is off the table, so the Mods band, which counts tool events, shows them.
export const segmentsFor = (input, nowMs = Date.now()) => {
  const cw = input?.context_window ?? {}
  const rl = input?.rate_limits ?? {}
  const model = str(input?.model?.display_name) ?? str(input?.model?.id)
  const effort = str(input?.effort?.level)
  const dir = str(input?.workspace?.current_dir) ?? str(input?.cwd)
  const cost = num(input?.cost?.total_cost_usd)
  const ms = num(input?.cost?.total_duration_ms)
  const ctx = fmtPct(num(cw.used_percentage))
  const costText = cost === null ? DASH : `$${cost.toFixed(2)}`
  const git = dir === null ? null : gitSegment(dir)

  const segments = [
    model === null
      ? { id: 'model', prio: 60, missing: true, bold: true, forms: [DASH, DASH, DASH] }
      : { id: 'model', prio: 60, bold: true, forms: [effort ? `${model} ${effort}` : model, model, ''] },
    usageSegment('5h', '5h', 100, { pct: num(rl.five_hour?.used_percentage), resetsAtMs: resetMs(rl.five_hour?.resets_at) }, nowMs),
    usageSegment('wk', 'Wk', 90, { pct: num(rl.seven_day?.used_percentage), resetsAtMs: resetMs(rl.seven_day?.resets_at) }, nowMs),
    { id: 'ctx', prio: 70, missing: ctx === DASH, forms: [`Ctx ${ctx}`, `Ctx ${ctx}`, `Ctx ${ctx}`] },
    {
      id: 'cost',
      prio: 30,
      missing: cost === null,
      forms: [ms === null || cost === null ? costText : `${costText} (${elapsed(ms)})`, costText, ''],
    },
  ]
  if (git !== null) segments.push({ id: 'git', prio: 20, forms: [git, git, ''] })
  return segments
}

// The width Claude Code reports in $COLUMNS; a missing or nonsense value falls back to a width
// that is safe in an 80-column terminal.
export const columnsFrom = env => {
  const n = Number.parseInt(env?.COLUMNS, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COLUMNS
}

// Claude Code draws the status line after a two-column indent and keeps two more columns free, and
// ends a longer line with `…` (measured on 2.1.295 at 70, 90 and 100 columns: a line of COLUMNS - 4 cells
// fits, one cell more is cut). The line is laid out for what is left; the tier follows the terminal.
export const STATUS_LINE_MARGIN = 4

export const render = (input, env = {}, nowMs = Date.now()) =>
  layoutLine(segmentsFor(input, nowMs), {
    columns: Math.max(1, columnsFrom(env) - STATUS_LINE_MARGIN),
    tierColumns: columnsFrom(env),
    ambiguous: env.CTK_AMBIGUOUS_WIDTH === '2' ? 2 : 1,
    color: env.CTK_COLOR === '1',
  })

export { DASH, SEP, charWidth, displayWidth, fmtCountdown, fmtPct, layoutLine, resetMs, stripAnsi, tierOf, truncateToWidth, usageSegment, windowFigures }

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
