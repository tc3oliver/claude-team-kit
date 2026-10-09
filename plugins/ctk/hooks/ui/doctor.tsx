import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import type { Extras, Kit } from './types.ts'

export const renderDoctor = (_kit: Kit, _m: Mission, mc: McState, _extras: Extras, ctx: Ctx) =>
  mc.doctorText === null ? [ctx.line('d-wait', 'Reading…', { dim: true })] : mc.doctorText.split('\n').map((t, i) => ctx.line(`d-${i}`, t, { dim: i === 0 }))
