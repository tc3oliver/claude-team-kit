import { displayWidth } from '../../shared/hudline.ts'
import { collisionLine, fmtAge, fmtSpan, UNAVAILABLE, viewKey, workerKey } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { hudButtons } from './hud.tsx'
import { glyphProps } from './motion.ts'
import { COLOR, GLYPH, guardColor, pressureBar, progressBar, statusColor, statusOf } from './theme.ts'
import type { ThemeColor } from './theme.ts'
import type { Extras, Kit } from './types.ts'

const num = (v: number | null): string => (v === null ? UNAVAILABLE : String(v))

const LABEL = 11
/** Worker rows shown before the `+N` row. */
const MAX_WORKERS = 4

const pctText = (pct: number | null): string => (pct === null ? '–' : `${Math.round(pct)}%`)
const ago = (ms: number | null): string => fmtAge(ms).replace(/ ago$/, '')

export const renderOverview = (kit: Kit, m: Mission, mc: McState, _extras: Extras, ctx: Ctx) => {
  const { Text } = kit
  const { line, pad, clip, wrap, fit, compact, room, ambiguous } = ctx
  const empty = m.workers.length === 0

  // One glyph per cap slot: running, idle, then free. Finished workers hold no slot, so they follow the meter as counts.
  const slots = Math.min(m.cap, 12)
  // Done and failed counts follow only once a team ran and they were observed; never a zero for what was not read.
  const tail = empty || m.completed === null || m.failed === null ? '' : `${GLYPH.done} ${m.completed} done · ${GLYPH.failed} ${m.failed} failed`
  const meter = (
    <Text key="meter" wrap="truncate-end">
      <Text dimColor>{pad('SLOTS', LABEL)}</Text>
      {Array.from({ length: slots }, (_, i) => {
        const run = m.running ?? 0
        const idle = m.idle ?? 0
        const [glyph, color] = m.active === null ? [GLYPH.pending, COLOR.muted] : i < run ? [GLYPH.running, COLOR.active] : i < run + idle ? [GLYPH.idle, COLOR.ready] : ['·', COLOR.muted]
        return (
          <Text key={i} color={color}>
            {glyph}{' '}
          </Text>
        )
      })}
      <Text bold> {m.active === null ? '–' : m.active}/{m.cap}</Text>
      {tail === '' ? null : <Text dimColor>{clip(`  ${tail}`, Math.max(0, room - LABEL - slots * 2 - 6))}</Text>}
    </Text>
  )

  // One button per worker (a Button holds Text only). Fields not observed are a dash, never 0.
  const nameCap = compact ? 8 : 12
  const shownWorkers = m.workers.slice(0, MAX_WORKERS)
  const nameW = Math.min(nameCap, Math.max(4, ...shownWorkers.map(w => displayWidth(w.name, ambiguous))))
  const tailOf = (w: (typeof m.workers)[number]) => `${w.toolCalls ?? '–'} tools · ${w.idleMs !== null ? 'idle' : 'last'} ${w.idleMs !== null ? ago(w.idleMs) : w.lastActivityMs === null ? '–' : ago(w.lastActivityMs)}`
  const statusW = compact ? 0 : 9
  const fixed = 2 + nameW + 1 + statusW
  const tailW = Math.min(Math.max(0, ...shownWorkers.map(w => displayWidth(tailOf(w), ambiguous))), Math.max(0, room - fixed))
  const taskW = room - fixed - tailW - 1
  const workerRows = shownWorkers.map(w => {
    const st = statusOf(w.status)
    return (
      <ctx.kit.Button key={workerKey(w.agentId)} plain label={`Worker ${w.name}`} onPress={() => {}}>
        <Text wrap="truncate-end">
          <Text color={statusColor(st)} {...glyphProps(ctx.motion, st === 'running', `worker:${w.agentId}`)}>{GLYPH[st]} </Text>
          <Text bold>{pad(w.name, nameW)} </Text>
          {compact ? null : <Text color={statusColor(st)}>{pad(w.status.toUpperCase(), 8)} </Text>}
          {taskW > 3 ? <Text dimColor={w.currentTask === null}>{pad(w.currentTask ?? '–', taskW)} </Text> : null}
          <Text dimColor>{pad(tailOf(w), tailW)}</Text>
        </Text>
      </ctx.kit.Button>
    )
  })
  const more = m.workers.length - shownWorkers.length
  const moreRow =
    more > 0 ? (
      <ctx.kit.Button key="o-more-workers" plain label="Workers" onPress={() => {}}>
        <Text dimColor wrap="truncate-end">{clip(`+${more} · 2: Workers`)}</Text>
      </ctx.kit.Button>
    ) : null

  const lbl = compact ? 6 : LABEL
  const t = m.tasks
  const tb = progressBar(t.total === null ? null : t.total === 0 ? null : (t.completed ?? 0) / t.total * 100, compact ? 6 : 10)
  const readyIds = t.rows.filter(r => r.ready).map(r => `#${r.id}`)
  const tasksRow =
    t.total === null
      ? line('o-tasks', `${pad('TASKS', lbl)}${UNAVAILABLE}`, { color: COLOR.muted })
      : line('o-tasks', `${pad('TASKS', lbl)}${tb.text} ${num(t.completed)}/${t.total} marked complete${t.ready === null ? '' : ` · ready ${readyIds[0] ?? 'none'}${readyIds.length > 1 ? ` +${readyIds.length - 1}` : ''}`}${t.blocked === null ? '' : ` · ${t.blocked} blocked`}`, { color: t.total > 0 && t.completed === t.total ? COLOR.done : tb.color })

  const cb = pressureBar(m.usage.contextUsed, compact ? 6 : 10)
  const costText = `${compact ? '' : 'COST '}${m.usage.cost} · ${compact ? '' : 'team '}${fmtSpan(m.teamElapsedMs)}`
  const ctxRow = (
    <Text key="o-ctx" wrap="truncate-end">
      <Text dimColor>{pad('CTX', lbl)}</Text>
      <Text color={cb.color}>{clip(cb.text, room - lbl)}</Text>
      <Text dimColor>{clip(`${compact ? ' · ' : '          '}${costText}`, Math.max(0, room - lbl - displayWidth(cb.text, ambiguous)))}</Text>
    </Text>
  )

  // 5H and WK share a line; the bars only where they fit.
  const quota = (label: string, pct: number | null, reset: string | null) => {
    const b = pressureBar(pct, 10)
    const note = reset === null || pct === null ? '' : ` · ${reset}`
    return { label, text: compact ? `${pctText(pct)}${note}` : `${b.text}${note}`, color: b.color }
  }
  const q5 = quota('5H', m.usage.fiveHourPct, m.usage.fiveHourReset)
  const q7 = quota('WK', m.usage.sevenDayPct, m.usage.sevenDayReset)
  const quotaRow = (
    <Text key="o-quota" wrap="truncate-end">
      <Text dimColor>{pad(q5.label, lbl)}</Text>
      <Text color={q5.color}>{q5.text}</Text>
      <Text dimColor>{'  '}{q7.label} </Text>
      <Text color={q7.color}>{q7.text}</Text>
    </Text>
  )

  const empties = empty
    ? [
        line('o-none', 'No native team yet.', { bold: true }),
        line('o-none2', 'Use a team to start coordinated work.', { dim: true }),
        line('o-none3', 'Ordinary subagents are not workers', { dim: true }),
        line('o-none4', 'and do not count toward the CTK Worker Cap.', { dim: true }),
      ]
    : []

  // A labelled dim block that wraps to `max` lines; only a block longer than that ends in an ellipsis. Never clips mid-word.
  const block = (key: string, label: string, text: string, opts: { dim?: boolean; color?: ThemeColor } = { dim: true }, max = 2) => {
    const lines = wrap(text, room - LABEL)
    return lines.slice(0, max).map((t, i, a) => line(`${key}-${i}`, `${pad(i === 0 ? label : '', LABEL)}${i === a.length - 1 && lines.length > a.length ? clip(`${t} …`, room - LABEL) : t}`, opts))
  }

  // The code is never clipped: when the whole row does not fit it takes a line of its own.
  const refusedHead = `✗ ${m.rejected} spawn(s) refused above the cap`
  const refusal =
    m.rejected === 0
      ? []
      : displayWidth(`${refusedHead} · TEAM_CAPACITY_REACHED`, ambiguous) <= room
        ? [line('o-refused', `${refusedHead} · TEAM_CAPACITY_REACHED`, { color: COLOR.error, bold: ctx.motion.hot.has('guard') })]
        : [line('o-refused', refusedHead, { color: COLOR.error, bold: ctx.motion.hot.has('guard') }), line('o-refused2', '  TEAM_CAPACITY_REACHED', { color: COLOR.error })]
  const budget = m.budgetStopped === 0 ? [] : block('o-budget', 'limit', `${m.budgetStopped} spawn(s) stopped by a usage limit · TEAM_BUDGET_REACHED`, { color: COLOR.error })
  const subagents = m.subagents.total > 0 ? block('o-sub', 'subagents', `${m.subagents.total} ordinary · ${m.subagents.live} live · ${room >= 62 ? 'not workers, not in the cap' : 'not in the cap'}`) : []
  const outside = m.outsideCap > 0 ? block('o-outside', 'isolated', `${m.outsideCap} named agent(s) started with isolation: ordinary subagents, not in the cap`, { color: COLOR.ready }) : []

  // The state pill is in the header; the reason is its short sentence, wrapped (full text: Doctor). A guard that is not working gets a line more.
  const bad = m.guard.state === 'error' || m.guard.state === 'unavailable'
  const guardWhy = block('o-why', 'guard', m.guard.short, bad ? { color: guardColor(m) } : { dim: true }, bad ? 3 : 2)

  const collision = collisionLine(m.signals.collisions)
  const collisionRow = collision === null ? [] : [line('o-coll', collision, { color: COLOR.ready })]

  // The refusal sits right after the workers so `fit` drops the quieter lines first, never the code.
  const rows = [
    meter,
    ...workerRows,
    ...(moreRow === null ? [] : [moreRow]),
    ...empties,
    ...refusal,
    ...budget,
    ...collisionRow,
    tasksRow,
    ctxRow,
    quotaRow,
    ...outside,
    ...subagents,
    ...guardWhy,
  ]
  const shown = fit('o', rows, ctx.rows)
  // The HUD form control lives in Config; it appears here only when real lines are left over.
  return shown.length < ctx.rows ? [...shown, hudButtons(kit, mc, ctx)] : shown
}
