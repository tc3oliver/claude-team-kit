import { UNAVAILABLE } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import type { Extras, Kit } from './types.ts'

export const renderUsage = (_kit: Kit, m: Mission, _mc: McState, _extras: Extras, ctx: Ctx) => {
  const { field, para } = ctx
  return [
    field('u-model', 'Model', m.usage.model ?? UNAVAILABLE),
    field('u-ctx', 'Context', m.usage.contextPct),
    field('u-5h', '5h usage', m.usage.fiveHour),
    field('u-7d', 'Weekly usage', m.usage.sevenDay),
    field('u-cost', 'Session cost', m.usage.cost),
    field('u-tools', 'Tool calls', `${m.usage.toolCalls} (lead, subagents and teammates)`),
    ...para('u-note', 'Reported by Claude Code; a plan without rate limits shows them as unavailable. Per-worker cost is not reported.'),
  ]
}
