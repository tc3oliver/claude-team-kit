import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_TYPES, DEFAULT_EFFORT, DEFAULT_OPTIONS, ROLES, modelFor } from '../plugin/ctk/shared/policy.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = join(repo, 'plugin', 'ctk')
const read = (...p: string[]) => readFileSync(join(plugin, ...p), 'utf8')

const frontmatter = (text: string): Record<string, string> => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  assert.ok(m, 'missing frontmatter')
  const out: Record<string, string> = {}
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, '')
  }
  return out
}
const words = (s: string) => s.trim().split(/\s+/).length
const lines = (s: string) => s.replace(/\n$/, '').split('\n').length

const manifest = JSON.parse(read('.claude-plugin', 'plugin.json'))
const marketplace = JSON.parse(readFileSync(join(repo, '.claude-plugin', 'marketplace.json'), 'utf8'))
const skillNames = readdirSync(join(plugin, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)

test('plugin.json userConfig keys and defaults equal DEFAULT_OPTIONS', () => {
  assert.equal(manifest.name, 'ctk')
  assert.equal(manifest.version, '0.1.0')
  assert.equal(manifest.license, 'MIT')
  assert.equal('repository' in manifest || 'homepage' in manifest, false)
  assert.deepEqual(Object.keys(manifest.userConfig).sort(), Object.keys(DEFAULT_OPTIONS).sort())
  for (const [key, def] of Object.entries(DEFAULT_OPTIONS)) {
    assert.equal(manifest.userConfig[key].default, def, key)
    assert.equal(manifest.userConfig[key].type, typeof def, key)
  }
  assert.equal(manifest.userConfig.maxWorkers.min, 1)
  assert.equal(manifest.userConfig.maxWorkers.max, 12)
})

test('types path is only declared when the file exists', () => {
  if (manifest.types !== undefined) assert.ok(existsSync(join(plugin, manifest.types)))
})

test('marketplace ctk-kit lists the ctk plugin from ./plugin/ctk', () => {
  assert.equal(marketplace.name, 'ctk-kit')
  assert.equal(marketplace.plugins.length, 1)
  assert.equal(marketplace.plugins[0].name, 'ctk')
  assert.equal(marketplace.plugins[0].source, './plugin/ctk')
})

const fileOf: Record<string, string> = {
  explorer: 'explorer',
  implementer: 'implementer',
  reviewer: 'reviewer',
  highRisk: 'high-risk-reviewer',
}
for (const role of ROLES) {
  test(`agent ${role} frontmatter matches policy defaults`, () => {
    const text = read('agents', `${fileOf[role]}.md`)
    const fm = frontmatter(text)
    assert.equal(`ctk:${fm.name}`, AGENT_TYPES[role])
    assert.equal(fm.model, modelFor(DEFAULT_OPTIONS, role))
    assert.equal(fm.effort, DEFAULT_EFFORT[role])
    assert.ok(words(fm.description!) <= 25)
    const body = text.replace(/^---[\s\S]*?\r?\n---\r?\n/, '').trim()
    assert.ok(lines(body) <= 12, `body has ${lines(body)} lines`)
    for (const banned of ['hooks', 'mcpServers', 'permissionMode']) assert.equal(banned in fm, false, banned)
    if (role !== 'implementer') assert.equal(fm.tools, 'Read, Grep, Glob', 'read-only tools')
  })
}

test('agent files are exactly the four roles', () => {
  assert.deepEqual(readdirSync(join(plugin, 'agents')).sort(), Object.values(fileOf).map((f) => `${f}.md`).sort())
})

test('skills are team, review, debug', () => {
  assert.deepEqual(skillNames.sort(), ['debug', 'review', 'team'])
})

for (const name of ['team', 'review', 'debug']) {
  test(`skill ${name}: frontmatter, size, references`, () => {
    const text = read('skills', name, 'SKILL.md')
    const fm = frontmatter(text)
    assert.equal(fm.name, name)
    assert.ok(fm.description, 'description')
    assert.ok(words(fm.description!) <= 25, `description has ${words(fm.description!)} words`)
    assert.ok(lines(text) <= 60, `SKILL.md has ${lines(text)} lines`)
    for (const [, ref] of text.matchAll(/`(references\/[\w.-]+\.md)`/g)) {
      assert.ok(existsSync(join(plugin, 'skills', name, ref!)), `missing ${ref}`)
    }
    const refsDir = join(plugin, 'skills', name, 'references')
    for (const f of existsSync(refsDir) ? readdirSync(refsDir) : []) {
      assert.ok(lines(readFileSync(join(refsDir, f), 'utf8')) <= 80, `${f} over 80 lines`)
    }
  })
}

test('team skill: manual only, hint, refusal codes, agent types', () => {
  const text = read('skills', 'team', 'SKILL.md')
  const fm = frontmatter(text)
  assert.equal(fm['disable-model-invocation'], 'true')
  assert.equal(fm['argument-hint'], '<goal>')
  assert.ok(text.includes('TEAM_CAPACITY_REACHED'))
  assert.ok(text.includes('TEAM_GUARD_FAILED'))
  assert.ok(text.includes(AGENT_TYPES.implementer) && text.includes(AGENT_TYPES.explorer))
})

test('review skill routes to both reviewer agents', () => {
  const text = read('skills', 'review', 'SKILL.md')
  assert.ok(text.includes(AGENT_TYPES.reviewer) && text.includes(AGENT_TYPES.highRisk))
})

test('no leftover poc files in skills or agents', () => {
  for (const dir of ['skills', 'agents']) {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [e.name]))
    assert.deepEqual(walk(join(plugin, dir)).filter((f) => f.endsWith('.poc')), [])
  }
})
