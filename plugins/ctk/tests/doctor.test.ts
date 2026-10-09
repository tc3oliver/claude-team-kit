import { describe, expect } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { TEAMS_FIX } from '../hooks/doctor.ts'
import { STATUS_TOOL } from '../hooks/team.ts'
import { engine, fresh, statusOf, test } from './world.ts'
import type { EngineOptions, World } from './world.ts'

const FLAG = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'

const doctor = async ($: Engine) => ((await $.command.run({ command: 'ctk-doctor', args: '' } as never)).text ?? '').split('\n')

const row = (lines: string[], label: string) => lines.find(l => l.slice(9).startsWith(`${label}:`))

const setup = (on: On, patch: Partial<World> = {}, opts: EngineOptions = {}) => {
  const w = Object.assign(fresh(), patch)
  engine(on, w, undefined, opts)
  return w
}

describe('ctk-doctor', () => {
  test('everything in order: ok rows and ready', async ($, on) => {
    setup(on, { tools: ['TaskCreate'] }, { env: { [FLAG]: '1' } })
    const lines = await doctor($)
    expect(lines[0]).toBe('CTK readiness (read-only; nothing is changed):')
    expect(row(lines, 'mod')).toBe('[ok]     mod: loaded (it answered this command)')
    expect(row(lines, 'guard')).toMatch(/^\[info\]   guard: available \(loaded; no spawn has reached the guard yet/)
    expect(row(lines, 'the cap counts teammates only')).toMatch(/ordinary subagents, and named agents started with isolation, are not limited/)
    expect(row(lines, 'cap')).toBe('[ok]     cap: 3 live teammates (default)')
    expect(row(lines, 'agent teams')).toBe(`[ok]     agent teams: enabled (${FLAG})`)
    expect(row(lines, 'task tools')).toBe('[ok]     task tools: TaskCreate is available')
    expect(row(lines, 'team band')).toBe('[ok]     team band: on')
    expect(row(lines, 'stats recording')).toBe('[ok]     stats recording: on')
    expect(lines.at(-1)).toBe('ready')
    expect(lines.some(l => l.startsWith('[action]'))).toBe(false)
  })

  test('teams flag unset is an action row with the exact fix', async ($, on) => {
    setup(on)
    const lines = await doctor($)
    const i = lines.findIndex(l => l.startsWith('[action]'))
    expect(lines[i]).toBe(`[action] agent teams: not enabled (${FLAG} is not set to 1)`)
    expect(lines[i + 1]).toBe(`         fix: ${TEAMS_FIX}`)
    expect(TEAMS_FIX).toBe('Add {"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"1"}} to ~/.claude/settings.json, then restart Claude Code.')
    expect(lines.at(-1)).toBe('1 action(s) needed')
  })

  test('a flag set to 0 is still an action', async ($, on) => {
    setup(on, {}, { env: { [FLAG]: '0' } })
    expect(row(await doctor($), 'agent teams')).toMatch(/^\[action\]/)
  })

  test('the flag is also read from settings env', async ($, on) => {
    setup(on, { settings: { env: { [FLAG]: '1' } } })
    expect(row(await doctor($), 'agent teams')).toMatch(/^\[ok\]/)
  })

  test('teams state is unknown, not guessed, when the environment cannot be read', async ($, on) => {
    setup(on, { settings: null }, { envFails: true })
    const lines = await doctor($)
    expect(row(lines, 'agent teams')).toBe(`[info]   agent teams: unknown (${FLAG} could not be read)`)
    expect(lines.at(-1)).toBe('ready')
  })

  test('cap source: set in plugin options', async ($, on) => {
    setup(on, { settings: { pluginConfigs: { 'ctk@ctk-kit': { options: { maxWorkers: 3 } } } } })
    expect(row(await doctor($), 'cap')).toBe('[ok]     cap: 3 live teammates (set in plugin options)')
  })

  test('cap in force is the configured value', { options: { maxWorkers: 5 } }, async ($, on) => {
    setup(on, { settings: { pluginConfigs: { other: { options: { maxWorkers: 9 } }, 'ctk@ctk-kit': { options: { hudBand: false } } } } })
    expect(row(await doctor($), 'cap')).toBe('[ok]     cap: 5 live teammates (default)')
  })

  test('a flat maxWorkers under the plugin id is not the settings shape and does not count', async ($, on) => {
    setup(on, { settings: { pluginConfigs: { 'ctk@ctk-kit': { maxWorkers: 3 } } } })
    expect(row(await doctor($), 'cap')).toBe('[ok]     cap: 3 live teammates (default)')
  })

  test('cap source is not checked when settings cannot be read', async ($, on) => {
    setup(on, { settings: null })
    expect(row(await doctor($), 'cap')).toBe('[ok]     cap: 3 live teammates (source not checked)')
  })

  test('task tools: not listed is unknown (deferred tools are not listed), unreadable says so', async ($, on) => {
    const w = setup(on, { tools: ['Agent', 'TaskStop'] })
    expect(row(await doctor($), 'task tools')).toBe(
      '[info]   task tools: unknown (TaskCreate is not in the listed tools; deferred tools are not listed)',
    )
    w.tools = null
    expect(row(await doctor($), 'task tools')).toBe('[info]   task tools: unknown (tool list not readable)')
  })

  test('statusLine: configured, none, not checked', async ($, on) => {
    const w = setup(on, { settings: { statusLine: { type: 'command', command: 'secret-looking-command' } } })
    const configured = await doctor($)
    expect(row(configured, 'statusLine')).toMatch(/^\[info\]   statusLine: yours is configured and left untouched/)
    expect(configured.join('\n')).not.toContain('secret-looking-command')
    w.settings = {}
    expect(row(await doctor($), 'statusLine')).toMatch(/^\[info\]   statusLine: none configured \(optional\)/)
    w.settings = null
    expect(row(await doctor($), 'statusLine')).toBe('[info]   statusLine: not checked (settings not readable)')
  })

  test('statusLine: CTK’s own script is recognised and its command is not printed', async ($, on) => {
    setup(on, { settings: { statusLine: { type: 'command', command: 'node "/Users/someone/.claude/ctk/bin/ctk-statusline.mjs"' } } })
    const out = await doctor($)
    expect(row(out, 'statusLine')).toMatch(/^\[info\]   statusLine: CTK’s, under the prompt/)
    expect(out.join('\n')).not.toContain('/Users/someone')
  })

  test('band and stats options off are info rows', { options: { hudBand: false, recordStats: false } }, async ($, on) => {
    setup(on)
    const lines = await doctor($)
    expect(row(lines, 'team band')).toBe('[info]   team band: off (plugin option hudBand)')
    expect(row(lines, 'stats recording')).toBe('[info]   stats recording: off (plugin option recordStats)')
  })

  test('it is read-only: nothing is written', async ($, on) => {
    const w = setup(on, { tools: ['TaskCreate'] })
    await doctor($)
    expect(w.rawPaths).toEqual([])
    expect(w.files.size).toBe(0)
  })
})

describe('ctk_team_status preflight fields', () => {
  const status = async ($: Engine) => statusOf(await $.tool.call({ tool: STATUS_TOOL }))

  test('teamsEnabled and taskTools are true when both are readable and present', async ($, on) => {
    setup(on, { tools: ['TaskCreate'] }, { env: { [FLAG]: '1' } })
    expect(await status($)).toMatchObject({ cap: 3, max: 3, teamsEnabled: true, taskTools: true })
  })

  test('teamsEnabled false when readable and unset; taskTools null when not listed', async ($, on) => {
    setup(on)
    expect(await status($)).toMatchObject({ teamsEnabled: false, taskTools: null })
  })

  test('both null when nothing can be read; cap still reported', { options: { maxWorkers: 4 } }, async ($, on) => {
    setup(on, { settings: null, tools: null }, { envFails: true })
    expect(await status($)).toMatchObject({ cap: 4, teamsEnabled: null, taskTools: null })
  })
})
