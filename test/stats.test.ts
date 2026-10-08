import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { runStats } from '../src/cli/commands/stats.ts'
import { emptyStats, STATS_SCHEMA_VERSION } from '../plugin/ctk/shared/stats.ts'
import { makeEnv, writeJson } from './helpers.ts'

test('stats says so when nothing is recorded', t => {
  const e = makeEnv(t)
  const r = runStats(e.ctx)
  assert.equal(r.code, 0)
  assert.match(r.lines[0] as string, /no session stats/)
})

test('stats prints per-session and total figures, labelled, with no per-worker cost', t => {
  const e = makeEnv(t)
  const a = { ...emptyStats('s1', 3, 1_000), spawnsAccepted: 2, spawnsRejected: 1, peakLive: 2, workerModels: { sonnet: 2 }, tasks: { created: 3, completed: 1 }, updatedAt: 2_000, measured: { costUsd: 0.5, contextPct: 41.2, fiveHourPct: 24, sevenDayPct: null } }
  const b = { ...emptyStats('s2', 3, 3_000), spawnsAccepted: 1, peakLive: 3, workerModels: { sonnet: 1, haiku: 1 }, updatedAt: 4_000 }
  writeJson(join(e.ctx.paths.statsDir, 's1.json'), a)
  writeJson(join(e.ctx.paths.statsDir, 's2.json'), b)
  writeFileSync(join(e.ctx.paths.statsDir, 'junk.json'), 'not json')
  writeJson(join(e.ctx.paths.statsDir, 'old.json'), { schemaVersion: STATS_SCHEMA_VERSION + 1 })
  const r = runStats(e.ctx)
  const text = r.lines.join('\n')
  assert.equal(r.code, 0)
  assert.match(text, /session s1 .*\n  counted:  spawns accepted 2, rejected 1, guard-failed 0, peak live 2; tasks 3 created, 1 completed; models sonnet×2/)
  assert.match(text, /measured: cost \$0\.50, context 41%, 5h limit 24%, 7d limit –/)
  assert.match(text, /total over 2 session\(s\)\n  counted:  spawns accepted 3, rejected 1, guard-failed 0, peak live 3; tasks 3 created, 1 completed; models haiku×1 sonnet×3/)
  assert.match(text, /latest session s2/)
  assert.match(text, /per-worker cost: not available from Claude Code/)
  assert.match(text, /2 unreadable stats file/)
  assert.ok(!/worker cost: \$/.test(text))
})

test('stats --json is one document', t => {
  const e = makeEnv(t, { json: true })
  mkdirSync(e.ctx.paths.statsDir, { recursive: true })
  writeJson(join(e.ctx.paths.statsDir, 's1.json'), emptyStats('s1', 3, 1))
  const r = runStats(e.ctx)
  assert.equal((r.data.sessions as unknown[]).length, 1)
})
