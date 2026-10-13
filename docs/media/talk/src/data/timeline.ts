// The story as a timeline. Every frame is a pure function of time, so a render is repeatable.
// All times are seconds from the start of the video.
import type { AgentId, TaskId } from './scenario.ts'
import { SUITES, TASKS, taskById } from './scenario.ts'

export type TaskStatus = 'hidden' | 'blocked' | 'ready' | 'running' | 'done'

interface TaskTimes {
  created: number
  start: number
  done: number
}

export const TASK_TIMES: Record<TaskId, TaskTimes> = {
  T1: { created: 8.6, start: 18.3, done: 33.0 },
  T2: { created: 9.8, start: 18.6, done: 36.0 },
  T3: { created: 11.0, start: 18.9, done: 38.5 },
  T4: { created: 12.2, start: 37.0, done: 51.0 },
  T5: { created: 13.4, start: 53.5, done: 65.0 },
  T6: { created: 48.0, start: 49.0, done: 52.0 },
}

/** Task 5 only learns about Task 6 when the human adds the amendment. */
const T5_GAINS_T6 = 48.2

export const KEY = {
  promptTypeFrom: 0.8,
  promptTypeTo: 5.2,
  enter: 5.8,
  headline: [6.4, 8.2],
  spawn: { backend: 15.0, frontend: 15.8, testing: 16.6 } as Record<AgentId, number>,
  amendTypeFrom: 43.8,
  amendTypeTo: 47.0,
  amendEnter: 47.4,
}

export function depsAt(id: TaskId, t: number): TaskId[] {
  const deps = taskById(id).deps
  return id === 'T5' && t < T5_GAINS_T6 ? deps.filter(d => d !== 'T6') : deps
}

export function taskStatus(id: TaskId, t: number): TaskStatus {
  const tt = TASK_TIMES[id]
  if (t < tt.created) return 'hidden'
  if (t >= tt.done) return 'done'
  if (t >= tt.start) return 'running'
  return depsAt(id, t).every(d => t >= TASK_TIMES[d].done) ? 'ready' : 'blocked'
}

export const taskProgress = (id: TaskId, t: number) => {
  const { start, done } = TASK_TIMES[id]
  return Math.min(1, Math.max(0, (t - start) / (done - start)))
}

export const visibleTasks = (t: number) => TASKS.filter(task => taskStatus(task.id, t) !== 'hidden')

export const doneCount = (t: number) => TASKS.filter(task => taskStatus(task.id, t) === 'done').length

export type AgentState = 'absent' | 'idle' | 'working' | 'handoff'

export function agentState(agent: AgentId, t: number): { state: AgentState; task?: TaskId } {
  if (t < KEY.spawn[agent]) return { state: 'absent' }
  const running = TASKS.find(task => task.agent === agent && taskStatus(task.id, t) === 'running')
  return running ? { state: 'working', task: running.id } : { state: 'idle' }
}

export const busyCount = (t: number) => (['backend', 'frontend', 'testing'] as AgentId[]).filter(a => agentState(a, t).state === 'working').length

export function leadStatus(t: number): string {
  if (t < KEY.enter) return '等待需求'
  if (t < 8.6) return '分析需求'
  if (t < 17) return '拆解任務'
  if (t < 32) return '協調 3 個 Worker'
  if (t < 43) return '接收回報'
  if (t < KEY.amendEnter) return '等待人類補充'
  if (t < 53) return '更新計畫'
  if (t < 65.5) return '驗收中'
  return '等待人類驗收'
}

export interface FeedItem {
  t: number
  from: string
  text: string
}

/** Reports the lead receives; the bottom feed in the dependency scene and the lead panels read this. */
export const FEED: FeedItem[] = [
  { t: 33.2, from: 'Backend → Lead', text: '優惠碼驗證完成' },
  { t: 36.2, from: 'Frontend → Lead', text: '結帳介面完成' },
  { t: 36.8, from: 'Lead', text: '前置條件滿足，啟動 Task 4' },
  { t: 38.8, from: 'Testing → Lead', text: '4 個測試案例就緒' },
  { t: 48.4, from: 'Lead → Backend', text: '新增：折扣不可疊加驗證' },
  { t: 52.2, from: 'Backend → Lead', text: '疊加規則驗證完成' },
]

export interface Toast {
  t: number
  until: number
  text: string
  tone: 'ok' | 'info'
}

export const TOASTS: Toast[] = [
  { t: 33.0, until: 35.6, text: 'Backend validation completed', tone: 'ok' },
  { t: 36.0, until: 38.2, text: 'Frontend 完成 · Task 4 解鎖：Ready → Running', tone: 'info' },
  { t: 38.5, until: 40.6, text: 'Testing：測試案例完成', tone: 'ok' },
  { t: 52.0, until: 54.0, text: '折扣不可疊加：驗證完成', tone: 'ok' },
]

export const activeToast = (t: number) => TOASTS.find(x => t >= x.t && t < x.until)

export const feedUpTo = (t: number) => FEED.filter(f => t >= f.t)

/** Test suites run one after another once Task 5 starts. */
export const SUITE_TIMES: Record<(typeof SUITES)[number]['id'], { from: number; to: number }> = {
  unit: { from: 54.4, to: 58.0 },
  integration: { from: 58.4, to: 61.8 },
  e2e: { from: 62.2, to: 64.8 },
}

export function suiteState(id: keyof typeof SUITE_TIMES, t: number) {
  const { from, to } = SUITE_TIMES[id]
  const total = SUITES.find(s => s.id === id)!.total
  if (t < from) return { status: 'waiting' as const, passed: 0, total }
  if (t >= to) return { status: 'passed' as const, passed: total, total }
  return { status: 'running' as const, passed: Math.floor(((t - from) / (to - from)) * total), total }
}

export const SUMMARY_FROM = 65.6
export const ZOOM_OUT_FROM = 67.0

/** The checkout preview the frontend worker builds (scene 3, middle column). */
export const PREVIEW = {
  inputAt: 20.6,
  typeFrom: 22.0,
  typeTo: 23.6,
  applyAt: 24.4,
  badTypeFrom: 27.0,
  badTypeTo: 28.2,
  badApplyAt: 28.9,
}
