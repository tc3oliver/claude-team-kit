import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import type { Extras, Kit } from './types.ts'

export const renderStats = (_kit: Kit, _m: Mission, _mc: McState, extras: Extras, ctx: Ctx) =>
  extras.statsText.split('\n').map((t, i) => ctx.line(`s-${i}`, t, { dim: i === 0 }))
