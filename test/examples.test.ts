import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { DEFAULT_PROFILE, parseLayer, profileToPluginOptions, resolveEffective } from '../src/core/schema.ts'
import { DEFAULT_OPTIONS, readOptions } from '../plugin/ctk/shared/policy.ts'

const dir = join(import.meta.dirname, '..', 'examples', 'profiles')

for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
  test(`example profile ${f} is a valid layer and resolves`, () => {
    const layer = parseLayer(JSON.parse(readFileSync(join(dir, f), 'utf8')), f)
    const eff = resolveEffective(layer, null)
    assert.ok(eff.team.maxWorkers >= 1)
  })
}

test('default profile maps to the plugin default options (single source of defaults)', () => {
  assert.deepEqual(profileToPluginOptions(DEFAULT_PROFILE), DEFAULT_OPTIONS)
  assert.deepEqual(readOptions(profileToPluginOptions(DEFAULT_PROFILE)), DEFAULT_OPTIONS)
})

test('layer order: defaults < user < device', () => {
  const user = parseLayer({ team: { maxWorkers: 4 }, routing: { reviewer: { model: 'haiku' } } }, 'user')
  const device = parseLayer({ team: { maxWorkers: 2 } }, 'device')
  const eff = resolveEffective(user, device)
  assert.equal(eff.team.maxWorkers, 2)
  assert.equal(eff.routing.reviewer.model, 'haiku')
  assert.equal(eff.routing.reviewer.effort, 'medium')
  assert.equal(eff.routing.implementer.model, 'sonnet')
})

test('unknown and non-whitelisted keys are rejected', () => {
  assert.throws(() => parseLayer({ portable: { settings: { env: { A: '1' } } } }, 'x'))
  assert.throws(() => parseLayer({ credentials: {} }, 'x'))
  assert.throws(() => parseLayer({ team: { maxWorkers: 0 } }, 'x'))
})
