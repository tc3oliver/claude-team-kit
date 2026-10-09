import { DASH, displayWidth } from '../../shared/hudline.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { COLOR } from './theme.ts'
import type { Extras, Kit } from './types.ts'

/** `label: value` whose value is the dash (or says unavailable) was not observed: muted, never read as 0. */
const unobserved = (seg: string) => new RegExp(`:\\s*(${DASH}|unavailable)(\\s|$)`).test(seg)

const TITLES: Record<string, string> = { 'counted by CTK:': 'COUNTED BY CTK', 'measured (reported by Claude Code):': 'MEASURED BY CLAUDE CODE' }

/** `7d limit: 12% (resets in 4d0h)` -> `7d limit 12% · resets in 4d0h`: the reset time is part of the figure, so it leads the wrap. */
const limit = (s: string) => s.replace(/^(\d+h|\d+d) limit: (.*?) \((resets in .*)\)$/, '$1 limit $2 · $3')

type Cell = { text: string; muted: boolean }

// Two sections, as /ctk-stats prints them. Counts CTK made are zero when nothing happened; figures
// Claude Code reports are the dash when it did not report them. A long value wraps under a hanging
// indent; if the rows still exceed the budget the view ends with the shared "+N more" line.
export const renderStats = ({ Box, Text }: Kit, _m: Mission, _mc: McState, extras: Extras, ctx: Ctx) => {
  const { divider, wrap, line, room, ambiguous } = ctx
  const rows: JSX.Element[] = []
  let n = 0
  const push = (cells: Cell[]) =>
    rows.push(
      <Box key={`s-${n++}`} flexDirection="row" columnGap={2}>
        {cells.map((c, i) => (
          <Text key={i} wrap="truncate-end" {...(c.muted ? { color: COLOR.muted } : {})}>
            {c.text}
          </Text>
        ))}
      </Box>,
    )
  // The session id line is dropped and elapsed shares a row with the per-worker note: the pane has 16 rows.
  const lines = extras.statsText.split('\n').slice(1).reduce<string[]>((a, l) => (a.at(-1)?.startsWith('  elapsed:') ? [...a.slice(0, -1), `${a.at(-1)}  ${l.trim()}`] : [...a, l]), [])
  // Below the table width the pane cannot hold both sections: the measured figures (limits, cost) lead and the
  // counts follow, so the "+N more" line cuts the least useful rows.
  const at = lines.findIndex(l => TITLES[l] === 'MEASURED BY CLAUDE CODE')
  const ordered = ctx.compact && at > 0 ? [...lines.slice(at), ...lines.slice(0, at)] : lines
  for (const l of ordered) {
    const title = TITLES[l]
    if (title !== undefined) {
      rows.push(divider(`s-d${n++}`, title))
      continue
    }
    // Segments that fit share a row; one that does not wraps with a 2-cell hanging indent.
    let cur: Cell[] = []
    let used = 0
    for (const seg of l.trim().split(/ {2,}/).filter(s => s !== '')) {
      const muted = unobserved(seg)
      const text = ctx.compact ? limit(seg).replace(/ \(lead, subagents and teammates; each call once\)$/, '') : limit(seg)
      const w = displayWidth(text, ambiguous)
      if (cur.length > 0 && used + 2 + w <= room) {
        cur.push({ text, muted })
        used += 2 + w
        continue
      }
      if (cur.length > 0) push(cur)
      const parts = w <= room ? [text] : wrap(text, room - 2).map((t, i) => (i === 0 ? t : `  ${t}`))
      for (const p of parts.slice(0, -1)) push([{ text: p, muted }])
      cur = [{ text: parts.at(-1)!, muted }]
      used = displayWidth(parts.at(-1)!, ambiguous)
    }
    if (cur.length > 0) push(cur)
  }
  return ctx.fit('s', rows as ReturnType<typeof line>[]) as JSX.Element[]
}
