// Single source of truth for the plugin's runtime options (the flat `userConfig`
// values Claude Code hands to `register(on, options)`).
//
// Plain TypeScript with no imports: the plugin loads this file directly (mods may
// only import their own files) and the CLI imports it too, so defaults can never
// drift. `test/contract.test.ts` checks plugin.json `userConfig` against this file.

export const ROLES = ['explorer', 'implementer', 'reviewer', 'highRisk', 'designer'] as const
export type Role = (typeof ROLES)[number]

export const HUD_IDLE = ['full', 'minimal', 'hidden'] as const
export type HudIdle = (typeof HUD_IDLE)[number]

export type PolicyOptions = {
  /** Most teammates alive at once. Further spawns are refused with TEAM_CAPACITY_REACHED. */
  maxWorkers: number
  /** Model for each CTK agent role: an alias (`haiku`), a full id, or `inherit`. */
  explorerModel: string
  implementerModel: string
  reviewerModel: string
  highRiskModel: string
  designerModel: string
  /** Draw the team band above the prompt. */
  hudBand: boolean
  /** What the band shows while no teammate has started: everything, only the CTK entry and guard, or nothing. */
  hudIdle: HudIdle
  /** Write small per-session counters to <config>/ctk/stats/ for `ctk stats`. */
  recordStats: boolean
  /** Add one hidden hint line to a prompt that asks for several agents or a team, so the model loads the team skill. */
  teamHint: boolean
}

export const DEFAULT_OPTIONS: PolicyOptions = {
  maxWorkers: 5,
  explorerModel: 'haiku',
  implementerModel: 'sonnet',
  reviewerModel: 'sonnet',
  highRiskModel: 'opus',
  designerModel: 'opus',
  hudBand: true,
  hudIdle: 'full',
  recordStats: true,
  teamHint: true,
}

/** Default reasoning effort per role. Mirrors the `effort:` frontmatter in plugins/ctk/agents/. */
export const DEFAULT_EFFORT: Record<Role, string> = {
  explorer: 'medium',
  implementer: 'medium',
  reviewer: 'medium',
  highRisk: 'high',
  designer: 'high',
}

/** Agent type names as Claude Code reports them for plugin agents (`<plugin>:<name>`). */
export const AGENT_TYPES: Record<Role, string> = {
  explorer: 'ctk:explorer',
  implementer: 'ctk:implementer',
  reviewer: 'ctk:reviewer',
  highRisk: 'ctk:high-risk-reviewer',
  designer: 'ctk:designer',
}

/** Error code carried in every capacity refusal. The team skill keys off this exact token. */
export const CAPACITY_CODE = 'TEAM_CAPACITY_REACHED'

const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : d)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)

export const clampMax = (v: unknown): number => {
  const n = Number(v ?? DEFAULT_OPTIONS.maxWorkers)
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 12) : DEFAULT_OPTIONS.maxWorkers
}

/** Normalize whatever `register` received into a complete, valid PolicyOptions. */
export const readOptions = (raw: unknown): PolicyOptions => {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    maxWorkers: clampMax(o.maxWorkers),
    explorerModel: str(o.explorerModel, DEFAULT_OPTIONS.explorerModel),
    implementerModel: str(o.implementerModel, DEFAULT_OPTIONS.implementerModel),
    reviewerModel: str(o.reviewerModel, DEFAULT_OPTIONS.reviewerModel),
    highRiskModel: str(o.highRiskModel, DEFAULT_OPTIONS.highRiskModel),
    designerModel: str(o.designerModel, DEFAULT_OPTIONS.designerModel),
    hudBand: bool(o.hudBand, DEFAULT_OPTIONS.hudBand),
    hudIdle: (HUD_IDLE as readonly unknown[]).includes(o.hudIdle) ? (o.hudIdle as HudIdle) : DEFAULT_OPTIONS.hudIdle,
    recordStats: bool(o.recordStats, DEFAULT_OPTIONS.recordStats),
    teamHint: bool(o.teamHint, DEFAULT_OPTIONS.teamHint),
  }
}

export const modelFor = (opts: PolicyOptions, role: Role): string =>
  ({
    explorer: opts.explorerModel,
    implementer: opts.implementerModel,
    reviewer: opts.reviewerModel,
    highRisk: opts.highRiskModel,
    designer: opts.designerModel,
  })[role]
