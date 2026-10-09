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
  /** What $.session.model answers; null makes it reject. */
  model: string | null
  /** Every $.ui.open argument, in order. */
  opened: Record<string, unknown>[]
  /** Pane ids $.ui.close received. */
  closed: string[]
  /** What $.ui.open answers: false means no pane can be drawn here. */
  placePanes: boolean
  /** Every $.config.set call, in order. */
  configSets: { key: string; value: unknown }[]
  /** Rows $.config.list answers; a row's isLocked can be set by a test. */
  configLocked: boolean
  /** What $.config.set answers: a string makes it return { deny }. */
  configDeny: string | null
  /** When set, $.config.set waits for it before answering. */
  configGate: Promise<void> | null
  /** While true, $.agent.list rejects (the roster cannot be read). */
  listFails: boolean
  /** When set, a spawn waits for it inside the engine, so a test can hold one in flight. */
  spawnGate: Promise<void> | null
  /** Every path $.fs.write received, as received. */
  rawPaths: string[]
  /** What $.settings.read answers (merged); null makes it reject. */
  settings: Record<string, unknown> | null
  /** Names $.tool.list answers; null makes it reject. */
  tools: string[] | null
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
  model: null,
  opened: [],
  closed: [],
  placePanes: true,
  configSets: [],
  configLocked: false,
  configDeny: null,
  configGate: null,
  listFails: false,
  spawnGate: null,
  rawPaths: [],
  settings: {},
  tools: [],
  failWrites: false,
  lag: new Map(),
})

// The test kit may hand a path on as the platform resolves it (`/cfg/x` becomes
// `C:\cfg\x` on Windows), so the fake disk keys files by a platform-neutral form.
export const norm = (path: string): string => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

export type EngineOptions = {
  /** $.env.get rejects (the environment cannot be read). */
  envFails?: boolean
  /** Environment the plugin sees; defaults to CLAUDE_CONFIG_DIR=/cfg. */
  env?: Record<string, string>
  listFails?: boolean
  lateReturn?: number
  /** Answer spawns without agentId / teammateId (an accepted-looking but unstarted spawn). */
  noIds?: boolean
  /** Model the engine reports for each started worker. */
  modelOf?: (e: AgentSpawnInput) => string
  writeFails?: boolean
  /** Roster list calls before a new teammate shows up in agent.list (Infinity: never). */
  rosterLag?: number
  /** What the engine answers a model's tool call with (`result`); defaults to 'ok'. */
  toolResult?: (e: Record<string, unknown>) => unknown
  /** Microtasks agent.list takes to answer; the roster is read when asked, then held back. */
  listDelay?: number
}

// agent.list answers the roster; agent.spawn yields `delay` microtasks (simulating
// startup) before the teammate appears in the roster. Returns the mocked clock.
export const engine = (on: On, w: World, delay: (i: number) => number = () => 3, opts: EngineOptions = {}) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  if (opts.envFails) {
    on('env.get', () => {
      throw new Error('env unavailable')
    })
  } else {
    mock.env(on, opts.env ?? { CLAUDE_CONFIG_DIR: '/cfg' })
  }
  on('settings.read', () => {
    if (w.settings === null) throw new Error('settings unavailable')
    return { value: w.settings } as never
  })
  on('tool.list', () => {
    if (w.tools === null) throw new Error('tool list unavailable')
    return { value: w.tools.map(name => ({ name, description: '', mcp: false })) } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
  on('classic.TaskCreated', () => ({}))
  on('classic.TaskCompleted', () => ({}))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.id', () => ({ value: 'sess/1' }) as never)
  on('agent.list', async () => {
    if (opts.listFails || w.listFails) throw new Error('roster unavailable')
    const seen = w.agents.filter(a => {
      const left = a.teammateId === undefined ? undefined : w.lag.get(a.teammateId)
      if (left === undefined) return true
      if (left <= 0) return true
      w.lag.set(a.teammateId as string, left - 1)
      return false
    })
    const value = seen.map(a => ({ ...a }))
    for (let k = 0; k < (opts.listDelay ?? 0); k++) await Promise.resolve()
    return { value } as never
  })
  on('session.usage', () => ({ value: w.usage }) as never)
  on('session.model', () => {
    if (w.model === null) throw new Error('model unavailable')
    return { value: w.model } as never
  })
  // Any tool other than the plugin's own: the engine runs it and answers.
  on('tool.call', (_$, e) => ({ result: opts.toolResult?.(e as unknown as Record<string, unknown>) ?? 'ok' }) as never)
  on('ui.open', (_$, e) => {
    w.opened.push({ ...e })
    return { value: w.placePanes ? { isPlaced: true } : { isPlaced: false, reason: 'no room' } } as never
  })
  on('config.list', () => {
    const row = (key: string, value: unknown, kind: string) => ({ key, label: key, kind, value, provider: { plugin: 'ctk', tier: 'user' }, isLocked: w.configLocked })
    return {
      value: [
        row('ctk.maxWorkers', 3, 'number'),
        row('ctk.explorerModel', 'haiku', 'text'),
        row('ctk.hudBand', true, 'boolean'),
        { key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', provider: { plugin: 'engine', tier: 'core' }, isLocked: false },
      ],
    } as never
  })
  on('config.set', async (_$, e) => {
    if (w.configGate !== null) await w.configGate
    w.configSets.push({ key: e.key, value: e.value })
    return (w.configDeny === null ? { value: e.value } : { deny: w.configDeny }) as never
  })
  // What the engine itself draws where no plugin does.
  on('ui.render', () => ({ type: 'Box', props: { key: 'engine-default' }, children: [] }) as never)
  on('ui.close', (_$, e) => {
    w.closed.push(e.id)
    return { value: undefined } as never
  })
  on('tool.register', (_$, e) => (w.registeredTools.push(e.name), { value: { tool: `mcp__ctk__${e.name}` } }) as never)
  on('command.register', (_$, e) => (w.registeredCommands.push(e.name), { value: { command: e.name } }) as never)
  on('fs.read', (_$, e) => {
    const text = w.files.get(norm(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('fs.write', (_$, e) => {
    if (opts.writeFails || w.failWrites) throw new Error('disk full')
    w.rawPaths.push(e.path)
    w.files.set(norm(e.path), e.text)
    return { value: undefined } as never
  })
  on('agent.spawn', async (_$, e) => {
    w.spawnCalls += 1
    w.models.push(e.model)
    const n = w.spawnCalls
    if (w.spawnGate !== null) await w.spawnGate
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

/**
 * Parses a tool.call answer of the status tool the way the engine accepts it. The test kit
 * does not validate a hook's result, but Claude Code rejects anything but a string or an
 * array of content blocks for a registered tool (checked on 2.1.294 against the real
 * engine), so the shape is asserted here.
 */
export const statusOf = (r: unknown): any => {
  const result = (r as { result?: unknown }).result
  const isBlock = (b: unknown) => typeof b === 'object' && b !== null && typeof (b as { type?: unknown }).type === 'string'
  const valid = typeof result === 'string' || (Array.isArray(result) && result.every(isBlock))
  if (!valid) throw new Error(`status tool result is not a string or content blocks: ${JSON.stringify(result)}`)
  return JSON.parse(typeof result === 'string' ? result : String((result as { text?: unknown }[])[0]?.text))
}
