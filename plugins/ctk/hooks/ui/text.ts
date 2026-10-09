import { displayWidth, truncateToWidth } from '../../shared/hudline.ts'

// Width-aware text helpers: every length here is terminal cells, never `.length`, so CJK and emoji
// names align. `ambiguous` is the cell width of East Asian Ambiguous characters (CTK_AMBIGUOUS_WIDTH).

/** Cuts to `n` cells with an ellipsis, then pads with spaces to exactly `n` cells. */
export const padCells = (s: string, n: number, ambiguous: 1 | 2 = 1): string => {
  const t = truncateToWidth(s, n, ambiguous)
  return t + ' '.repeat(Math.max(0, n - displayWidth(t, ambiguous)))
}

/** Greedy word wrap to `width` cells; a word longer than the width is cut. */
export const wrapCells = (text: string, width: number, ambiguous: 1 | 2 = 1): string[] => {
  const out: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = truncateToWidth(word, width, ambiguous)
    if (cur === '') cur = w
    else if (displayWidth(cur, ambiguous) + 1 + displayWidth(w, ambiguous) <= width) cur += ` ${w}`
    else {
      out.push(cur)
      cur = w
    }
  }
  return cur === '' ? out : [...out, cur]
}
