import type { Register } from 'claude-code'

import { renderMission } from './missionui.tsx'
import { buildScene, LABEL } from './scenes.ts'

// Scratch-only showcase mod: mounts the real renderMission over fixed fixture data. It makes no model
// call and registers nothing but one command; scripts/showcase/render.mjs generates, loads and removes it.
const PANE = 'showcase'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'showcase', description: 'Open the synthetic Mission Control showcase pane' })
    return next(e)
  })

  on('command.run', { command: 'showcase' }, async $ => {
    await $.ui.open({ id: PANE, title: 'CTK Mission Control', focus: true, closeOnEscape: true, rows: 40 })
    return { text: 'showcase open' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const scene = buildScene((await $.env.get('SHOWCASE_SCENE')) ?? 'empty')
    const meta = (await $.env.get('SHOWCASE_META')) ?? ''
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text bold color="warning" wrap="truncate-end">{LABEL}</Text>
        <Text dimColor>{meta}</Text>
        {renderMission($.ui.resolve(e), scene.mission, scene.mc, scene.extras, e.props)}
      </Box>
    )
  })
}
