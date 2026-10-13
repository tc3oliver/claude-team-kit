import type { CSSProperties } from 'react'
import { AGENTS, taskById, type TaskId } from '../data/scenario.ts'
import { KEY, depsAt, taskProgress, taskStatus, TASK_TIMES, type TaskStatus } from '../data/timeline.ts'
import { AgentChip, Bar, Card, Pill, StatusBadge, ramp, useT } from './kit.tsx'
import { C } from './theme.ts'

const visible = (s: TaskStatus): s is Exclude<TaskStatus, 'hidden'> => s !== 'hidden'

/** A task as one table row (scene 2 and scene 5). */
const GRID = (compact: boolean) => (compact ? '70px 1fr 170px 230px' : '90px 1fr 330px 260px')

export function TaskRow({ id, height = 108, highlight, compact = false }: { id: TaskId; height?: number; highlight?: [number, number]; compact?: boolean }) {
  const t = useT()
  const task = taskById(id)
  const status = taskStatus(id, t)
  if (!visible(status)) return null
  const born = ramp(t, TASK_TIMES[id].created, TASK_TIMES[id].created + 0.45)
  const assigned = t >= KEY.spawn[task.agent]
  const deps = depsAt(id, t)
  const flash = highlight && t >= highlight[0] && t < highlight[1] ? 1 : 0
  return (
    <div style={{ height, display: 'grid', gridTemplateColumns: GRID(compact), alignItems: 'center', gap: 20, padding: '0 28px', borderRadius: 20, marginBottom: 12, background: flash ? C.panelHi : C.panel, border: `2px solid ${flash ? C.warn : C.line}`, opacity: born, transform: `translateX(${(1 - born) * 60}px)` }}>
      <div style={{ fontSize: 34, fontWeight: 800, color: C.accent }}>{id}</div>
      <div>
        <div style={{ fontSize: 34, fontWeight: 700 }}>{task.title}</div>
        <div style={{ fontSize: 26, color: C.dim }}>{deps.length ? `依賴 ${deps.join('、')}` : '可立即開始'}</div>
      </div>
      <div>{assigned ? (compact ? <Pill color={AGENTS[task.agent].color}>{AGENTS[task.agent].role}</Pill> : <AgentChip agent={task.agent} />) : <Pill color={C.dim}>尚未分派</Pill>}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <StatusBadge status={status} />
      </div>
    </div>
  )
}

export const TABLE_HEAD: CSSProperties = { display: 'grid', gridTemplateColumns: GRID(false), gap: 20, padding: '0 28px 14px', fontSize: 26, color: C.dim, fontWeight: 600 }

export function TaskTableHead({ compact = false }: { compact?: boolean }) {
  return (
    <div style={{ ...TABLE_HEAD, gridTemplateColumns: GRID(compact) }}>
      <div>Task</div>
      <div>名稱 / 依賴</div>
      <div>{compact ? 'Agent' : 'Assigned Agent'}</div>
      <div style={{ textAlign: 'right' }}>Status</div>
    </div>
  )
}

/** A task as a graph node (scene 4). */
export function TaskNode({ id, w = 540, h = 150 }: { id: TaskId; w?: number; h?: number }) {
  const t = useT()
  const task = taskById(id)
  const status = taskStatus(id, t)
  if (!visible(status)) return null
  const color = status === 'done' ? C.ok : status === 'running' ? C.accent : status === 'ready' ? C.warn : C.line
  const readyAt = Math.max(0, ...task.deps.map(d => TASK_TIMES[d].done))
  const pulse = task.deps.length && t >= readyAt && t < readyAt + 1.2 ? 1 - (t - readyAt) / 1.2 : 0
  return (
    <Card style={{ width: w, height: h, padding: '18px 26px', boxSizing: 'border-box', border: `3px solid ${color}`, boxShadow: pulse ? `0 0 ${60 * pulse}px ${C.warn}` : undefined, opacity: status === 'blocked' ? 0.75 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <span style={{ fontSize: 36, fontWeight: 800, color: C.accent }}>{id}</span>
        <span style={{ fontSize: 34, fontWeight: 700 }}>{task.title}</span>
      </div>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 26, color: AGENTS[task.agent].color, fontWeight: 600 }}>{AGENTS[task.agent].role}</span>
        <StatusBadge status={status} />
      </div>
      {status === 'running' && (
        <div style={{ marginTop: 14 }}>
          <Bar value={taskProgress(id, t)} color={C.accent} />
        </div>
      )}
    </Card>
  )
}
