import { AGENTS, BACKEND_LOG, FRONTEND_LOG, TASKS, TESTING_LOG, type AgentId } from '../data/scenario.ts'
import { taskStatus } from '../data/timeline.ts'
import { StatusBadge, fill, ramp, useT } from '../ui/kit.tsx'
import { Content, TopBar } from '../ui/Stage.tsx'
import { CheckoutPreview, DiffView, TestList, WorkerColumn } from '../ui/Worker.tsx'
import { C } from '../ui/theme.ts'

const COL_W = 580
const GAP = 42
const COL_H = 720
const FOCUS_X: Record<AgentId, number> = { backend: COL_W / 2, frontend: COL_W * 1.5 + GAP, testing: COL_W * 2.5 + GAP * 2 }

/** Zoom keyframes: [from, to] seconds in which each column is the focus, with 0.7 s moves in and out. */
const FOCUS: { agent: AgentId; from: number; to: number }[] = [
  { agent: 'backend', from: 21.4, to: 24.3 },
  { agent: 'frontend', from: 24.3, to: 27.2 },
  { agent: 'testing', from: 27.2, to: 30.2 },
]

function camera(t: number) {
  const zoom = 1.26
  let sum = 0
  let sx = 0
  for (const f of FOCUS) {
    const w = Math.max(0, ramp(t, f.from, f.from + 0.7) - ramp(t, f.to, f.to + 0.7))
    sum += w
    sx += w * FOCUS_X[f.agent]
  }
  const S = Math.min(1, sum)
  return { s: 1 + (zoom - 1) * S, fx: sum > 0 ? 912 * (1 - S) + (sx / sum) * S : 912 }
}

function focusWeight(agent: AgentId, t: number) {
  let w = 0
  for (const f of FOCUS) if (f.agent === agent) w = ramp(t, f.from, f.from + 0.5) - ramp(t, f.to, f.to + 0.5)
  return Math.max(0, w)
}

/** Scene 3: three workers at the same time. Light zoom plus dimming moves attention from column to column. */
export function Parallel() {
  const t = useT()
  const { s, fx } = camera(t)
  const anyFocus = (Object.keys(AGENTS) as AgentId[]).reduce((m, a) => Math.max(m, focusWeight(a, t)), 0)
  const dim = (a: AgentId) => 1 - 0.5 * (anyFocus - focusWeight(a, t))
  const VIEW_W = 1824
  const VIEW_H = 908
  return (
    <div style={fill}>
      <TopBar />
      <Content>
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <div style={{ width: VIEW_W, transformOrigin: '0 0', transform: `translate(${VIEW_W / 2 - fx * s}px, ${(VIEW_H - COL_H * s) / 2 - 90 * s}px) scale(${s})` }}>
            <div style={{ display: 'flex', gap: 14, height: 70, alignItems: 'center', marginBottom: 20, opacity: ramp(t, 18, 18.5) }}>
              <span style={{ fontSize: 28, color: C.dim, fontWeight: 600 }}>同時進行</span>
              {TASKS.filter(k => k.id <= 'T3').map(k => {
                const st = taskStatus(k.id, t)
                return st === 'hidden' ? null : (
                  <span key={k.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 28, fontWeight: 700 }}>
                    <span style={{ color: AGENTS[k.agent].color }}>{k.id}</span>
                    <StatusBadge status={st} size={26} />
                  </span>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: GAP }}>
              <div style={{ opacity: dim('backend') }}>
                <WorkerColumn agent="backend" log={BACKEND_LOG} width={COL_W} height={COL_H}>
                  <DiffView />
                </WorkerColumn>
              </div>
              <div style={{ opacity: dim('frontend') }}>
                <WorkerColumn agent="frontend" log={FRONTEND_LOG} width={COL_W} height={COL_H}>
                  <CheckoutPreview />
                </WorkerColumn>
              </div>
              <div style={{ opacity: dim('testing') }}>
                <WorkerColumn agent="testing" log={TESTING_LOG} width={COL_W} height={COL_H}>
                  <TestList />
                </WorkerColumn>
              </div>
            </div>
          </div>
        </div>
      </Content>
    </div>
  )
}
