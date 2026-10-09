// Width-aware layout for the one-line HUD, shared by the Mods band (hooks/band.ts). The
// dependency-free status line script (statusline/ctk-statusline.mjs) carries a copy of the
// same functions because it is installed as a single file; tests/hudline.test.ts runs both
// over one matrix so the two cannot drift. Pure, no imports.

export const DASH = '–'
export const SEP = ' │ '

/** Terminal width used when none is known: narrow enough to be safe in an 80-column terminal. */
export const DEFAULT_COLUMNS = 80

/** 0 = 120+ columns (full), 1 = 80-119 (abbreviated), 2 = under 80 (only the essentials). */
export type Tier = 0 | 1 | 2

/** At most this many segments are drawn in the narrowest tier. */
export const MIN_TIER_SEGMENTS = 3

export const tierOf = (columns: number): Tier => (columns >= 120 ? 0 : columns >= 80 ? 1 : 2)

export type Segment = {
  id: string
  /** Higher is kept longer when the line is too wide. */
  prio: number
  /** The text per tier, richest first; '' means the segment is not drawn at that tier. */
  forms: readonly [string, string, string]
  /** True when the figure was not reported: drawn as a dash and dropped before any real figure. */
  missing?: boolean
  bold?: boolean
}

// --- Display width -----------------------------------------------------------------------

// CSI and OSC sequences. They take no cells.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

export const stripAnsi = (s: string): string => s.replace(ANSI, '')

type Range = readonly [number, number]

const inRanges = (cp: number, ranges: readonly Range[]): boolean => {
  for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true
  return false
}

// Combining marks, joiners and variation selectors take no cell of their own.
const ZERO: readonly Range[] = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a], [0x064b, 0x065f],
  [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x20d0, 0x20ff], [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f], [0xe0100, 0xe01ef],
]

// East Asian Wide and Fullwidth, plus the emoji blocks terminals draw two cells wide.
const WIDE: readonly Range[] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x2705, 0x2705], [0x2e80, 0x303e], [0x3041, 0x33ff],
  [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
]

// East Asian Ambiguous characters this file or a branch name is likely to hold: one cell in
// most terminals, two in terminals set to a CJK ambiguous width (CTK_AMBIGUOUS_WIDTH=2).
const AMBIGUOUS: readonly Range[] = [
  [0x00a1, 0x00a1], [0x00a4, 0x00a4], [0x00a7, 0x00a8], [0x00aa, 0x00aa], [0x00ad, 0x00ae],
  [0x00b0, 0x00b4], [0x00b6, 0x00ba], [0x00bc, 0x00bf], [0x00d7, 0x00d7], [0x00f7, 0x00f7],
  [0x2010, 0x2027], [0x2030, 0x203b], [0x2190, 0x21ff], [0x2460, 0x24ff], [0x2500, 0x257f],
  [0x2580, 0x258f], [0x2592, 0x2595], [0x25a0, 0x25ff],
]

export const charWidth = (cp: number, ambiguous: 1 | 2 = 1): number => {
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return 0
  if (cp < 0x300) return ambiguous === 2 && inRanges(cp, AMBIGUOUS) ? 2 : 1
  if (inRanges(cp, ZERO)) return 0
  if (inRanges(cp, WIDE)) return 2
  return ambiguous === 2 && inRanges(cp, AMBIGUOUS) ? 2 : 1
}

/** Terminal cells the text takes: ANSI sequences take none, CJK and emoji take two. */
export const displayWidth = (s: string, ambiguous: 1 | 2 = 1): number => {
  let w = 0
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0) ?? 0, ambiguous)
  return w
}

/** Cuts to at most `max` cells, ending with `…` when something was cut; never splits a wide character. */
export const truncateToWidth = (s: string, max: number, ambiguous: 1 | 2 = 1): string => {
  if (max < 1) return ''
  const plain = stripAnsi(s)
  if (displayWidth(plain, ambiguous) <= max) return plain
  const ell = charWidth(0x2026, ambiguous)
  let out = ''
  let used = 0
  for (const ch of plain) {
    const w = charWidth(ch.codePointAt(0) ?? 0, ambiguous)
    if (used + w + ell > max) break
    out += ch
    used += w
  }
  return ell > max ? '' : `${out}…`
}

// --- Figures -----------------------------------------------------------------------------

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A usage percentage, rounded; null (a dash) when it was not reported. */
export const fmtPct = (v: number | null | undefined): string => {
  const n = finite(v)
  return n === null || n < 0 ? DASH : `${Math.round(n)}%`
}

/**
 * Reset time to epoch milliseconds. Claude Code's status line gives epoch seconds, the Mods
 * API an ISO 8601 string; anything else (or a non-date) is null, never a guess.
 */
export const resetMs = (v: unknown): number | null => {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null
    return v < 1e11 ? v * 1000 : v
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

/** `34m`, `2h34m`, `3d12h`; `<1m` under a minute; null once the reset time has passed. */
export const fmtCountdown = (resetAtMs: number | null, nowMs: number): string | null => {
  if (resetAtMs === null || !Number.isFinite(nowMs) || resetAtMs <= nowMs) return null
  const mins = Math.floor((resetAtMs - nowMs) / 60_000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h${String(mins % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

export type Window = { pct: number | null | undefined; resetsAtMs: number | null }

/**
 * One rate-limit window. A window whose reset time has passed is stale (the percentage
 * belongs to the window that ended), so it renders as a dash rather than a number that is
 * no longer true. A percentage without a reset time still shows; the countdown is left out.
 */
export const windowFigures = (w: Window, nowMs: number): { pct: string; countdown: string | null; missing: boolean } => {
  const stale = w.resetsAtMs !== null && Number.isFinite(nowMs) && w.resetsAtMs <= nowMs
  const pct = stale ? DASH : fmtPct(w.pct)
  return { pct, countdown: stale ? null : fmtCountdown(w.resetsAtMs, nowMs), missing: pct === DASH }
}

/** `5h 28% (2h34m)` / `5h 28% 2h34m`; a missing figure is `5h –`. */
export const usageSegment = (id: string, label: string, prio: number, w: Window, nowMs: number): Segment => {
  const f = windowFigures(w, nowMs)
  if (f.missing) return { id, prio, missing: true, forms: [`${label} ${DASH}`, `${label} ${DASH}`, `${label} ${DASH}`] }
  const base = `${label} ${f.pct}`
  return {
    id,
    prio,
    forms: f.countdown === null ? [base, base, base] : [`${base} (${f.countdown})`, `${base} ${f.countdown}`, `${base} ${f.countdown}`],
  }
}

// --- Layout ------------------------------------------------------------------------------

export type LayoutOptions = {
  /** Cells the line may take. */
  columns: number
  /** The terminal width that picks the tier, when `columns` is less than the terminal (a margin). */
  tierColumns?: number
  /** 2 for terminals that draw East Asian Ambiguous characters (│ · …) two cells wide. */
  ambiguous?: 1 | 2
  /** Wrap `bold` segments in ANSI bold. The width maths ignores the sequences. */
  color?: boolean
}

const BOLD = ['\x1b[1m', '\x1b[22m'] as const

// A figure that was not reported is dropped before one that was, whatever its rank.
const effective = (s: Segment): number => (s.missing === true ? s.prio - 1000 : s.prio)

/**
 * Lays the segments out on one line that is never wider than `columns` cells.
 *
 * The tier follows the width (120+ full, 80-119 abbreviated, under 80 the essentials only).
 * When the tier's text is still too wide, whole segments are dropped lowest rank first and the
 * line is never cut mid-figure. Only when a single segment alone does not fit is it shortened
 * (a more abbreviated form first, then `…`). Segments keep their given display order.
 */
export const layoutLine = (segments: readonly Segment[], opts: LayoutOptions): string => {
  const columns = Number.isFinite(opts.columns) && opts.columns >= 1 ? Math.floor(opts.columns) : DEFAULT_COLUMNS
  const amb = opts.ambiguous === 2 ? 2 : 1
  const tier = tierOf(Number.isFinite(opts.tierColumns) && (opts.tierColumns as number) >= 1 ? (opts.tierColumns as number) : columns)
  const sepWidth = displayWidth(SEP, amb)
  const width = (items: readonly { text: string }[]): number =>
    items.reduce((n, i) => n + displayWidth(i.text, amb), 0) + sepWidth * Math.max(0, items.length - 1)

  let items = segments
    .map(s => ({ s, text: s.forms[tier] }))
    .filter(i => i.text !== '')
  if (tier === 2 && items.length > MIN_TIER_SEGMENTS) {
    const keep = new Set(
      [...items]
        .sort((a, b) => effective(b.s) - effective(a.s))
        .slice(0, MIN_TIER_SEGMENTS)
        .map(i => i.s.id),
    )
    items = items.filter(i => keep.has(i.s.id))
  }
  while (items.length > 1 && width(items) > columns) {
    let drop = 0
    let lowest = Infinity
    items.forEach((item, i) => {
      if (effective(item.s) <= lowest) {
        lowest = effective(item.s)
        drop = i
      }
    })
    items = items.filter((_, i) => i !== drop)
  }
  const only = items.length === 1 ? items[0] : undefined
  if (only !== undefined && width(items) > columns) {
    let text = only.text
    for (let t = tier + 1; t <= 2 && displayWidth(text, amb) > columns; t++) {
      const form = only.s.forms[t]
      if (form !== undefined && form !== '') text = form
    }
    items = [{ s: only.s, text: truncateToWidth(text, columns, amb) }]
  }
  return items.map(i => (opts.color === true && i.s.bold === true ? `${BOLD[0]}${i.text}${BOLD[1]}` : i.text)).join(SEP)
}
