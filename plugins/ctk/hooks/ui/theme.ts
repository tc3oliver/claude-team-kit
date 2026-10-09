import type { Mission } from '../mission.ts'

// Semantic colours as Mods theme keys only: raw strings do not follow the person's theme, so they
// would be unreadable on one of light and dark. The theme has no accent or muted key; `suggestion`
// stands for active and `inactive` for not observed.
export type ThemeColor = 'suggestion' | 'success' | 'warning' | 'error' | 'inactive' | 'subtle'

export const COLOR = {
  active: 'suggestion',
  done: 'success',
  ready: 'warning',
  error: 'error',
  muted: 'inactive',
} as const satisfies Record<string, ThemeColor>

export const GLYPH = { running: '●', idle: '◉', done: '✓', failed: '✗', ready: '◇', pending: '○' } as const

export type Status = keyof typeof GLYPH

const STATUS_COLOR: Record<Status, ThemeColor> = {
  running: COLOR.active,
  idle: COLOR.ready,
  done: COLOR.done,
  failed: COLOR.error,
  ready: COLOR.ready,
  pending: COLOR.muted,
}

export const statusColor = (s: Status): ThemeColor => STATUS_COLOR[s]

/** Maps a worker or task status word to a glyph status; an unknown word is pending, never done. */
export const statusOf = (word: string): Status =>
  word === 'running' || word === 'in_progress' ? 'running' : word === 'idle' ? 'idle' : word === 'completed' || word === 'done' ? 'done' : word === 'failed' || word === 'killed' ? 'failed' : word === 'ready' ? 'ready' : 'pending'

export const guardColor = (m: Mission): ThemeColor => (m.guard.state === 'active' ? COLOR.done : m.guard.state === 'error' ? COLOR.error : COLOR.ready)

/**
 * `[██░░░░░░░░] 13%`. A value that was not observed is a muted dash bar, never an empty 0% bar:
 * observed, unavailable and zero must look different.
 */
export const progressBar = (pct: number | null, width = 10): { text: string; color: ThemeColor } => {
  if (pct === null || !Number.isFinite(pct) || pct < 0) return { text: `[${'─'.repeat(width)}] –`, color: COLOR.muted }
  const p = Math.min(100, pct)
  const filled = Math.round((p / 100) * width)
  const color = p >= 90 ? COLOR.error : p >= 70 ? COLOR.ready : COLOR.done
  return { text: `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${Math.round(p)}%`, color }
}

/** `── TITLE ─────` across `width` cells (titles are ASCII). */
export const dividerText = (width: number, title = ''): string => {
  const head = title === '' ? '' : `── ${title} `
  return head + '─'.repeat(Math.max(0, width - head.length))
}

/** The header's state pill. Capacity wins over ACTIVE so a full team is never drawn green: amber when full, red once a spawn was refused. */
export const pillOf = (m: Mission): { text: string; color: ThemeColor } => {
  if (m.guard.state === 'error') return { text: '✗ ERROR', color: COLOR.error }
  if (m.guard.state === 'unavailable') return { text: '○ unavailable', color: COLOR.muted }
  if (m.active !== null && m.active >= m.cap) return { text: '▲ CAPACITY', color: m.rejected > 0 ? COLOR.error : COLOR.ready }
  return m.guard.state === 'active' ? { text: '● ACTIVE', color: COLOR.done } : { text: '◇ READY', color: COLOR.ready }
}
