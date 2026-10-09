import { fmtSpan, guardWord, UNAVAILABLE } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { hudButtons } from './hud.tsx'
import { COLOR, guardColor, progressBar } from './theme.ts'
import type { Extras, Kit } from './types.ts'

const num = (v: number | null): string => (v === null ? UNAVAILABLE : String(v))

const GUARD_BANNER = { active: '● ACTIVE', available: '◇ READY', error: '✗ ERROR', unavailable: '○ unavailable' } as const

/** The reset part of a usage string, or the whole string when the figure was not observed. */
const resetNote = (text: string, pct: number | null): string => (pct === null ? text : (text.match(/\(.*\)/)?.[0] ?? ''))

export const renderOverview = (kit: Kit, m: Mission, mc: McState, _extras: Extras, ctx: Ctx) => {
  const { Box } = kit
  const { fieldWrap, line, para, metric, pad, fit, wide, room } = ctx
  const barWidth = wide ? 20 : 10
  const empty = m.workers.length === 0
  const card = Math.floor((room - 6) / 4)

  const quota = (key: string, label: string, pct: number | null, text: string) => {
    const b = progressBar(pct, barWidth)
    return line(key, `${pad(label, 13)}${b.text} ${resetNote(text, pct)}`.trimEnd(), { color: b.color })
  }

  const cards = wide
    ? [
        <Box key="cards" flexDirection="row" columnGap={2}>
          {metric('m-workers', 'Native workers', `${num(m.active)}/${m.cap}`, m.active === null ? COLOR.muted : COLOR.active, card)}
          {metric('m-tasks', 'Tasks done', m.tasks.total === null ? UNAVAILABLE : `${num(m.tasks.completed)}/${m.tasks.total}`, m.tasks.total === null ? COLOR.muted : COLOR.done, card)}
          {metric('m-refused', 'Refused spawns', String(m.rejected), m.rejected > 0 ? COLOR.error : undefined, card)}
          {metric('m-cost', 'Session cost', m.usage.cost, m.usage.cost === UNAVAILABLE ? COLOR.muted : undefined, card)}
        </Box>,
      ]
    : []

  const teamBlock = empty
    ? [
        line('o-none', 'No native team yet.', { bold: true }),
        ...para('o-none2', 'Use a team to start coordinated work.'),
        ...para('o-none3', 'Ordinary subagents do not count toward the CTK Worker Cap and are not listed under Native Workers.'),
        ...fieldWrap('workers', 'Workers', `0/${m.cap} active`),
      ]
    : fieldWrap('workers', 'Workers', `${num(m.active)}/${m.cap} active · ${num(m.running)} running · ${num(m.idle)} idle · ${num(m.completed)} completed · ${num(m.failed)} failed`)

  // Narrow panes show this row only when it has something to say; the wide cards always carry the refused count.
  const cap = [
    ...(m.subagents.total > 0 ? [`${m.subagents.total} ordinary · ${m.subagents.live} live · not teammates, so the cap does not count them`] : []),
    `${m.rejected} spawn(s) refused above the cap`,
  ].join(' · ')
  const showCap = wide || m.rejected > 0 || m.subagents.total > 0

  const taskText =
    m.tasks.total === null
      ? UNAVAILABLE
      : m.tasks.detailed && !m.tasks.partial
        ? `${num(m.tasks.completed)}/${m.tasks.total} done · ${num(m.tasks.pending)} pending · ${num(m.tasks.inProgress)} in progress · ${num(m.tasks.blocked)} blocked · ${num(m.tasks.ready)} ready`
        : `${num(m.tasks.completed)}/${m.tasks.total} done (counts from task events; ${m.tasks.partial ? 'some tasks were created before CTK loaded' : 'no task call seen since CTK loaded'}, so no detail)`

  const session = [
    ...(wide ? [] : [m.usage.cost]),
    `${m.usage.contextPct} ctx`,
    `${m.usage.toolCalls} tool calls`,
    `${m.teamElapsedMs === null ? UNAVAILABLE : fmtSpan(m.teamElapsedMs)} team`,
  ].join(' · ')

  const rows = [
    ...fieldWrap('guard', 'Guard', `${GUARD_BANNER[m.guard.state]} (${guardWord(m.guard)}) · ${m.guard.why}`, guardColor(m)),
    ...cards,
    ...teamBlock,
    ...(showCap ? fieldWrap('cap', 'Cap', cap) : []),
    ...(m.outsideCap > 0 ? fieldWrap('outside', 'Outside cap', `${m.outsideCap} named agent(s) started with isolation as ordinary subagents; the cap does not count them`, 'warning') : []),
    // With no team and no task event there is nothing to say about tasks; the empty state already says it.
    ...(empty && m.tasks.total === null ? [] : fieldWrap('tasks', 'Tasks', taskText)),
    quota('q-5h', '5h quota', m.usage.fiveHourPct, m.usage.fiveHour),
    quota('q-7d', 'Weekly quota', m.usage.sevenDayPct, m.usage.sevenDay),
    ...fieldWrap('session', 'Session', session),
  ]
  // The HUD control is reserved a row so a long view never pushes it out.
  return [...fit('o', rows, ctx.rows - 1), hudButtons(kit, mc, ctx)]
}
