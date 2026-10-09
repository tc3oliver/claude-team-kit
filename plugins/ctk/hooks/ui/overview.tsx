import { fmtSpan, UNAVAILABLE } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { hudButtons } from './hud.tsx'
import { COLOR, GLYPH, guardColor, progressBar } from './theme.ts'
import type { Extras, Kit } from './types.ts'

const num = (v: number | null): string => (v === null ? UNAVAILABLE : String(v))

/** `resets 2h34m` from the usage text; the whole text when the figure was not observed. */
const resetNote = (text: string, pct: number | null): string => (pct === null ? text : (text.match(/resets in ([^)]*)/)?.[1] ? `resets ${text.match(/resets in ([^)]*)/)?.[1]}` : ''))

/** Cards 4 across from this much room, otherwise 2 by 2. */
const CARDS_ROW = 56

export const renderOverview = (kit: Kit, m: Mission, mc: McState, _extras: Extras, ctx: Ctx) => {
  const { Box, Text } = kit
  const { line, metric, pad, clip, wrap, fit, wide, room } = ctx
  const empty = m.workers.length === 0
  const atCapacity = m.active !== null && m.active >= m.cap

  // One glyph per cap slot: running, idle, then free. Finished workers hold no slot, so they follow the meter as counts.
  const slots = Math.min(m.cap, 12)
  // Done and failed counts follow only once a team ran and they were observed; never a zero for what was not read.
  const tail = empty || m.completed === null || m.failed === null ? '' : `${GLYPH.done} ${m.completed} done · ${GLYPH.failed} ${m.failed} failed`
  const meter = (
    <Text key="meter" wrap="truncate-end">
      <Text dimColor>{pad('SLOTS', 7)}</Text>
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
      {tail === '' ? null : <Text dimColor>{clip(`  ${tail}`, Math.max(0, room - 7 - slots * 2 - 6))}</Text>}
    </Text>
  )

  const w = wide || room >= CARDS_ROW ? Math.floor((room - 6) / 4) : Math.floor((room - 2) / 2)
  const cardList = [
    metric('m-workers', 'WORKERS', m.active === null ? UNAVAILABLE : `${m.active}/${m.cap}`, m.active === null ? COLOR.muted : atCapacity ? (m.rejected > 0 ? COLOR.error : COLOR.ready) : COLOR.active, w),
    metric('m-tasks', 'TASKS', m.tasks.total === null ? UNAVAILABLE : `${num(m.tasks.completed)}/${m.tasks.total}`, m.tasks.total === null ? COLOR.muted : m.tasks.total > 0 && m.tasks.completed === m.tasks.total ? COLOR.done : undefined, w),
    metric('m-refused', 'REFUSED', String(m.rejected), m.rejected > 0 ? COLOR.error : undefined, w),
    metric('m-cost', 'COST', m.usage.cost, m.usage.cost === UNAVAILABLE ? COLOR.muted : undefined, w),
  ]
  const cards =
    wide || room >= CARDS_ROW
      ? [<Box key="cards" flexDirection="row" columnGap={2}>{cardList}</Box>]
      : [<Box key="cards1" flexDirection="row" columnGap={2}>{cardList.slice(0, 2)}</Box>, <Box key="cards2" flexDirection="row" columnGap={2}>{cardList.slice(2)}</Box>]

  const barWidth = wide ? 20 : 10
  const quota = (key: string, label: string, pct: number | null, text: string) => {
    const b = progressBar(pct, barWidth)
    return line(key, `${pad(label, 7)}${b.text} ${pct === null ? '' : '· '}${resetNote(text, pct)}`.trimEnd(), { color: b.color })
  }

  const empties = empty
    ? [
        line('o-none', 'No native team yet.', { bold: true }),
        line('o-none2', 'Use a team to start coordinated work.', { dim: true }),
        line('o-none3', 'Ordinary subagents are not workers', { dim: true }),
        line('o-none4', 'and do not count toward the CTK Worker Cap.', { dim: true }),
      ]
    : []

  const tasksDetail =
    m.tasks.total === null || empty
      ? []
      : [
          line(
            'o-tasks',
            m.tasks.detailed && !m.tasks.partial
              ? `tasks  ${num(m.tasks.pending)} pending · ${num(m.tasks.inProgress)} doing · ${num(m.tasks.blocked)} blocked · ${num(m.tasks.ready)} ready`
              : `tasks  counts from task events; ${m.tasks.partial ? 'some predate CTK' : 'no detail yet'}`,
            { dim: true },
          ),
        ]

  const refusal =
    m.rejected > 0 ? [line('o-refused', `✗ ${m.rejected} spawn(s) refused above the cap · TEAM_CAPACITY_REACHED`, { color: COLOR.error, bold: ctx.motion.hot.has('guard') })] : []
  const subagents =
    m.subagents.total > 0 ? [line('o-sub', `subagents  ${m.subagents.total} ordinary · ${m.subagents.live} live · not workers, not in the cap`, { dim: true })] : []
  const outside = m.outsideCap > 0 ? [line('o-outside', `${m.outsideCap} named agent(s) started with isolation: ordinary subagents, not in the cap`, { color: COLOR.ready })] : []

  // The state pill is in the header; the reason is one dim line (full text: Doctor). A guard that is not working gets two.
  const why = wrap(m.guard.why, room - 7)
  const bad = m.guard.state === 'error' || m.guard.state === 'unavailable'
  const guardWhy = why.slice(0, bad ? 2 : 1).map((t, i, a) => line(`o-why-${i}`, `${pad(i === 0 ? 'guard' : '', 7)}${i === a.length - 1 && why.length > a.length ? clip(`${t} …`, room - 7) : t}`, bad ? { color: guardColor(m) } : { dim: true }))

  const session = line('o-session', `session  ${m.usage.contextPct} ctx · ${m.usage.toolCalls} tool calls · ${m.teamElapsedMs === null ? UNAVAILABLE : fmtSpan(m.teamElapsedMs)} team`, { dim: true })

  const rows = [
    meter,
    ...cards,
    ...empties,
    quota('q-5h', '5H', m.usage.fiveHourPct, m.usage.fiveHour),
    quota('q-7d', 'WK', m.usage.sevenDayPct, m.usage.sevenDay),
    ...refusal,
    ...outside,
    ...tasksDetail,
    ...subagents,
    ...guardWhy,
    session,
  ]
  const shown = fit('o', rows)
  // The HUD form control lives in Config; it appears here only when rows are left over.
  return shown.length < ctx.rows ? [...shown, hudButtons(kit, mc, ctx)] : shown
}

