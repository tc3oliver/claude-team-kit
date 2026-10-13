import { AGENTS, SUITES, SUMMARY, TASKS, taskById, type AgentId } from '../data/scenario.ts'
import { SUITE_TIMES, SUMMARY_FROM, ZOOM_OUT_FROM, suiteState, taskStatus, TASK_TIMES } from '../data/timeline.ts'
import { Bar, Card, Pill, StatusBadge, fill, ramp, useT } from '../ui/kit.tsx'
import { Content, TopBar } from '../ui/Stage.tsx'
import { C } from '../ui/theme.ts'

/** Scene 6: tests run, everything turns Completed, the lead reports, the camera pulls back and holds on the finished board. */
export function Deliver() {
  const t = useT()
  const out = ramp(t, ZOOM_OUT_FROM, ZOOM_OUT_FROM + 1.0)
  return (
    <div style={fill}>
      <TopBar />
      <Content>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', gap: 30, opacity: out }}>
          {(Object.keys(AGENTS) as AgentId[]).map(a => (
            <Card key={a} style={{ flex: 1, padding: '16px 26px', border: `3px solid ${AGENTS[a].color}` }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: AGENTS[a].color }}>
                {AGENTS[a].name} · {AGENTS[a].role}
              </div>
              <div style={{ fontSize: 28, marginTop: 4 }}>✓ 工作完成，待命</div>
            </Card>
          ))}
        </div>
        <div style={{ position: 'absolute', inset: 0, transformOrigin: '50% 0', transform: `translateY(${150 * out}px) scale(${1 - 0.2 * out})` }}>
          <div style={{ display: 'flex', gap: 44, height: '100%' }}>
            <div style={{ width: 760 }}>
              <div style={{ fontSize: 44, fontWeight: 800, marginBottom: 18 }}>任務看板</div>
              {TASKS.map(k => (
                <TaskLine key={k.id} id={k.id} />
              ))}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 44, fontWeight: 800, marginBottom: 18, opacity: ramp(t, 53.6, 54) }}>測試</div>
              {SUITES.map(s => (
                <Suite key={s.id} id={s.id} name={s.name} />
              ))}
              <Summary />
            </div>
          </div>
        </div>
      </Content>
    </div>
  )
}

function TaskLine({ id }: { id: (typeof TASKS)[number]['id'] }) {
  const t = useT()
  const st = taskStatus(id, t)
  if (st === 'hidden') return null
  return (
    <div style={{ height: 88, display: 'flex', alignItems: 'center', gap: 20, padding: '0 24px', marginBottom: 10, borderRadius: 18, background: C.panel, border: `2px solid ${st === 'done' ? C.ok + '88' : C.line}` }}>
      <span style={{ fontSize: 32, fontWeight: 800, color: C.accent, width: 64 }}>{id}</span>
      <span style={{ fontSize: 32, fontWeight: 600, flex: 1 }}>{taskById(id).title}</span>
      <StatusBadge status={st} />
    </div>
  )
}

function Suite({ id, name }: { id: (typeof SUITES)[number]['id']; name: string }) {
  const t = useT()
  const s = suiteState(id, t)
  const color = s.status === 'passed' ? C.ok : s.status === 'running' ? C.accent : C.dim
  return (
    <Card style={{ padding: '20px 30px', marginBottom: 16, border: `3px solid ${s.status === 'waiting' ? C.line : color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <span style={{ fontSize: 38, fontWeight: 700 }}>{name}</span>
        <span style={{ fontSize: 38, fontWeight: 800, color }}>
          {s.status === 'waiting' ? '等待中' : `${s.passed} / ${s.total}`} {s.status === 'passed' ? '✓' : ''}
        </span>
      </div>
      <Bar value={s.passed / s.total} color={color} h={14} />
    </Card>
  )
}

function Summary() {
  const t = useT()
  if (t < SUMMARY_FROM) return null
  const p = ramp(t, SUMMARY_FROM, SUMMARY_FROM + 0.5)
  return (
    <Card style={{ padding: '22px 30px', border: `3px solid ${C.ok}`, boxShadow: `0 0 50px ${C.ok}33`, opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
      <div style={{ fontSize: 30, color: C.accent, fontWeight: 700, marginBottom: 8 }}>Lead 工作摘要</div>
      {SUMMARY.map((line, i) => (
        <div key={line} style={{ fontSize: 36, height: 54, opacity: ramp(t, SUMMARY_FROM + 0.25 * i, SUMMARY_FROM + 0.25 * i + 0.4) }}>
          <span style={{ color: i === SUMMARY.length - 1 ? C.warn : C.ok }}>{i === SUMMARY.length - 1 ? '○' : '✓'} </span>
          {line}
        </div>
      ))}
    </Card>
  )
}

export { Pill, SUITE_TIMES, TASK_TIMES }
