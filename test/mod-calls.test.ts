import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// The mod must never start a model call, a teammate, a tool or a network request on its own: the HUD
// and Mission Control are free, and the cap only refuses. `claude plugin validate` lists the host calls
// a module makes; this keeps that list closed in CI without needing the Claude Code binary's types.

const HOOKS = join(import.meta.dirname, '..', 'plugins', 'ctk', 'hooks')
// Recursive: hooks/ui/* is part of the mod and gets the same closed list and banned-pattern check.
const sources = readdirSync(HOOKS, { recursive: true })
  .map(f => String(f).replaceAll('\\', '/')) // Windows lists 'ui\\x.tsx'
  .filter(f => /\.(ts|tsx)$/.test(f))
  .map(f => ({ file: f, text: readFileSync(join(HOOKS, f), 'utf8') }))

const ALLOWED = new Set([
  'agent.list',
  // A pane redraw timer: one at most, only while Mission Control is open and something runs (register.tsx armMotion).
  'clock.after',
  'clock.now',
  'command.register',
  'config.list',
  'config.set',
  'env.get',
  'fs.read',
  'fs.write',
  'session.id',
  'session.model',
  'session.usage',
  'settings.read',
  'tool.list',
  'tool.register',
  'ui.close',
  'ui.invalidate',
  'ui.open',
  'ui.resolve',
])

const calls = (text: string): string[] => [...text.matchAll(/\$\.([a-z]+)\.([A-Za-z]+)\b/g)].map(m => `${m[1]}.${m[2]}`)

test('the mod calls only the host APIs on the closed list: no model call, no spawn, no tool run, no process, no network', () => {
  const found = new Set(sources.flatMap(s => calls(s.text)))
  const extra = [...found].filter(c => !ALLOWED.has(c))
  assert.deepEqual(extra, [], `new host call(s) ${extra.join(', ')}: review them, then add them to this list on purpose`)
})

test('the scan reaches hooks/ui', () => {
  assert.ok(sources.some(s => s.file.startsWith('ui/')), 'hooks/ui/* is scanned')
})

test('nothing in the mod reaches for the network, a process or dynamic code', () => {
  for (const { file, text } of sources) {
    const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const banned of [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\beval\s*\(/, /new Function\s*\(/, /\bimport\s*\(/, /\$\.process\b/, /\$\.session\.send\b/, /\$\.agent\.spawn\b/, /\$\.tool\.call\b/, /\$\.prompt\b/]) {
      assert.equal(banned.test(code), false, `${file} uses ${banned}`)
    }
  }
})

const strip = (text: string): string => text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

test('$.config.set appears in one place only, behind the person’s Confirm', () => {
  const where = sources.flatMap(s => (strip(s.text).match(/\$\.config\.set\b/g) ?? []).map(() => s.file))
  assert.deepEqual(where, ['register.tsx'])
  const register = strip(sources.find(s => s.file === 'register.tsx')!.text)
  const at = register.indexOf('$.config.set')
  const fn = register.lastIndexOf('async function', at)
  assert.match(register.slice(fn, fn + 40), /decideChange/)
  // decideChange is reached from the press handler's confirm effect only
  assert.equal([...register.matchAll(/decideChange\(/g)].length, 2, 'the definition and the one call in handlePress')
  assert.match(register, /effect === 'confirm' \|\| r\.effect === 'cancel'\) await decideChange/)
})
