import { AGENTS, LEAD_PLAN, PROMPT, TASKS, type AgentId } from '../data/scenario.ts'
import { KEY } from '../data/timeline.ts'
import { Card, Pill, Typed, fill, ramp, useSpring, useT } from '../ui/kit.tsx'
import { Content, TopBar } from '../ui/Stage.tsx'
import { TaskRow, TaskTableHead } from '../ui/Tasks.tsx'
import { C } from '../ui/theme.ts'

const PLAN_AT = [8.5, 10.6, 13.0]

/** Scene 2: the lead turns the request into a task board with dependencies. */
export function Plan() {
  const t = useT()
  return (
    <div style={fill}>
      <TopBar />
      <Content>
        <div style={{ display: 'flex', gap: 44, height: '100%' }}>
          <div style={{ width: 640, display: 'flex', flexDirection: 'column', gap: 22 }}>
            <Card style={{ padding: '22px 28px', background: C.panelHi }}>
              <div style={{ fontSize: 26, color: C.dim, marginBottom: 8 }}>你</div>
              <div style={{ fontSize: 28, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{PROMPT}</div>
            </Card>
            <Card style={{ padding: '22px 28px' }}>
              <div style={{ fontSize: 26, color: C.accent, marginBottom: 10, fontWeight: 700 }}>Lead</div>
              {LEAD_PLAN.map((line, i) => (
                <div key={line} style={{ fontSize: 31, lineHeight: 1.5, minHeight: 56, opacity: t >= PLAN_AT[i] ? 1 : 0 }}>
                  <span style={{ color: C.accent }}>{i + 1}. </span>
                  <Typed text={line} from={PLAN_AT[i]} to={PLAN_AT[i] + 1.4} cursor={false} />
                </div>
              ))}
            </Card>
            <Spawns />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 44, fontWeight: 800, marginBottom: 18, opacity: ramp(t, 8.3, 8.8) }}>任務看板</div>
            <TaskTableHead />
            {TASKS.filter(k => k.id !== 'T6').map(k => (
              <TaskRow key={k.id} id={k.id} />
            ))}
          </div>
        </div>
      </Content>
    </div>
  )
}

function Spawns() {
  const t = useT()
  if (t < 14.6) return null
  return (
    <Card style={{ padding: '20px 28px' }}>
      <div style={{ fontSize: 26, color: C.dim, marginBottom: 12, opacity: ramp(t, 14.6, 15) }}>建立 Worker</div>
      {(Object.keys(AGENTS) as AgentId[]).map(a => (
        <Spawn key={a} agent={a} />
      ))}
    </Card>
  )
}

function Spawn({ agent }: { agent: AgentId }) {
  const p = useSpring(KEY.spawn[agent])
  return (
    <div style={{ height: 58, opacity: Math.min(1, p), transform: `translateX(${(1 - p) * -50}px)` }}>
      <Pill color={AGENTS[agent].color}>
        ● {AGENTS[agent].name} · {AGENTS[agent].role} 就緒
      </Pill>
    </div>
  )
}
