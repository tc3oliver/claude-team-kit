import { displayWidth } from '../../shared/hudline.ts'
import { taskKey, UNAVAILABLE } from '../mission.ts'
import type { McState, Mission, TaskRow } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { layoutDag, taskStatus } from './dag.ts'
import { backButton } from './frame.tsx'
import { COLOR, GLYPH, progressBar, statusColor } from './theme.ts'
import type { Status } from './theme.ts'
import type { Extras, Kit } from './types.ts'

/**
 * Hard cap on the rows this page returns (the inline pane has 16: header, tabs, spacing and footer
 * take 5). Task counts never change it; what does not fit is summarised as "+N more not shown".
 */
export const TASK_ROWS = 11
/** Rows the mini DAG may use, and the room it needs. */
const DAG_ROWS = 4
const DAG_ROOM = 70

const num = (v: number | null): string => (v === null ? UNAVAILABLE : String(v))

// What the person needs first: work in progress, then what can start, then the rest, done last.
const rank = (t: TaskRow): number => (t.status === 'in_progress' ? 0 : t.ready ? 1 : t.status === 'completed' ? 4 : t.blocked ? 2 : 3)

const WORD: Record<Status, string> = { running: 'in progress', ready: 'ready', pending: 'pending', done: 'marked complete', idle: '', failed: '' }
const word = (t: TaskRow): string => (t.status === 'unknown' ? 'unknown' : t.blocked ? 'blocked' : WORD[taskStatus(t)])

export const renderTasks = (kit: Kit, m: Mission, mc: McState, _extras: Extras, ctx: Ctx) => {
  const { Text } = kit
  const { line, field, para, clip, room, ambiguous } = ctx
  const t = m.tasks

  if (!t.detailed) {
    return [
      ...para('t-none', m.empty.tasks ?? `Task detail ${UNAVAILABLE}: no TaskCreate or TaskUpdate call has been seen since CTK loaded.`).slice(0, TASK_ROWS - 1),
      ...(t.total === null ? [] : [field('t-counts', 'From events', `${num(t.completed)}/${t.total} done`)]),
    ]
  }

  const picked = mc.selected?.kind === 'task' ? mc.selected.id : null
  if (picked !== null) {
    const row = t.rows.find(r => r.id === picked)
    if (row === undefined) return [...para('t-gone', `Task #${picked} is not on the board.`).slice(0, 3), backButton(kit, ctx)]
    const seen = (id: string): string => (t.rows.some(r => r.id === id) ? `#${id}` : `#${id} (not seen)`)
    const list = (ids: string[]): string => (ids.length === 0 ? 'none' : ids.map(seen).join(' '))
    return [
      ...para(`t-${row.id}-title`, `#${row.id} ${row.subject}`, { bold: true }).slice(0, 2),
      field('t-status', 'Status', word(row) + (row.status === 'completed' ? ' (TaskUpdate; not verified)' : ''), statusColor(taskStatus(row))),
      field('t-owner', 'Owner', row.owner ?? UNAVAILABLE),
      field('t-by', 'Blocked by', list(row.blockedBy)),
      field('t-open', 'Still open', row.blockedBy.length === 0 ? 'none' : list(row.openBlockers)),
      field('t-blocks', 'Blocks', list(row.blocks)),
      ...(row.seenByUpdateOnly ? [line('t-upd', 'Created before CTK loaded: title and links may be incomplete.', { dim: true, color: 'warning' })] : []),
      backButton(kit, ctx),
    ]
  }

  const out: ReturnType<typeof line>[] = []
  const pct = t.total !== null && t.total > 0 && t.completed !== null ? (t.completed / t.total) * 100 : null
  const bar = progressBar(pct)
  out.push(line('t-bar', `${bar.text}  ${num(t.completed)}/${num(t.total)} marked complete`, { color: pct === null ? COLOR.muted : COLOR.done }))

  const ready = t.rows.filter(r => r.ready).map(r => `#${r.id}`)
  const running = t.rows.filter(r => r.status === 'in_progress' && !r.blocked).length
  const frontier = t.ready === null ? `Ready ${UNAVAILABLE}` : `Ready ${ready.length === 0 ? 'none' : ready.slice(0, 6).join(' ') + (ready.length > 6 ? ` +${ready.length - 6}` : '')}`
  out.push(line('t-front', `${frontier} · Running ${t.partial ? UNAVAILABLE : running} · Blocked ${num(t.blocked)}`, { color: COLOR.ready }))
  if (t.partial) out.push(line('t-partial', 'Some tasks were created before CTK loaded, so the detail counts are unavailable.', { dim: true, color: 'warning' }))

  const dag = room >= DAG_ROOM ? layoutDag(t.rows, { width: room, maxRows: DAG_ROWS, ambiguous }) : null
  if (dag !== null) {
    dag.lines.forEach((segs, i) =>
      out.push(
        <Text key={`t-dag-${i}`} wrap="truncate-end">
          {segs.map((s, j) => (
            <Text key={j} color={s.status === undefined ? COLOR.muted : statusColor(s.status)}>
              {s.text}
            </Text>
          ))}
        </Text>,
      ),
    )
  }

  const sorted = [...t.rows].sort((a, b) => rank(a) - rank(b))
  const free = TASK_ROWS - out.length
  const shown = sorted.length > free ? free - 1 : sorted.length
  const gw = displayWidth(GLYPH.running, ambiguous) + 1
  for (const r of sorted.slice(0, Math.max(0, shown))) {
    const st = taskStatus(r)
    const id = `#${r.id} `
    const side = [r.owner === null ? null : `@${r.owner}`, r.openBlockers.length === 0 ? null : `needs ${r.openBlockers.map(b => `#${b}`).join(',')}`].filter(x => x !== null).join(' · ')
    const avail = room - gw - displayWidth(id, ambiguous)
    const showSide = side !== '' && displayWidth(side, ambiguous) * 2 <= avail
    out.push(
      <kit.Button key={taskKey(r.id)} plain label={`Task #${r.id}`} onPress={() => {}}>
        <Text wrap="truncate-end">
          <Text color={statusColor(st)}>{GLYPH[st]} </Text>
          <Text bold>{id}</Text>
          <Text>{ctx.pad(r.subject, showSide ? avail - displayWidth(side, ambiguous) - 1 : avail)}</Text>
          {showSide ? <Text dimColor> {side}</Text> : null}
        </Text>
      </kit.Button>,
    )
  }
  if (shown < sorted.length) out.push(line('t-more', clip(`+${sorted.length - shown} more not shown (done tasks last)`), { dim: true }))
  return out
}
