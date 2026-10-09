import { DASH, displayWidth } from '../../shared/hudline.ts'
import { modelLabel } from '../band.ts'
import { fmtAge, fmtSpan, UNAVAILABLE, workerKey } from '../mission.ts'
import type { McState, Mission, WorkerRow } from '../mission.ts'
import { moreText } from './ctx.tsx'
import type { Ctx } from './ctx.tsx'
import { backButton } from './frame.tsx'
import { glyphProps } from './motion.ts'
import { COLOR, GLYPH, statusColor, statusOf } from './theme.ts'
import type { Status } from './theme.ts'
import type { Extras, Kit } from './types.ts'

const ACT_W = 4
const RAMP = '▁▃▅▇'
/** Most ordinary subagents listed; the rest are counted. Few when workers share the page. */
const SUBAGENT_ROWS = 8
const SUBAGENT_ROWS_BESIDE_WORKERS = 2
const NAME_MIN = 10
const NAME_MAX = 28

/** `m:ss`, or `h:mm:ss` past an hour. */
export const fmtClock = (ms: number): string => {
  const t = Math.floor(ms / 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  return t >= 3600 ? `${Math.floor(t / 3600)}:${two(Math.floor((t % 3600) / 60))}:${two(t % 60)}` : `${Math.floor(t / 60)}:${two(t % 60)}`
}

export const renderWorkers = (kit: Kit, m: Mission, mc: McState, _extras: Extras, ctx: Ctx) => {
  const { Text } = kit
  const { line, field, para, pad, compact, room, ambiguous } = ctx

  const BODY_ROWS = ctx.rows
  const subTotal = m.subagents.total
  const subMax = m.workers.length === 0 ? SUBAGENT_ROWS : SUBAGENT_ROWS_BESIDE_WORKERS
  const subRows = subTotal === 0 ? 0 : 1 + Math.min(subTotal, subMax) + (subTotal > subMax ? 1 : 0)
  // Two lines per worker while they fit under the hint; past that, one line each with a TASK column.
  const twoLine = !compact && m.workers.length * 2 <= BODY_ROWS - 1 - subRows

  const gw = displayWidth(GLYPH.running, ambiguous) + 1
  const widest = (xs: string[], min = 0) => Math.max(min, ...xs.map(x => displayWidth(x, ambiguous)))
  const pill = (w: WorkerRow) => (statusOf(w.status) === 'done' ? 'DONE' : w.status.toUpperCase())
  const modelOf = (w: WorkerRow) => modelLabel(w.model) ?? DASH
  // Activity is observed tool calls relative to the busiest worker, never progress.
  const busiest = Math.max(0, ...m.workers.map(w => w.toolCalls ?? 0))
  const act = (w: WorkerRow) => (w.toolCalls === null ? DASH.repeat(ACT_W) : [...RAMP].map((g, i) => (w.toolCalls! > 0 && i < Math.ceil((ACT_W * w.toolCalls!) / busiest) ? g : '·')).join(''))
  const cellOf: Record<string, (w: WorkerRow) => string> = {
    status: pill,
    activity: act,
    tools: w => (w.toolCalls === null ? DASH : String(w.toolCalls)),
    idle: w => (w.idleMs === null ? DASH : fmtSpan(w.idleMs)),
    time: w => (w.elapsedMs === null ? DASH : fmtClock(w.elapsedMs)),
    model: modelOf,
    last: w => (w.lastActivityMs === null ? DASH : fmtAge(w.lastActivityMs)),
  }
  const heads: Record<string, string> = { status: 'STATUS', activity: 'ACTIV', tools: 'TOOLS', idle: 'IDLE', time: 'TIME', model: 'MODEL', last: 'LAST' }
  // Columns after the name, in the order they are given up when the room is short; widths follow the content.
  const cols = ['status', 'activity', 'tools', 'idle', ...(compact || twoLine ? [] : ['time']), 'model', 'last'].map(id => ({ id, head: heads[id]!, w: widest([heads[id]!, ...m.workers.map(w => cellOf[id]!(w))]) }))
  let left = room - gw
  const shown = cols.filter(c => (left - c.w - 1 >= NAME_MIN ? ((left -= c.w + 1), true) : false))
  const longest = widest(m.workers.map(w => w.name), 4)
  const pillW = widest(m.workers.map(pill))
  const modelW = widest(m.workers.map(modelOf))
  const nameW = twoLine ? Math.min(NAME_MAX, longest, Math.max(NAME_MIN, room - gw - pillW - modelW - ACT_W - 3)) : Math.min(NAME_MAX, longest, left)
  const taskW = compact || twoLine ? 0 : Math.min(left - nameW - 1, widest(m.workers.map(w => w.currentTask ?? DASH), 4))
  const rest = (get: (id: string) => string) => shown.map(c => ` ${pad(get(c.id), c.w)}`).join('')

  const oneLine = (w: WorkerRow) => {
    const st = statusOf(w.status)
    return (
      <kit.Button key={workerKey(w.agentId)} plain label={`Worker ${w.name}`} onPress={() => {}}>
        <Text wrap="truncate-end">
          <Text color={statusColor(st)} {...glyphProps(ctx.motion, st === 'running', `worker:${w.agentId}`)}>{GLYPH[st]} </Text>
          <Text bold>{pad(w.name, nameW)}</Text>
          <Text dimColor={w.currentTask === null}>{taskW <= 0 ? '' : ` ${pad(w.currentTask ?? DASH, taskW)}`}</Text>
          {shown.map(c => (
            <Text key={c.id} color={c.id === 'status' || c.id === 'activity' ? statusColor(st) : undefined} dimColor={cellOf[c.id]!(w) === DASH}>{` ${pad(cellOf[c.id]!(w), c.w)}`}</Text>
          ))}
        </Text>
      </kit.Button>
    )
  }
  // Wide: name, status pill, model and activity on one row; the task, tool calls and times under it. Only observed values; the rest are a dash.
  const twoLines = (w: WorkerRow) => {
    const st = statusOf(w.status)
    const detail = [
      w.currentTask ?? DASH,
      `${w.toolCalls ?? DASH} tools`,
      w.elapsedMs === null ? DASH : fmtClock(w.elapsedMs),
      `last ${w.lastActivityMs === null ? DASH : fmtAge(w.lastActivityMs)}`,
    ].join(' · ')
    return [
      <kit.Button key={workerKey(w.agentId)} plain label={`Worker ${w.name}`} onPress={() => {}}>
        <Text wrap="truncate-end">
          <Text color={statusColor(st)} {...glyphProps(ctx.motion, st === 'running', `worker:${w.agentId}`)}>{GLYPH[st]} </Text>
          <Text bold>{pad(w.name, nameW)}</Text>
          <Text color={statusColor(st)} bold>{` ${pad(pill(w), pillW)}`}</Text>
          <Text dimColor={w.model === null}>{` ${pad(modelOf(w), modelW)} `}</Text>
          <Text color={w.toolCalls === null ? COLOR.muted : statusColor(st)}>{act(w)}</Text>
        </Text>
      </kit.Button>,
      // A Button holds only Text, so the second row sits beside it, not inside.
      line(`${workerKey(w.agentId)}-d`, `${' '.repeat(gw)}${detail}`, { dim: true }),
    ]
  }

  const picked = mc.selected?.kind === 'worker' ? m.workers.find(w => w.agentId === mc.selected?.id) : undefined
  if (picked !== undefined) {
    return [
      line('w-name', picked.name, { bold: true }),
      field('w-id', 'Agent id', picked.agentId),
      field('w-model', 'Model', picked.model ?? `${UNAVAILABLE} (the spawn did not report one)`),
      field('w-status', 'Status', picked.status),
      field('w-task', 'Current task', picked.currentTask ?? `${UNAVAILABLE} (no in-progress task owned by this worker was observed)`),
      field('w-tools', 'Tool calls', picked.toolCalls === null ? UNAVAILABLE : `${picked.toolCalls} (its own loop)`),
      field('w-recent', 'Recent', picked.recent.length === 0 ? `${UNAVAILABLE} (no tool call of its own loop was seen)` : picked.recent.join(' ‹ ')),
      field('w-last', 'Last activity', fmtAge(picked.lastActivityMs)),
      field('w-idle', 'Idle for', picked.status === 'idle' ? fmtSpan(picked.idleMs) : 'not idle'),
      backButton(kit, ctx),
    ]
  }
  const subagents = () =>
    subTotal === 0
      ? []
      : [
          line('sa-head', `SUBAGENTS (${subTotal}) · outside the cap`, { bold: true }),
          ...m.subagents.rows.slice(-subMax).map((a, i) => line(`sa-${i}`, `${pad(a.type, Math.min(compact ? 14 : 20, widest(m.subagents.rows.map(r => r.type))))} ${pad(a.status, 9)} ${a.description}`, { dim: true })),
          ...(subTotal > subMax ? [line('sa-more', `+${subTotal - subMax} earlier`, { dim: true })] : []),
        ]
  if (m.workers.length === 0) return [...para('w-none', m.empty.workers ?? 'No teammate has started this session.'), ...subagents()]

  // The hint (and in the compact table a header) take rows; the subagent block keeps what it needs; workers get the rest.
  const per = twoLine ? 2 : 1
  const avail = BODY_ROWS - (twoLine ? 1 : 2) - subRows
  const over = m.workers.length * per > avail
  const visible = over ? m.workers.slice(0, Math.max(1, Math.floor((avail - 1) / per))) : m.workers
  const hidden = m.workers.slice(visible.length)
  const hiddenBy = (st: Status) => hidden.filter(w => statusOf(w.status) === st).length
  const summary = (['running', 'idle', 'failed'] as const)
    .map(st => [hiddenBy(st), st] as const)
    .filter(([n]) => n > 0)
    .map(([n, st]) => `${n} ${st}`)
    .join(', ')
  return [
    ...(!twoLine ? [line('w-head', `${' '.repeat(gw)}${pad('NAME', nameW)}${taskW <= 0 ? '' : ` ${pad('TASK', taskW)}`}${rest(id => shown.find(c => c.id === id)?.head ?? '')}`, { dim: true })] : []),
    ...visible.flatMap(twoLine ? twoLines : w => [oneLine(w)]),
    ...(hidden.length > 0 ? [line('w-more', `${moreText(hidden.length, room)}${summary === '' ? '' : ` (${summary})`}`, { dim: true })] : []),
    line('w-hint', 'Select a worker for details · bars: tool calls vs the busiest (activity)', { dim: true }),
    ...subagents(),
  ]
}
