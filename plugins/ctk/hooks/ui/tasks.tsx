import { UNAVAILABLE } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import type { Extras, Kit } from './types.ts'

const num = (v: number | null): string => (v === null ? UNAVAILABLE : String(v))

export const renderTasks = (_kit: Kit, m: Mission, _mc: McState, _extras: Extras, ctx: Ctx) => {
  const { line, field, para } = ctx

  if (!m.tasks.detailed) {
    return [
      ...para('t-none', m.empty.tasks ?? `Task detail ${UNAVAILABLE}: no TaskCreate or TaskUpdate call has been seen since CTK loaded.`),
      ...(m.tasks.total === null ? [] : [field('t-counts', 'From events', `${num(m.tasks.completed)}/${m.tasks.total} done`)]),
    ]
  }
  // One line, however many tasks: a long list would push the prompt off screen. The counts are the
  // overview's; the per-task rows are not drawn.
  const t = m.tasks
  return [
    field('t-sum', 'Tasks', t.partial ? `${num(t.completed)}/${num(t.total)} done` : `${num(t.completed)}/${num(t.total)} done · ${num(t.pending)} pending · ${num(t.inProgress)} in progress · ${num(t.blocked)} blocked · ${num(t.ready)} ready`),
    ...(t.partial ? [line('t-partial', 'Some tasks were created before CTK loaded, so the detail counts are unavailable.', { dim: true, color: 'warning' })] : []),
  ]
}
