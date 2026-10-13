import type { ReactNode } from 'react'
import { AGENTS, BACKEND_CODE, CART, TEST_CASES, taskById, type AgentId } from '../data/scenario.ts'
import { PREVIEW, agentState, taskStatus } from '../data/timeline.ts'
import { Pill, StatusBadge, Typed, ramp, useT } from './kit.tsx'
import { C, MONO } from './theme.ts'

const AGENT_TASKS: Record<AgentId, ('T1' | 'T2' | 'T3')[]> = { backend: ['T1'], frontend: ['T2'], testing: ['T3'] }

/** One worker's column: who, which task, state, the work itself, and its latest activity. */
export function WorkerColumn({ agent, log, children, width = 560, height = 800 }: { agent: AgentId; log: { t: number; text: string }[]; children: ReactNode; width?: number; height?: number }) {
  const t = useT()
  const a = AGENTS[agent]
  const st = agentState(agent, t)
  const taskId = AGENT_TASKS[agent][0]
  const status = taskStatus(taskId, t)
  const lines = log.filter(l => t >= l.t).slice(-2)
  const doing = lines[lines.length - 1]
  return (
    <div style={{ width, height, borderRadius: 28, background: C.panel, border: `3px solid ${st.state === 'working' ? a.color : C.line}`, boxShadow: st.state === 'working' ? `0 0 50px ${a.color}33` : undefined, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '22px 28px 16px', borderBottom: `2px solid ${C.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 40, fontWeight: 800, color: a.color }}>{a.name}</div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>{a.role}</div>
        </div>
        <div style={{ marginTop: 10, fontSize: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            <b style={{ color: C.accent }}>{taskId}</b> {taskById(taskId).title}
          </span>
          {status !== 'hidden' && <StatusBadge status={status} size={26} />}
        </div>
      </div>
      <div style={{ flex: 1, padding: 22, overflow: 'hidden', position: 'relative' }}>{children}</div>
      <div style={{ padding: '14px 28px 20px', borderTop: `2px solid ${C.line}`, minHeight: 96, fontSize: 26, color: C.dim }}>
        {lines.map((l, i) => (
          <div key={l.t} style={{ color: i === lines.length - 1 ? C.text : C.dim, opacity: i === lines.length - 1 ? 1 : 0.7 }}>
            {i === lines.length - 1 && st.state === 'working' ? '▸ ' : '✓ '}
            {l.text}
          </div>
        ))}
        {!doing && <div>待命</div>}
      </div>
    </div>
  )
}

export function DiffView() {
  const t = useT()
  const shown = BACKEND_CODE.filter(l => t >= l.t)
  const last = shown[shown.length - 1]
  return (
    <div style={{ background: C.code, borderRadius: 16, padding: '16px 18px', height: '100%', boxSizing: 'border-box', border: `2px solid ${C.line}` }}>
      <div style={{ fontFamily: MONO, fontSize: 26, color: C.dim, marginBottom: 10 }}>src/coupons.js</div>
      {shown.map(l => {
        const add = l.text.startsWith('+')
        const age = ramp(t, l.t, l.t + 0.3)
        return (
          <div key={l.t} style={{ fontFamily: MONO, fontSize: 26, lineHeight: 1.5, whiteSpace: 'pre', color: add ? '#86efac' : C.text, background: add ? '#14532d55' : 'transparent', margin: '0 -18px', padding: '0 18px', opacity: age }}>
            {add ? l.text : '  ' + l.text}
            {l === last && Math.floor(t * 3) % 2 === 0 && <span style={{ color: C.accent }}>▌</span>}
          </div>
        )
      })}
    </div>
  )
}

const money = (n: number) => '$' + n.toLocaleString('en-US')

export function CheckoutPreview() {
  const t = useT()
  const P = PREVIEW
  const showInput = t >= P.inputAt
  const code1 = 'SAVE10'
  const bad = 'OLD22'
  const phase = t >= P.badTypeFrom ? 'bad' : 'good'
  const typed = phase === 'good' ? code1.slice(0, Math.round(ramp(t, P.typeFrom, P.typeTo, 0, code1.length))) : bad.slice(0, Math.round(ramp(t, P.badTypeFrom, P.badTypeTo, 0, bad.length)))
  const applied = phase === 'good' ? t >= P.applyAt : false
  const error = t >= P.badApplyAt
  const press = (at: number) => (t >= at && t < at + 0.25 ? 0.93 : 1)
  const btnScale = phase === 'good' ? press(P.applyAt) : press(P.badApplyAt)
  const off = applied ? CART.off : 0
  return (
    <div style={{ background: '#f8fafc', color: '#0f172a', borderRadius: 16, height: '100%', boxSizing: 'border-box', padding: '22px 26px', fontSize: 28 }}>
      <div style={{ fontSize: 34, fontWeight: 800, marginBottom: 14 }}>結帳</div>
      <Row a="小計" b={money(CART.subtotal)} />
      {showInput && (
        <div style={{ margin: '14px 0 6px', opacity: ramp(t, P.inputAt, P.inputAt + 0.4) }}>
          <div style={{ fontSize: 24, color: '#475569', marginBottom: 6 }}>優惠碼</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, height: 58, borderRadius: 10, border: `3px solid ${error ? '#dc2626' : '#94a3b8'}`, display: 'flex', alignItems: 'center', padding: '0 14px', fontFamily: MONO, fontSize: 28 }}>
              {typed}
              {typed.length < (phase === 'good' ? code1.length : bad.length) && <span style={{ color: '#2563eb' }}>▌</span>}
            </div>
            <div style={{ height: 58, padding: '0 20px', display: 'flex', alignItems: 'center', borderRadius: 10, background: '#2563eb', color: 'white', fontWeight: 700, fontSize: 26, transform: `scale(${btnScale})` }}>套用</div>
          </div>
          {error && <div style={{ color: '#dc2626', fontSize: 26, marginTop: 8, fontWeight: 600 }}>優惠碼已過期</div>}
        </div>
      )}
      {off > 0 && !error && <Row a="優惠碼 SAVE10" b={'-' + money(off)} color="#16a34a" />}
      {error && <Row a="優惠碼" b="未套用" color="#64748b" />}
      <div style={{ borderTop: '2px solid #cbd5e1', marginTop: 12, paddingTop: 12 }}>
        <Row a="總計" b={money(CART.subtotal - (error ? 0 : off))} bold />
      </div>
    </div>
  )
}

const Row = ({ a, b, color, bold }: { a: string; b: string; color?: string; bold?: boolean }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 800 : 500, fontSize: bold ? 34 : 28, color: color ?? 'inherit', padding: '4px 0' }}>
    <span>{a}</span>
    <span>{b}</span>
  </div>
)

export function TestList() {
  const t = useT()
  return (
    <div style={{ background: C.code, borderRadius: 16, padding: 20, height: '100%', boxSizing: 'border-box', border: `2px solid ${C.line}` }}>
      <div style={{ fontFamily: MONO, fontSize: 26, color: C.dim, marginBottom: 16 }}>test/coupons.test.js</div>
      {TEST_CASES.map((c, i) => {
        const started = t >= c.t
        const done = t >= c.t + 1.7
        const age = ramp(t, c.t, c.t + 0.3)
        return (
          <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 16, height: 84, fontSize: 32, opacity: started ? age : 0.25, transform: `translateX(${(1 - (started ? age : 1)) * 30}px)` }}>
            <span style={{ width: 40, fontSize: 36, color: done ? C.ok : C.warn }}>{done ? '✓' : started ? '…' : '○'}</span>
            <span>
              <b style={{ color: C.dim, fontWeight: 600 }}>{i + 1}.</b> {c.name}
            </span>
          </div>
        )
      })}
      {t >= 29.6 && <Pill color={C.ok}>4 個案例已寫好</Pill>}
    </div>
  )
}

export { Typed }
