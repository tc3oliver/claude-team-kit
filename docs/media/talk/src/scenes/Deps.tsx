import type { TaskId } from '../data/scenario.ts'
import { TASK_TIMES, activeToast, feedUpTo, taskStatus } from '../data/timeline.ts'
import { fill, ramp, useT } from '../ui/kit.tsx'
import { Content, Toast, TopBar } from '../ui/Stage.tsx'
import { TaskNode } from '../ui/Tasks.tsx'
import { C } from '../ui/theme.ts'

const W = 540
const H = 150
const POS: Record<string, { x: number; y: number }> = {
  T1: { x: 0, y: 0 },
  T2: { x: 0, y: 200 },
  T3: { x: 0, y: 400 },
  T4: { x: 640, y: 100 },
  T5: { x: 1260, y: 270 },
}
const EDGES: [TaskId, TaskId][] = [
  ['T1', 'T4'],
  ['T2', 'T4'],
  ['T3', 'T5'],
  ['T4', 'T5'],
]
const TOP = 70

/** Scene 4: finished work unlocks the next task. The edge turns solid the moment its source is done. */
export function Deps() {
  const t = useT()
  const toast = activeToast(t)
  const feed = feedUpTo(t).slice(-3)
  return (
    <div style={fill}>
      <TopBar />
      <Content>
        <div style={{ fontSize: 44, fontWeight: 800 }}>任務依賴</div>
        <svg width={1824} height={620} style={{ position: 'absolute', left: 0, top: TOP }}>
          {EDGES.map(([from, to]) => {
            const a = POS[from]
            const b = POS[to]
            const x1 = a.x + W
            const y1 = a.y + H / 2
            const x2 = b.x
            const y2 = b.y + H / 2
            const done = t >= TASK_TIMES[from].done
            const draw = done ? ramp(t, TASK_TIMES[from].done, TASK_TIMES[from].done + 0.8) : 0
            const d = `M${x1},${y1} C${x1 + 70},${y1} ${x2 - 70},${y2} ${x2},${y2}`
            return (
              <g key={from + to}>
                <path d={d} stroke={C.line} strokeWidth={5} strokeDasharray="14 12" fill="none" />
                {done && <path d={d} stroke={C.ok} strokeWidth={7} fill="none" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />}
              </g>
            )
          })}
        </svg>
        {Object.keys(POS).map(id => (
          <div key={id} style={{ position: 'absolute', left: POS[id].x, top: TOP + POS[id].y }}>
            <TaskNode id={id as TaskId} w={W} h={H} />
          </div>
        ))}
        {waitingNote(t)}
        <div style={{ position: 'absolute', left: 0, right: 0, top: TOP + 640, height: 200 }}>
          <div style={{ fontSize: 26, color: C.dim, marginBottom: 6 }}>Lead 收到的回報</div>
          {feed.map(f => (
            <div key={f.t} style={{ fontSize: 34, height: 50, opacity: ramp(t, f.t, f.t + 0.4) }}>
              <span style={{ color: C.accent, fontWeight: 700 }}>{f.from}</span>
              <span style={{ color: C.dim }}>　</span>
              {f.text}
            </div>
          ))}
        </div>
        {toast && <Toast text={toast.text} tone={toast.tone} at={toast.t} until={toast.until} />}
      </Content>
    </div>
  )
}

/** The caption on Task 4 while it waits, then the moment it unlocks. */
function waitingNote(t: number) {
  const p = POS.T4
  const st = taskStatus('T4', t)
  const text = st === 'blocked' ? 'Waiting for dependencies' : st === 'ready' ? 'Ready → Running' : ''
  if (!text) return null
  return (
    <div style={{ position: 'absolute', left: p.x, top: TOP + p.y + H + 12, width: W, textAlign: 'center', fontSize: 30, fontWeight: 700, color: st === 'ready' ? C.warn : C.dim }}>
      {text}
    </div>
  )
}
