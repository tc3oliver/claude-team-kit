import type { McState, Mission } from './mission.ts'
import { createCtx } from './ui/ctx.tsx'
import { renderConfig } from './ui/config.tsx'
import { renderDoctor } from './ui/doctor.tsx'
import { footer, header, tabs } from './ui/frame.tsx'
import { renderOverview } from './ui/overview.tsx'
import { renderStats } from './ui/stats.tsx'
import { renderTasks } from './ui/tasks.tsx'
import type { Motion } from './ui/motion.ts'
import type { Extras, Kit } from './ui/types.ts'
import { renderUsage } from './ui/usage.tsx'
import { renderWorkers } from './ui/workers.tsx'

// Mission Control's body: a read-only view of what CTK observed. Every button here only changes
// what the pane shows (see pressMc) except Confirm/Cancel on a pending option change, which is
// handled by register.tsx and exists only while a change is waiting for the person's yes.
// A figure that was not observed reads "unavailable". Each view lives in ./ui/<view>.tsx.

export type { Extras, Kit, OptionRow, Pending } from './ui/types.ts'

/** Rows the pane is opened with. */
export const PANE_ROWS = 16

const VIEWS = { overview: renderOverview, workers: renderWorkers, tasks: renderTasks, usage: renderUsage, config: renderConfig, stats: renderStats, doctor: renderDoctor }

export const renderMission = (kit: Kit, m: Mission, mc: McState, extras: Extras, props: { bodyColumns: number; ambiguous?: 1 | 2; motion?: Motion }) => {
  const { Box } = kit
  const ctx = createCtx(kit, props)
  return (
    <Box flexDirection="column" width={props.bodyColumns}>
      {header(kit, m, ctx)}
      {tabs(kit, mc, ctx)}
      <Box key="body" flexDirection="column" marginTop={1}>
        {VIEWS[mc.view](kit, m, mc, extras, ctx)}
      </Box>
      {footer(kit, ctx)}
    </Box>
  )
}
