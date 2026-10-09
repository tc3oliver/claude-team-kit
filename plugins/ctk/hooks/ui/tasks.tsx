import { displayWidth } from '../../shared/hudline.ts'
import { taskKey, UNAVAILABLE } from '../mission.ts'
import type { McState, Mission, TaskRow } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { layoutDag, taskStatus } from './dag.ts'
import { backButton } from './frame.tsx'
import { glyphProps } from './motion.ts'
import { COLOR, GLYPH, progressBar, statusColor } from './theme.ts'
import type { Status } from './theme.ts'
import type { Extras, Kit } from './types.ts'

/**
 * Default cap on the rows this page returns (the inline pane has 16: header, tabs, spacing and footer
 * take 5); the page reads `ctx.rows`, which a taller pane raises. Task counts never change it; what
 * does not fit is summarised as "+N more not shown".
 */
export const TASK_ROWS = 11
/** Rows the dependency graph may use; the bar, the frontier and a few list rows keep the rest. */
const DAG_ROWS = 6
const LIST_MIN = 3

/** The overflow line: the longest wording that fits the room, so it never clips mid-word. */
export const moreHint = (n: number, room: number, ambiguous: 1 | 2 = 1): string => {
  const tiers = [
    `+${n} more not shown, done last · enlarge the terminal, or ask Claude for the task list`,
    `+${n} more · enlarge the terminal or ask Claude to list them`,
    `+${n} more · enlarge, or ask Claude`,
    `+${n} more · enlarge terminal`,
  ]
  return tiers.find(t => displayWidth(t, ambiguous) <= room) ?? tiers[2]!
}

const num = (v: number | null): string => (v === null ? UNAVAILABLE : String(v))

// What the person needs first: work in progress, then what can start, then the rest, done last.
const rank = (t: TaskRow): number => (t.status === 'in_progress' ? 0 : t.ready ? 1 : t.status === 'completed' ? 4 : t.blocked ? 2 : 3)

const WORD: Record<Status, string> = { running: 'in progress', ready: 'ready', pending: 'pending', done: 'marked complete', idle: '', failed: '' }
const word = (t: TaskRow): string => (t.status === 'unknown' ? 'unknown' : t.blocked ? 'blocked' : WORD[taskStatus(t)])

export const renderTasks = (kit: Kit, m: Mission, mc: McState, _extras: Extras, ctx: Ctx) => {
  const { Text } = kit
  const { line, field, para, clip, room, ambiguous, rows } = ctx
  const t = m.tasks

  if (!t.detailed) {
    return [
      ...para('t-none', m.empty.tasks ?? `Task detail ${UNAVAILABLE}: no TaskCreate or TaskUpdate call has been seen since CTK loaded.`).slice(0, rows - 1),
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
  const partial = t.partial ? [line('t-partial', 'Some tasks were created before CTK loaded, so the detail counts are unavailable.', { dim: true, color: 'warning' })] : []

  const dag = layoutDag(t.rows, { width: room, maxRows: Math.min(DAG_ROWS, rows - 2 - partial.length - LIST_MIN), ambiguous })
  if (dag !== null) {
    dag.lines.forEach((segs, i) =>
      out.push(
        <Text key={`t-dag-${i}`} wrap="truncate-end">
          {segs.map((s, j) => (
            <Text key={j} color={s.title ? undefined : s.status === undefined ? COLOR.muted : statusColor(s.status)}>
              {s.text}
            </Text>
          ))}
        </Text>,
      ),
    )
  }
  out.push(line('t-bar', `${bar.text}  ${num(t.completed)}/${num(t.total)} marked complete`, { color: pct === null ? COLOR.muted : COLOR.done }))

  const ready = t.rows.filter(r => r.ready).map(r => `#${r.id}`)
  const running = t.rows.filter(r => r.status === 'in_progress' && !r.blocked).length
  const readyText = t.ready === null ? UNAVAILABLE : ready.length === 0 ? 'none' : ready.slice(0, 6).join(' ') + (ready.length > 6 ? ` +${ready.length - 6}` : '')
  out.push(
    <Text key="t-front" wrap="truncate-end">
      <Text color={COLOR.ready}>Ready {readyText}</Text>
      <Text dimColor> · </Text>
      <Text color={COLOR.active}>Running {t.partial ? UNAVAILABLE : running}</Text>
      <Text dimColor> · Blocked {num(t.blocked)}</Text>
    </Text>,
  )
  out.push(...partial)

  const sorted = [...t.rows].sort((a, b) => rank(a) - rank(b))
  const free = rows - out.length
  const shown = sorted.length > free ? free - 1 : sorted.length
  const gw = displayWidth(GLYPH.running, ambiguous) + 1
  for (const r of sorted.slice(0, Math.max(0, shown))) {
    const st = taskStatus(r)
    const id = `#${r.id} `
    const avail = room - gw - displayWidth(id, ambiguous)
    // A long owner is cut, not dropped, so the title keeps at least two thirds of the room.
    const owner = r.owner === null ? null : `@${ctx.clip(r.owner, Math.max(6, Math.floor(avail / 3)) - 1)}`
    const side = [owner, r.openBlockers.length === 0 ? null : `needs ${r.openBlockers.map(b => `#${b}`).join(',')}`].filter(x => x !== null).join(' · ')
    const showSide = side !== '' && displayWidth(side, ambiguous) * 2 <= avail
    out.push(
      <kit.Button key={taskKey(r.id)} plain label={`Task #${r.id}`} onPress={() => {}}>
        <Text wrap="truncate-end">
          <Text color={statusColor(st)} {...glyphProps(ctx.motion, st === 'running', `task:${r.id}`)}>{GLYPH[st]} </Text>
          <Text bold>{id}</Text>
          <Text>{ctx.pad(r.subject, showSide ? avail - displayWidth(side, ambiguous) - 1 : avail)}</Text>
          {showSide ? <Text dimColor> {side}</Text> : null}
        </Text>
      </kit.Button>,
    )
  }
  if (shown < sorted.length) out.push(line('t-more', clip(moreHint(sorted.length - shown, room, ambiguous)), { dim: true }))
  return out
}
