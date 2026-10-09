import { BACK_KEY, CLOSE_KEY, MC_VIEWS, REFRESH_KEY, viewKey } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { guardColor } from './theme.ts'
import type { Kit } from './types.ts'

// Widths in cells: the full tab row is 54, the short one 34; the footer buttons are 22.
const TABS_FULL = 56
const TAB_SHORT = 4
const FOOT_FULL = 84
const FOOT_MID = 58
const FOOT_SHORT = 34
const HEAD_FULL = 46

/** Title, guard state and the read-only mark on one line; the mark is the first thing to go when narrow. */
export const header = (kit: Kit, m: Mission, ctx: Ctx) => {
  const { Box, Text } = kit
  return (
    <Box key="head" flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text bold>CTK Mission Control</Text>
      <Text color={guardColor(m)}>Guard {m.guard.state === 'active' ? 'ON' : m.guard.state === 'available' ? 'ready' : m.guard.label}</Text>
      {ctx.room >= HEAD_FULL ? <Text dimColor>read-only</Text> : null}
    </Box>
  )
}

/** Seven tabs on one line from 60 columns: below TABS_FULL cells of room the labels shrink to four letters. */
export const tabs = (kit: Kit, mc: McState, ctx: Ctx) => {
  const { Box, Text, Button } = kit
  const short = ctx.room < TABS_FULL
  return (
    <Box key="tabs" flexDirection="row" flexWrap="wrap" columnGap={short ? 1 : 2}>
      {MC_VIEWS.map(v => (
        <Button key={viewKey(v.view)} plain hotkey={v.hotkey} label={v.label} onPress={() => {}}>
          <Text bold={mc.view === v.view} underline={mc.view === v.view}>
            {short ? v.label.slice(0, TAB_SHORT) : v.label}
          </Text>
        </Button>
      ))}
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
