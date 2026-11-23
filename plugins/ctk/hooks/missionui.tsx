import type { McState, Mission } from './mission'
import { bodyRowsFor, createCtx } from './ui/ctx'
import { renderConfig } from './ui/config'
import { renderDoctor } from './ui/doctor'
import { footer, header, stackedTabs, tabs } from './ui/frame'
import { renderOverview } from './ui/overview'
import { renderStats } from './ui/stats'
import { renderTasks } from './ui/tasks'
import type { Motion } from './ui/motion'
import type { Extras, Kit } from './ui/types'
import { renderUsage } from './ui/usage'
import { renderWorkers } from './ui/workers'

// Mission Control's body: a read-only view of what CTK observed. Every button here only changes
// what the pane shows (see pressMc) except Confirm/Cancel on a pending option change, which is
// handled by register.tsx and exists only while a change is waiting for the person's yes.
// A figure that was not observed reads "unavailable". Each view lives in ./ui/<view>.tsx.

export type { Extras, Kit, OptionRow, Pending } from './ui/types'

/** Rows the pane is opened with. */
export const PANE_ROWS = 16

const VIEWS = { overview: renderOverview, workers: renderWorkers, tasks: renderTasks, usage: renderUsage, config: renderConfig, stats: renderStats, doctor: renderDoctor }

export const renderMission = (kit: Kit, m: Mission, mc: McState, extras: Extras, props: { bodyColumns: number; ambiguous?: 1 | 2; motion?: Motion; placement?: 'dock' | 'inline' | 'widget'; scroll?: { bodyRows: number } }) => {
  const { Box } = kit
  const base = bodyRowsFor(props)
  const stacked = stackedTabs(Math.max(10, props.bodyColumns - 1), base)
  const ctx = createCtx(kit, { ...props, rows: stacked ? base - 1 : base })
  return (
    <Box flexDirection="column" width={props.bodyColumns}>
      {header(kit, m, ctx)}
      {tabs(kit, mc, ctx, stacked)}
      <Box key="body" flexDirection="column" marginTop={1}>
        {VIEWS[mc.view](kit, m, mc, extras, ctx)}
      </Box>
      {footer(kit, ctx)}
    </Box>
  )
}
