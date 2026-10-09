import { UNAVAILABLE } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { COLOR, progressBar } from './theme.ts'
import type { Extras, Kit } from './types.ts'

export const renderUsage = (kit: Kit, m: Mission, _mc: McState, _extras: Extras, ctx: Ctx) => {
  const { Box } = kit
  const { line, para, metric, divider } = ctx
  const bars: [string, string, number | null, string | null, string][] = [
    ['u-5h', '5H', m.usage.fiveHourPct, m.usage.fiveHourReset, m.usage.fiveHour],
    ['u-7d', 'WEEK', m.usage.sevenDayPct, m.usage.sevenDayReset, m.usage.sevenDay],
    ['u-ctx', 'CTX', m.usage.contextUsed, null, m.usage.contextPct],
  ]
  return [
    divider('u-d1', 'LIMITS'),
    ...bars.map(([key, label, pct, reset, text]) => {
      const b = progressBar(pct)
      const tail = pct === null ? `  ${text}` : reset === null ? '' : `  reset ${reset}`
      return line(key, `${label.padEnd(5)}${b.text}${tail}`, { color: b.color })
    }),
    divider('u-d2', 'SESSION'),
    <Box key="u-metrics" flexDirection="row" flexWrap="wrap" columnGap={2}>
      {metric('u-model', 'Model', m.usage.model ?? UNAVAILABLE, m.usage.model === null ? COLOR.muted : undefined, 24)}
      {metric('u-cost', 'Cost', m.usage.cost, m.usage.cost === UNAVAILABLE ? COLOR.muted : undefined, 12)}
      {metric('u-tools', 'Tool calls', String(m.usage.toolCalls), undefined, 12)}
    </Box>,
    ...para('u-note', 'Reported by Claude Code; a plan without rate limits shows them as unavailable. Tool calls cover the lead, subagents and teammates. Per-worker cost is not reported.'),
  ]
}
