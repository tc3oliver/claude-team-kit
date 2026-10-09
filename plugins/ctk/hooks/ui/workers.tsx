import { DASH } from '../../shared/hudline.ts'
import { modelLabel } from '../band.ts'
import { fmtAge, fmtSpan, UNAVAILABLE, workerKey } from '../mission.ts'
import type { McState, Mission, WorkerRow } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { backButton } from './frame.tsx'
import type { Extras, Kit } from './types.ts'

/** Most ordinary subagents listed; the rest are counted. */
const SUBAGENT_ROWS = 8

export const renderWorkers = (kit: Kit, m: Mission, mc: McState, _extras: Extras, ctx: Ctx) => {
  const { line, field, para, link, pad, compact } = ctx

  const workerLine = (w: WorkerRow) =>
    compact
      ? `${pad(w.name, 11)} ${pad(modelLabel(w.model) ?? UNAVAILABLE, 10)} ${pad(w.status, 7)} ${pad(w.toolCalls === null ? UNAVAILABLE : String(w.toolCalls), 5)} ${w.idleMs === null ? DASH : fmtSpan(w.idleMs)}`
      : `${pad(w.name, 12)} ${pad(w.model ?? UNAVAILABLE, 17)} ${pad(w.status, 8)} ${pad(w.toolCalls === null ? UNAVAILABLE : String(w.toolCalls), 5)} ${pad(fmtAge(w.lastActivityMs), 8)} ${w.idleMs === null ? DASH : fmtSpan(w.idleMs)}`

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
    m.subagents.total === 0
      ? []
      : [
          line('sa-head', `ORDINARY SUBAGENTS (${m.subagents.total}) - not teammates, not counted by the cap`, { bold: true }),
          ...m.subagents.rows.slice(-SUBAGENT_ROWS).map((a, i) => line(`sa-${i}`, `${pad(a.type, compact ? 14 : 20)} ${pad(a.status, 9)} ${a.description}`, { dim: true })),
          ...(m.subagents.total > SUBAGENT_ROWS ? [line('sa-more', `+${m.subagents.total - SUBAGENT_ROWS} earlier`, { dim: true })] : []),
        ]
  if (m.workers.length === 0) return [...para('w-none', m.empty.workers ?? 'No teammate has started this session.'), ...subagents()]
  return [
    line(
      'w-head',
      compact
        ? `${pad('NAME', 11)} ${pad('MODEL', 10)} ${pad('STATUS', 7)} ${pad('TOOLS', 5)} IDLE`
        : `${pad('NAME', 12)} ${pad('MODEL', 17)} ${pad('STATUS', 8)} ${pad('TOOLS', 5)} ${pad('LAST', 8)} IDLE`,
      { dim: true },
    ),
    ...m.workers.map(w => link(workerKey(w.agentId), workerLine(w), `Worker ${w.name}`)),
    line('w-hint', 'Select a worker for its details.', { dim: true }),
    ...subagents(),
  ]
}
