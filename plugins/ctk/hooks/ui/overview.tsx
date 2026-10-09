import { fmtSpan, guardWord, UNAVAILABLE } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { hudButtons } from './hud.tsx'
import { guardColor } from './theme.ts'
import type { Extras, Kit } from './types.ts'

const num = (v: number | null): string => (v === null ? UNAVAILABLE : String(v))

export const renderOverview = (kit: Kit, m: Mission, mc: McState, _extras: Extras, ctx: Ctx) => {
  const { field } = ctx
  return [
    field('guard', 'Guard', `${guardWord(m.guard)} · ${m.guard.why}`, guardColor(m)),
    field('workers', 'Workers', `${num(m.active)}/${m.cap} active · ${num(m.running)} running · ${num(m.idle)} idle · ${num(m.completed)} completed · ${num(m.failed)} failed`),
    ...(m.subagents.total > 0
      ? [field('subagents', 'Subagents', `${m.subagents.total} ordinary · ${m.subagents.live} live · not teammates, so the cap does not count them`)]
      : []),
    field('refused', 'Refused', `${m.rejected} spawn(s) above the cap`),
    ...(m.outsideCap > 0 ? [field('outside', 'Outside cap', `${m.outsideCap} named agent(s) started with isolation as ordinary subagents; the cap does not count them`, 'warning')] : []),
    field(
      'tasks',
      'Tasks',
      m.tasks.total === null
        ? UNAVAILABLE
        : m.tasks.detailed && !m.tasks.partial
          ? `${num(m.tasks.completed)}/${m.tasks.total} done · ${num(m.tasks.pending)} pending · ${num(m.tasks.inProgress)} in progress · ${num(m.tasks.blocked)} blocked · ${num(m.tasks.ready)} ready`
          : `${num(m.tasks.completed)}/${m.tasks.total} done (counts from task events; ${m.tasks.partial ? 'some tasks were created before CTK loaded' : 'no task call seen since CTK loaded'}, so no detail)`,
    ),
    field('elapsed', 'Team time', m.teamElapsedMs === null ? `${UNAVAILABLE} (no worker started since CTK loaded)` : fmtSpan(m.teamElapsedMs)),
    field('usage', 'Usage', `5h ${m.usage.fiveHour} · week ${m.usage.sevenDay} · context ${m.usage.contextPct} · cost ${m.usage.cost} · ${m.usage.toolCalls} tool calls`),
    hudButtons(kit, mc, ctx),
  ]
}
