import type { EngineInterface } from 'claude-code'

import { DASH, truncateToWidth } from '../shared/hudline.ts'
import { modelLabel } from './band.ts'
import {
  BACK_KEY,
  CLOSE_KEY,
  cancelKey,
  confirmKey,
  HUD_MODES,
  MC_VIEWS,
  REFRESH_KEY,
  UNAVAILABLE,
  fmtAge,
  fmtSpan,
  hudKey,
  taskKey,
  viewKey,
  workerKey,
} from './mission.ts'
import type { HudMode, Mission, McState, TaskRow, WorkerRow } from './mission.ts'

// Mission Control's body: a read-only view of what CTK observed. Every button here only changes
// what the pane shows (see pressMc) except Confirm/Cancel on a pending option change, which is
// handled by register.tsx and exists only while a change is waiting for the person's yes.
// A figure that was not observed reads "unavailable".

export type Kit = ReturnType<EngineInterface['ui']['resolve']>

export type OptionRow = { label: string; value: string }

export type Pending = { id: string; text: string }

export type Extras = {
  statsText: string
  options: OptionRow[]
  pending: Pending | null
  /** The outcome of the last confirmed or cancelled change; null when there is none. */
  notice: string | null
}

const noop = () => {}

const num = (v: number | null): string => (v === null ? UNAVAILABLE : String(v))

const pad = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))

/** Below this many cells of room the tables use their compact form. */
const TABLE_ROOM = 62

const modeLabel = (m: HudMode): string => m[0]?.toUpperCase() + m.slice(1)

export const renderMission = (kit: Kit, m: Mission, mc: McState, extras: Extras, props: { bodyColumns: number }) => {
  const { Box, Text, Button } = kit
  // The pane's body is narrow (about 70 cells docked on a 150-column terminal) and a Text inside a Button
  // wraps instead of truncating, so every line is cut to the width it was given.
  const room = Math.max(10, props.bodyColumns - 1)
  const clip = (t: string, width = room): string => truncateToWidth(t, width)

  const line = (key: string, text: string, opts: { dim?: boolean; color?: 'success' | 'error' | 'warning' | 'subtle'; bold?: boolean } = {}) => (
    <Text key={key} wrap="truncate-end" dimColor={opts.dim} color={opts.color} bold={opts.bold}>
      {clip(text)}
    </Text>
  )
  const field = (key: string, label: string, value: string, color?: 'success' | 'error' | 'warning', labelWidth = 13) => (
    <Text key={key} wrap="truncate-end">
      <Text dimColor>{pad(label, labelWidth)}</Text>
      <Text color={color}>{clip(value, room - labelWidth)}</Text>
    </Text>
  )
  const button = (key: string, label: string, hotkey?: string) => (
    <Button key={key} label={label} {...(hotkey === undefined ? {} : { hotkey })} onPress={noop} />
  )
  const link = (key: string, text: string, label: string) => (
    <Button key={key} plain label={label} onPress={noop}>
      <Text wrap="truncate-end">{clip(text)}</Text>
    </Button>
  )
  const guardColor = m.guard.state === 'active' ? 'success' : m.guard.state === 'error' ? 'error' : 'warning'

  const tabs = (
    <Box key="tabs" flexDirection="row" flexWrap="wrap" columnGap={2}>
      {MC_VIEWS.map(v => (
        <Button key={viewKey(v.view)} plain hotkey={v.hotkey} label={v.label} onPress={noop}>
          <Text bold={mc.view === v.view} underline={mc.view === v.view}>
            {v.label}
          </Text>
        </Button>
      ))}
    </Box>
  )

  const hudButtons = (
    <Box key="hud" flexDirection="row" columnGap={2}>
      <Text dimColor>HUD form (this session)</Text>
      {HUD_MODES.map(mode => (
        <Button key={hudKey(mode)} plain label={`HUD form ${mode}`} onPress={noop}>
          <Text bold={mc.hudMode === mode} underline={mc.hudMode === mode}>
            {modeLabel(mode)}
          </Text>
        </Button>
      ))}
    </Box>
  )

  const back = <Box key="back">{button(BACK_KEY, 'Back')}</Box>

  const overview = () => [
    field('guard', 'Guard', `${m.guard.state === 'active' ? 'ON' : m.guard.state} · ${m.guard.why}`, guardColor),
    field('workers', 'Workers', `${num(m.active)}/${m.cap} active · ${num(m.running)} running · ${num(m.idle)} idle · ${num(m.completed)} completed · ${num(m.failed)} failed`),
    field('refused', 'Refused', `${m.rejected} spawn(s) above the cap`),
    field(
      'tasks',
      'Tasks',
      m.tasks.total === null
        ? UNAVAILABLE
        : m.tasks.detailed && !m.tasks.partial
          ? `${num(m.tasks.completed)}/${m.tasks.total} done · ${num(m.tasks.pending)} pending · ${num(m.tasks.inProgress)} in progress · ${num(m.tasks.blocked)} blocked · ${num(m.tasks.ready)} ready`
          : `${num(m.tasks.completed)}/${m.tasks.total} done (counts from task events; ${m.tasks.partial ? 'some tasks were created before CTK loaded' : 'no task call seen since CTK loaded'}, so no detail)`,
    ),
    field('elapsed', 'Team time', m.teamElapsedMs === null ? `${UNAVAILABLE} (no worker started since CTK loaded)` : fmtSpan(m.teamElapsedMs)),
    field('usage', 'Usage', `5h ${m.usage.fiveHour} · week ${m.usage.sevenDay} · context ${m.usage.contextPct} · cost ${m.usage.cost} · ${m.usage.toolCalls} tool calls`),
    hudButtons,
  ]

  // A docked pane is about 50 cells wide: below this the tables drop their least useful column (LAST,
  // DEPENDS wording) and shorten the model id so the columns that matter stay on screen.
  const compact = room < TABLE_ROOM

  const workerLine = (w: WorkerRow) =>
    compact
      ? `${pad(w.name, 11)} ${pad(modelLabel(w.model) ?? UNAVAILABLE, 10)} ${pad(w.status, 7)} ${pad(w.toolCalls === null ? UNAVAILABLE : String(w.toolCalls), 5)} ${w.idleMs === null ? DASH : fmtSpan(w.idleMs)}`
      : `${pad(w.name, 12)} ${pad(w.model ?? UNAVAILABLE, 17)} ${pad(w.status, 8)} ${pad(w.toolCalls === null ? UNAVAILABLE : String(w.toolCalls), 5)} ${pad(fmtAge(w.lastActivityMs), 8)} ${w.idleMs === null ? DASH : fmtSpan(w.idleMs)}`

  const workers = () => {
    const picked = mc.selected?.kind === 'worker' ? m.workers.find(w => w.agentId === mc.selected?.id) : undefined
    if (picked !== undefined) {
      return [
        line('w-name', picked.name, { bold: true }),
        field('w-id', 'Agent id', picked.agentId),
        field('w-model', 'Model', picked.model ?? `${UNAVAILABLE} (the spawn did not report one)`),
        field('w-status', 'Status', picked.status),
        field('w-task', 'Current task', picked.currentTask ?? `${UNAVAILABLE} (no in-progress task owned by this worker was observed)`),
        field('w-tools', 'Tool calls', picked.toolCalls === null ? UNAVAILABLE : `${picked.toolCalls} (its own loop)`),
        field('w-last', 'Last activity', fmtAge(picked.lastActivityMs)),
        field('w-idle', 'Idle for', picked.status === 'idle' ? fmtSpan(picked.idleMs) : 'not idle'),
        back,
      ]
    }
    if (m.workers.length === 0) return [line('w-none', 'No teammate has started this session.', { dim: true })]
    return [
      line(
        'w-head',
        compact
          ? `${pad('NAME', 11)} ${pad('MODEL', 10)} ${pad('STATUS', 7)} ${pad('TOOLS', 5)} IDLE`
          : `${pad('NAME', 12)} ${pad('MODEL', 17)} ${pad('STATUS', 8)} ${pad('TOOLS', 5)} ${pad('LAST', 8)} IDLE`,
        { dim: true },
      ),
      ...m.workers.map(w => link(workerKey(w.agentId), workerLine(w), `Worker ${w.name}`)),
      line('w-hint', 'Select a worker for its details.', { dim: true }),
    ]
  }

  const statusWord = (t: TaskRow): string => (t.status === 'in_progress' ? 'doing' : t.status === 'completed' && compact ? 'done' : t.status)
  const needs = (t: TaskRow): string => (t.blocked ? `needs ${t.openBlockers.map(i => (compact ? i : `#${i}`)).join(',')}` : t.ready ? 'ready' : DASH)

  const taskLine = (t: TaskRow) =>
    compact
      ? `${pad(`#${t.id}`, 3)} ${pad(statusWord(t), 7)} ${pad(t.owner ?? DASH, 9)} ${pad(needs(t), 9)} ${t.subject}`
      : `${pad(`#${t.id}`, 4)} ${pad(statusWord(t), 7)} ${pad(t.owner ?? DASH, 10)} ${pad(needs(t), 11)} ${t.subject}`

  const tasks = () => {
    if (!m.tasks.detailed) {
      return [
        line('t-none', `Task detail ${UNAVAILABLE}: no TaskCreate or TaskUpdate call has been seen since CTK loaded.`, { dim: true }),
        line('t-why', 'Task tools are off by default on current models; set CLAUDE_CODE_ENABLE_TODO_TOOLS=1 to give the lead a shared task list.', { dim: true }),
        ...(m.tasks.total === null ? [] : [field('t-counts', 'From events', `${num(m.tasks.completed)}/${m.tasks.total} done`)]),
      ]
    }
    const picked = mc.selected?.kind === 'task' ? m.tasks.rows.find(t => t.id === mc.selected?.id) : undefined
    if (picked !== undefined) {
      const state = (id: string) => m.tasks.rows.find(t => t.id === id)?.status ?? UNAVAILABLE
      return [
        line('k-name', `#${picked.id} ${picked.subject}`, { bold: true }),
        field('k-status', 'Status', picked.status),
        field('k-owner', 'Owner', picked.owner ?? UNAVAILABLE),
        field('k-ready', 'Ready', picked.ready ? 'yes' : picked.blocked ? 'no, blocked' : picked.status === 'completed' ? 'done' : 'no'),
        field('k-deps', 'Depends on', picked.blockedBy.length === 0 ? 'nothing' : picked.blockedBy.map(i => `#${i} (${state(i)})`).join(', ')),
        field('k-blocks', 'Blocks', picked.blocks.length === 0 ? 'nothing' : picked.blocks.map(i => `#${i}`).join(', ')),
        back,
      ]
    }
    return [
      line('t-head', compact ? `${pad('ID', 3)} ${pad('STATUS', 7)} ${pad('OWNER', 9)} ${pad('NEEDS', 9)} TASK` : `${pad('ID', 4)} ${pad('STATUS', 7)} ${pad('OWNER', 10)} ${pad('DEPENDS', 11)} TASK`, { dim: true }),
      ...m.tasks.rows.map(t => link(taskKey(t.id), taskLine(t), `Task ${t.id}`)),
      ...(m.tasks.partial ? [line('t-partial', 'Some tasks were created before CTK loaded: shown as "unknown", and the totals are unavailable.', { dim: true, color: 'warning' })] : []),
      line('t-hint', 'Built from the TaskCreate and TaskUpdate calls CTK observed; select a task for its dependencies.', { dim: true }),
    ]
  }

  const usage = () => [
    field('u-model', 'Model', m.usage.model ?? UNAVAILABLE),
    field('u-ctx', 'Context', m.usage.contextPct),
    field('u-5h', '5h usage', m.usage.fiveHour),
    field('u-7d', 'Weekly usage', m.usage.sevenDay),
    field('u-cost', 'Session cost', m.usage.cost),
    field('u-tools', 'Tool calls', `${m.usage.toolCalls} (lead, subagents and teammates)`),
    line('u-note', 'Reported by Claude Code; a plan without rate limits shows them as unavailable. Per-worker cost is not reported.', { dim: true }),
  ]

  const config = () => [
    field('c-guard', 'Guard', `${m.guard.state === 'active' ? 'ON' : m.guard.state} · ${m.guard.why}`, guardColor, 26),
    ...extras.options.map((o, i) => field(`c-o${i}`, o.label, o.value, undefined, 26)),
    hudButtons,
    ...(extras.notice === null ? [] : [line('c-notice', extras.notice, { color: extras.notice.startsWith('Applied') ? 'success' : 'warning' })]),
    ...(extras.pending === null
      ? [line('c-how', 'Nothing changes without your confirmation here. To change an option, ask in plain words ("set the worker cap to 2") or use /plugin configure ctk@ctk-kit.', { dim: true })]
      : [
          line('c-pending', `Waiting for you: ${extras.pending.text}`, { bold: true, color: 'warning' }),
          <Box key="c-confirm" flexDirection="row" columnGap={2}>
            {button(confirmKey(extras.pending.id), 'Confirm')}
            {button(cancelKey(extras.pending.id), 'Cancel')}
          </Box>,
        ]),
  ]

  const stats = () => extras.statsText.split('\n').map((t, i) => line(`s-${i}`, t, { dim: i === 0 }))

  const doctor = () =>
    mc.doctorText === null
      ? [line('d-wait', 'Reading…', { dim: true })]
      : mc.doctorText.split('\n').map((t, i) => line(`d-${i}`, t, { dim: i === 0 }))

  const body = { overview, workers, tasks, usage, config, stats, doctor }[mc.view]()

  return (
    <Box flexDirection="column" width={props.bodyColumns}>
      <Box flexDirection="row" columnGap={2}>
        <Text bold>CTK Mission Control</Text>
        <Text color={guardColor}>Guard {m.guard.state === 'active' ? 'ON' : m.guard.label}</Text>
        <Text dimColor>read-only</Text>
      </Box>
      {tabs}
      <Box key="body" flexDirection="column" marginTop={1}>
        {body}
      </Box>
      <Box key="foot" flexDirection="row" columnGap={2} marginTop={1}>
        {button(REFRESH_KEY, 'Refresh')}
        {button(CLOSE_KEY, 'Close')}
        <Text dimColor>Tab moves · digits switch views · Esc returns to the prompt</Text>
      </Box>
    </Box>
  )
}
