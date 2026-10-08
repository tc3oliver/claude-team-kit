import { mock } from 'claude-code/testing'
import type { AgentInfo, AgentSpawnInput, On } from 'claude-code'

// Shared stand-in for the engine beneath the plugin.

export type World = {
  agents: AgentInfo[]
  peak: number
  started: number
  spawnCalls: number
  /** Models the engine saw on each spawn, in order (after the plugin's routing). */
  models: (string | undefined)[]
  /** Files the plugin wrote through $.fs.write, by path. */
  files: Map<string, string>
  registeredTools: string[]
  registeredCommands: string[]
  usage: Record<string, unknown>
  /** While true, $.fs.write rejects. */
  failWrites: boolean
  /** Teammates the roster does not list yet: id -> list calls left before it appears. */
  lag: Map<string, number>
}

const ENGINE = { plugin: 'engine', tier: 'core' } as const

export const spawnInput = (i: number, teammate = true, extra: Partial<AgentSpawnInput> = {}): AgentSpawnInput => ({
  tool_use_id: `toolu_${i}`,
  prompt: `work item ${i}`,
  description: `worker ${i}`,
  subagentType: teammate ? 'teammate' : 'general-purpose',
  provider: ENGINE as never,
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
  name: `worker-${i}`,
  ...(teammate ? { isTeammate: true as const } : {}),
  ...extra,
})

export const live = (w: World) =>
  w.agents.filter(a => a.teammateId && !['completed', 'failed', 'killed'].includes(a.status)).length

export const fresh = (): World => ({
  agents: [],
  peak: 0,
  started: 0,
  spawnCalls: 0,
  models: [],
  files: new Map(),
  registeredTools: [],
  registeredCommands: [],
  usage: { startedAt: 0, context: { window: 200000 }, rateLimits: [] },
  failWrites: false,
  lag: new Map(),
})

export type EngineOptions = {
  listFails?: boolean
  lateReturn?: number
  /** Answer spawns without agentId / teammateId (an accepted-looking but unstarted spawn). */
  noIds?: boolean
  /** Model the engine reports for each started worker. */
  modelOf?: (e: AgentSpawnInput) => string
  writeFails?: boolean
  /** Roster list calls before a new teammate shows up in agent.list (Infinity: never). */
  rosterLag?: number
}

// agent.list answers the roster; agent.spawn yields `delay` microtasks (simulating
// startup) before the teammate appears in the roster. Returns the mocked clock.
export const engine = (on: On, w: World, delay: (i: number) => number = () => 3, opts: EngineOptions = {}) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
  on('classic.TaskCreated', () => ({}))
  on('classic.TaskCompleted', () => ({}))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.id', () => ({ value: 'sess/1' }) as never)
  on('agent.list', () => {
    if (opts.listFails) throw new Error('roster unavailable')
    const seen = w.agents.filter(a => {
      const left = a.teammateId === undefined ? undefined : w.lag.get(a.teammateId)
      if (left === undefined) return true
      if (left <= 0) return true
      w.lag.set(a.teammateId as string, left - 1)
      return false
    })
    return { value: seen.map(a => ({ ...a })) } as never
  })
  on('session.usage', () => ({ value: w.usage }) as never)
  on('tool.register', (_$, e) => (w.registeredTools.push(e.name), { value: { tool: `mcp__ctk__${e.name}` } }) as never)
  on('command.register', (_$, e) => (w.registeredCommands.push(e.name), { value: { command: e.name } }) as never)
  on('fs.read', (_$, e) => {
    const text = w.files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('fs.write', (_$, e) => {
    if (opts.writeFails || w.failWrites) throw new Error('disk full')
    w.files.set(e.path, e.text)
    return { value: undefined } as never
  })
  on('agent.spawn', async (_$, e) => {
    w.spawnCalls += 1
    w.models.push(e.model)
    const n = w.spawnCalls
    for (let k = 0; k < delay(n); k++) await Promise.resolve()
    const id = `a${n}`
    const teammateId = e.isTeammate ? `${e.name}@session-test` : undefined
    w.agents.push({ id, teammateId, description: e.description, type: e.subagentType, status: 'running' })
    if (teammateId !== undefined && opts.rosterLag !== undefined) w.lag.set(teammateId, opts.rosterLag)
    if (e.isTeammate) {
      w.started += 1
      w.peak = Math.max(w.peak, live(w))
    }
    // The roster already shows the teammate while the spawn has not returned.
    for (let k = 0; k < (opts.lateReturn ?? 0); k++) await Promise.resolve()
    const model = opts.modelOf?.(e) ?? e.model ?? 'sonnet'
    return opts.noIds ? { model } : { model, agentId: id, teammateId }
  })
  return clock
}
