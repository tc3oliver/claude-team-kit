import type { CSSProperties, ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { AGENTS, type AgentId } from '../data/scenario.ts'
import type { TaskStatus } from '../data/timeline.ts'
import { FPS } from '../time.ts'
import { C, FONT, MONO, STATUS } from './theme.ts'

// ---- time ---------------------------------------------------------------------------------------------------------

const SceneStart = createContext(0)
export const SceneClock = ({ from, children }: { from: number; children: ReactNode }) => (
  <SceneStart.Provider value={from}>{children}</SceneStart.Provider>
)
/** Seconds since the start of the whole video, from inside any scene. */
export function useT(): number {
  const f = useCurrentFrame()
  return useContext(SceneStart) + f / FPS
}

export const ramp = (t: number, from: number, to: number, a = 0, b = 1) =>
  interpolate(t, [from, to], [a, b], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })

/** A spring that starts at second `at`; 0 before, settles to 1. */
export function useSpring(at: number, damping = 18): number {
  const t = useT()
  const { fps } = useVideoConfig()
  return t < at ? 0 : spring({ frame: Math.round((t - at) * fps), fps, config: { damping, stiffness: 140 } })
}

// ---- text ---------------------------------------------------------------------------------------------------------

export function Typed({ text, from, to, cursor = true, style }: { text: string; from: number; to: number; cursor?: boolean; style?: CSSProperties }) {
  const t = useT()
  const n = Math.round(ramp(t, from, to, 0, text.length))
  const showCursor = cursor && t >= from - 0.3 && (t < to + 0.2 || Math.floor(t * 2) % 2 === 0)
  return (
    <span style={style}>
      {text.slice(0, n)}
      {showCursor && <span style={{ display: 'inline-block', width: '0.12em', height: '1.05em', marginLeft: 4, background: C.accent, verticalAlign: 'text-bottom', opacity: t < to ? 1 : 0.8 }} />}
    </span>
  )
}

// ---- small parts ------------------------------------------------------------------------------------------------

export const Pill = ({ children, color, fill, size = 26 }: { children: ReactNode; color: string; fill?: boolean; size?: number }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '6px 18px', borderRadius: 999, fontSize: size, fontWeight: 600, color: fill ? C.bg : color, background: fill ? color : `${color}22`, border: `2px solid ${color}66`, whiteSpace: 'nowrap' }}>
    {children}
  </span>
)

export const StatusBadge = ({ status, size = 26 }: { status: Exclude<TaskStatus, 'hidden'>; size?: number }) => {
  const s = STATUS[status]
  const t = useT()
  const dot = status === 'running' ? 0.5 + 0.5 * Math.sin(t * 7) : 1
  return (
    <Pill color={s.color} size={size}>
      <span style={{ width: 14, height: 14, borderRadius: 7, background: s.color, opacity: dot, display: 'inline-block' }} />
      {s.label}
    </Pill>
  )
}

export const AgentChip = ({ agent, size = 26 }: { agent: AgentId; size?: number }) => (
  <Pill color={AGENTS[agent].color} size={size}>
    {AGENTS[agent].name} · {AGENTS[agent].role}
  </Pill>
)

export const Card = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div style={{ background: C.panel, border: `2px solid ${C.line}`, borderRadius: 24, ...style }}>{children}</div>
)

export const Bar = ({ value, color = C.accent, h = 12 }: { value: number; color?: string; h?: number }) => (
  <div style={{ height: h, borderRadius: h, background: `${C.line}`, overflow: 'hidden' }}>
    <div style={{ width: `${Math.round(value * 100)}%`, height: '100%', background: color, borderRadius: h }} />
  </div>
)

export const Mono = ({ children, size = 26, style }: { children: ReactNode; size?: number; style?: CSSProperties }) => (
  <div style={{ fontFamily: MONO, fontSize: size, lineHeight: 1.45, whiteSpace: 'pre', ...style }}>{children}</div>
)

export const fill: CSSProperties = { position: 'absolute', inset: 0, fontFamily: FONT, color: C.text }
