import { HUD_MODES, hudKey } from '../mission.ts'
import type { HudMode, McState } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import type { Kit } from './types.ts'

const modeLabel = (m: HudMode): string => m[0]?.toUpperCase() + m.slice(1)

/** The HUD form switcher the overview and the config view share. */
export const hudButtons = (kit: Kit, mc: McState, ctx: Ctx) => {
  const { Box, Text, Button } = kit
  return (
    <Box key="hud" flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text dimColor>{ctx.compact ? 'HUD form' : 'HUD form (this session)'}</Text>
      {HUD_MODES.map(mode => (
        <Button key={hudKey(mode)} plain label={`HUD form ${mode}`} onPress={() => {}}>
          <Text bold={mc.hudMode === mode} underline={mc.hudMode === mode}>
            {modeLabel(mode)}
          </Text>
        </Button>
      ))}
    </Box>
  )
}
