import { z } from 'zod'

import { DEFAULT_EFFORT, DEFAULT_OPTIONS, ROLES, type PolicyOptions, type Role } from '../../plugin/ctk/shared/policy.ts'
import { deepMerge, type JsonObject } from './jsonx.ts'

export const PROFILE_SCHEMA_VERSION = 1

/**
 * Settings keys a profile may carry into settings.json. A whitelist on purpose:
 * everything else in ~/.claude (credentials, history, caches, hooks, permissions, env)
 * is device- or user-private and is never synced.
 */
export const PORTABLE_SETTINGS_KEYS = ['model', 'effortLevel', 'teammateMode', 'outputStyle', 'language'] as const
export type PortableSettingsKey = (typeof PORTABLE_SETTINGS_KEYS)[number]

const model = z.string().min(1).max(100)
const effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])
const roleSchema = z.strictObject({ model, effort })

/** Complete profile: what `effective` resolves to. */
export const profileSchema = z.strictObject({
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
  team: z.strictObject({ maxWorkers: z.number().int().min(1).max(12) }),
  routing: z.strictObject({ explorer: roleSchema, implementer: roleSchema, reviewer: roleSchema, highRisk: roleSchema }),
  hud: z.strictObject({ band: z.boolean(), statusLine: z.enum(['auto', 'off']) }),
  stats: z.strictObject({ record: z.boolean() }),
  claude: z.strictObject({ enableAgentTeams: z.boolean() }),
  portable: z.strictObject({
    settings: z.strictObject({
      model: z.string().optional(),
      effortLevel: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
      teammateMode: z.enum(['auto', 'in-process', 'tmux', 'iterm2']).optional(),
      outputStyle: z.string().optional(),
      language: z.string().optional(),
    }),
  }),
  /** Names of CTK-managed skills to materialize from the profile repo's skills/<name>/ into <config>/skills/. */
  skills: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/)),
})
export type Profile = z.infer<typeof profileSchema>

/** A layer (user profile file or device override) is any subset of a profile. */
const partialRole = z.strictObject({ model: model.optional(), effort: effort.optional() })
export const profileLayerSchema = z.strictObject({
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION).optional(),
  team: z.strictObject({ maxWorkers: profileSchema.shape.team.shape.maxWorkers.optional() }).optional(),
  routing: z
    .strictObject({
      explorer: partialRole.optional(),
      implementer: partialRole.optional(),
      reviewer: partialRole.optional(),
      highRisk: partialRole.optional(),
    })
    .optional(),
  hud: z.strictObject({ band: z.boolean().optional(), statusLine: z.enum(['auto', 'off']).optional() }).optional(),
  stats: z.strictObject({ record: z.boolean().optional() }).optional(),
  claude: z.strictObject({ enableAgentTeams: z.boolean().optional() }).optional(),
  portable: z.strictObject({ settings: profileSchema.shape.portable.shape.settings.optional() }).optional(),
  skills: profileSchema.shape.skills.optional(),
})
export type ProfileLayer = z.infer<typeof profileLayerSchema>

export const DEFAULT_PROFILE: Profile = {
  schemaVersion: PROFILE_SCHEMA_VERSION,
  team: { maxWorkers: DEFAULT_OPTIONS.maxWorkers },
  routing: {
    explorer: { model: DEFAULT_OPTIONS.explorerModel, effort: DEFAULT_EFFORT.explorer as Profile['routing']['explorer']['effort'] },
    implementer: { model: DEFAULT_OPTIONS.implementerModel, effort: DEFAULT_EFFORT.implementer as Profile['routing']['implementer']['effort'] },
    reviewer: { model: DEFAULT_OPTIONS.reviewerModel, effort: DEFAULT_EFFORT.reviewer as Profile['routing']['reviewer']['effort'] },
    highRisk: { model: DEFAULT_OPTIONS.highRiskModel, effort: DEFAULT_EFFORT.highRisk as Profile['routing']['highRisk']['effort'] },
  },
  hud: { band: DEFAULT_OPTIONS.hudBand, statusLine: 'auto' },
  stats: { record: DEFAULT_OPTIONS.recordStats },
  claude: { enableAgentTeams: true },
  portable: { settings: {} },
  skills: [],
}

export class ProfileError extends Error {}

/** Parse and validate a layer. Throws ProfileError with a readable message. */
export const parseLayer = (raw: unknown, label: string): ProfileLayer => {
  const r = profileLayerSchema.safeParse(raw)
  if (!r.success) {
    const msg = r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new ProfileError(`${label}: ${msg}`)
  }
  return r.data
}

/** CTK Defaults -> User Profile -> Device Overrides. */
export const resolveEffective = (user: ProfileLayer | null, device: ProfileLayer | null): Profile => {
  const merged = deepMerge(DEFAULT_PROFILE as unknown as JsonObject, user as JsonObject | null, device as JsonObject | null)
  const r = profileSchema.safeParse(merged)
  if (!r.success) {
    throw new ProfileError(`effective profile invalid: ${r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  return r.data
}

/** The flat `userConfig` values the plugin reads (stored under pluginConfigs in settings.json). */
export const profileToPluginOptions = (p: Profile): PolicyOptions => ({
  maxWorkers: p.team.maxWorkers,
  explorerModel: p.routing.explorer.model,
  implementerModel: p.routing.implementer.model,
  reviewerModel: p.routing.reviewer.model,
  highRiskModel: p.routing.highRisk.model,
  hudBand: p.hud.band,
  recordStats: p.stats.record,
})

export const roles: readonly Role[] = ROLES
