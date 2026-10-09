import { DEFAULT_OPTIONS, HUD_IDLE } from '../shared/policy.ts'
import type { PolicyOptions } from '../shared/policy.ts'

// Pure logic for changing CTK's own plugin options from the Mods API: what may be set, how a
// requested value is checked, and the pending-change state machine behind the Confirm button.
// No host calls here and nothing is written: the one write, `$.config.set`, lives in the caller
// and runs only after `confirm` returned `confirmed`. docs/CONFIG-API-NOTES.md has the evidence.

/** The plugin's name; `$.config` rows are keyed `<plugin>.<field>`. */
export const PLUGIN_NAME = 'ctk'

export const OPTION_NAMES = [
  'maxWorkers',
  'explorerModel',
  'implementerModel',
  'reviewerModel',
  'highRiskModel',
  'designerModel',
  'hudBand',
  'hudIdle',
  'recordStats',
  'teamHint',
] as const satisfies readonly (keyof PolicyOptions)[]
export type OptionName = (typeof OPTION_NAMES)[number]

// Compile-time guard: a PolicyOptions field missing from OPTION_NAMES fails the typecheck here.
type Missing = Exclude<keyof PolicyOptions, OptionName>
const noneMissing: [Missing] extends [never] ? true : never = true
void noneMissing

export type OptionValue = number | string | boolean

export const isOptionName = (name: unknown): name is OptionName => (OPTION_NAMES as readonly unknown[]).includes(name)

/** The `$.config.list()` / `$.config.set` row key of an option: `ctk.maxWorkers`. */
export const optionKey = (name: OptionName): string => `${PLUGIN_NAME}.${name}`

/** The cap the CLI schema (src/core/schema.ts) and the plugin.json `min`/`max` both enforce. */
export const WORKERS_MIN = 1
export const WORKERS_MAX = 12
export const MODEL_MAX_LENGTH = 100
/** A pending change older than this cannot be confirmed. */
export const PENDING_TTL_MS = 10 * 60_000

const MODEL_PATTERN = /^[A-Za-z0-9._:\-[\]]+$/
// Credential shapes and long opaque tokens. A model alias or id is never one of these.
const SECRET_PATTERN = /^(?:(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}|gh[pos]_[A-Za-z0-9]{8,}|xox[a-z]-|AKIA[A-Z0-9]{12,}|AIza[A-Za-z0-9_-]{20,})|[A-Za-z0-9_-]{40,}/

type Meta = { label: string; hint: string; allowed: string }

const MODEL_ALLOWED = 'an alias (haiku, sonnet, opus), a full model id, or inherit'

const META: Record<OptionName, Meta> = {
  maxWorkers: {
    label: 'Max live teammates',
    hint: 'Hard cap on teammates alive at once. Further spawns are refused.',
    allowed: `a whole number from ${WORKERS_MIN} to ${WORKERS_MAX}`,
  },
  explorerModel: { label: 'Explorer model', hint: 'Model for ctk:explorer.', allowed: MODEL_ALLOWED },
  implementerModel: { label: 'Implementer model', hint: 'Model for ctk:implementer.', allowed: MODEL_ALLOWED },
  reviewerModel: { label: 'Reviewer model', hint: 'Model for ctk:reviewer.', allowed: MODEL_ALLOWED },
  highRiskModel: { label: 'High-risk reviewer model', hint: 'Model for ctk:high-risk-reviewer.', allowed: MODEL_ALLOWED },
  designerModel: { label: 'Designer model', hint: 'Model for ctk:designer.', allowed: MODEL_ALLOWED },
  hudBand: { label: 'Team band', hint: 'Show the one-line team status band above the prompt.', allowed: 'on or off' },
  hudIdle: { label: 'Band while no team runs', hint: 'What the band shows until a teammate has started.', allowed: 'full, minimal or hidden' },
  recordStats: { label: 'Record stats', hint: 'Write small per-session counters for the ctk stats command.', allowed: 'on or off' },
  teamHint: { label: 'Team hint', hint: 'Add one hidden hint line to a prompt that asks for several agents or a team.', allowed: 'on or off' },
}

/** The sections Mission Control groups the options into, in display order. */
export const OPTION_GROUPS: { title: string; names: OptionName[] }[] = [
  { title: 'Team', names: ['maxWorkers'] },
  { title: 'Models', names: ['explorerModel', 'implementerModel', 'reviewerModel', 'highRiskModel', 'designerModel'] },
  { title: 'Band', names: ['hudBand', 'hudIdle'] },
  { title: 'Other', names: ['recordStats', 'teamHint'] },
]

/** The group title for an option label as the pane receives it; unknown labels fall under Other. */
export const groupOfLabel = (label: string): string => {
  const name = OPTION_NAMES.find(n => META[n].label === label)
  return OPTION_GROUPS.find(g => name !== undefined && g.names.includes(name))?.title ?? 'Other'
}

export type OptionRow = {
  name: OptionName
  label: string
  /** The value now, typed. */
  value: OptionValue
  /** The value now as text (`on` / `off` for a switch). */
  shown: string
  hint: string
  allowed: string
  /** The shipped default, as text. */
  defaultShown: string
}

export const showValue = (v: OptionValue): string => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v))

/** Every option with its current value, for display in a pane or a `show` answer. */
export const describeOptions = (opts: PolicyOptions): OptionRow[] =>
  OPTION_NAMES.map(name => ({
    name,
    label: META[name].label,
    value: opts[name],
    shown: showValue(opts[name]),
    hint: META[name].hint,
    allowed: META[name].allowed,
    defaultShown: showValue(DEFAULT_OPTIONS[name]),
  }))

export type Change = {
  name: OptionName
  /** The key `$.config.set` takes. */
  key: string
  /** The validated, correctly typed new value. */
  value: OptionValue
  /** The value when the change was proposed. */
  from: OptionValue
  /** One line for the person: `Max live teammates (maxWorkers): 3 -> 2`. */
  text: string
}

export type ValidateOk = { ok: true } & Change
export type ValidateFail = {
  ok: false
  /** What went wrong, in words the model can relay. Never echoes a rejected string. */
  reason: string
  code: 'unknown_option' | 'invalid_value' | 'unchanged'
}
export type ValidateResult = ValidateOk | ValidateFail

const fail = (code: ValidateFail['code'], reason: string): ValidateFail => ({ ok: false, reason, code })

const SAFE_NAME = /^[A-Za-z0-9_.-]{1,40}$/

const parseWorkers = (raw: unknown): number | string => {
  let n: number | undefined
  if (typeof raw === 'number') n = raw
  else if (typeof raw === 'string' && /^\s*\d{1,3}\s*$/.test(raw)) n = Number(raw)
  if (n === undefined) return `maxWorkers takes ${META.maxWorkers.allowed}, not ${typeof raw === 'string' ? 'that text' : typeof raw}.`
  if (!Number.isInteger(n) || n < WORKERS_MIN || n > WORKERS_MAX) {
    return `maxWorkers takes ${META.maxWorkers.allowed}; ${Number.isFinite(n) ? n : 'that value'} does not qualify.`
  }
  return n
}

const parseModel = (name: OptionName, raw: unknown): string => {
  if (typeof raw !== 'string') throw new Error(`${name} takes ${MODEL_ALLOWED}, not ${typeof raw}.`)
  const v = raw.trim()
  if (v === '') throw new Error(`${name} cannot be empty; use inherit to follow the session model.`)
  if (v.length > MODEL_MAX_LENGTH) throw new Error(`${name} is limited to ${MODEL_MAX_LENGTH} characters.`)
  if (!MODEL_PATTERN.test(v)) {
    throw new Error(`${name} takes ${MODEL_ALLOWED}: letters, digits and . _ : - [ ] only, no spaces.`)
  }
  if (SECRET_PATTERN.test(v)) throw new Error(`${name} looks like a credential, not a model; nothing was accepted.`)
  return v
}

const parseIdle = (name: OptionName, raw: unknown): string => {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if ((HUD_IDLE as readonly string[]).includes(v)) return v
  throw new Error(`${name} takes ${META[name].allowed}.`)
}

const parseSwitch = (name: OptionName, raw: unknown): boolean => {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase()
    if (v === 'true' || v === 'on') return true
    if (v === 'false' || v === 'off') return false
  }
  throw new Error(`${name} takes ${META[name].allowed} (true or false).`)
}

/**
 * Check a requested change against CTK's schema and the current options. Rejects unknown
 * names, out-of-range or non-integer caps, malformed model ids, non-boolean switches, and a
 * value equal to the current one. A rejection never echoes a rejected string.
 */
export const validateChange = (name: string, raw: unknown, opts: PolicyOptions): ValidateResult => {
  if (!isOptionName(name)) {
    const shown = SAFE_NAME.test(String(name)) ? ` "${String(name)}"` : ''
    return fail('unknown_option', `Unknown option${shown}. Valid options: ${OPTION_NAMES.join(', ')}.`)
  }
  let value: OptionValue
  if (name === 'maxWorkers') {
    const n = parseWorkers(raw)
    if (typeof n === 'string') return fail('invalid_value', n)
    value = n
  } else {
    try {
      value = name === 'hudBand' || name === 'recordStats' || name === 'teamHint' ? parseSwitch(name, raw) : name === 'hudIdle' ? parseIdle(name, raw) : parseModel(name, raw)
    } catch (err) {
      return fail('invalid_value', (err as Error).message)
    }
  }
  const from = opts[name]
  if (value === from) return fail('unchanged', `${name} is already ${showValue(from)}; nothing to change.`)
  return {
    ok: true,
    name,
    key: optionKey(name),
    value,
    from,
    text: `${META[name].label} (${name}): ${showValue(from)} -> ${showValue(value)}`,
  }
}

// ---- pending change: proposed by the model, applied only after the person confirms ----

export type Pending = { id: string; change: Change; createdAt: number }

/** At most one change waits at a time; `seq` numbers the proposals so a stale button cannot match a newer one. */
export type PendingState = { pending: Pending | null; seq: number }

export const emptyPending = (): PendingState => ({ pending: null, seq: 0 })

export const isExpired = (p: Pending, now: number): boolean => now - p.createdAt > PENDING_TTL_MS

export type ProposeOutcome = { kind: 'proposed'; pending: Pending; replaced: Pending | null }
export type ConfirmOutcome =
  | { kind: 'confirmed'; change: Change }
  | { kind: 'none' }
  | { kind: 'mismatch'; pendingId: string }
  | { kind: 'expired'; change: Change }
export type CancelOutcome = { kind: 'cancelled'; change: Change } | { kind: 'none' } | { kind: 'mismatch'; pendingId: string }

/** Store a validated change as the pending one. A change already waiting is replaced and reported. */
export const propose = (
  state: PendingState,
  change: Change,
  now: number,
): { state: PendingState; outcome: ProposeOutcome } => {
  const seq = state.seq + 1
  const pending: Pending = { id: `c${seq}`, change, createdAt: now }
  return { state: { pending, seq }, outcome: { kind: 'proposed', pending, replaced: state.pending } }
}

/**
 * The person pressed Confirm on proposal `id`. Only a live, matching proposal is released, once:
 * the state is cleared so a second press finds nothing. A different id leaves the waiting one alone;
 * an expired one is dropped and not released. The caller then calls `$.config.set` with `change.key`
 * and `change.value`, and re-runs `validateChange` against the options as they are at that moment.
 */
export const confirm = (
  state: PendingState,
  id: string,
  now: number,
): { state: PendingState; outcome: ConfirmOutcome } => {
  const p = state.pending
  if (p === null) return { state, outcome: { kind: 'none' } }
  if (p.id !== id) return { state, outcome: { kind: 'mismatch', pendingId: p.id } }
  const cleared: PendingState = { pending: null, seq: state.seq }
  if (isExpired(p, now)) return { state: cleared, outcome: { kind: 'expired', change: p.change } }
  return { state: cleared, outcome: { kind: 'confirmed', change: p.change } }
}

/** The person pressed Cancel on proposal `id`: discarded, nothing applied. */
export const cancel = (state: PendingState, id: string): { state: PendingState; outcome: CancelOutcome } => {
  const p = state.pending
  if (p === null) return { state, outcome: { kind: 'none' } }
  if (p.id !== id) return { state, outcome: { kind: 'mismatch', pendingId: p.id } }
  return { state: { pending: null, seq: state.seq }, outcome: { kind: 'cancelled', change: p.change } }
}

/** Drop an expired proposal (for a redraw); a live one is returned as it was. */
export const sweep = (state: PendingState, now: number): PendingState =>
  state.pending !== null && isExpired(state.pending, now) ? { pending: null, seq: state.seq } : state
