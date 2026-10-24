import { describe, expect } from 'claude-code/testing'

import { formatReport, REPORT_FILES_MAX } from '../hooks/report.ts'
import { MEMORY_LIMIT, newMissionState, noteFileChange } from '../hooks/mission.ts'
import { emptyStats } from '../shared/stats.ts'
import { engine, fresh, test } from './world.ts'

const stats = () => ({ ...emptyStats('s', 3, 0), spawnsAccepted: 2, spawnsRejected: 1, toolCalls: 40, workerModels: { sonnet: 2 }, measured: { ...emptyStats('s', 3, 0).measured, costUsd: 1.5, model: 'opus' } })

describe('formatReport', () => {
  test('lists tasks, spawns, cost, models and files', async () => {
    const text = formatReport({
      stats: stats(),
      tasks: [{ id: '1', subject: 'write it', status: 'completed', owner: 'a', blockedBy: [], blocks: [] }, { id: '2', subject: 'gone', status: 'deleted', owner: null, blockedBy: [], blocks: [] }],
      files: ['/w/a.ts'],
      teamMs: 125_000,
    })
    expect(text).toContain('Team duration: 2m. Spawns: 2 accepted, 1 refused')
    expect(text).toContain('cost $1.50, 40 tool calls')
    expect(text).toContain('lead opus; teammates sonnet×2; subagents –')
    expect(text).toContain('- #1 [completed] write it (a)')
    expect(text).not.toContain('gone')
    expect(text).toContain('Files changed (1)\n- /w/a.ts')
  })

  test('empty session says so, and a long file list is cut with a count', async () => {
    const empty = formatReport({ stats: emptyStats('s', 3, 0), tasks: [], files: [], teamMs: null })
    expect(empty).toContain('No task list was recorded.')
    expect(empty).toContain('None recorded.')
    const files = Array.from({ length: REPORT_FILES_MAX + 3 }, (_, i) => `/f${i}`)
    expect(formatReport({ stats: stats(), tasks: [], files, teamMs: 0 })).toContain('- and 3 more')
  })

  test('paths are relative to the working directory; outside ones and dropped ones are only counted', async () => {
    const text = formatReport({ stats: stats(), tasks: [], files: ['/w/src/a.ts', '/home/u/.claude/memory.md', '/tmp/x'], filesDropped: 4, cwd: '/w/', teamMs: 0 })
    expect(text).toContain('Files changed (1)\n- src/a.ts')
    expect(text).not.toContain('/home/u')
    expect(text).toContain('- 2 outside the working directory, not listed')
    expect(text).toContain('- 4 earlier changes not kept')
  })
})

describe('noteFileChange', () => {
  test('keeps paths of write tools only, once, bounded', async () => {
    const m = newMissionState()
    noteFileChange(m, 'Edit', { file_path: '/a', old_string: 'secret' })
    noteFileChange(m, 'Edit', { file_path: '/a' })
    noteFileChange(m, 'NotebookEdit', { notebook_path: '/n.ipynb' })
    noteFileChange(m, 'Read', { file_path: '/r' })
    noteFileChange(m, 'Write', {})
    expect([...m.files]).toEqual(['/a', '/n.ipynb'])
    for (let i = 0; i < MEMORY_LIMIT + 5; i++) noteFileChange(m, 'Write', { file_path: `/x${i}` })
    expect(m.files.size).toBe(MEMORY_LIMIT)
    expect(m.files.has('/a')).toBe(false)
  })
})

describe('/ctk-report', () => {
  test('is registered and prints files the session changed', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    expect(w.registeredCommands).toContain('ctk-report')
    await $.tool.call({ tool: 'Edit', file_path: '/w/changed.ts', tool_use_id: 'u1' } as never)
    await $.tool.call({ tool: 'Read', file_path: '/w/read.ts', tool_use_id: 'u2' } as never)
    const r = await $.command.run({ command: 'ctk-report' } as never)
    expect(String((r as { text?: string }).text)).toContain('- /w/changed.ts')
    expect(String((r as { text?: string }).text)).not.toContain('read.ts')
  })
})
