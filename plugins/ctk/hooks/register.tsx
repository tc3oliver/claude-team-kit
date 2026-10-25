import type { EngineInterface, Register } from 'claude-code'

import { readOptions } from '../shared/policy.ts'
import type { PolicyOptions } from '../shared/policy.ts'
import { emptyStats, parseStats, safeSessionId } from '../shared/stats.ts'
import type { StatsRecord } from '../shared/stats.ts'
import type { CacheUsage } from './band.ts'
import { BAND_MARGIN, BAND_SEP, bandParts, cacheHealth, formatSummary, GUARD_QUIET } from './band.ts'
import { factsFrom, formatDoctor, isCtkStatusLine } from './doctor.ts'
import type { Facts } from './doctor.ts'
import { budgetDeny, budgetReached, capacityDeny, CONFIG_TOOL_NAME, effectiveLive, emptySnapshot, guardDeny, settingChangeDeny, isNewToolCall, isLiveStatus, measuredOf, noteSample, prunePending, routed, snapshotOf, startsOutsideCap, STATUS_TOOL_NAME, teamHintFor } from './team.ts'
import type { PctSample, Snapshot } from './team.ts'
import { cancel, confirm, describeOptions, emptyPending, OPTION_NAMES, propose, sweep, validateChange } from './config.ts'
import type { PendingState } from './config.ts'
import { displayWidth } from '../shared/hudline.ts'
import { readBranch } from './branch.ts'
import { TRANSCRIPT_PREFIX } from './ui/workers.tsx'
import { filterBashOutput, hashOutput } from './outfilter.ts'
import { formatReport } from './report.ts'
import { budgetNotice, capNotice, isLifecycleOnly, isOwnAssignmentEcho, LEAD_NAME, NOTIFY_TITLE, stallNotices, teamNotices, teamSummary } from './notify.ts'
import {
  buildMission,
  forcedTierColumns,
  guardOf,
  MC_PANE_ID,
  missionJson,
  missionText,
  newMcState,
  newCollisionNote,
  newMissionState,
  noteFileChange,
  noteLeadBash,
  noteWorkerActive,
  noteSpawn,
  noteTaskCall,
  noteTeammateIdle,
  noteWorkerToolCall,
  toolLabel,
  noteWorkerTurnEnd,
  OPEN_KEY,
  pressMc,
  signalsOf,
  stalledOf,
} from './mission.ts'
import type { McState, Mission, MissionState } from './mission.ts'
import { renderMission } from './missionui.tsx'
import { delayFor, motionOf, newMotionState, observe, reducedFrom } from './ui/motion.ts'
import type { MotionState } from './ui/motion.ts'

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
  /** The main loop's last turn cache counts, from turn.complete's usage; null before one. */
  cache: CacheUsage | null
  /** When the last cap-refusal notice went out (clock ms); 0 before one. */
  lastCapNotice: number
  /** When the last usage-limit notice went out (clock ms); 0 before one. */
  lastBudgetNotice: number
  /** True once a response read from the cache: before that, a 0% read is the first write, not a lapse. */
  cacheWarm: boolean
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
  /** Recall files written so far this session; the next one goes to slot (this % RECALL_SLOTS). */
  recallCount: number
  /** True while the CTK status line is configured: the band then leaves out what it shows. */
  coordinated: boolean
  /** The git branch of the session's directory, read from .git/HEAD; null when not in a repository. */
  branch: string | null
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
  /** Mission Control's motion: highlights and the slow frame. Memory only; reduced motion keeps it static. */
  mo: MotionState
  /** The one pending redraw timer, armed only while the pane draws and something moves. */
  moTimer: { cancel: () => void } | null
  /** True from a pane draw until the pane is closed by its own button; the timer does nothing otherwise. */
  paneOpen: boolean
  /** True from session end: a late pane draw must not arm another timer. */
  ended: boolean
  /** Teammates already announced as failed or killed, so each is announced once. */
  announced: Set<string>
  /** Recent 5-hour usage readings for the burn-rate forecast (memory only). */
  samples: PctSample[]
  /** Workers already announced as stalled; cleared per worker once it is active again. */
  stallNoticed: Set<string>
  /** Re-reads the roster while a team is live, so a stall is seen though nothing else happens. */
  stallTimer: { cancel: () => void } | null
  /** True once /ctk-report was suggested for the current team run; cleared when a teammate is live again. */
  reportSuggested: boolean
  /** Lead compactions and turns where the cache went cold, for the report's Friction section (memory only). */
  friction: { compactions: number; coldCache: number; echoes: number; lifecycle: number }
}

async function ctkDir($: EngineInterface): Promise<string | null> {
  const explicit = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = explicit ? null : (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  const dir = explicit || (home ? `${home}/.claude` : null)
  return dir === null ? null : `${dir.replace(/[\\/]+$/, '')}/ctk`
}

async function statsPath($: EngineInterface, sessionId: string): Promise<string | null> {
  const dir = await ctkDir($)
  return dir === null ? null : `${dir}/stats/${safeSessionId(sessionId)}.json`
}

/** The engine's reminder to use the task (or todo) tools; matched by text, as its type name varies by build. */
const TASK_NUDGE = /(task tools haven't|TodoWrite tool hasn't) been used recently/

/** How many full outputs the Bash filter keeps per session; older ones are overwritten slot by slot. */
export const RECALL_SLOTS = 32
/** A session dir untouched this long is taken as dead: a live parallel session is never emptied. */
const RECALL_STALE_MS = 24 * 3600 * 1000

// One dir per session so a parallel session never overwrites or wipes another's recalls. The Mods API
// has no delete: an emptied file stays on disk as a zero-byte file.
async function recallDir($: EngineInterface, sessionId: string): Promise<string | null> {
  const dir = await ctkDir($)
  return dir === null ? null : `${dir}/recall/${safeSessionId(sessionId)}`
}

/** Writes the full output for Read and returns the note for the model, or null when it was not written. */
async function keepRecall($: EngineInterface, c: Ctx, command: string, stdout: string, stderr: string, hash: string): Promise<string | null> {
  const dir = await recallDir($, c.stats.sessionId)
  if (dir === null) return null
  const path = `${dir}/${c.recallCount % RECALL_SLOTS}.txt`
  await $.fs.write(path, `ctk recall ${hash}\n$ ${command}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`)
  c.recallCount += 1
  return `\n[ctk: output shortened; the full output is in ${path} until this session ends (first line: ctk recall ${hash})]`
}

/**
 * Empties non-empty recall files: every one when `olderThanMs` is null, else only files not written
 * for that long (any session dir, plus loose files of the earlier flat layout). Fails open.
 */
async function wipeRecalls($: EngineInterface, olderThanMs: number | null, now: number, onlyDir?: string) {
  const empty = async (dir: string) => {
    for (const f of await $.fs.list(dir).catch(() => [])) {
      if (f.kind === 'file' && f.size > 0 && (olderThanMs === null || now - f.mtimeMs > olderThanMs)) {
        await $.fs.write(`${dir}/${f.name}`, '').catch(() => undefined)
      }
    }
  }
  try {
    if (onlyDir !== undefined) return await empty(onlyDir)
    const dir = await ctkDir($)
    if (dir === null) return
    await empty(`${dir}/recall`)
    for (const f of await $.fs.list(`${dir}/recall`)) if (f.kind === 'dir') await empty(`${dir}/recall/${f.name}`)
  } catch {
    // No directory yet, or unreadable: nothing to wipe.
  }
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

// Re-reads .git/HEAD (two small files at most) and redraws the band when the branch changed. Never throws.
async function refreshBranch($: EngineInterface, c: Ctx) {
  try {
    const branch = await readBranch(path => $.fs.read(path), await $.session.cwd())
    if (branch === c.branch) return
    c.branch = branch
    c.dirty = true
    $.ui.invalidate('ui.render')
  } catch {
    // No branch shown; the band is otherwise unchanged.
  }
}

/** At most one cap-refusal notice per this gap. */
const CAP_NOTICE_GAP_MS = 60_000

// One desktop notification per event, and the same text as a toast in the terminal; a terminal without
// a channel, or any failure, says nothing.
async function announce($: EngineInterface, texts: string[]) {
  for (const text of texts) {
    try {
      $.ui.toast(text)
    } catch {
      // The toast is a courtesy.
    }
    await $.ui.notify(text, { title: NOTIFY_TITLE }).catch(() => undefined)
  }
}

const STALL_CHECK_MS = 60_000

function armStall($: EngineInterface, c: Ctx) {
  if (c.stallTimer !== null || c.ended || (c.snap.live ?? 0) === 0) return
  c.stallTimer = $.clock.after(STALL_CHECK_MS, () => {
    c.stallTimer = null
    void refresh($, c)
  })
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
    const before = c.snap
    c.snap = snapshotOf(agents, usage, now)
    // Not awaited: $.ui.notify runs the person's Notification hooks first, and a slow one must not hold a spawn or a turn.
    void announce($, [...teamNotices(before, c.snap, c.announced), ...(agents === null ? [] : stallNotices(stalledOf(c.mission, c.snap, c.lastNow), c.stallNoticed))])
    armStall($, c)
    // Once per team run, when the last live teammate has finished: offer the report as the prompt's dim suggestion.
    if ((c.snap.live ?? 0) > 0) c.reportSuggested = false
    else if (before.live !== null && before.live > 0 && c.snap.live === 0 && !c.reportSuggested) {
      c.reportSuggested = true
      void Promise.resolve($.prompt.suggest({ text: '/ctk-report' })).catch(() => undefined)
    }
    // A failed usage read keeps the last figures: a null must not switch a usage limit off.
    if (usage !== null) c.stats.measured = measuredOf(usage, model)
    else if (model !== null) c.stats.measured = { ...c.stats.measured, model }
    noteSample(c.samples, now, c.stats.measured.fiveHourPct)
    if (c.snap.live !== null) c.stats.peakLive = Math.max(c.stats.peakLive, c.snap.live)
    c.ready = true
    c.dirty = true
    $.ui.invalidate('ui.render')
  } catch {
    // Band and stats are best effort.
  }
  await refreshBranch($, c)
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
  const [value, settings, tools, engine] = await Promise.all([
    $.env.get('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS').then(value => ({ value }), () => null),
    $.settings.read().catch(() => null),
    $.tool.list().catch(() => null),
    // Added after the bundled types (2.1.295): an older build rejects, and the row says so.
    Promise.resolve().then(() => $.session.version()).then(v => v.version, () => null),
  ])
  const base = factsFrom({ opts: c.opts, envFlag: value, settings, toolNames: tools === null ? null : tools.map(t => t.name) })
  // The guard is judged from what this session saw, with the flag read just now; callers refresh the roster first.
  const guard = guardOf(c.stats, c.snap, base.teamsEnabled, c.ready)
  return { ...base, guard: { state: guard.state, why: guard.why }, outsideCap: c.stats.spawnsOutsideCap, engine }
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
          subagentModels: prior.subagentModels ?? {},
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
  try {
    c.mo = newMotionState(reducedFrom(await $.env.get('CTK_REDUCED_MOTION'), await $.env.get('NO_COLOR')))
  } catch {
    // Keep motion on its default.
  }
  await detectEnvironment($, c)
  await refresh($, c)
}

// Stops the redraw timer. Called when the pane closes and when the session ends.
function stopMotion(c: Ctx, ended = false) {
  if (ended) c.ended = true
  c.moTimer?.cancel()
  c.moTimer = null
  c.paneOpen = false
}

// One timer at most, and only while the pane is drawing and something moves (a running worker, or a highlight
// still to end). Each fire redraws the pane, which arms the next; a pane that is gone draws nothing, so the
// chain ends by itself.
function armMotion($: EngineInterface, c: Ctx, mission: Mission, now: number) {
  if (c.moTimer !== null || c.ended) return
  const ms = delayFor(c.mo, mission, now)
  if (ms === null) return
  c.moTimer = $.clock.after(ms, () => {
    c.moTimer = null
    if (!c.paneOpen || c.ended) return
    try {
      c.mo = { ...c.mo, frame: c.mo.frame + 1 }
      $.ui.invalidate('ui.render')
    } catch {
      // A redraw that cannot be asked for ends the chain; motion is decoration.
    }
  })
}

const noop = () => {}

const bandSignals = (c: Ctx) => {
  const s = signalsOf(c.mission, c.snap, c.lastNow)
  return { stalled: s.stalled, ready: s.ready.length, idleWorkers: s.idleWorkers.length }
}

/** The one line for the lead when it closes the last open task while teammate completions are unchecked; null otherwise. */
const uncheckedAtEnd = (m: MissionState): string | null => {
  const tasks = [...m.tasks.values()].filter(t => t.status !== 'deleted')
  if (tasks.some(t => t.status !== 'completed')) return null
  const ids = tasks.filter(t => m.unverified.has(t.id)).map(t => `#${t.id}`)
  return ids.length === 0 ? null : `CTK: ${ids.join(' ')} ${ids.length === 1 ? 'was' : 'were'} completed by a teammate and not checked by you yet; run the tests or inspect the result before reporting done.`
}

const missionOf = (c: Ctx) =>
  buildMission({ stats: c.stats, snap: c.snap, state: c.mission, nowMs: c.lastNow, teamsEnabled: c.teamsEnabled, ready: c.ready, cache: c.cache, samples: c.samples })

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
    if (key.startsWith(TRANSCRIPT_PREFIX)) {
      // $.ui.view arrived in Claude Code 2.1.300, after the generated types: on an older build the call
      // throws, as it does for an agent that ended or left the list; both are caught below.
      // The cast is erased at compile time: the call site must stay `$.ui.view(...)` for the validator.
      await ($.ui as unknown as { view: (args: { agentId: string }) => Promise<unknown> }).view({ agentId: key.slice(TRANSCRIPT_PREFIX.length) })
      return
    }
    const r = pressMc(c.mc, key)
    c.mc = r.mc
    if (r.effect === 'close') {
      stopMotion(c)
      await $.ui.close({ id: MC_PANE_ID })
    }
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
  try {
    now = await $.clock.now()
    // The gate is "no teammate is STARTING" (docs/MISSION-CONTROL.md): roster-live teammates
    // deliberately do not block a confirmed change — lowering the cap below the live count is
    // allowed, and the guard then refuses further spawns. The roster read is not for a count but
    // for its prune: spawns the roster has settled leave c.pending, so only ones still starting
    // (c.inflight reservations, c.pending not yet listed) block.
    prunePending(await $.agent.list(), c.pending, now)
  } catch {
    c.notice = 'Not applied: the clock or the roster could not be read, so CTK cannot tell the team is settled.'
    return
  }
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
    cache: null,
    cacheWarm: false,
    lastCapNotice: 0,
    inflight: 0,
    pending: new Map(),
    lastNow: 0,
    ready: false,
    dirty: false,
    lastWrite: 0,
    lastDraw: 0,
    toolSeen: new Set(),
    recallCount: 0,
    coordinated: false,
    branch: null,
    ambiguous: 1,
    mission: newMissionState(),
    mc: newMcState(),
    teamsEnabled: null,
    cfg: emptyPending(),
    notice: null,
    applying: false,
    mo: newMotionState(),
    moTimer: null,
    paneOpen: false,
    ended: false,
    announced: new Set(),
    samples: [],
    lastBudgetNotice: 0,
    stallNoticed: new Set(),
    stallTimer: null,
    reportSuggested: false,
    friction: { compactions: 0, coldCache: 0, echoes: 0, lifecycle: 0 },
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
      // Started, not merely requested: only a result with an agentId ran a subagent.
      if (r.deny === undefined && r.agentId !== undefined) c.stats.subagentModels[r.model] = (c.stats.subagentModels[r.model] ?? 0) + 1
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
      if (c.opts.stopAtFiveHourPct > 0 || c.opts.stopAtCostUsd > 0) {
        await refresh($, c, false)
        const why = budgetReached(c.opts, c.stats.measured)
        if (why !== null) {
          release()
          c.stats.spawnsBudgetStopped += 1
          const now = await $.clock.now().catch(() => 0)
          if (now - c.lastBudgetNotice >= CAP_NOTICE_GAP_MS) {
            c.lastBudgetNotice = now
            void announce($, [budgetNotice(why)])
          }
          return { deny: budgetDeny(why) }
        }
      }
      const live = await liveTeammates($, c)
      if (live + c.inflight > c.opts.maxWorkers) {
        const starting = c.inflight - 1
        release()
        c.stats.spawnsRejected += 1
        // A lead that retries a refused spawn would otherwise raise one notice per try.
        const now = await $.clock.now().catch(() => 0)
        if (now - c.lastCapNotice >= CAP_NOTICE_GAP_MS) {
          c.lastCapNotice = now
          void announce($, [capNotice(live, c.opts.maxWorkers)])
        }
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
        // `teammateId.split('@')[0]` is always a string, so the name fallback needs no further `??`.
        noteSpawn(c.mission, started.agentId, e.name ?? started.teammateId.split('@')[0], started.model, acceptedAt)
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
    await refreshBranch($, c) // a `git checkout` the person ran themselves shows up with their next prompt
    const hint = c.opts.teamHint ? teamHintFor(e) : null
    return next(hint === null ? e : { ...e, context: [...(e.context ?? []), hint] })
  }).catch(($, e, next) => next(e))

  // The engine nudges the model to use the task tools every few turns. Once this session has created
  // tasks the lead already keeps a task list, so the nudge is noise; before that it is left alone.
  on('prompt.attachment', async ($, e, next) => {
    const r = await next(e)
    if (e.origin?.kind !== 'engine' || ((c.stats.tasks?.created ?? 0) === 0 && c.mission.tasks.size === 0)) return r
    return TASK_NUDGE.test(r.text ?? '') ? { text: null } : r
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    c.ended = false
    try {
      await $.tool.register({
        name: STATUS_TOOL_NAME,
        description: 'Live CTK team state: workers, cap, accepted and refused spawns. Quota, cost and context are left out unless includeUsage is true; ask for them only when the person asks about usage.',
        inputSchema: { type: 'object', properties: { includeUsage: { type: 'boolean' } } },
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
            value: { description: 'maxWorkers: whole number 1-12; models: alias or id; hudBand, recordStats, teamHint and bashFilter: true or false' },
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
    try {
      await $.command.register({ name: 'ctk-report', description: 'Print a team summary for a PR body (tasks, spawns, cost, changed files).' })
    } catch {
      // Without the command /ctk-stats still prints the counters.
    }
    c.cache = null
    c.cacheWarm = false
    // Off: recalls from before it was turned off would stay on disk. On: only dead sessions' files go.
    await wipeRecalls($, c.opts.bashFilter ? RECALL_STALE_MS : null, await $.clock.now().catch(() => 0))
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
    // The main loop only (a subagent's turn carries agentId): the usage is that turn's own, free, no extra call.
    if (e.agentId === undefined && e.usage !== undefined) {
      if (e.usage.cache_read_input_tokens > 0) c.cacheWarm = true
      const was = cacheHealth(c.cache)?.state
      c.cache = c.cacheWarm ? e.usage : null
      if (cacheHealth(c.cache)?.state === 'cold' && was !== 'cold') c.friction.coldCache++
    }
    await detectEnvironment($, c)
    await refresh($, c)
    noteWorkerTurnEnd(c.mission, (e as { agentId?: string }).agentId, c.lastNow, e.usage)
    return r
  })

  // An agent that claims a task with TaskUpdate is sent its own task_assignment back, which wakes it for a whole
  // extra turn. Only that echo (assignedBy is the recipient; the main conversation is the team's lead) is dropped,
  // and so is shutdown bookkeeping that woke the lead to say nothing. Everything else arrives.
  on('session.receive', async ($, e, next) => {
    if (e.agentId === undefined && isLifecycleOnly(e.text)) {
      c.friction.lifecycle++
      return { consumed: 'ctk: shutdown bookkeeping' }
    }
    const name = e.agentId === undefined ? LEAD_NAME : c.snap.workers.find(w => w.agentId === e.agentId)?.name
    if (name === undefined || !isOwnAssignmentEcho(e.text, name)) return next(e)
    c.friction.echoes++
    return { consumed: 'ctk: own task_assignment echo' }
  }).catch(($, e, next) => next(e))

  // Whatever compacts, the summarizer is told to keep the live team and open tasks; with no team it is untouched.
  on('session.compact', async ($, e, next) => {
    // A subagent's or teammate's own compaction (agentId set) is about its task, not the lead's team.
    if (e.trigger === 'precompute' || (e as { agentId?: string }).agentId !== undefined) return next(e)
    c.friction.compactions++
    const summary = teamSummary(c.snap, c.mission.tasks.values(), c.opts.maxWorkers)
    return next(summary === null ? e : { ...e, instructions: e.instructions ? `${e.instructions}\n\n${summary}` : summary })
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    stopMotion(c, true)
    c.stallTimer?.cancel()
    c.stallTimer = null
    await persist($, c, true)
    // A recall can hold whatever a command printed, secrets included: it outlives no session.
    const dir = await recallDir($, c.stats.sessionId).catch(() => null)
    if (dir !== null) await wipeRecalls($, null, 0, dir)
    return next(e)
  })

  // Read-only counters: these never block a task. A task event changes only these counters (the
  // board rides tool.call/noteTaskCall, the roster rides spawn/measure/turn events), so it goes
  // through the throttled touch() like tool.call does: a burst of 50 events costs bounded host
  // calls instead of 50 full refreshes, and the counter reaches the stats file on the next
  // throttled write at the latest — a session's forced end-write guarantees it.
  on('classic.TaskCreated', async ($, e, next) => {
    c.stats.tasks = { created: (c.stats.tasks?.created ?? 0) + 1, completed: c.stats.tasks?.completed ?? 0 }
    await touch($, c)
    return next(e)
  })

  on('classic.TaskCompleted', async ($, e, next) => {
    c.stats.tasks = { created: c.stats.tasks?.created ?? 0, completed: (c.stats.tasks?.completed ?? 0) + 1 }
    await touch($, c)
    return next(e)
  })

  // Every tool call the model makes, in the lead and in subagents and teammates, counts once by
  // its tool_use_id. The count happens before the call runs and the call is passed on untouched;
  // a call a hook later denies still counts, because the model made it.
  on('tool.call', async ($, e, next) => {
    const isNew = isNewToolCall(c.toolSeen, e.tool_use_id)
    if (isNew) c.stats.toolCalls += 1
    // A call still running is activity: a tool that takes over ten minutes must not read as a stall.
    if (isNew && e.agentId !== undefined) noteWorkerActive(c.mission, e.agentId, await $.clock.now().catch(() => c.lastNow))
    const r = await next(e)
    await touch($, c)
    if (isNew) {
      noteWorkerToolCall(c.mission, e.agentId, c.lastNow, toolLabel(e.tool, e), r.deny !== undefined || r.isError === true)
      if (e.tool === 'Bash' && e.agentId === undefined) noteLeadBash(c.mission)
      // The task board is built from the Task tools' named fields only (see noteTaskCall), and only
      // from a call that ran: a denied or failed one changes nothing.
      if (r.deny === undefined && r.isError !== true) {
        const path = noteFileChange(c.mission, e.tool, e, e.agentId)
        const note = path === null ? null : newCollisionNote(c.mission, c.snap, path)
        if (note !== null) return { ...r, context: [...(r.context ?? []), note] }
      }
      if ((e.tool === 'TaskCreate' || e.tool === 'TaskUpdate') && r.deny === undefined) {
        const result = (r as { result?: unknown }).result
        const taskId = (e as { taskId?: unknown }).taskId
        const wasOpen = typeof taskId === 'string' && c.mission.tasks.get(taskId)?.status !== 'completed'
        noteTaskCall(c.mission, e.tool, e as unknown as Record<string, unknown>, result, e.agentId)
        const failed = (result as { success?: unknown } | null | undefined)?.success === false
        const completes = (e as { status?: unknown }).status === 'completed' && wasOpen
        const left = e.agentId === undefined && e.tool === 'TaskUpdate' && completes && !failed && r.isError !== true ? uncheckedAtEnd(c.mission) : null
        if (left !== null) return { ...r, context: [...(r.context ?? []), left] }
      }
    }
    return r
  }).catch(($, e, next) => next(e)) // whatever fails here, the model's tool call still goes through

  // Opt-in (bashFilter): a long test, build or log output reaches the model cut to its failures,
  // with the full text written where Read can get it. Only a write that succeeded is announced;
  // otherwise the model gets the output untouched.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    // The inner try/catch (not the .catch below) so a failed recall write returns the original output.
    try {
      if (!c.opts.bashFilter || r.deny !== undefined) return r
      const command = String((e as { command?: unknown }).command ?? '')
      // A non-zero exit arrives as isError with the text as a string, which core will not take back
      // as a result (verified on 2.1.310); a deny carries the shortened text as the same error.
      if (r.isError === true) {
        if (typeof r.result !== 'string') return r
        const f = filterBashOutput(command, r.result)
        const note = f.changed ? await keepRecall($, c, command, r.result, '', f.hash) : null
        return note === null ? r : { deny: f.text + note }
      }
      const out = r.result as { stdout?: unknown; stderr?: unknown; persistedOutputPath?: unknown } | undefined
      // stdout is only a preview of a persisted output: shortening it would hide what Read can fetch.
      if (out?.persistedOutputPath) return r
      if (typeof out?.stdout !== 'string' || typeof out.stderr !== 'string') return r
      const so = filterBashOutput(command, out.stdout)
      const se = filterBashOutput(command, out.stderr)
      if (!so.changed && !se.changed) return r
      const note = await keepRecall($, c, command, out.stdout, out.stderr, hashOutput(`${out.stdout}\0${out.stderr}`))
      if (note === null) return r
      return { result: { ...out, stdout: so.text + note, stderr: se.text }, ...(r.context ? { context: r.context } : {}) }
    } catch {
      return r
    }
  }).catch(($, e, next) => next(e)) // a failure before next() runs: the call goes through untouched

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
      budgetStopped: c.stats.spawnsBudgetStopped,
      accepted: c.stats.spawnsAccepted,
      cap: c.opts.maxWorkers,
      teamsEnabled: facts.teamsEnabled,
      taskTools: facts.taskTools,
      ...missionJson(missionOf(c), (e as { includeUsage?: unknown }).includeUsage === true),
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

  on('command.run', { command: 'ctk-report' }, async ($, e, next) => {
    await refresh($, c)
    const teamMs = c.mission.teamStartedAt === null ? null : Math.max(0, c.lastNow - c.mission.teamStartedAt)
    return { text: formatReport({ stats: c.stats, tasks: c.mission.tasks.values(), files: c.mission.files, filesDropped: c.mission.filesDropped, cwd: await $.session.cwd().catch(() => null), teamMs, friction: { ...c.friction, failed: c.snap.failed ?? 0 } }) }
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const entry = 'CTK ▸ '
    const guard = guardOf(c.stats, c.snap, c.teamsEnabled, c.ready).label
    // Until a teammate has started, the band may show less: only the entry and the guard, or nothing
    // (then /ctk-mission is the way in). Once a team has run, the band always shows in full.
    const waiting = sweep(c.cfg, c.lastNow).pending !== null
    const idle = c.mission.workers.size === 0 && (c.snap.live ?? 0) === 0 && c.stats.spawnsAccepted === 0 && !waiting
    if (idle && c.opts.hudIdle === 'hidden') return next(e)
    const room = e.props.bodyColumns - displayWidth(entry, c.ambiguous)
    const parts =
      idle && c.opts.hudIdle === 'minimal'
        ? GUARD_QUIET.has(guard) ? [] : [{ text: `Guard ${guard}` }]
        : bandParts(c.stats, c.snap, room, {
            nowMs: c.lastNow,
            ambiguous: c.ambiguous,
            coordinated: c.coordinated,
            branch: c.branch,
            guard,
            cache: cacheHealth(c.cache),
            ...bandSignals(c),
            subagentsLive: c.snap.subagents.filter(a => isLiveStatus(a.status)).length,
            pendingChange: waiting,
            tierColumns: forcedTierColumns(c.mc.hudMode) ?? e.viewport?.columns ?? e.props.bodyColumns + BAND_MARGIN,
          })
    return (
      <Box marginTop={1}>
        <Button key={OPEN_KEY} plain label="Open CTK Mission Control" onPress={noop}>
          {/* Accent and underline say the band is a button; the figures stay dim unless one needs attention. */}
          <Text bold underline color="suggestion">{entry.trimEnd()}</Text>
          <Text> </Text>
          {parts.flatMap((p, i) => [
            ...(i > 0 ? [<Text key={`s${i}`} dimColor>{BAND_SEP}</Text>] : []),
            p.tone === undefined ? (
              <Text key={`p${i}`} dimColor>{p.text}</Text>
            ) : (
              <Text key={`p${i}`} bold={p.tone === 'bad'} color={p.tone === 'bad' ? 'error' : 'warning'}>{p.text}</Text>
            ),
          ])}
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== MC_PANE_ID) return next(e)
    const now = await $.clock.now().catch(() => c.lastNow)
    c.paneOpen = true
    // One Mission and one pending-change sweep for the whole frame: observe, the motion timer and
    // the draw all read the same snapshot, so buildMission (with its O(n²) task rows) runs once,
    // not three times, and the pane cannot show motion from one draw and rows from another.
    const mission = missionOf(c)
    const pending = sweep(c.cfg, c.lastNow).pending
    c.mo = observe(c.mo, mission, now)
    armMotion($, c, mission, now)
    return renderMission(
      $.ui.resolve(e),
      mission,
      c.mc,
      {
        statsText: formatSummary(c.stats, c.snap, c.lastNow),
        options: describeOptions(c.opts).map(r => ({ label: r.label, value: r.shown })),
        pending: pending === null ? null : { id: pending.id, text: pending.change.text },
        notice: c.notice,
      },
      { ...e.props, ambiguous: c.ambiguous, motion: motionOf(c.mo) },
    )
  })
}
