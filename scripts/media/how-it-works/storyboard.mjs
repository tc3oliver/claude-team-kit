// The data behind the "How CTK works" illustration: one made-up goal, its task graph, a schedule of
// who works on what, and the captions. Pure data plus `validate`, so the picture cannot show an
// impossible moment (a task started before its blockers finished, a fourth busy worker, an arrow
// from the cap to a worker). Nothing here is a recording: the scenario is invented.

/** Length of one loop, in seconds. */
export const DURATION = 24

/** Where the loop's still image (the poster, and the reduced-motion fallback) is taken. */
export const POSTER_AT = 12.9

export const CAP = 3

export const GOAL = 'Use a team to implement authentication improvements and add regression tests'

// Each task is a vertical slice: it ships one working behaviour together with its own tests, so it
// can be checked alone. `after` lists the tasks that must be finished first, each for a stated reason.
export const TASKS = [
  { id: 'T1', label: 'Lockout', after: [], why: 'failed logins lock the account; a good login resets the count' },
  { id: 'T2', label: 'Hash upgrade', after: [], why: 'new hashes use a stronger algorithm; old ones still verify' },
  { id: 'T3', label: 'Cookie flags', after: [], why: 'secure session cookie flags and an idle timeout' },
  { id: 'T4', label: 'Audit log', after: ['T1'], why: 'records the lockout events T1 introduces' },
  { id: 'T5', label: 'IP throttle', after: ['T1'], why: 'reuses the attempt counter T1 introduces' },
  { id: 'T6', label: 'Reset flow', after: ['T1', 'T2'], why: 'clears a lockout (T1) and writes the new hash (T2)' },
  { id: 'T7', label: 'Rotation', after: ['T3', 'T6'], why: 'needs the hardened session (T3) and the reset event (T6)' },
  { id: 'T8', label: 'Verify all', after: ['T4', 'T5', 'T7'], why: 'the final check: runs after every slice is done' },
]

export const WORKERS = ['W1', 'W2', 'W3']

// Who works on which task, and when (seconds on the loop). T8 belongs to the lead: the closing
// check is run by the lead itself, not by a teammate.
export const SCHEDULE = [
  { task: 'T1', by: 'W1', start: 6.8, end: 10.6 },
  { task: 'T2', by: 'W2', start: 7.1, end: 14.4 },
  { task: 'T3', by: 'W3', start: 7.4, end: 15.8 },
  { task: 'T4', by: 'W1', start: 12.0, end: 17.2 },
  { task: 'T6', by: 'W2', start: 15.0, end: 18.0 },
  { task: 'T5', by: 'W3', start: 16.2, end: 18.4 },
  { task: 'T7', by: 'W1', start: 18.2, end: 19.6 },
  { task: 'T8', by: 'Lead', start: 19.8, end: 21.4 },
]

/** The three teammates exist from these moments; capacity reads n/3 from then on. */
export const WORKER_UP = { W1: 6.5, W2: 6.8, W3: 7.1 }

/** The layers of the story. A caption names which one is responsible for what it describes. */
export const LAYERS = {
  native: { name: 'Native', color: '#9aa4b2' },
  skill: { name: 'Skill-guided', color: '#b392f0' },
  mod: { name: 'Mod-enforced', color: '#f2994a' },
}

// title <= 52 characters, note <= 80: the caption has to stay readable on a phone-sized embed.
export const CAPTIONS = [
  { from: 0.7, to: 4.5, layers: ['skill', 'native'], title: 'Plan: cut vertical slices with real dependencies', note: 'The lead writes the tasks; Claude Code keeps the shared list.' },
  { from: 4.6, to: 6.9, layers: ['skill', 'native'], title: 'Ready frontier: blocked tasks cannot be claimed', note: 'Only tasks with no open blockers are started.' },
  { from: 7.0, to: 11.0, layers: ['mod'], title: 'Bounded parallelism: capacity 3/3', note: 'The mod caps native teammate spawns, not ordinary subagents.' },
  { from: 11.1, to: 14.5, layers: ['skill'], title: 'Handoff by pointers, not pasted context', note: 'The extra ready task waits. The lead reassigns an idle worker.' },
  { from: 14.6, to: 19.6, layers: ['native', 'skill'], title: 'Done unblocks dependents; the lead hands work on', note: 'The lead or the teammate picks the next task; CTK does not.' },
  { from: 19.7, to: 21.6, layers: ['skill'], title: 'Verification: done means verified', note: 'The skill asks the lead to run the check and read the result first.' },
]

/** What the lead is doing, shown on its card. */
export const LEAD_STATES = [
  { from: 0.7, to: 4.5, text: 'writing tasks' },
  { from: 6.2, to: 7.5, text: 'starting 3 workers' },
  { from: 11.6, to: 14.1, text: 'handing off T4' },
  { from: 14.8, to: 15.5, text: 'handing off T6' },
  { from: 15.9, to: 16.6, text: 'handing off T5' },
  { from: 18.0, to: 18.7, text: 'handing off T7' },
  { from: 19.7, to: 21.5, text: 'running the check' },
]

/** A short reassignment arrow from the lead to a worker (the lead hands the task over). */
export const HANDOFFS = [
  { task: 'T4', worker: 'W1', from: 11.6, until: 12.6 },
  { task: 'T6', worker: 'W2', from: 14.8, until: 15.5 },
  { task: 'T5', worker: 'W3', from: 15.9, until: 16.6 },
  { task: 'T7', worker: 'W1', from: 18.0, until: 18.7 },
]

// The handoff card for T4. The paths are invented for the illustration.
export const HANDOFF_CARD = {
  from: 11.7,
  to: 14.3,
  fields: [
    ['Task ID', 'T4'],
    ['Spec path', 'specs/auth/T4.md'],
    ['File scope', 'src/auth/audit/**'],
    ['Verify', 'npm test -- audit'],
  ],
}

export const VERIFY_CARD = { from: 19.8, to: 21.5, command: 'npm test && npm run typecheck', result: 'exit 0' }

export const FINAL = { from: 21.7, to: 23.6 }

export const TAGLINE = [
  { text: 'Native Agent Teams.', layer: 'native' },
  { text: 'Structured Execution.', layer: 'skill' },
  { text: 'Controlled Parallelism.', layer: 'mod' },
]

/** Everything `validate` looks at, so a test can hand it a broken copy. */
export const MODEL = { TASKS, SCHEDULE, WORKER_UP, HANDOFFS, CAPTIONS, FINAL, WORKERS, CAP, POSTER_AT, DURATION }

const lookups = (m = MODEL) => {
  const byTask = id => {
    const t = m.TASKS.find(x => x.id === id)
    if (t === undefined) throw new Error(`unknown task ${id}`)
    return t
  }
  const slot = id => {
    const s = m.SCHEDULE.find(x => x.task === id)
    if (s === undefined) throw new Error(`task ${id} is not scheduled`)
    return s
  }
  const endOf = id => slot(id).end
  const startOf = id => slot(id).start
  /** When a task became ready: the latest end among its blockers (0 when it has none). */
  const readyAt = id => Math.max(0, ...byTask(id).after.map(b => endOf(b)))
  return { byTask, slot, endOf, startOf, readyAt }
}

export const { readyAt, startOf, endOf } = lookups()

/** Tasks first become visible (as blocked or ready) while the plan is drawn. */
export const planAppearAt = id => 1.0 + TASKS.findIndex(t => t.id === id) * 0.28

/** The moment every task has been shown and the ready ones light up. */
export const FRONTIER_AT = 4.8

/** Throws on the first impossible moment in the storyboard; returns the number of checks made. */
export const validate = (m = MODEL) => {
  const { byTask, endOf: end, startOf: start, readyAt: ready } = lookups(m)
  let checks = 0
  const check = (ok, msg) => {
    checks++
    if (!ok) throw new Error(`storyboard: ${msg}`)
  }
  const ids = new Set(m.TASKS.map(t => t.id))
  check(ids.size === m.TASKS.length, 'duplicate task id')
  for (const t of m.TASKS) for (const b of t.after) check(ids.has(b) && b !== t.id, `${t.id} depends on unknown or itself ${b}`)

  // no cycles: order by repeatedly removing tasks whose blockers are gone
  const left = new Map(m.TASKS.map(t => [t.id, new Set(t.after)]))
  while (left.size > 0) {
    const free = [...left].filter(([, deps]) => deps.size === 0).map(([id]) => id)
    check(free.length > 0, 'the task graph has a cycle')
    for (const id of free) left.delete(id)
    for (const deps of left.values()) for (const id of free) deps.delete(id)
  }

  check(m.SCHEDULE.length === m.TASKS.length, 'every task is scheduled exactly once')
  for (const t of m.TASKS) check(m.SCHEDULE.filter(s => s.task === t.id).length === 1, `${t.id} is scheduled once`)

  for (const s of m.SCHEDULE) {
    check(s.start >= 0 && s.end > s.start && s.end <= m.FINAL.from, `${s.task} has a sane window`)
    for (const b of byTask(s.task).after) check(end(b) <= s.start, `${s.task} starts before its blocker ${b} finished`)
    check(s.by === 'Lead' || m.WORKERS.includes(s.by), `${s.task} is run by an unknown worker`)
  }
  check(m.SCHEDULE.find(s => s.task === 'T8')?.by === 'Lead', 'the final check is the lead\u2019s')

  // a worker does one thing at a time, and exists before it is given work
  for (const w of [...m.WORKERS, 'Lead']) {
    const mine = m.SCHEDULE.filter(s => s.by === w).sort((a, b) => a.start - b.start)
    for (let i = 1; i < mine.length; i++) check(mine[i - 1].end <= mine[i].start, `${w} works on two tasks at once`)
    if (w !== 'Lead') for (const s of mine) check(m.WORKER_UP[w] <= s.start, `${w} is given ${s.task} before it exists`)
  }

  // the cap: never more teammates alive than allowed (they all stay alive, idle or busy), never more busy
  check(m.WORKERS.length <= m.CAP, 'more workers than the cap')
  const times = m.SCHEDULE.flatMap(s => [s.start, s.end]).sort((a, b) => a - b)
  for (const t of times) {
    const busy = m.SCHEDULE.filter(s => s.by !== 'Lead' && s.start <= t + 1e-9 && t < s.end - 1e-9).length
    check(busy <= m.CAP, `${busy} workers busy at ${t}s, above the cap`)
  }

  // a reassignment is the lead's: each arrow points at the worker that gets the task, after the task is ready
  for (const h of m.HANDOFFS) {
    const s = m.SCHEDULE.find(x => x.task === h.task)
    check(s !== undefined && s.by === h.worker, `handoff of ${h.task} goes to the wrong worker`)
    check(h.until > h.from, `handoff of ${h.task} has a window`)
    check(h.from >= ready(h.task) - 1e-9, `${h.task} is handed off before it is ready`)
    check(h.from <= s.start && s.start <= h.from + 1.5, `${h.task} starts right after its handoff`)
  }

  // the extra ready task really waits: ready while every teammate is alive and none is free to take it
  check(start('T5') - ready('T5') > 4, 'T5 waits for a slot')

  // the loop: captions in order, inside the loop, no overlap
  let prev = 0
  for (const c of m.CAPTIONS) {
    check(c.from >= prev - 1e-9 && c.to > c.from && c.to <= m.DURATION, 'captions overlap or leave the loop')
    check(c.title.length <= 52 && c.note.length <= 80, 'caption too long for a phone-sized embed')
    prev = c.to
  }
  check(m.FINAL.from >= prev - 1e-9 && m.FINAL.to < m.DURATION, 'the closing card fits the loop')
  check(m.POSTER_AT > 0 && m.POSTER_AT < m.FINAL.from, 'the poster is taken before the closing card')
  return checks
}
