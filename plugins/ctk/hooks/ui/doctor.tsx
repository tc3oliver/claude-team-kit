import { parseDoctor } from '../doctor.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { COLOR, GLYPH } from './theme.ts'
import type { Extras, Kit } from './types.ts'

const HEADER = 'CTK readiness (read-only; nothing is changed):'

/** `agent teams: enabled (FLAG)` -> `agent teams: enabled`: the detail stays in /ctk-doctor. */
const short = (t: string) => t.replace(/ \(.*$/, '')

// Fixes first, then what is not known or not on, then one line for everything that is fine.
export const renderDoctor = (_kit: Kit, _m: Mission, mc: McState, _extras: Extras, ctx: Ctx) => {
  const { line, para } = ctx
  if (mc.doctorText === null) return [line('d-wait', 'Reading…', { dim: true })]
  const rows = parseDoctor(mc.doctorText)
  if (rows.length === 0) return [line('d-none', mc.doctorText)]
  const actions = rows.filter(r => r.level === 'action')
  // Guard is shown on its own unless it is ON: a supported version alone never makes it active.
  const guard = rows.find(r => r.text.startsWith('guard:'))
  const guardOn = guard?.text.startsWith('guard: ON') === true
  const watch = rows.filter(r => r.level === 'info' && (/unknown|not checked|not enabled|not computed/.test(r.text) || (r === guard && !guardOn)))
  const ok = rows.filter(r => r.level === 'ok')
  const notes = rows.filter(r => r.level === 'info' && !watch.includes(r))
  return [
    ...(ctx.compact ? [] : [line('d-head', HEADER, { dim: true })]),
    actions.length === 0
      ? watch.length === 0
        ? line('d-sum', `${GLYPH.done} No fixes needed`, { color: COLOR.done, bold: true })
        : line('d-sum', `${GLYPH.ready} No fixes needed · ${watch.length} to watch`, { color: COLOR.ready, bold: true })
      : line('d-sum', `${GLYPH.failed} ${actions.length} need${actions.length === 1 ? 's' : ''} a fix`, { color: COLOR.error, bold: true }),
    ...actions.flatMap((r, i) => [
      ...para(`d-a${i}`, `${GLYPH.failed} ${r.text}`, { color: COLOR.error }),
      ...(r.fix === undefined ? [] : para(`d-f${i}`, `  Next: ${r.fix}`, { dim: true })),
    ]),
    ...watch.flatMap((r, i) => para(`d-w${i}`, `${GLYPH.ready} ${r.text}`, { color: COLOR.ready })),
    ...(guardOn ? para('d-g', `${GLYPH.done} ${short(guard!.text)}`, { color: COLOR.done }) : []),
    ...(ok.length === 0 ? [] : para('d-ok', `${GLYPH.done} ${ok.filter(r => r !== guard).map(r => short(r.text)).join(' · ')}`, { color: COLOR.done })),
    ...(notes.length === 0 ? [] : para('d-n', `${GLYPH.pending} ${notes.length} more note${notes.length === 1 ? '' : 's'}: /ctk-doctor lists them`, { dim: true })),
  ]
}
