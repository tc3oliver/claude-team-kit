import type { Mission } from '../mission.ts'

// Motion for Mission Control, kept as plain values so the views stay pure. What a person sees is
// `Motion` (a frame counter and the keys to highlight); `MotionState` is what register.tsx keeps to
// work out the next one. Nothing here starts a timer: register.tsx arms one only while the pane is
// drawing, and each fire redraws the pane, so closing the pane ends the chain by itself.

/** One slow frame: a running glyph dims and brightens once a second. */
export const FRAME_MS = 1000

/** How long a new worker, a completed task or a refusal stays highlighted. */
export const HIGHLIGHT_MS = 3000

export type Motion = {
  frame: number
  /** True when motion is off: views draw static glyphs and no highlight is ever set. */
  reduced: boolean
  /** Keys: `worker:<agentId>`, `task:<id>`, `guard`. */
  hot: ReadonlySet<string>
}

export const STATIC_MOTION: Motion = { frame: 0, reduced: true, hot: new Set() }

type Seen = { workers: ReadonlySet<string>; done: ReadonlySet<string>; rejected: number }

export type MotionState = {
  reduced: boolean
  frame: number
  /** What the previous draw showed; null before the first, which highlights nothing. */
  seen: Seen | null
  /** Highlight key to the clock time it ends. */
  until: Readonly<Record<string, number>>
}

export const newMotionState = (reduced = false): MotionState => ({ reduced, frame: 0, seen: null, until: {} })

/** The host exposes no reduced-motion flag, so CTK_REDUCED_MOTION=1 and a set NO_COLOR turn motion off. */
export const reducedFrom = (reducedMotion: string | undefined, noColor: string | undefined): boolean =>
  reducedMotion === '1' || (noColor !== undefined && noColor !== '')

const seenOf = (m: Mission): Seen => ({
  workers: new Set(m.workers.map(w => w.agentId)),
  done: new Set(m.tasks.rows.filter(t => t.status === 'completed').map(t => t.id)),
  rejected: m.rejected,
})

/** Compares this draw with the last one: what is new is highlighted from `now`, what has expired is dropped. */
export const observe = (s: MotionState, m: Mission, now: number): MotionState => {
  if (s.reduced) return { ...s, seen: null, until: {} }
  const seen = seenOf(m)
  const until: Record<string, number> = {}
  for (const [k, t] of Object.entries(s.until)) if (t > now) until[k] = t
  if (s.seen !== null) {
    for (const id of seen.workers) if (!s.seen.workers.has(id)) until[`worker:${id}`] = now + HIGHLIGHT_MS
    for (const id of seen.done) if (!s.seen.done.has(id)) until[`task:${id}`] = now + HIGHLIGHT_MS
    if (seen.rejected > s.seen.rejected) until.guard = now + HIGHLIGHT_MS
  }
  return { ...s, seen, until }
}

export const motionOf = (s: MotionState): Motion => ({ frame: s.frame, reduced: s.reduced, hot: new Set(Object.keys(s.until)) })

/** Milliseconds to the next redraw, or null when nothing moves: the frame needs a running worker, a highlight needs its end. */
export const delayFor = (s: MotionState, m: Mission, now: number): number | null => {
  if (s.reduced) return null
  if ((m.running ?? 0) > 0) return FRAME_MS
  const ends = Object.values(s.until).filter(t => t > now)
  return ends.length === 0 ? null : Math.max(1, Math.min(...ends) - now)
}

/** A running glyph is drawn dim on odd frames; with motion off it never is. */
export const pulseDim = (mo: Motion): boolean => !mo.reduced && mo.frame % 2 === 1

/** Text props for a status glyph: a running one dims on odd frames, a freshly changed row (`key`) is inverted. */
export const glyphProps = (mo: Motion, running: boolean, key: string): { dimColor: boolean; inverse: boolean } => ({
  dimColor: running && pulseDim(mo),
  inverse: mo.hot.has(key),
})
