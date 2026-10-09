import { DASH, displayWidth } from '../../shared/hudline.ts'
import { modelLabel } from '../band.ts'
import { fmtAge, fmtSpan, UNAVAILABLE, workerKey } from '../mission.ts'
import type { McState, Mission, WorkerRow } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { backButton } from './frame.tsx'
import { GLYPH, statusColor, statusOf } from './theme.ts'
import type { Status } from './theme.ts'
import type { Extras, Kit } from './types.ts'

/** Body rows left under the inline pane's PANE_ROWS = 16 after the header, tabs, spacing and footer. */
const BODY_ROWS = 11
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
  const { line, field, para, pad, clip, compact, room, ambiguous } = ctx

  const subTotal = m.subagents.total
  const subMax = m.workers.length === 0 ? SUBAGENT_ROWS : SUBAGENT_ROWS_BESIDE_WORKERS
  const subRows = subTotal === 0 ? 0 : 1 + Math.min(subTotal, subMax) + (subTotal > subMax ? 1 : 0)
  // Two lines per worker while they fit under the hint; past that, one line each with a TASK column.
  const twoLine = !compact && m.workers.length * 2 <= BODY_ROWS - 1 - subRows

  const gw = displayWidth(GLYPH.running, ambiguous) + 1
  // Columns after the name, in the order they are given up when the room is short.
  const cols = [
    { id: 'status', head: 'STATUS', w: 8 },
    { id: 'tools', head: 'TOOLS', w: 5 },
    { id: 'idle', head: 'IDLE', w: 6 },
    ...(compact || twoLine ? [] : [{ id: 'time', head: 'TIME', w: 7 }]),
    { id: 'model', head: 'MODEL', w: compact ? 11 : 17 },
    { id: 'last', head: 'LAST', w: 8 },
  ]
  let left = room - gw
  const shown = cols.filter(c => (left - c.w - 1 >= NAME_MIN ? ((left -= c.w + 1), true) : false))
  const nameW = twoLine ? Math.min(NAME_MAX, Math.max(NAME_MIN, room - gw - 29)) : compact ? Math.min(NAME_MAX, Math.max(4, left)) : Math.min(20, left)
  const taskW = compact || twoLine ? 0 : left - nameW - 1 >= 8 ? left - nameW - 1 : 0

  const cell = (w: WorkerRow, id: string): string =>
    id === 'status' ? w.status : id === 'tools' ? (w.toolCalls === null ? DASH : String(w.toolCalls)) : id === 'idle' ? (w.idleMs === null ? DASH : fmtSpan(w.idleMs)) : id === 'time' ? (w.elapsedMs === null ? DASH : fmtClock(w.elapsedMs)) : id === 'last' ? (w.lastActivityMs === null ? DASH : fmtAge(w.lastActivityMs)) : (compact ? modelLabel(w.model) : w.model) ?? DASH
  const rest = (get: (id: string) => string) => shown.map(c => ` ${pad(get(c.id), c.w)}`).join('')

  const oneLine = (w: WorkerRow) => {
    const st = statusOf(w.status)
    return (
      <kit.Button key={workerKey(w.agentId)} plain label={`Worker ${w.name}`} onPress={() => {}}>
        <Text wrap="truncate-end">
          <Text color={statusColor(st)}>{GLYPH[st]} </Text>
          <Text bold>{pad(w.name, nameW)}</Text>
          <Text dimColor={w.currentTask === null}>{taskW === 0 ? '' : ` ${pad(w.currentTask ?? DASH, taskW)}`}</Text>
          <Text>{rest(id => cell(w, id))}</Text>
        </Text>
      </kit.Button>
    )
  }
  // Wide: the name, model and state on one row; the task, tool calls and times under it. Only observed values; the rest are a dash.
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
          <Text color={statusColor(st)}>{GLYPH[st]} </Text>
          <Text bold>{pad(w.name, nameW)}</Text>
          <Text dimColor={w.model === null}> {pad(w.model ?? DASH, 17)} </Text>
          <Text color={statusColor(st)}>{clip(w.status.toUpperCase(), 10)}</Text>
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
      field('w-last', 'Last activity', fmtAge(picked.lastActivityMs)),
      field('w-idle', 'Idle for', picked.status === 'idle' ? fmtSpan(picked.idleMs) : 'not idle'),
      backButton(kit, ctx),
    ]
  }
  const subagents = () =>
    subTotal === 0
      ? []
      : [
          line('sa-head', `ORDINARY SUBAGENTS (${subTotal}) - not teammates, not counted by the cap`, { bold: true }),
          ...m.subagents.rows.slice(-subMax).map((a, i) => line(`sa-${i}`, `${pad(a.type, compact ? 14 : 20)} ${pad(a.status, 9)} ${a.description}`, { dim: true })),
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
    ...(!twoLine ? [line('w-head', `${' '.repeat(gw)}${pad('NAME', nameW)}${taskW === 0 ? '' : ` ${pad('TASK', taskW)}`}${rest(id => shown.find(c => c.id === id)?.head ?? '')}`, { dim: true })] : []),
    ...visible.flatMap(twoLine ? twoLines : w => [oneLine(w)]),
    ...(hidden.length > 0 ? [line('w-more', `+${hidden.length} more${summary === '' ? '' : ` (${summary})`}`, { dim: true })] : []),
    line('w-hint', 'Select a worker for its details.', { dim: true }),
    ...subagents(),
  ]
}
