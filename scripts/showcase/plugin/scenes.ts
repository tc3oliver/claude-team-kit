import { formatSummary } from './band.ts'
import { describeOptions } from './config.ts'
import { formatDoctor } from './doctor.ts'
import { readOptions } from '../shared/policy.ts'
import { emptyStats } from '../shared/stats.ts'
import { emptySnapshot } from './team.ts'
import { buildMission, newMcState, newMissionState } from './mission.ts'

export const LABEL = 'SYNTHETIC DATA - UI showcase, not a live agent run'

// A fixed clock keeps every render identical; nothing here is read from a session.
const NOW = 10_000_000
const MIN = 60_000

const W = (name: string, status: string) => ({ name, teammateId: `${name}@team`, agentId: `a-${name}`, status })

type TaskSeed = [id: string, subject: string, status: string, owner: string | null, blockedBy: string[]]

const TASKS: TaskSeed[] = [
  ['1', 'Map the session API surface', 'completed', 'scout', []],
  ['2', 'Design the status glyph set', 'completed', 'scout', []],
  ['3', 'Write the Workers table', 'pending', null, ['1', '2']],
  ['4', 'Verify widths 60 to 200 in a real terminal', 'pending', null, ['3']],
  ['5', 'Split the pane into view modules', 'in_progress', 'builder', []],
  ['6', 'Task board with the ready frontier', 'pending', null, ['5']],
  ['7', 'Cross-check the pane at five widths', 'in_progress', 'frontend-integration-tester', []],
  ['8', 'Read the host layout notes', 'completed', 'scout', []],
  ['9', 'Draft the layout budget', 'completed', 'scout', ['8']],
  ['10', 'Reconcile the pane row budget with the host allowance at every supported terminal width and theme', 'pending', null, ['9']],
]

// More tasks than the graph can draw, in a chain and fan mix: the list fallback and its hint show.
const MANY: TaskSeed[] = [
  ['1', 'Inventory the views', 'completed', 'scout', []],
  ['2', 'Pick the glyph set', 'completed', 'scout', ['1']],
  ['3', 'Draft the header', 'completed', 'designer', ['2']],
  ['4', 'Build the slot meter', 'in_progress', 'builder', ['3']],
  ['5', 'Build the metric cards', 'pending', null, ['4']],
  ['6', 'Choose tab tiers', 'completed', 'designer', []],
  ['7', 'Tabs at 60 columns', 'pending', null, ['6']],
  ['8', 'Tabs at 80 columns', 'pending', null, ['6']],
  ['9', 'Tabs at 100 columns', 'pending', null, ['6']],
  ['10', 'Tabs docked', 'in_progress', 'builder-2', ['6']],
  ['11', 'Row budget', 'completed', 'scout', []],
  ['12', 'Hide rows by priority', 'pending', null, ['11']],
  ['13', 'Hint for hidden rows', 'pending', null, ['12']],
  ['14', 'Verify in a real terminal', 'pending', null, ['5', '13']],
]

const board = (seeds: TaskSeed[] = TASKS) => {
  const s = newMissionState()
  s.taskCallsSeen = true
  s.teamStartedAt = NOW - 14 * MIN
  for (const [id, subject, status, owner, blockedBy] of seeds) {
    s.tasks.set(id, { id, subject, status: status as never, owner, blockedBy, blocks: [] })
  }
  return s
}

const team = (s: ReturnType<typeof newMissionState>, rows: [string, string, string | null, number, number][]) => {
  for (const [name, status, model, calls, ago] of rows) {
    s.workers.set(`a-${name}`, { agentId: `a-${name}`, name, model, toolCalls: calls, recent: [], lastActivityAt: NOW - ago * 1000, idleSinceAt: status === 'idle' ? NOW - ago * 1000 : null, startedAt: NOW - 12 * MIN })
  }
}

const ROSTER: [string, string, string | null, number, number][] = [
  ['scout', 'completed', 'claude-haiku-5-5', 31, 380],
  ['builder', 'running', 'claude-sonnet-5-5', 64, 6],
  ['frontend-integration-tester', 'running', 'claude-sonnet-5-5', 42, 11],
  ['reviewer', 'idle', 'claude-opus-5-5', 9, 95],
]

// Eight workers, for the activity bars and the one-line fallback of the Workers view.
const BIG: [string, string, string | null, number, number][] = [
  ['scout', 'completed', 'claude-haiku-5-5', 31, 380],
  ['designer', 'completed', 'claude-sonnet-5-5', 18, 250],
  ['builder', 'running', 'claude-sonnet-5-5', 64, 6],
  ['builder-2', 'running', 'claude-sonnet-5-5', 52, 9],
  ['frontend-integration-tester', 'running', 'claude-sonnet-5-5', 42, 11],
  ['docs', 'running', 'claude-haiku-5-5', 7, 30],
  ['reviewer', 'idle', 'claude-opus-5-5', 9, 95],
  ['verifier', 'waiting', 'claude-sonnet-5-5', 0, 2],
]

const measured = {
  costUsd: 3.42,
  contextPct: 47,
  fiveHourPct: 38,
  sevenDayPct: 12,
  fiveHourResetsAt: new Date(NOW + 154 * MIN).toISOString(),
  sevenDayResetsAt: new Date(NOW + 4 * 24 * 60 * MIN).toISOString(),
  model: 'claude-fable-5-1',
}

export const buildScene = (name: string) => {
  const stats = emptyStats('showcase', 5, NOW - 14 * MIN)
  // A roster that was read and holds no teammate; emptySnapshot() would mean the roster could not be read.
  let snap = { ...emptySnapshot(), busy: 0, idle: 0, done: 0, failed: 0, live: 0 }
  let state = newMissionState()
  const mc = newMcState()
  if (name !== 'empty') {
    stats.spawnsSeen = 5
    stats.spawnsAccepted = 5
    stats.peakLive = 3
    stats.toolCalls = 164
    const roster = name === 'workers' ? BIG : ROSTER
    if (name === 'workers') stats.maxWorkers = 10
    const seeds = name === 'many' ? MANY : TASKS
    stats.tasks = { created: seeds.length, completed: seeds.filter(t => t[2] === 'completed').length }
    stats.measured = measured
    state = board(seeds)
    team(state, roster)
    const busyN = roster.filter(r => r[1] === 'running' || r[1] === 'waiting').length
    const doneN = roster.filter(r => r[1] === 'completed').length
    snap = {
      busy: busyN,
      idle: roster.filter(r => r[1] === 'idle').length,
      done: doneN,
      failed: 0,
      live: roster.length - doneN,
      workers: roster.map(([n, s]) => W(n, s)),
      subagents: [
        { agentId: 'sa1', type: 'Explore', description: 'Find where Pane props are typed', status: 'completed' },
        { agentId: 'sa2', type: 'general-purpose', description: 'Check the glyph widths in three terminals', status: 'running' },
      ],
      elapsedMs: 14 * MIN,
    }
  }
  if (name === 'workers') mc.view = 'workers'
  if (name === 'dag' || name === 'many') mc.view = 'tasks'
  if (name === 'usage') mc.view = 'usage'
  if (name === 'config' || name === 'stats' || name === 'doctor') mc.view = name
  if (name === 'guard') {
    // Five live teammates at a cap of five, and two spawns already refused.
    stats.spawnsSeen = 7
    stats.spawnsAccepted = 5
    stats.spawnsRejected = 2
    stats.peakLive = 5
    const full: [string, string, string | null, number, number][] = ['w1', 'w2', 'w3', 'w4', 'w5'].map((n, i) => [n, i === 4 ? 'idle' : 'running', 'claude-sonnet-5-5', 20 + i, 5 + i])
    state = board()
    state.workers.clear()
    team(state, full)
    snap = { ...snap, busy: 4, idle: 1, done: 0, failed: 0, live: 5, workers: full.map(([n, s]) => W(n, s)), subagents: [] }
  }
  const mission = buildMission({ stats, snap, state, nowMs: NOW, teamsEnabled: true, ready: true })
  const options = describeOptions(readOptions({})).map(r => ({ label: r.label, value: r.shown }))
  const pending = name === 'config' ? { id: 'c1', text: 'Max live teammates (maxWorkers): 5 -> 6' } : null
  if (name === 'doctor') {
    mc.doctorText = formatDoctor({
      maxWorkers: 5,
      capFromSettings: false,
      teamsEnabled: true,
      taskTools: true,
      toolListRead: true,
      statusLine: true,
      ctkStatusLine: true,
      hudBand: true,
      recordStats: true,
      teamHint: true,
      guard: { state: 'available', why: mission.guard.why },
      outsideCap: 0,
    })
  }
  const statsText = formatSummary(stats, snap, NOW)
  return { mission, mc, extras: { statsText, options, pending, notice: null } }
}
