import { DASH, displayWidth } from '../../shared/hudline.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { COLOR } from './theme.ts'
import type { Extras, Kit } from './types.ts'

/** `label: value` whose value is the dash (or says unavailable) was not observed: muted, never read as 0. */
const unobserved = (seg: string) => new RegExp(`:\\s*(${DASH}|unavailable)(\\s|$)`).test(seg)

const TITLES: Record<string, string> = { 'counted by CTK:': 'COUNTED BY CTK', 'measured (reported by Claude Code):': 'MEASURED BY CLAUDE CODE' }

// Two sections, as /ctk-stats prints them. Counts CTK made are zero when nothing happened; figures
// Claude Code reports are the dash when it did not report them.
export const renderStats = ({ Box, Text }: Kit, _m: Mission, _mc: McState, extras: Extras, ctx: Ctx) => {
  const { clip, divider } = ctx
  const out: JSX.Element[] = []
  let n = 0
  // The session id line is dropped and elapsed shares a row with the per-worker note: the pane has 16 rows.
  const lines = extras.statsText.split('\n').slice(1).reduce<string[]>((a, l) => (a.at(-1)?.startsWith('  elapsed:') ? [...a.slice(0, -1), `${a.at(-1)}  ${l.trim()}`] : [...a, l]), [])
  for (const l of lines) {
    const title = TITLES[l]
    if (title !== undefined) {
      out.push(divider(`s-d${n++}`, title))
      continue
    }
    const segs = l.trim().split(/ {2,}/).filter(s => s !== '')
    let left = ctx.room
    const cells = segs.map(s => {
      const t = clip(s, Math.max(4, left))
      left -= displayWidth(t, ctx.ambiguous) + 2
      return t
    })
    out.push(
      <Box key={`s-${n++}`} flexDirection="row" columnGap={2}>
        {cells.map((t, i) => (
          <Text key={i} wrap="truncate-end" {...(unobserved(segs[i]!) ? { color: COLOR.muted } : {})}>
            {t}
          </Text>
        ))}
      </Box>,
    )
  }
  return out
}
