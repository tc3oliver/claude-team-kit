import type { ReactNode } from 'react'
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion'
import { TASKS } from '../data/scenario.ts'
import { busyCount, doneCount, leadStatus, taskStatus, visibleTasks } from '../data/timeline.ts'
import { FPS } from '../time.ts'
import { Pill, fill, ramp, useT } from './kit.tsx'
import { C, FONT } from './theme.ts'

export const Background = () => (
  <AbsoluteFill style={{ background: `radial-gradient(1400px 800px at 50% 0%, ${C.bg2}, ${C.bg})` }} />
)

/** Scene wrapper: fades in over a few frames and out over the overlap, so cuts never pop. */
export function Fade({ frames, fadeIn = 8, fadeOut = 8, children }: { frames: number; fadeIn?: number; fadeOut?: number; children: ReactNode }) {
  const f = useCurrentFrame()
  const o = Math.min(
    fadeIn ? interpolate(f, [0, fadeIn], [0, 1], { extrapolateRight: 'clamp' }) : 1,
    fadeOut ? interpolate(f, [frames - fadeOut, frames], [1, 0], { extrapolateLeft: 'clamp' }) : 1,
  )
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>
}

export const TOP_H = 104

export function TopBar() {
  const t = useT()
  const shown = visibleTasks(t).length
  const total = TASKS.filter(k => taskStatus(k.id, t) !== 'hidden').length
  const busy = busyCount(t)
  return (
    <div style={{ ...fill, bottom: 'auto', height: TOP_H, display: 'flex', alignItems: 'center', padding: '0 48px', gap: 28, borderBottom: `2px solid ${C.line}`, background: `${C.bg}cc`, fontFamily: FONT }}>
      <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 0.5 }}>
        <span style={{ color: C.accent }}>◆</span> Agent Workspace
        <span style={{ color: C.dim, fontWeight: 500 }}> · shop-demo</span>
      </div>
      <div style={{ flex: 1 }} />
      <Pill color={C.accent} size={28}>Lead · {leadStatus(t)}</Pill>
      <Pill color={C.accent} size={28}>Workers {busy}/3</Pill>
      <Pill color={C.ok} size={28}>任務 {doneCount(t)}/{shown || total}</Pill>
    </div>
  )
}

export const Content = ({ children, pad = 40 }: { children: ReactNode; pad?: number }) => (
  <div style={{ position: 'absolute', left: pad + 8, right: pad + 8, top: TOP_H + 32, bottom: 36, fontFamily: FONT, color: C.text }}>{children}</div>
)

export const Toast = ({ text, tone, at, until }: { text: string; tone: 'ok' | 'info'; at: number; until: number }) => {
  const t = useT()
  const inP = ramp(t, at, at + 0.35)
  const outP = ramp(t, until - 0.35, until, 1, 0)
  const p = Math.min(inP, outP)
  const color = tone === 'ok' ? C.ok : C.accent
  return (
    <div style={{ position: 'absolute', right: 0, top: -4, transform: `translateY(${(1 - p) * -40}px)`, opacity: p, padding: '20px 36px', borderRadius: 20, background: C.panelHi, border: `3px solid ${color}`, boxShadow: `0 0 60px ${color}44`, fontSize: 38, fontWeight: 700, color: C.text, zIndex: 5 }}>
      <span style={{ color }}>✓ </span>
      {text}
    </div>
  )
}

export { FPS }
