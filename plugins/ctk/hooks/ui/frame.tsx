import { BACK_KEY, CLOSE_KEY, MC_VIEWS, REFRESH_KEY, viewKey } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { pillOf } from './theme.ts'
import type { Kit } from './types.ts'

// Widths in cells. The hotkey button draws "1: " before its label (seen in real cells), so a tab is label + 3.
const FOOT_FULL = 84
const FOOT_MID = 58
const FOOT_SHORT = 34
const HEAD_FULL = 46
const PREFIX = 3

/** The state pill: guard state, or CAPACITY once the team is full, so a full team is never drawn green. */
export const header = (kit: Kit, m: Mission, ctx: Ctx) => {
  const { Box, Text } = kit
  const pill = pillOf(m)
  return (
    <Box key="head" flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text bold>◆ CTK MISSION CONTROL</Text>
      <Text bold color={pill.color}>
        {pill.text}
      </Text>
      {ctx.room >= HEAD_FULL ? <Text dimColor>read-only</Text> : null}
    </Box>
  )
}

/** The longest tier whose measured width fits the room: full labels, four letters, then digits with only the active label spelled out. */
const tabTier = (room: number): { letters: number | 'digits'; gap: number } => {
  const row = (label: (l: string) => number, gap: number) => MC_VIEWS.reduce((a, v) => a + PREFIX + label(v.label), 0) + gap * (MC_VIEWS.length - 1)
  if (row(l => l.length, 2) <= room) return { letters: 0, gap: 2 }
  if (row(l => l.length, 1) <= room) return { letters: 0, gap: 1 }
  if (row(l => Math.min(4, l.length), 1) <= room) return { letters: 4, gap: 1 }

  return { letters: 'digits', gap: 1 }
}

export const tabs = (kit: Kit, mc: McState, ctx: Ctx) => {
  const { Box, Text, Button } = kit
  const { letters, gap } = tabTier(ctx.room)
  return (
    <Box key="tabs" flexDirection="row" flexWrap="wrap" columnGap={gap}>
      {MC_VIEWS.map(v => {
        const on = mc.view === v.view
        const label = letters === 'digits' ? (on ? v.label : '') : letters === 0 ? v.label : v.label.slice(0, letters)
        return (
          <Button key={viewKey(v.view)} plain hotkey={v.hotkey} label={v.label} onPress={() => {}}>
            <Text bold={on} underline={on}>
              {label}
            </Text>
          </Button>
        )
      })}
    </Box>
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
