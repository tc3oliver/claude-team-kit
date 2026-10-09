import { displayWidth } from '../../shared/hudline.ts'
import { fmtSpan, UNAVAILABLE } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { hudButtons } from './hud.tsx'
import { COLOR, GLYPH, guardColor, progressBar } from './theme.ts'
import type { ThemeColor } from './theme.ts'
import type { Extras, Kit } from './types.ts'

const num = (v: number | null): string => (v === null ? UNAVAILABLE : String(v))

/** `resets 2h34m` from the usage text; the whole text when the figure was not observed. */
const resetNote = (text: string, pct: number | null): string => (pct === null ? text : (text.match(/resets in ([^)]*)/)?.[1] ? `resets ${text.match(/resets in ([^)]*)/)?.[1]}` : ''))

/** Cards 4 across from this much room, otherwise 2 by 2; each card is CARD_MIN to CARD_MAX cells wide, side by side. */
const CARDS_ROW = 52
const CARD_MIN = 11
const CARD_MAX = 14
const LABEL = 11

export const renderOverview = (kit: Kit, m: Mission, mc: McState, _extras: Extras, ctx: Ctx) => {
  const { Box, Text } = kit
  const { line, metric, pad, clip, wrap, fit, wide, room, ambiguous } = ctx
  const empty = m.workers.length === 0
  const atCapacity = m.active !== null && m.active >= m.cap

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

  const across = room >= CARDS_ROW
  const w = Math.max(CARD_MIN, Math.min(CARD_MAX, across ? Math.floor((room - 6) / 4) : Math.floor((room - 2) / 2)))
  const cardList = [
    metric('m-workers', 'WORKERS', m.active === null ? UNAVAILABLE : `${m.active}/${m.cap}`, m.active === null ? COLOR.muted : atCapacity ? (m.rejected > 0 ? COLOR.error : COLOR.ready) : COLOR.active, w),
    metric('m-tasks', 'TASKS', m.tasks.total === null ? UNAVAILABLE : `${num(m.tasks.completed)}/${m.tasks.total}`, m.tasks.total === null ? COLOR.muted : m.tasks.total > 0 && m.tasks.completed === m.tasks.total ? COLOR.done : undefined, w),
    metric('m-refused', 'REFUSED', String(m.rejected), m.rejected > 0 ? COLOR.error : undefined, w),
    metric('m-cost', 'COST', m.usage.cost, m.usage.cost === UNAVAILABLE ? COLOR.muted : undefined, w),
  ]
  const cards =
    across
      ? [<Box key="cards" flexDirection="row" columnGap={2}>{cardList}</Box>]
      : [<Box key="cards1" flexDirection="row" columnGap={2}>{cardList.slice(0, 2)}</Box>, <Box key="cards2" flexDirection="row" columnGap={2}>{cardList.slice(2)}</Box>]

  const barWidth = wide ? 20 : 10
  const quota = (key: string, label: string, pct: number | null, text: string) => {
    const b = progressBar(pct, barWidth)
    return line(key, `${pad(label, LABEL)}${b.text} ${pct === null ? '' : '· '}${resetNote(text, pct)}`.trimEnd(), { color: b.color })
  }

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

  const tasksDetail =
    m.tasks.total === null || empty
      ? []
      : block(
          'o-tasks',
          'tasks',
          m.tasks.detailed && !m.tasks.partial
            ? `${num(m.tasks.pending)} pending · ${num(m.tasks.inProgress)} doing · ${num(m.tasks.blocked)} blocked · ${num(m.tasks.ready)} ready`
            : `counts from task events; ${m.tasks.partial ? 'some predate CTK' : 'no detail yet'}`,
        )

  // The code is never clipped: when the whole row does not fit it takes a line of its own.
  const refusedHead = `✗ ${m.rejected} spawn(s) refused above the cap`
  const refusal =
    m.rejected === 0
      ? []
      : displayWidth(`${refusedHead} · TEAM_CAPACITY_REACHED`, ambiguous) <= room
        ? [line('o-refused', `${refusedHead} · TEAM_CAPACITY_REACHED`, { color: COLOR.error, bold: ctx.motion.hot.has('guard') })]
        : [line('o-refused', refusedHead, { color: COLOR.error, bold: ctx.motion.hot.has('guard') }), line('o-refused2', '  TEAM_CAPACITY_REACHED', { color: COLOR.error })]
  const subagents = m.subagents.total > 0 ? block('o-sub', 'subagents', `${m.subagents.total} ordinary · ${m.subagents.live} live · ${room >= 62 ? 'not workers, not in the cap' : 'not in the cap'}`) : []
  const outside = m.outsideCap > 0 ? block('o-outside', 'isolated', `${m.outsideCap} named agent(s) started with isolation: ordinary subagents, not in the cap`, { color: COLOR.ready }) : []

  // The state pill is in the header; the reason is its short sentence, wrapped (full text: Doctor). A guard that is not working gets a line more.
  const bad = m.guard.state === 'error' || m.guard.state === 'unavailable'
  const guardWhy = block('o-why', 'guard', m.guard.short, bad ? { color: guardColor(m) } : { dim: true }, bad ? 3 : 2)

  const session = block('o-session', 'session', `${m.usage.contextPct} ctx · ${m.usage.toolCalls} tool calls · ${m.teamElapsedMs === null ? UNAVAILABLE : fmtSpan(m.teamElapsedMs)} team`)

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
    ...session,
  ]
  // Each card node is two lines (a label over its value), so the nodes are counted against a budget reduced by the extra lines.
  const extra = cards.length
  const shown = fit('o', rows, ctx.rows - extra)
  // The HUD form control lives in Config; it appears here only when real lines are left over.
  return shown.length + extra < ctx.rows ? [...shown, hudButtons(kit, mc, ctx)] : shown
}
