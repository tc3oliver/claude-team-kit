import { BACK_KEY, CLOSE_KEY, MC_VIEWS, REFRESH_KEY, viewKey } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import { BODY_ROWS } from './ctx.tsx'
import type { Ctx } from './ctx.tsx'
import { displayWidth } from '../../shared/hudline.ts'
import { pillOf, pressureColor } from './theme.ts'
import type { Kit } from './types.ts'

// Widths in cells. The hotkey button draws "1: " before its label (seen in real cells), so a tab is label + 3.
const FOOT_FULL = 84
const FOOT_MID = 58
const FOOT_SHORT = 34
const PREFIX = 3

/** Whole short words for the narrow tier: a label cut to four letters reads as a typo (Usag, Conf, Doct). */
const STUB: Record<string, string> = { overview: 'Over', workers: 'Work', tasks: 'Task', usage: 'Use', config: 'Cfg', stats: 'Stat', doctor: 'Doc' }

/** Longer than this and the title shrinks to `◆ CTK` so the pill and the pressure badges still fit on one line. */
const TITLE = '◆ CTK MISSION CONTROL'
const TITLE_SHORT = '◆ CTK'

/**
 * The header: title, the state pill (guard state, or CAPACITY once the team is full, so a full team is
 * never drawn green), then a badge for each figure under pressure (context, the 5h and weekly windows
 * from 60%), then `read-only`. It is always one line, because a wrapped header costs a body row: the
 * title shortens first, then the optional parts that do not fit are left out, context last.
 */
export const header = (kit: Kit, m: Mission, ctx: Ctx) => {
  const { Box, Text } = kit
  const pill = pillOf(m)
  const width = (parts: readonly string[]): number => parts.reduce((n, t) => n + displayWidth(t, ctx.ambiguous), 0) + 2 * Math.max(0, parts.length - 1)
  const badges = [
    { key: 'ctx', text: `Ctx ${Math.round(m.usage.contextUsed ?? 0)}%`, pct: m.usage.contextUsed },
    { key: '5h', text: `5h ${Math.round(m.usage.fiveHourPct ?? 0)}%`, pct: m.usage.fiveHourPct },
    { key: 'wk', text: `Wk ${Math.round(m.usage.sevenDayPct ?? 0)}%`, pct: m.usage.sevenDayPct },
  ].filter(b => pressureColor(b.pct) !== undefined)
  const withCtx = [pill.text, ...badges.slice(0, 1).filter(b => b.key === 'ctx').map(b => b.text)]
  const title = width([TITLE, ...withCtx]) <= ctx.room ? TITLE : TITLE_SHORT
  const shown: typeof badges = []
  let used = [title, pill.text]
  for (const b of badges) {
    if (width([...used, b.text]) > ctx.room) continue
    used = [...used, b.text]
    shown.push(b)
  }
  const readOnly = width([...used, 'read-only']) <= ctx.room
  return (
    <Box key="head" flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text bold>{title}</Text>
      <Text bold color={pill.color}>
        {pill.text}
      </Text>
      {shown.map(b => {
        const color = pressureColor(b.pct)
        return (
          <Text key={b.key} bold={color === 'error'} color={color}>
            {b.text}
          </Text>
        )
      })}
      {readOnly ? <Text dimColor>read-only</Text> : null}
    </Box>
  )
}

const rowWidth = (views: typeof MC_VIEWS, label: (v: { view: string; label: string }) => number, gap: number): number =>
  views.reduce((a, v) => a + PREFIX + label(v), 0) + gap * (views.length - 1)
const full = (v: { label: string }): number => v.label.length
/** Where the second line starts when the tabs stack: three views, then four. */
const SPLIT = 3
const stackedGap = (room: number): number => [2, 1].find(g => rowWidth(MC_VIEWS.slice(SPLIT), full, g) <= room) ?? 0

/** Whether the tabs take two lines of full labels: too narrow for one line, wide enough for two, and a taller (docked) body to pay for the line. */
export const stackedTabs = (room: number, bodyRows: number): boolean => bodyRows > BODY_ROWS && rowWidth(MC_VIEWS, full, 1) > room && stackedGap(room) > 0

/** One line, the longest tier whose measured width fits: full labels, curated short words, then three letters (the line wraps rather than clip). */
const tabTier = (room: number): { letters: 'full' | 'stub' | 'digits'; gap: number } => {
  if (rowWidth(MC_VIEWS, full, 2) <= room) return { letters: 'full', gap: 2 }
  if (rowWidth(MC_VIEWS, full, 1) <= room) return { letters: 'full', gap: 1 }
  if (rowWidth(MC_VIEWS, v => (STUB[v.view] ?? v.label).length, 1) <= room) return { letters: 'stub', gap: 1 }
  return { letters: 'digits', gap: 1 }
}

export const tabs = (kit: Kit, mc: McState, ctx: Ctx, stacked = false) => {
  const { Box, Text, Button } = kit
  const { letters, gap } = stacked ? { letters: 'full' as const, gap: stackedGap(ctx.room) } : tabTier(ctx.room)
  const one = (v: (typeof MC_VIEWS)[number]) => {
    const on = mc.view === v.view
    const label = letters === 'digits' ? (on ? v.label : v.label.slice(0, 3)) : letters === 'full' ? v.label : (STUB[v.view] ?? v.label)
    return (
      <Button key={viewKey(v.view)} plain hotkey={v.hotkey} label={v.label} onPress={() => {}}>
        <Text bold={on} underline={on}>
          {label}
        </Text>
      </Button>
    )
  }
  const line = (key: string, views: typeof MC_VIEWS) => (
    <Box key={key} flexDirection="row" flexWrap="wrap" columnGap={gap}>
      {views.map(one)}
    </Box>
  )
  return stacked ? (
    <Box key="tabs" flexDirection="column">
      {line('tabs-a', MC_VIEWS.slice(0, SPLIT))}
      {line('tabs-b', MC_VIEWS.slice(SPLIT))}
    </Box>
  ) : (
    line('tabs', MC_VIEWS)
  )
}

/** Refresh and Close plus a hint that is shortened, then dropped, instead of wrapping the row. */
export const footer = (kit: Kit, ctx: Ctx) => {
  const { Box, Text } = kit
  const hint = ctx.room >= FOOT_FULL ? 'Tab moves · digits switch views · Esc returns to the prompt' : ctx.room >= FOOT_MID ? 'Tab moves · 1-7 views · Esc closes' : ctx.room >= FOOT_SHORT ? 'Esc closes' : null
  return (
    <Box key="foot" flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
      {ctx.button(REFRESH_KEY, 'Refresh')}
      {ctx.button(CLOSE_KEY, 'Close')}
      {hint === null ? null : <Text dimColor>{hint}</Text>}
    </Box>
  )
}

export const backButton = (kit: Kit, ctx: Ctx) => <kit.Box key="back">{ctx.button(BACK_KEY, 'Back')}</kit.Box>
