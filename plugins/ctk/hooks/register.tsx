import type { EngineInterface, Register } from 'claude-code'

import { readOptions } from '../shared/policy.ts'
import type { PolicyOptions } from '../shared/policy.ts'
import { emptyStats, parseStats, safeSessionId } from '../shared/stats.ts'
import type { StatsRecord } from '../shared/stats.ts'
import { BAND_MARGIN, formatBand, formatSummary } from './band.ts'
import { factsFrom, formatDoctor, isCtkStatusLine } from './doctor.ts'
import type { Facts } from './doctor.ts'
import { capacityDeny, CONFIG_TOOL_NAME, effectiveLive, emptySnapshot, guardDeny, settingChangeDeny, isNewToolCall, measuredOf, routed, snapshotOf, startsOutsideCap, STATUS_TOOL_NAME, teamHintFor } from './team.ts'
import type { Snapshot } from './team.ts'
import { cancel, confirm, describeOptions, emptyPending, OPTION_NAMES, propose, sweep, validateChange } from './config.ts'
import type { PendingState } from './config.ts'
import { displayWidth } from '../shared/hudline.ts'
import {
  buildMission,
  forcedTierColumns,
  guardOf,
  MC_PANE_ID,
  missionJson,
  missionText,
  newMcState,
  newMissionState,
  noteSpawn,
  noteTaskCall,
  noteTeammateIdle,
  noteWorkerToolCall,
  noteWorkerTurnEnd,
  OPEN_KEY,
  pressMc,
} from './mission.ts'
import type { McState, MissionState } from './mission.ts'
import { renderMission } from './missionui.tsx'

// Every host call is here because `$` may only be handed to top-level functions of this
// file. Anything pure (cap text, routing, snapshot math, band text) is in team.ts / band.ts.
// Each host call degrades on failure: a stats or HUD problem never touches a spawn, and
// the cap itself fails closed.

const STATS_WRITE_GAP_MS = 2000
/** The band is redrawn for a tool call at most this often. */
const DRAW_GAP_MS = 1000

type Ctx = {
  opts: PolicyOptions
  stats: StatsRecord
  snap: Snapshot
  /** Spawns that passed the cap and have not returned yet; bumped before the first await. */
  inflight: number
  /** Accepted teammates (id -> accepted-at ms) the roster has not listed yet; see effectiveLive. */
  pending: Map<string, number>
  /** Last clock reading, the fallback timestamp if the clock fails. */
  lastNow: number
  /** False until the first refresh: the band draws nothing before it has figures. */
  ready: boolean
  dirty: boolean
  lastWrite: number
  lastDraw: number
  /** tool_use_ids already counted, so one call is never counted twice. */
  toolSeen: Set<string>
  /** True while the CTK status line is configured: the band then leaves out what it shows. */
  coordinated: boolean
  /** 2 when CTK_AMBIGUOUS_WIDTH=2 (a terminal that draws │ and … two cells wide). */
  ambiguous: 1 | 2
  /** What Mission Control shows: workers, tasks and tool calls observed this session (memory only). */
  mission: MissionState
  /** Which view the pane shows and the HUD form; session-local, never saved. */
  mc: McState
  /** Whether the Agent Teams flag is set; null until read. */
  teamsEnabled: boolean | null
  /** An option change the model proposed and the person has not yet confirmed (memory only). */
  cfg: PendingState
  /** The last result of a confirmed or cancelled change, shown in Config. */
  notice: string | null
  /** True from just before a confirmed change is written until it is refused: teammate spawns wait, because the reload that follows forgets spawns in flight. */
  applying: boolean
}

async function statsPath($: EngineInterface, sessionId: string): Promise<string | null> {
  const explicit = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = explicit ? null : (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  const dir = explicit || (home ? `${home}/.claude` : null)
  return dir === null ? null : `${dir.replace(/[\\/]+$/, '')}/ctk/stats/${safeSessionId(sessionId)}.json`
}

// Throttled to one write per STATS_WRITE_GAP_MS; a change inside the gap is written by the
// next state change, turn end or (forced) session end. `dirty` is cleared before the write
// so a change made during it is kept, and set again if the write fails, so the forced write
// at session end retries it.
async function persist($: EngineInterface, c: Ctx, force = false) {
  if (!c.opts.recordStats || !c.dirty) return
  try {
    const now = await $.clock.now()
    if (!force && now - c.lastWrite < STATS_WRITE_GAP_MS) return
    const path = await statsPath($, c.stats.sessionId)
    if (path === null) return
    c.lastWrite = now
    c.dirty = false
    c.stats.updatedAt = now
    try {
      await $.fs.write(path, `${JSON.stringify(c.stats)}\n`)
    } catch (err) {
      c.dirty = true
      throw err
    }
  } catch {
    // A stats failure must never affect a spawn or the HUD.
  }
}

// Re-reads the roster and usage, then redraws the band and writes stats. Never throws.
async function refresh($: EngineInterface, c: Ctx, write = true) {
  try {
    const [agents, usage, now, model] = await Promise.all([
      $.agent.list().catch(() => null),
      $.session.usage().catch(() => null),
      $.clock.now().catch(() => 0),
      $.session.model().catch(() => null),
    ])
    if (now > 0) c.lastNow = now
    c.snap = snapshotOf(agents, usage, now)
    if (usage !== null || model !== null) c.stats.measured = measuredOf(usage, model)
    if (c.snap.live !== null) c.stats.peakLive = Math.max(c.stats.peakLive, c.snap.live)
    c.ready = true
    c.dirty = true
    $.ui.invalidate('ui.render')
  } catch {
    // Band and stats are best effort.
  }
  if (write) await persist($, c)
}

// Whether the CTK status line is the configured one (any settings level) and whether the Agent Teams
// flag is set. Best effort: unreadable settings leave the last answers, which start as "no" and
// "unknown", so the band then shows everything and the guard reads unavailable.
async function detectEnvironment($: EngineInterface, c: Ctx) {
  try {
    const [settings, flag] = await Promise.all([
      $.settings.read().catch(() => null),
      $.env.get('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS').then(value => ({ value }), () => null),
    ])
    if (settings !== null) c.coordinated = isCtkStatusLine(settings)
    c.teamsEnabled = factsFrom({ opts: c.opts, envFlag: flag, settings, toolNames: null }).teamsEnabled
  } catch {
    // Keep the previous answers.
  }
}

// A tool call changed the count: redraw the band (at most once per DRAW_GAP_MS) and let the
// throttled stats write pick it up. Never throws, never touches the call.
async function touch($: EngineInterface, c: Ctx) {
  try {
    const now = await $.clock.now()
    c.lastNow = now
    c.dirty = true
    if (now - c.lastDraw >= DRAW_GAP_MS) {
      c.lastDraw = now
      $.ui.invalidate('ui.render')
    }
  } catch {
    // The count is kept; the next refresh draws it.
  }
  await persist($, c)
}

// Rejects when the roster or the clock cannot be read: the caller fails closed.
async function liveTeammates($: EngineInterface, c: Ctx): Promise<number> {
  const roster = await $.agent.list()
  const now = await $.clock.now()
  c.lastNow = now
  return effectiveLive(roster, c.pending, now)
}

// What the readiness report and the status tool's preflight fields rest on. Each read
// degrades to null on failure; nothing is written.
async function gatherFacts($: EngineInterface, c: Ctx): Promise<Facts> {
  const [value, settings, tools] = await Promise.all([
    $.env.get('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS').then(value => ({ value }), () => null),
    $.settings.read().catch(() => null),
    $.tool.list().catch(() => null),
  ])
  const base = factsFrom({ opts: c.opts, envFlag: value, settings, toolNames: tools === null ? null : tools.map(t => t.name) })
  // The guard is judged from what this session saw, with the flag read just now; callers refresh the roster first.
  const guard = guardOf(c.stats, c.snap, base.teamsEnabled, c.ready)
  return { ...base, guard: { state: guard.state, why: guard.why }, outsideCap: c.stats.spawnsOutsideCap }
}

// A session.start that fires again (enable, worker respawn, reload) continues this
// session's counters from its stats file instead of resetting them.
async function boot($: EngineInterface, c: Ctx) {
  try {
    const now = await $.clock.now()
    const sessionId = await $.session.id()
    c.lastNow = now
    c.stats = emptyStats(sessionId, c.opts.maxWorkers, now)
    c.lastWrite = 0
    try {
      const path = await statsPath($, sessionId)
      const prior = path === null ? null : parseStats(JSON.parse(await $.fs.read(path)))
      if (prior !== null && prior.sessionId === sessionId) {
        c.stats = {
          ...c.stats,
          ...prior,
          maxWorkers: c.opts.maxWorkers,
          workerModels: prior.workerModels ?? {},
          measured: { ...c.stats.measured, ...prior.measured },
        }
      }
    } catch {
      // No readable prior file: start from zero.
    }
  } catch {
    // Keep the placeholder session id; counters still work.
  }
  try {
    c.ambiguous = (await $.env.get('CTK_AMBIGUOUS_WIDTH')) === '2' ? 2 : 1
  } catch {
    // Keep one-cell ambiguous characters.
  }
  await detectEnvironment($, c)
  await refresh($, c)
}

const noop = () => {}

const missionOf = (c: Ctx) =>
  buildMission({ stats: c.stats, snap: c.snap, state: c.mission, nowMs: c.lastNow, teamsEnabled: c.teamsEnabled, ready: c.ready })

// Reads the readiness report for the Doctor view; a failure leaves a one-line reason.
async function loadDoctor($: EngineInterface, c: Ctx) {
  try {
    await refresh($, c, false)
    c.mc = { ...c.mc, doctorText: formatDoctor(await gatherFacts($, c)) }
  } catch {
    c.mc = { ...c.mc, doctorText: 'CTK readiness could not be read.' }
  }
}

// Opens Mission Control. It is always called from the person's own press or command, which is what lets
// the pane be placed at any terminal width. Resolves false when no pane could be drawn.
async function openMission($: EngineInterface, c: Ctx): Promise<boolean> {
  try {
    await refresh($, c)
    if (c.mc.view === 'doctor') await loadDoctor($, c)
    const r = await $.ui.open({ id: MC_PANE_ID, title: 'CTK Mission Control', focus: true, closeOnEscape: true, rows: 16 })
    return r.isPlaced
  } catch {
    return false
  }
}

// A press on the band or on one of the pane's buttons. Only the band's opens something; the pane's
// buttons change what the pane shows. A failure here is swallowed: the team is never affected.
async function handlePress($: EngineInterface, c: Ctx, key: string) {
  try {
    if (key === OPEN_KEY) {
      await openMission($, c)
      return
    }
    const r = pressMc(c.mc, key)
    c.mc = r.mc
    if (r.effect === 'close') await $.ui.close({ id: MC_PANE_ID })
    else if (r.effect === 'doctor') await loadDoctor($, c)
    else if (r.effect === 'refresh') await refresh($, c)
    else if (r.effect === 'confirm' || r.effect === 'cancel') await decideChange($, c, r.effect, r.id ?? '')
    $.ui.invalidate('ui.render')
  } catch {
    // Mission Control is a view; its failure changes nothing else.
  }
}

// The person's answer to a proposed option change. Confirm is the only way a change is applied: the model
// can only propose. Before the one write (`$.config.set`) the change is checked again against the options
// as they are now, the setting must not be locked by managed settings, and no teammate may be starting
// (a successful set reloads this module, which forgets spawns still in flight).
async function decideChange($: EngineInterface, c: Ctx, answer: 'confirm' | 'cancel', id: string) {
  const waiting = c.cfg.pending
  if (waiting === null || waiting.id !== id) {
    // The press was drawn for a proposal that is gone or has been replaced: it answers nothing.
    c.notice = waiting === null ? 'Nothing is waiting for your confirmation.' : 'That proposal was replaced. Check the one now waiting; nothing changed.'
    return
  }
  if (answer === 'cancel') {
    c.cfg = cancel(c.cfg, id).state
    c.notice = `Cancelled: ${waiting.change.text}. Nothing changed.`
    return
  }
  let now: number
  let live: number
  try {
    now = await $.clock.now()
    // Spawns the roster has not listed yet are pruned here, so a settled team does not block the change.
    live = effectiveLive(await $.agent.list(), c.pending, now)
  } catch {
    c.notice = 'Not applied: the clock or the roster could not be read, so CTK cannot tell the team is settled.'
    return
  }
  void live
  if (c.inflight > 0 || c.pending.size > 0) {
    c.notice = 'Teammates are starting. Confirm again in a moment; nothing changed.'
    return
  }
  const decided = confirm(c.cfg, id, now)
  c.cfg = decided.state
  if (decided.outcome.kind === 'expired') {
    c.notice = 'That proposal is older than 10 minutes and was dropped. Ask again; nothing changed.'
    return
  }
  if (decided.outcome.kind !== 'confirmed') return
  const change = decided.outcome.change
  const again = validateChange(change.name, change.value, c.opts)
  if (!again.ok) {
    c.notice = `Not applied: ${again.reason}`
    return
  }
  try {
    const row = (await $.config.list()).find(r => r.key === again.key)
    if (row === undefined) {
      c.notice = 'Not applied: this Claude Code has no such setting.'
      return
    }
    if (row.isLocked) {
      c.notice = 'Not applied: a managed setting controls this option.'
      return
    }
    // The checks above awaited: look again, and from here until the write is refused no teammate may start.
    if (c.inflight > 0 || c.pending.size > 0) {
      c.notice = 'Teammates are starting. Confirm again in a moment; nothing changed.'
      return
    }
    c.applying = true
    // A successful set reloads the module a moment later: write the counters now and the notice first.
    await persist($, c, true)
    c.notice = `Applied: ${again.text}.`
    const res = await $.config.set({ key: again.key, value: again.value })
    c.applying = false
    if (res.deny !== undefined) {
      c.notice = `Not applied: ${res.deny}`
      return
    }
    c.opts = { ...c.opts, [again.name]: again.value }
    if (again.name === 'maxWorkers') c.stats.maxWorkers = c.opts.maxWorkers
  } catch {
    c.applying = false
    c.notice = 'Not applied: the setting could not be written.'
  }
}

// The model's tool for options: `show` lists them, `propose` stores one change and opens Mission Control on it.
// Nothing is applied here.
async function configTool($: EngineInterface, c: Ctx, input: Record<string, unknown>): Promise<string> {
  if (input.action === 'show') {
    return JSON.stringify({
      options: describeOptions(c.opts).map(r => ({ option: r.name, value: r.shown, allowed: r.allowed, default: r.defaultShown })),
      waiting: c.cfg.pending === null ? null : c.cfg.pending.change.text,
    })
  }
  if (input.action !== 'propose') return JSON.stringify({ error: 'action must be "show" or "propose"' })
  const v = validateChange(String(input.option), input.value, c.opts)
  if (!v.ok) return JSON.stringify({ status: 'rejected', reason: v.reason, validOptions: OPTION_NAMES })
  const now = await $.clock.now().catch(() => c.lastNow)
  c.cfg = propose(c.cfg, v, now).state
  c.notice = null
  c.mc = { ...c.mc, view: 'config', selected: null }
  $.ui.invalidate('ui.render')
  const shown = await openMission($, c)
  return JSON.stringify({
    status: 'pending_user_confirmation',
    change: v.text,
    applied: false,
    next: shown
      ? 'Nothing has changed yet. Mission Control is open on its Config page with a Confirm button, and the band above the prompt says "Confirm setting" until it is answered. Tell the user, in their language: "I opened CTK Mission Control; press Confirm there to apply it, or Cancel. Nothing changes until you do." Do not say it is done.'
      : 'Nothing has changed. Mission Control could not be drawn here. Tell the user to run /ctk-mission and press Confirm on its Config page (the band above the prompt also says "Confirm setting"), or to change the option with /plugin configure ctk@ctk-kit. Do not say it is done.',
  })
}

export const register: Register = (on, options) => {
  const opts = readOptions(options)
  const c: Ctx = {
    opts,
    stats: emptyStats('unknown', opts.maxWorkers, 0),
    snap: emptySnapshot(),
    inflight: 0,
    pending: new Map(),
    lastNow: 0,
    ready: false,
    dirty: false,
    lastWrite: 0,
    lastDraw: 0,
    toolSeen: new Set(),
    coordinated: false,
    ambiguous: 1,
    mission: newMissionState(),
    mc: newMcState(),
    teamsEnabled: null,
    cfg: emptyPending(),
    notice: null,
    applying: false,
  }

  // Hard cap on live teammates. `inflight` is bumped synchronously before the first await,
  // so concurrent spawns from one assistant message each see the others' reservations. A
  // spawn that has started but not yet released its reservation may be counted twice: the
  // cap errs toward refusing, never over. Only teammate spawns are gated.
  on('agent.spawn', async ($, e, next) => {
    // Every spawn event counts: that this hook is reached at all is what "Guard ON" rests on.
    c.stats.spawnsSeen += 1
    c.dirty = true
    if (startsOutsideCap(e, c.teamsEnabled)) c.stats.spawnsOutsideCap += 1
    if (e.isTeammate !== true) {
      const r = await next(routed(e, c.opts))
      // Let the band and Mission Control list this subagent now. A failed read never touches the spawn (and must not throw: the spawn already ran).
      try {
        await refresh($, c)
      } catch {
        // the next refresh will catch up
      }
      return r
    }

    // A confirmed option change is being written; the reload after it forgets reservations, so a
    // teammate waits (retryable) rather than starting across it. Counted as neither accepted nor failed.
    if (c.applying) return { deny: settingChangeDeny() }

    c.inflight += 1
    let held = true
    const release = () => {
      if (held) {
        held = false
        c.inflight -= 1
      }
    }

    try {
      const live = await liveTeammates($, c)
      if (live + c.inflight > c.opts.maxWorkers) {
        const starting = c.inflight - 1
        release()
        c.stats.spawnsRejected += 1
        await refresh($, c)
        return { deny: capacityDeny(live, starting, c.opts.maxWorkers) }
      }
      const started = await next(routed(e, c.opts))
      // Accepted is verified, not assumed: a result without both ids did not start a teammate.
      if (started.deny === undefined && started.agentId !== undefined && started.teammateId !== undefined) {
        c.stats.spawnsAccepted += 1
        c.stats.workerModels[started.model] = (c.stats.workerModels[started.model] ?? 0) + 1
        // Keep it counted until the roster lists it, and only then release the reservation,
        // so a roster that lags behind next() cannot let a spawn past the cap.
        const acceptedAt = await $.clock.now().catch(() => c.lastNow)
        c.pending.set(started.teammateId, acceptedAt)
        noteSpawn(c.mission, started.agentId, e.name ?? started.teammateId.split('@')[0] ?? started.teammateId, started.model, acceptedAt)
      }
      release()
      await refresh($, c)
      return started
    } finally {
      release()
    }
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    if (e.isTeammate !== true) return next(e)
    c.stats.spawnsFailedClosed += 1
    return { deny: guardDeny() }
  })

  // A prompt that asks for several agents, a team or parallel work, or to use CTK, gets one hint line beside it
  // (never shown, no model call): the model then loads the team skill instead of starting plain subagents. The
  // prompt's own text is untouched, a prompt that is not the person's own is left alone, and any failure here
  // lets the prompt through as it was.
  on('prompt.submit', async ($, e, next) => {
    const hint = c.opts.teamHint ? teamHintFor(e) : null
    return next(hint === null ? e : { ...e, context: [...(e.context ?? []), hint] })
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    try {
      await $.tool.register({
        name: STATUS_TOOL_NAME,
        description: 'Live CTK team state: workers, cap, accepted and refused spawns.',
      })
    } catch {
      // Without the tool the Agent result's teammate_id still confirms a spawn.
    }
    try {
      await $.tool.register({
        name: CONFIG_TOOL_NAME,
        description: 'Show CTK options, or propose one change. A proposal applies nothing: the user confirms it in CTK Mission Control.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['show', 'propose'] },
            option: { type: 'string', enum: [...OPTION_NAMES] },
            value: { description: 'maxWorkers: whole number 1-12; models: alias or id; hudBand, recordStats and teamHint: true or false' },
          },
          required: ['action'],
        },
        isDeferred: true,
      })
    } catch {
      // Without the tool, options are changed with /plugin configure.
    }
    try {
      await $.command.register({ name: 'ctk-stats', description: 'Show CTK team stats for this session.' })
    } catch {
      // Without the command `ctk stats` still reads the stats file.
    }
    try {
      await $.command.register({ name: 'ctk-doctor', description: 'Check CTK readiness (read-only).' })
    } catch {
      // Without the command the status tool still reports the same facts.
    }
    try {
      await $.command.register({ name: 'ctk-mission', description: 'Open CTK Mission Control (read-only team view).' })
    } catch {
      // Without the command the CTK band is the way in.
    }
    const r = await next(e)
    await boot($, c)
    return r
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await refresh($, c)
    return r
  })

  // Teammate status changes raise no session.measure; turn ends do.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await detectEnvironment($, c)
    await refresh($, c)
    noteWorkerTurnEnd(c.mission, (e as { agentId?: string }).agentId, c.lastNow)
    return r
  })

  on('session.end', async ($, e, next) => {
    await persist($, c, true)
    return next(e)
  })

  // Read-only counters: these never block a task.
  on('classic.TaskCreated', async ($, e, next) => {
    c.stats.tasks = { created: (c.stats.tasks?.created ?? 0) + 1, completed: c.stats.tasks?.completed ?? 0 }
    await refresh($, c)
    return next(e)
  })

  on('classic.TaskCompleted', async ($, e, next) => {
    c.stats.tasks = { created: c.stats.tasks?.created ?? 0, completed: (c.stats.tasks?.completed ?? 0) + 1 }
    await refresh($, c)
    return next(e)
  })

  // Every tool call the model makes, in the lead and in subagents and teammates, counts once by
  // its tool_use_id. The count happens before the call runs and the call is passed on untouched;
  // a call a hook later denies still counts, because the model made it.
  on('tool.call', async ($, e, next) => {
    const isNew = isNewToolCall(c.toolSeen, e.tool_use_id)
    if (isNew) c.stats.toolCalls += 1
    const r = await next(e)
    await touch($, c)
    if (isNew) {
      noteWorkerToolCall(c.mission, e.agentId, c.lastNow)
      // The task board is built from the Task tools' named fields only (see noteTaskCall), and only
      // from a call that ran: a denied or failed one changes nothing.
      if ((e.tool === 'TaskCreate' || e.tool === 'TaskUpdate') && r.deny === undefined) {
        noteTaskCall(c.mission, e.tool, e as unknown as Record<string, unknown>, (r as { result?: unknown }).result)
      }
    }
    return r
  }).catch(($, e, next) => next(e)) // whatever fails here, the model's tool call still goes through

  // A teammate going idle is the one moment its idle time starts; nothing else reads this event.
  on('classic.TeammateIdle', async ($, e, next) => {
    noteTeammateIdle(c.mission, e.teammate_name, await $.clock.now().catch(() => c.lastNow))
    await refresh($, c)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The matcher must be a literal for `claude plugin validate`; policy.test.ts ties it to STATUS_TOOL.
  on('tool.call', { tool: 'mcp__ctk__ctk_team_status' }, async ($, e, next) => {
    await refresh($, c)
    const facts = await gatherFacts($, c)
    const status = {
      live: c.snap.live,
      max: c.opts.maxWorkers,
      workers: c.snap.workers,
      rejected: c.stats.spawnsRejected,
      accepted: c.stats.spawnsAccepted,
      cap: c.opts.maxWorkers,
      teamsEnabled: facts.teamsEnabled,
      taskTools: facts.taskTools,
      ...missionJson(missionOf(c)),
    }
    // Claude Code validates a registered tool's result as a string or an array of content
    // blocks; an MCP-style { content, isError } object is rejected (verified on 2.1.294).
    return { result: JSON.stringify(status) }
  })

  on('tool.call', { tool: 'mcp__ctk__ctk_config' }, async ($, e, next) => ({ result: await configTool($, c, e as unknown as Record<string, unknown>) })).catch(
    () => ({ result: JSON.stringify({ error: 'CTK could not read the request; nothing changed.' }) }),
  )

  on('command.run', { command: 'ctk-stats' }, async ($, e, next) => {
    await refresh($, c)
    return { text: formatSummary(c.stats, c.snap, c.lastNow) }
  })

  // The command is the way in where the band is hidden, and the answer where no pane can be drawn.
  on('command.run', { command: 'ctk-mission' }, async ($, e, next) => {
    if (await openMission($, c)) return { text: 'ctk: Mission Control is open. Esc returns to the prompt; /ctk-stats and /ctk-doctor still work.' }
    return { text: missionText(missionOf(c)) }
  })

  // Presses on the band and on Mission Control's buttons. The buttons' own handlers do nothing; the
  // work is done here, after them.
  on('ui.press', { plugin: 'ctk' }, async ($, e, next) => {
    // The button's own handler runs first: handling the press redraws, and a redraw releases the handler.
    const r = await next(e)
    await handlePress($, c, e.element)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'ctk-doctor' }, async ($, e, next) => {
    await refresh($, c, false)
    return { text: formatDoctor(await gatherFacts($, c)) }
  })

  // The whole band is one button: a click anywhere on it, or Enter once it has the focus (ctrl+x then Tab),
  // opens Mission Control. The line itself is laid out for the room left after the `CTK ▸` entry.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!c.opts.hudBand || !c.ready || e.props.hasSurvey) return next(e)
    const { Text, Button } = $.ui.resolve(e)
    const entry = 'CTK ▸ '
    const guard = guardOf(c.stats, c.snap, c.teamsEnabled, c.ready).label
    // Until a teammate has started, the band may show less: only the entry and the guard, or nothing
    // (then /ctk-mission is the way in). Once a team has run, the band always shows in full.
    const waiting = sweep(c.cfg, c.lastNow).pending !== null
    const idle = c.mission.workers.size === 0 && (c.snap.live ?? 0) === 0 && c.stats.spawnsAccepted === 0 && !waiting
    if (idle && c.opts.hudIdle === 'hidden') return next(e)
    const room = e.props.bodyColumns - displayWidth(entry, c.ambiguous)
    const line = idle && c.opts.hudIdle === 'minimal' ? `Guard ${guard}` : formatBand(c.stats, c.snap, room, {
      nowMs: c.lastNow,
      ambiguous: c.ambiguous,
      coordinated: c.coordinated,
      guard,
      subagentsLive: c.snap.subagents.filter(a => !['completed', 'failed', 'killed'].includes(a.status)).length,
      pendingChange: waiting,
      tierColumns: forcedTierColumns(c.mc.hudMode) ?? e.viewport?.columns ?? e.props.bodyColumns + BAND_MARGIN,
    })
    return (
      <Button key={OPEN_KEY} plain label="Open CTK Mission Control" onPress={noop}>
        <Text bold>{entry}</Text>
        <Text dimColor>{line}</Text>
      </Button>
    )
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== MC_PANE_ID) return next(e)
    return renderMission(
      $.ui.resolve(e),
      missionOf(c),
      c.mc,
      {
        statsText: formatSummary(c.stats, c.snap, c.lastNow),
        options: describeOptions(c.opts).map(r => ({ label: r.label, value: r.shown })),
        pending: sweep(c.cfg, c.lastNow).pending === null ? null : { id: sweep(c.cfg, c.lastNow).pending!.id, text: sweep(c.cfg, c.lastNow).pending!.change.text },
        notice: c.notice,
      },
      e.props,
    )
  })
}
