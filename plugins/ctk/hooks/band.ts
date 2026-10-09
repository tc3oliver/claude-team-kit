import { DASH, fmtModels, pct, usd } from '../shared/format.ts'
import { fmtCountdown, fmtPct, layoutLine, resetMs, truncateToWidth, usageSegment } from '../shared/hudline.ts'
import type { Segment } from '../shared/hudline.ts'
import type { StatsRecord } from '../shared/stats.ts'
import type { Snapshot } from './team.ts'

// Pure text for the AbovePrompt band and the /ctk-stats summary (figure formatting is in
// shared/format.ts, which `ctk stats` uses too; the width-aware layout is in shared/hudline.ts).

const num = (v: number | null): string => (v === null ? DASH : String(v))

/**
 * `5s`, `4m`, `1h05m` for a duration in ms; `nullText` stands in for a null duration. The one
 * body behind the band's `fmtElapsed` (sentinel DASH) and Mission Control's `fmtSpan` (sentinel
 * UNAVAILABLE): both call sites keep their own null wording, so the formats stay as pinned.
 */
export const spanText = (ms: number | null, nullText: string): string => {
  if (ms === null) return nullText
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export const fmtElapsed = (ms: number | null): string => spanText(ms, DASH)

/**
 * `claude-sonnet-5-5` -> `Sonnet 5.5`; `claude-opus-4-1-20250805` -> `Opus 4.1`; an alias such
 * as `sonnet` -> `Sonnet`. Anything unrecognised is shown as given, minus a `claude-` prefix.
 */
export const modelLabel = (id: string | null): string | null => {
  if (id === null) return null
  const raw = id.trim().replace(/^claude-/i, '')
  if (raw === '') return null
  const long = /\[1m\]$/i.test(raw) ? ' 1M' : ''
  const parts = raw.replace(/\[.*\]$/, '').split('-')
  const family = parts[0] ?? ''
  if (!/^(opus|sonnet|haiku|fable)$/i.test(family)) return raw
  const nums = parts.slice(1).filter(p => /^\d{1,2}$/.test(p))
  return `${family[0]?.toUpperCase()}${family.slice(1).toLowerCase()}${nums.length > 0 ? ` ${nums.slice(0, 2).join('.')}` : ''}${long}`
}

export type BandOptions = {
  /** Epoch ms the reset countdowns count from: the clock reading of the last refresh. */
  nowMs?: number
  /** 2 on terminals that draw `│` and `…` two cells wide (CTK_AMBIGUOUS_WIDTH=2). */
  ambiguous?: 1 | 2
  /**
   * True when the CTK status line is configured. It then shows model, usage, context, cost and
   * branch under the prompt, so the band keeps to what only the mod can know and nothing is
   * drawn twice.
   */
  coordinated?: boolean
  /**
   * The terminal width that picks the form (full, abbreviated, essentials). Default: the width the
   * engine reports for the band plus its margin; a forced HUD form passes its own.
   */
  tierColumns?: number
  /** The guard's one-word state (`ON`, `ERR`, `–`), shown as `Guard ON`; left out when not given. */
  guard?: string
  /** Ordinary subagents live now (not teammates); shown as `Sub 2` only when above zero. */
  subagentsLive?: number
  /** An option change waits for the person's Confirm in Mission Control; the band says so until it is answered. */
  pendingChange?: boolean
  /** The git branch of the session's directory (a short commit id when detached); left out when null or the status line shows it. */
  branch?: string | null
}

/** Above this many tasks the band points at Mission Control for the whole list. */
const MORE_TASKS = 6

// Rank when the line is too wide (higher stays longer). Model, usage, context and cost are
// the status line's too; the rest is the team's.
const RANK = { pending: 95, fiveHour: 100, sevenDay: 90, tools: 80, context: 70, model: 60, branch: 55, agents: 50, guard: 45, tasks: 40, subagents: 35, cost: 30, workerModels: 10 }

export const bandSegments = (s: StatsRecord, snap: Snapshot, opts: BandOptions = {}): Segment[] => {
  const now = opts.nowMs ?? 0
  const out: Segment[] = []
  const mine = opts.coordinated !== true

  if (mine) {
    out.push({ id: 'model', prio: RANK.model, bold: true, ...modelSegment(s.measured.model) })
    out.push(
      usageSegment('5h', '5h', RANK.fiveHour, { pct: s.measured.fiveHourPct, resetsAtMs: resetMs(s.measured.fiveHourResetsAt) }, now),
      usageSegment('wk', 'Wk', RANK.sevenDay, { pct: s.measured.sevenDayPct, resetsAtMs: resetMs(s.measured.sevenDayResetsAt) }, now),
    )
  }
  if (mine && opts.branch) {
    const full = `git:${opts.branch}`
    out.push({ id: 'branch', prio: RANK.branch, forms: [truncateToWidth(full, 28, opts.ambiguous), truncateToWidth(full, 20, opts.ambiguous), ''] })
  }
  out.push({ id: 'tools', prio: RANK.tools, forms: [`Tools ${s.toolCalls}`, `T${s.toolCalls}`, `T${s.toolCalls}`] })
  out.push(agentsSegment(s, snap))
  if (opts.guard !== undefined) {
    const text = `Guard ${opts.guard}`
    out.push({ id: 'guard', prio: RANK.guard, missing: opts.guard === DASH, forms: [text, text, ''] })
  }
  if (mine) {
    const ctx = s.measured.contextPct
    const text = `Ctx ${fmtPct(ctx)}`
    out.push({ id: 'ctx', prio: RANK.context, missing: fmtPct(ctx) === DASH, forms: [text, text, text] })
  }
  if (opts.subagentsLive !== undefined && opts.subagentsLive > 0) {
    const n = opts.subagentsLive
    out.push({ id: 'subagents', prio: RANK.subagents, forms: [`Sub ${n}`, `S${n}`, ''] })
  }
  if (opts.pendingChange === true) out.push({ id: 'pending', prio: RANK.pending, bold: true, forms: ['Confirm setting: click here', 'Confirm: click', '!'] })
  if (s.tasks !== null) {
    const text = `Tasks ${s.tasks.completed}/${s.tasks.created}`
    // Past a handful of tasks the pane lists only some of them, so say where the whole board is.
    const more = s.tasks.created > MORE_TASKS
    out.push({ id: 'tasks', prio: RANK.tasks, forms: [more ? `${text} (full list: Mission Control)` : text, more ? `${text} (list: click here)` : text, ''] })
  }
  if (mine) {
    const cost = usd(s.measured.costUsd)
    const elapsed = snap.elapsedMs === null || s.measured.costUsd === null ? null : fmtElapsed(snap.elapsedMs)
    out.push({
      id: 'cost',
      prio: RANK.cost,
      missing: s.measured.costUsd === null,
      forms: [elapsed === null ? cost : `${cost} (${elapsed})`, cost, ''],
    })
  }
  if (Object.keys(s.workerModels).length > 0) {
    out.push({ id: 'workers', prio: RANK.workerModels, forms: [`models ${fmtModels(s.workerModels)}`, '', ''] })
  }
  return out
}

const modelSegment = (id: string | null): Pick<Segment, 'forms' | 'missing'> => {
  const label = modelLabel(id)
  return label === null ? { missing: true, forms: [DASH, DASH, DASH] } : { forms: [label, label, ''] }
}

// `Agents 2/3`: live teammates (busy and idle, the figure the cap counts) over the cap. A refused
// spawn is the cap doing its job, so it travels with the segment and is dropped with it.
const agentsSegment = (s: StatsRecord, snap: Snapshot): Segment => {
  const live = num(snap.live)
  const refused = s.spawnsRejected
  const busy = snap.busy !== null && snap.live !== null && snap.live > 0 ? ` (${snap.busy} busy)` : ''
  return {
    id: 'agents',
    prio: RANK.agents,
    missing: snap.live === null,
    forms: [
      `Agents ${live}/${s.maxWorkers}${refused > 0 ? ` (refused ${refused})` : busy}`,
      `A${live}/${s.maxWorkers}${refused > 0 ? ` !${refused}` : ''}`,
      `A${live}/${s.maxWorkers}${refused > 0 ? ` !${refused}` : ''}`,
    ],
  }
}

/**
 * The band's body is 5 columns narrower than the terminal (Claude Code keeps the right edge for its
 * own `[-]` control; measured on 2.1.295: bodyColumns 125, 115, 95, 75, 55 at terminal widths 130,
 * 120, 100, 80, 60). The tier follows the terminal, so 120+ columns is the full form, as documented.
 */
export const BAND_MARGIN = 5

export const formatBand = (s: StatsRecord, snap: Snapshot, bodyColumns: number, opts: BandOptions = {}): string =>
  layoutLine(bandSegments(s, snap, opts), { columns: bodyColumns, tierColumns: opts.tierColumns ?? bodyColumns + BAND_MARGIN, ambiguous: opts.ambiguous })

const limitLine = (label: string, pctValue: number | null, resetsAt: string | null, now: number): string => {
  const left = fmtCountdown(resetMs(resetsAt), now)
  const stale = resetMs(resetsAt) !== null && left === null
  return `${label}: ${stale ? DASH : pct(pctValue)}${left === null ? '' : ` (resets in ${left})`}`
}

export const formatSummary = (s: StatsRecord, snap: Snapshot, nowMs = 0): string =>
  [
    `CTK session ${s.sessionId}`,
    'counted by CTK:',
    `  teammate spawns: ${s.spawnsAccepted} accepted, ${s.spawnsRejected} refused at capacity, ${s.spawnsFailedClosed} failed closed`,
    `  guard reached by ${s.spawnsSeen} spawn event(s); named agents started outside the cap (with isolation): ${s.spawnsOutsideCap}`,
    `  peak live teammates: ${s.peakLive} (cap ${s.maxWorkers}); now ${num(snap.live)}`,
    `  worker models: ${fmtModels(s.workerModels) || DASH}`,
    `  tasks created/completed: ${s.tasks === null ? `${DASH} (no task event seen)` : `${s.tasks.created}/${s.tasks.completed}`}`,
    `  tool calls: ${s.toolCalls} (lead, subagents and teammates; each call once)`,
    'measured (reported by Claude Code):',
    `  model: ${modelLabel(s.measured.model) ?? DASH}  cost: ${usd(s.measured.costUsd)}  context: ${pct(s.measured.contextPct)}`,
    `  ${limitLine('5h limit', s.measured.fiveHourPct, s.measured.fiveHourResetsAt, nowMs)}  ${limitLine('7d limit', s.measured.sevenDayPct, s.measured.sevenDayResetsAt, nowMs)}`,
    `  elapsed: ${fmtElapsed(snap.elapsedMs)}`,
    '  per-worker cost: not available from Claude Code',
  ].join('\n')
