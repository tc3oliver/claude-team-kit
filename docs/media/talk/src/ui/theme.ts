import type { TaskStatus } from '../data/timeline.ts'

export const C = {
  bg: '#0b1020',
  bg2: '#111833',
  panel: '#151d3b',
  panelHi: '#1c2750',
  line: '#2a3763',
  text: '#eef2ff',
  dim: '#9fb0d9',
  accent: '#7c9cff',
  ok: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
  code: '#0a0f1f',
}

export const FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif'
export const MONO = '"SF Mono","JetBrains Mono",Menlo,"PingFang TC",monospace'

export const STATUS: Record<Exclude<TaskStatus, 'hidden'>, { label: string; color: string }> = {
  blocked: { label: '等待前置任務', color: C.dim },
  ready: { label: 'Ready', color: C.warn },
  running: { label: 'Running', color: C.accent },
  done: { label: 'Completed', color: C.ok },
}
