import type { AgentInfo, AgentSpawnInput, SessionUsage } from 'claude-code'

import { AGENT_TYPES, CAPACITY_CODE, modelFor, ROLES } from '../shared/policy.ts'
import type { PolicyOptions, Role } from '../shared/policy.ts'
import type { StatsRecord } from '../shared/stats.ts'

// Pure team logic: no host calls here. Everything that needs `$` lives in register.tsx.

export const GUARD_CODE = 'TEAM_GUARD_FAILED'

/** Statuses that hold a teammate slot. A finished (completed, failed, killed) teammate frees it. */
const LIVE = new Set(['pending', 'running', 'waiting', 'idle'])
/** Working or blocked mid-task (`waiting` is stuck on an approval, so not free to reuse). */
const BUSY = new Set(['pending', 'running', 'waiting'])

export const isLiveTeammate = (a: AgentInfo): boolean => a.teammateId !== undefined && LIVE.has(a.status)

export type Worker = { name: string; teammateId: string; agentId: string; status: string }

/** An agent the roster lists without a teammate address: an ordinary subagent, which the cap neither counts nor limits. */
export type Subagent = { agentId: string; type: string; description: string; status: string }

/** What the last refresh saw. A null figure was not reported; it renders as a dash. */
export type Snapshot = {
  /** Null when the roster could not be read. */
  busy: number | null
  idle: number | null
  done: number | null
  /** Teammates that failed or were killed; a subset of `done`. */
  failed: number | null
  live: number | null
  workers: Worker[]
  /** Ordinary subagents the roster lists (not teammates); empty when the roster could not be read. */
  subagents: Subagent[]
  elapsedMs: number | null
}

export const emptySnapshot = (): Snapshot => ({ busy: null, idle: null, done: null, failed: null, live: null, workers: [], subagents: [], elapsedMs: null })

export const snapshotOf = (agents: AgentInfo[] | null, usage: SessionUsage | null, now: number): Snapshot => {
  const elapsedMs = usage !== null && usage.startedAt > 0 && now >= usage.startedAt ? now - usage.startedAt : null
  if (agents === null) return { ...emptySnapshot(), elapsedMs }
  const team = agents.filter(a => a.teammateId !== undefined)
  const count = (statuses: Set<string>) => team.filter(a => statuses.has(a.status)).length
  return {
    busy: count(BUSY),
    idle: team.filter(a => a.status === 'idle').length,
    done: team.length - count(LIVE),
    failed: team.filter(a => a.status === 'failed' || a.status === 'killed').length,
    live: team.filter(isLiveTeammate).length,
    workers: team.map(a => ({
      name: (a.teammateId as string).split('@')[0] as string,
      teammateId: a.teammateId as string,
      agentId: a.id,
      status: a.status,
    })),
    subagents: agents.filter(a => a.teammateId === undefined).map(a => ({ agentId: a.id, type: a.type, description: a.description, status: a.status })),
    elapsedMs,
  }
}

export const measuredOf = (usage: SessionUsage | null, model: string | null = null): StatsRecord['measured'] => {
  const limit = (kind: string) => usage?.rateLimits.find(l => l.kind === kind)
  return {
    costUsd: usage?.cost?.usd ?? null,
    contextPct: usage?.context.percent ?? null,
    fiveHourPct: limit('five_hour')?.percentUsed ?? null,
    sevenDayPct: limit('seven_day')?.percentUsed ?? null,
    fiveHourResetsAt: limit('five_hour')?.resetsAt ?? null,
    sevenDayResetsAt: limit('seven_day')?.resetsAt ?? null,
    model,
  }
}

/** Most tool_use_ids remembered for de-duplication; the oldest half is forgotten past this. */
export const TOOL_SEEN_LIMIT = 4096

/**
 * Whether a `tool.call` event is a call not yet counted. A call is identified by its
 * tool_use_id, so an event that fires twice for one call (a retried hook, a replay) counts
 * once; an event without an id cannot be recognised again and counts every time.
 */
export const isNewToolCall = (seen: Set<string>, toolUseId: unknown): boolean => {
  if (typeof toolUseId !== 'string' || toolUseId === '') return true
  if (seen.has(toolUseId)) return false
  seen.add(toolUseId)
  if (seen.size > TOOL_SEEN_LIMIT) {
    let drop = seen.size - TOOL_SEEN_LIMIT / 2
    for (const id of seen) {
      if (drop-- <= 0) break
      seen.delete(id)
    }
  }
  return true
}

/** A teammate spawn that arrives while a confirmed option change is being written. The skill treats this code like any guard refusal: leave the task pending and retry. */
export const settingChangeDeny = (): string =>
  `${GUARD_CODE}: CTK is applying a setting change you confirmed. Do not treat this worker as started; leave its task pending and retry in a moment.`

export const capacityDeny = (live: number, starting: number, max: number): string =>
  `${CAPACITY_CODE}: live=${live} starting=${starting} max=${max}. Do not treat this worker as started; leave its task pending; reuse an idle teammate via SendMessage or wait for one to finish.`

export const guardDeny = (): string =>
  `${GUARD_CODE}: the teammate cap could not be checked. Do not treat this worker as started; leave its task pending and retry later.`

/**
 * A named agent that Claude Code started as an ordinary subagent while Agent Teams were on. Claude Code's
 * documentation says a named call becomes a teammate unless it is a fork or passes `isolation`, and a
 * live probe on 2.1.295 showed exactly that: the spawn carried no `isTeammate`. The cap cannot gate it
 * (the event does not say why), so the guard only counts it, to keep "outside the cap" visible.
 */
export const startsOutsideCap = (e: Pick<AgentSpawnInput, 'isTeammate' | 'name' | 'fork' | 'workflow'>, teamsEnabled: boolean | null): boolean =>
  teamsEnabled === true && e.isTeammate !== true && e.name !== undefined && e.fork !== true && e.workflow === undefined

export const roleOf = (subagentType: string): Role | undefined => ROLES.find(r => AGENT_TYPES[r] === subagentType)

/**
 * Model routing by role. An explicit `model` always wins and `inherit` passes through.
 * Effort is deliberately not overridden here: the options carry models only, so effort
 * comes from each agent's frontmatter (`effort:` in plugins/ctk/agents/).
 */
export const routed = (e: AgentSpawnInput, opts: PolicyOptions): AgentSpawnInput => {
  if (e.model !== undefined) return e
  const role = roleOf(e.subagentType)
  if (role === undefined) return e
  const model = modelFor(opts, role)
  return model === 'inherit' ? e : { ...e, model }
}

/** Full name Claude Code gives the status tool (`mcp__<plugin>__<name>`); the tool.call hook matches it. */
export const STATUS_TOOL_NAME = 'ctk_team_status'
export const STATUS_TOOL = `mcp__ctk__${STATUS_TOOL_NAME}`
export const CONFIG_TOOL_NAME = 'ctk_config'
export const CONFIG_TOOL = `mcp__ctk__${CONFIG_TOOL_NAME}`

/** How long an accepted teammate stays counted while the roster has not listed it yet. */
export const PENDING_TTL_MS = 10_000

/**
 * Live teammates for the cap: the roster's live ones plus accepted ones the roster has not
 * listed yet (teammateId -> accepted-at ms). A listed one is dropped from `pending` and the
 * roster's status governs from then on; an unlisted one is dropped after the TTL, so a
 * teammate that finished instantly cannot hold a slot forever. Mutates `pending`.
 */
export const effectiveLive = (roster: AgentInfo[], pending: Map<string, number>, now: number): number => {
  const listed = new Set(roster.flatMap(a => (a.teammateId === undefined ? [] : [a.teammateId])))
  for (const [id, at] of pending) {
    if (listed.has(id) || now - at >= PENDING_TTL_MS) pending.delete(id)
  }
  return roster.filter(isLiveTeammate).length + pending.size
}

// --- Natural-language entry ----------------------------------------------------------------

/**
 * Whether a prompt asks for several agents, a team or parallel work, or to use CTK. A small, fixed set of
 * phrases in English and Chinese: it is not a classifier. All it can do is attach a one-line hint (see
 * TEAM_HINT) that the model reads beside the prompt; the model still decides, and the team skill's own
 * intent gate still applies. A prompt that is a command, or already names the team skill, is left alone.
 */
const TEAM_ASK = [
  /多\s*(個|个|一個)?\s*(sub-?)?(agents?|代理)/i,
  /(multi|multiple|several|parallel)[\s-]*(sub-?)?agents?\b/i,
  /\b(\d+|two|three|four|five|several)\s+(sub-?agents?|teammates?|agents)\b/i,
  /\bagents?\s+team\b/i,
  /\b(a|use|as a)\s+team\b/i,
  /\bteam\s+of\b/i,
  /(用|使用|開|組|啟動)\s*(一個|個)?\s*(team|團隊|隊伍)/i,
  /(平行|並行|同時)\s*(處理|執行|進行|做|跑|派)/,
  /(分頭|分工)/,
  /\b(in parallel|parallelize|concurrently)\b/i,
  /\bctk\s*(的)?\s*(流程|workflow|team)/i,
  /(?<![A-Za-z])(use|using)\s+ctk\b/i,
  /(用|使用)\s*ctk/i,
]

export const teamIntent = (text: string): boolean => {
  const t = text.slice(0, 2000).trim()
  // A slash command ("/ctk:team ...", "/ctk-doctor") is not a request in words; a path such as /Users/x/repo is not a command.
  if (t === '' || /^\/[\w:-]+(\s|$)/.test(t)) return false
  return TEAM_ASK.some(re => re.test(t))
}

/** What the model reads beside such a prompt. Conditional on purpose: a mention of "team" in another sense is not a request. */
export const TEAM_HINT =
  'CTK note: if this request asks for several agents, a team or parallel work, invoke the ctk:team skill first (Skill tool) and follow it. It names every worker, which makes each one a native teammate that the worker cap and Mission Control track; an Agent call without a name is only an ordinary subagent. If the request is not about agents, ignore this note.'

/** The hint for a prompt, or null. Only the person's own words count: the terminal's Enter and the Remote Control bridge. */
export const teamHintFor = (e: { text: string; origin?: { kind: string } }): string | null =>
  (e.origin?.kind === 'composer' || e.origin?.kind === 'bridge') && teamIntent(e.text) ? TEAM_HINT : null
