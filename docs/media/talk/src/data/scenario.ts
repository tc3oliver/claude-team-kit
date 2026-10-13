// Everything the video says and shows, as data. No timing here (see timeline.ts) and no layout (see scenes/).

export type AgentId = 'backend' | 'frontend' | 'testing'
export type TaskId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6'

export const PROMPT =
  '幫我在購物網站加入優惠碼功能。需要前端輸入框、後端折扣驗證、錯誤處理和自動化測試。請分配給 3 個 Agent 協作完成，測試通過後再交付。'

export const AMENDMENT = '補充一下，優惠碼不能與其他折扣重複使用，請一起驗證。'

export const AGENTS: Record<AgentId, { name: string; role: string; color: string }> = {
  backend: { name: 'Worker 1', role: 'Backend', color: '#5eead4' },
  frontend: { name: 'Worker 2', role: 'Frontend', color: '#93c5fd' },
  testing: { name: 'Worker 3', role: 'Testing', color: '#fcd34d' },
}

export interface Task {
  id: TaskId
  title: string
  agent: AgentId
  deps: TaskId[]
}

export const TASKS: Task[] = [
  { id: 'T1', title: '後端優惠碼驗證', agent: 'backend', deps: [] },
  { id: 'T2', title: '前端優惠碼介面', agent: 'frontend', deps: [] },
  { id: 'T3', title: '測試案例設計', agent: 'testing', deps: [] },
  { id: 'T4', title: '前後端整合', agent: 'frontend', deps: ['T1', 'T2'] },
  { id: 'T5', title: '整合測試與驗收', agent: 'testing', deps: ['T3', 'T4', 'T6'] },
  { id: 'T6', title: '折扣不可疊加驗證', agent: 'backend', deps: ['T1'] },
]

export const taskById = (id: TaskId): Task => TASKS.find(t => t.id === id)!

export const LEAD_PLAN = [
  '需求：優惠碼 = 前端 + 後端 + 測試',
  '拆成 5 個任務，標出先後順序',
  '三個 Worker 同時開工',
]

/** What each worker shows while it works; `t` is when the line appears, in seconds. */
export const BACKEND_CODE: { t: number; text: string }[] = [
  { t: 19.2, text: 'function apply(code, total) {' },
  { t: 20.4, text: '+ const c = COUPONS[code]' },
  { t: 21.4, text: "+ if (!c) return bad('無效')" },
  { t: 22.8, text: '+ if (c.expires < now())' },
  { t: 23.6, text: "+   return bad('已過期')" },
  { t: 25.2, text: '+ if (c.used >= c.limit)' },
  { t: 26.0, text: "+   return bad('已用完')" },
  { t: 27.6, text: '+ const off = Math.floor(' },
  { t: 28.4, text: '+   total * c.rate)' },
  { t: 29.6, text: '+ return ok(off)' },
]

export const BACKEND_LOG: { t: number; text: string }[] = [
  { t: 18.6, text: '讀取 src/checkout.js' },
  { t: 20.0, text: '新增 src/coupons.js' },
  { t: 24.4, text: '加入過期與次數檢查' },
  { t: 28.0, text: '計算折扣金額' },
  { t: 30.4, text: '自測 4 個情境' },
]

export const FRONTEND_LOG: { t: number; text: string }[] = [
  { t: 18.9, text: '讀取 public/checkout.js' },
  { t: 20.6, text: '加入優惠碼輸入框' },
  { t: 24.0, text: '顯示折扣與錯誤訊息' },
  { t: 28.2, text: '預覽結帳頁' },
]

export const TESTING_LOG: { t: number; text: string }[] = [
  { t: 19.2, text: '讀取 src/checkout.js' },
  { t: 20.2, text: '建立 test/coupons.test.js' },
  { t: 26.8, text: '補上邊界案例' },
]

export const TEST_CASES: { t: number; name: string }[] = [
  { t: 21.0, name: '有效優惠碼' },
  { t: 23.6, name: '過期優惠碼' },
  { t: 26.2, name: '超過使用次數' },
  { t: 28.8, name: '無效輸入' },
]

export const SUITES = [
  { id: 'unit', name: 'Unit Tests', total: 12 },
  { id: 'integration', name: 'Integration Tests', total: 6 },
  { id: 'e2e', name: 'E2E Tests', total: 3 },
] as const

export const SUMMARY = ['優惠碼功能完成', '前後端整合完成', '測試通過 21 / 21', '等待人類最終驗收']

/** Frontend preview: the checkout page the worker is building. */
export const CART = { subtotal: 1180, code: 'SAVE10', off: 118 }
