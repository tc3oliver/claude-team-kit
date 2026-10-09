import { UNAVAILABLE } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { COLOR, progressBar } from './theme.ts'
import type { Extras, Kit } from './types.ts'

export const renderUsage = (kit: Kit, m: Mission, _mc: McState, _extras: Extras, ctx: Ctx) => {
  const { Box } = kit
  const { line, para, metric, divider, room } = ctx
  // The model card gives way so the row stays one band down to 38 cells; narrower, the cards wrap onto a second band.
  const modelW = Math.max(10, Math.min(24, room - 28))
  const bands = room >= modelW + 28 ? 1 : 2
  const bars: [string, string, number | null, string | null, string][] = [
    ['u-5h', '5H', m.usage.fiveHourPct, m.usage.fiveHourReset, m.usage.fiveHour],
    ['u-7d', 'WEEK', m.usage.sevenDayPct, m.usage.sevenDayReset, m.usage.sevenDay],
    ['u-ctx', 'CTX', m.usage.contextUsed, null, m.usage.contextPct],
  ]
  const nodes = [
    divider('u-d1', 'LIMITS'),
    ...bars.map(([key, label, pct, reset, text]) => {
      const b = progressBar(pct)
      const tail = pct === null ? `  ${text}` : reset === null ? '' : `  reset ${reset}`
      return line(key, `${label.padEnd(5)}${b.text}${tail}`, { color: b.color })
    }),
    divider('u-d2', 'SESSION'),
    <Box key="u-metrics" flexDirection="row" flexWrap="wrap" columnGap={2}>
      {metric('u-model', 'Model', m.usage.model ?? UNAVAILABLE, m.usage.model === null ? COLOR.muted : undefined, modelW)}
      {metric('u-cost', 'Cost', m.usage.cost, m.usage.cost === UNAVAILABLE ? COLOR.muted : undefined, 12)}
      {metric('u-tools', 'Tool calls', String(m.usage.toolCalls), undefined, 12)}
    </Box>,
    ...para('u-note', 'Reported by Claude Code; a plan without rate limits shows them as unavailable. Tool calls cover the lead, subagents and teammates. Per-worker cost is not reported.'),
  ]
  // The metrics node is two lines per band; the rest are one each. The note, last, is what a short pane drops.
  return ctx.fit('u', nodes as ReturnType<typeof line>[], ctx.rows - (2 * bands - 1))
}
