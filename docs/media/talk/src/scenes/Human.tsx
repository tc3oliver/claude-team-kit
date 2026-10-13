import { AGENTS, AMENDMENT, TASKS } from '../data/scenario.ts'
import { KEY, TASK_TIMES } from '../data/timeline.ts'
import { Card, Typed, fill, ramp, useT } from '../ui/kit.tsx'
import { Content, TopBar } from '../ui/Stage.tsx'
import { TaskRow, TaskTableHead } from '../ui/Tasks.tsx'
import { C } from '../ui/theme.ts'

const REPLY = '收到。新增 Task 6「折扣不可疊加驗證」，Task 5 驗收前必須完成。'
const REPLY_AT = [48.4, 51.0] as const

/** Scene 5: the person steps in mid-run through the lead; the board changes and the right worker picks it up. */
export function Human() {
  const t = useT()
  const sent = t >= KEY.amendEnter
  return (
    <div style={fill}>
      <TopBar />
      <Content>
        <div style={{ display: 'flex', gap: 44, height: '100%' }}>
          <div style={{ width: 720, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ fontSize: 44, fontWeight: 800, opacity: ramp(t, 43.2, 43.7) }}>工作進行中，補充需求</div>
            <Card style={{ padding: '26px 30px', background: C.panelHi, border: `3px solid ${sent ? C.line : C.accent}`, opacity: ramp(t, 43.4, 43.9) }}>
              <div style={{ fontSize: 26, color: C.dim, marginBottom: 10 }}>你{sent ? '' : '　正在輸入…'}</div>
              <div style={{ fontSize: 40, lineHeight: 1.5, fontWeight: 600, minHeight: 120 }}>
                <Typed text={AMENDMENT} from={KEY.amendTypeFrom} to={KEY.amendTypeTo} cursor={!sent} />
              </div>
            </Card>
            {t >= REPLY_AT[0] && (
              <Card style={{ padding: '26px 30px', opacity: ramp(t, REPLY_AT[0], REPLY_AT[0] + 0.3) }}>
                <div style={{ fontSize: 26, color: C.accent, marginBottom: 10, fontWeight: 700 }}>Lead</div>
                <div style={{ fontSize: 34, lineHeight: 1.5 }}>
                  <Typed text={REPLY} from={REPLY_AT[0]} to={REPLY_AT[1]} cursor={false} />
                </div>
              </Card>
            )}
            <BackendTicker />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 44, fontWeight: 800, marginBottom: 18 }}>任務看板</div>
            <TaskTableHead compact />
            {TASKS.map(k => (
              <TaskRow key={k.id} id={k.id} height={100} compact highlight={k.id === 'T6' ? [TASK_TIMES.T6.created, TASK_TIMES.T6.created + 2.4] : k.id === 'T5' ? [48.2, 50.6] : undefined} />
            ))}
          </div>
        </div>
      </Content>
    </div>
  )
}

function BackendTicker() {
  const t = useT()
  if (t < TASK_TIMES.T6.start) return null
  const done = t >= TASK_TIMES.T6.done
  const a = AGENTS.backend
  return (
    <Card style={{ padding: '20px 28px', border: `3px solid ${a.color}`, opacity: ramp(t, TASK_TIMES.T6.start, TASK_TIMES.T6.start + 0.4) }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: a.color }}>
        {a.name} · {a.role}
      </div>
      <div style={{ fontSize: 30, marginTop: 6 }}>{done ? '✓ 疊加規則測試通過' : '▸ 檢查優惠碼是否與其他折扣重複'}</div>
    </Card>
  )
}
