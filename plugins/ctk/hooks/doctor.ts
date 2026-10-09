import type { PolicyOptions } from '../shared/policy.ts'

// Pure readiness logic for /ctk-doctor and the status tool's preflight fields. The host
// reads (env, settings, tool list) are in register.tsx; a state that could not be read is
// null here and is reported as unknown, never guessed.

export const TEAMS_FLAG = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'
export const TEAMS_FIX = `Add {"env":{"${TEAMS_FLAG}":"1"}} to ~/.claude/settings.json, then restart Claude Code.`

export type Facts = {
  maxWorkers: number
  /** Whether settings hold /pluginConfigs/ctk@…/options/maxWorkers; null when settings could not be read. */
  capFromSettings: boolean | null
  /** Null when neither the process environment nor settings could be read. */
  teamsEnabled: boolean | null
  /** True only when TaskCreate is in the tool list: a deferred tool is not listed, so absence proves nothing. */
  taskTools: boolean | null
  /** False when the tool list itself could not be read. */
  toolListRead: boolean
  statusLine: boolean | null
  /** True when the configured status line is CTK's own script; null when settings could not be read. */
  ctkStatusLine: boolean | null
  hudBand: boolean
  recordStats: boolean
}

export type Inputs = {
  opts: PolicyOptions
  /** `$.env.get(TEAMS_FLAG)`: null when the read failed. It also sees values from settings.json `env`. */
  envFlag: { value: string | undefined } | null
  settings: Readonly<Record<string, unknown>> | null
  toolNames: string[] | null
}

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const truthy = (v: string): boolean => ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())

/** Whether the merged settings point the status line at CTK's script (the command itself is never shown). */
export const isCtkStatusLine = (settings: Readonly<Record<string, unknown>> | null): boolean => {
  const command = record(settings?.statusLine)?.command
  return typeof command === 'string' && command.includes('ctk-statusline')
}

export const factsFrom = ({ opts, envFlag, settings, toolNames }: Inputs): Facts => {
  const settingsFlag = record(settings?.env)?.[TEAMS_FLAG]
  const raw = envFlag?.value ?? (typeof settingsFlag === 'string' ? settingsFlag : undefined)
  const pluginConfigs = record(settings?.pluginConfigs)
  return {
    maxWorkers: opts.maxWorkers,
    capFromSettings:
      settings === null
        ? null
        : Object.entries(pluginConfigs ?? {}).some(
            ([k, v]) => (k === 'ctk' || k.startsWith('ctk@')) && record(record(v)?.options)?.maxWorkers !== undefined,
          ),
    teamsEnabled: raw !== undefined ? truthy(raw) : envFlag !== null ? false : null,
    taskTools: toolNames?.includes('TaskCreate') ? true : null,
    toolListRead: toolNames !== null,
    statusLine: settings === null ? null : settings.statusLine !== undefined,
    ctkStatusLine: settings === null ? null : isCtkStatusLine(settings),
    hudBand: opts.hudBand,
    recordStats: opts.recordStats,
  }
}

type Row = { level: 'ok' | 'info' | 'action'; text: string; fix?: string }

export const doctorRows = (f: Facts): Row[] => [
  { level: 'ok', text: 'mod: active (it answered this command)' },
  {
    level: 'ok',
    text: `cap: ${f.maxWorkers} live teammates (${f.capFromSettings === null ? 'source not checked' : f.capFromSettings ? 'set in plugin options' : 'default'})`,
  },
  f.teamsEnabled === true
    ? { level: 'ok', text: `agent teams: enabled (${TEAMS_FLAG})` }
    : f.teamsEnabled === false
      ? { level: 'action', text: `agent teams: not enabled (${TEAMS_FLAG} is not set to 1)`, fix: TEAMS_FIX }
      : { level: 'info', text: `agent teams: unknown (${TEAMS_FLAG} could not be read)` },
  f.taskTools === true
    ? { level: 'ok', text: 'task tools: TaskCreate is available' }
    : {
        level: 'info',
        text: f.toolListRead
          ? 'task tools: unknown (TaskCreate is not in the listed tools; deferred tools are not listed)'
          : 'task tools: unknown (tool list not readable)',
      },
  f.statusLine === null
    ? { level: 'info', text: 'statusLine: not checked (settings not readable)' }
    : f.ctkStatusLine === true
      ? { level: 'info', text: 'statusLine: CTK’s, under the prompt (model, usage, context, cost); the band above it shows only tools, agents and tasks' }
      : f.statusLine
        ? { level: 'info', text: 'statusLine: yours is configured and left untouched; the band above the prompt shows model, usage and team figures' }
        : { level: 'info', text: 'statusLine: none configured (optional); the band above the prompt shows model, usage and team figures' },
  f.hudBand
    ? { level: 'ok', text: 'team band: on' }
    : { level: 'info', text: 'team band: off (plugin option hudBand)' },
  f.recordStats
    ? { level: 'ok', text: 'stats recording: on' }
    : { level: 'info', text: 'stats recording: off (plugin option recordStats)' },
]

export const formatDoctor = (f: Facts): string => {
  const rows = doctorRows(f)
  const actions = rows.filter(r => r.level === 'action').length
  const lines = rows.flatMap(r => [`[${r.level}]`.padEnd(9) + r.text, ...(r.fix === undefined ? [] : [`         fix: ${r.fix}`])])
  return ['CTK readiness (read-only; nothing is changed):', ...lines, actions === 0 ? 'ready' : `${actions} action(s) needed`].join('\n')
}
