import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildSvg } from './build.mjs'
import { CAPTIONS, HANDOFFS, MODEL, SCHEDULE, TASKS, validate } from './storyboard.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')

const clone = () => structuredClone(MODEL)
const rejects = (mutate, pattern) => {
  const m = clone()
  mutate(m)
  assert.throws(() => validate(m), pattern)
}

test('the storyboard is possible: dependencies, one task per worker at a time, the cap', () => {
  assert.ok(validate() > 50)
})

test('the checks catch the impossible moments they are meant to', () => {
  rejects(m => (m.SCHEDULE.find(s => s.task === 'T4').start = 5), /starts before its blocker/)
  rejects(m => (m.SCHEDULE.find(s => s.task === 'T5').by = 'W1'), /works on two tasks at once|before it exists/)
  rejects(m => m.WORKERS.push('W4'), /more workers than the cap/)
  rejects(m => (m.TASKS.find(t => t.id === 'T1').after = ['T7']), /cycle|starts before/)
  rejects(m => (m.SCHEDULE.find(s => s.task === 'T8').by = 'W1'), /the lead/)
  rejects(m => (m.HANDOFFS[0].worker = 'W3'), /wrong worker/)
  rejects(m => (m.HANDOFFS[0].from = 1), /before it is ready/)
  rejects(m => (m.SCHEDULE.find(s => s.task === 'T5').start = 10.9), /at once|waits for a slot|right after/)
  rejects(m => (m.CAPTIONS[1].from = 1), /overlap/)
  rejects(m => (m.CAPTIONS[0].title = 'x'.repeat(60)), /too long/)
})

test('the picture shows the whole scenario: eight slices, three workers, the cap at 3/3 and one waiting task', () => {
  assert.equal(TASKS.length, 8)
  assert.equal(new Set(SCHEDULE.filter(s => s.by !== 'Lead').map(s => s.by)).size, 3)
  const t5 = SCHEDULE.find(s => s.task === 'T5')
  assert.ok(t5.start > 15, 'T5 is ready early and waits')
  assert.equal(HANDOFFS.length, 4)
})

const svg = buildSvg()
const visible = svg
  .replace(/<style>[\s\S]*?<\/style>/, '')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')

test('the SVG is self-contained: no script, no external reference, no embedded HTML', () => {
  assert.doesNotMatch(svg, /<script|foreignObject|<image|@import|xlink:href|\shref=|javascript:|on\w+="/i)
  const urls = [...svg.matchAll(/url\(([^)]*)\)/g)].map(m => m[1])
  for (const u of urls) assert.match(u, /^#/, `url(${u}) must be a local reference`)
  const links = [...svg.matchAll(/https?:\/\/[^"'\s<)]+/g)].map(m => m[0])
  assert.deepEqual(links, ['http://www.w3.org/2000/svg'])
})

test('the SVG stays light enough for a README', () => {
  assert.ok(Buffer.byteLength(svg) < 100_000, `${Buffer.byteLength(svg)} bytes`)
})

test('the SVG is labelled an illustration, and carries the closing line and the handoff fields', () => {
  for (const want of ['Illustration', 'not a recording', 'Native Agent Teams.', 'Structured Execution.', 'Controlled Parallelism.', 'Task ID', 'Spec path', 'File scope', 'Verify', 'Capacity', '3/3', 'waits for a slot', 'done means verified']) {
    assert.ok(visible.includes(want), `missing "${want}"`)
  }
  assert.match(svg, /<title id="t">[^<]*How CTK works/)
})

test('the words stay inside what is true: no guarantee, no speed or saving claim, no scheduler of CTK', () => {
  const lower = visible.toLowerCase()
  for (const bad of ['guarantee', 'faster', 'cheaper', 'saves', 'saving', 'orchestrator', 'automatically', 'always', 'never fails', '%']) {
    assert.ok(!lower.includes(bad), `the picture must not say "${bad}"`)
  }
  // the word scheduler appears only to deny it
  for (const line of visible.split('\n').filter(l => /scheduler/i.test(l))) assert.match(line, /not a scheduler/)
  // the cap is described as limiting native teammate spawns, never ordinary subagents
  assert.ok(visible.includes('not ordinary subagents'))
  assert.ok(visible.includes('teammate spawns'))
})

test('every caption names the layer it belongs to (native, skill-guided or mod-enforced)', () => {
  for (const c of CAPTIONS) assert.ok(c.layers.length >= 1 && c.layers.every(l => ['native', 'skill', 'mod'].includes(l)))
  // only the capacity caption is mod-enforced; skill behaviour is never drawn as code enforcement
  assert.deepEqual(CAPTIONS.filter(c => c.layers.includes('mod')).map(c => c.title), ['Bounded parallelism: capacity 3/3'])
  const verify = CAPTIONS.find(c => /Verification/.test(c.title))
  assert.deepEqual(verify.layers, ['skill'])
})

test('the loop has no seam: the stage starts and ends invisible, and reduced motion shows the poster', () => {
  const stage = /<g class="an (a\d+)">/.exec(svg.slice(svg.indexOf('<rect width="1920"')))
  assert.ok(stage)
  const kf = new RegExp(`@keyframes k${stage[1]}\\{(.*?)\\}\\}\\.${stage[1]}\\{`).exec(svg)[0]
  assert.match(kf, /^@keyframes ka\d+\{0%\{opacity:0\}/)
  assert.match(kf, /100%\{opacity:0\}\}\.a\d+\{$/)
  assert.match(svg, /prefers-reduced-motion:reduce\)\{\.an\{animation-play-state:paused!important;animation-delay:-12\.9s!important\}\}/)
  assert.match(svg, /animation-iteration-count:infinite/)
})

test('the animation source is outside the plugin and the npm package', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.ok(!pkg.files.some(f => /^scripts/.test(f) && !f.startsWith('!')), 'scripts/ must not be packaged')
  assert.ok(pkg.files.includes('!docs/assets/*.mp4'))
  assert.ok(pkg.files.includes('!docs/assets/*-poster.png'))
  const walk = dir => readdirSync(dir).flatMap(n => (n === 'node_modules' || n === '.omc' ? [] : statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
  for (const f of walk(join(root, 'plugins/ctk')).filter(f => /\.(ts|tsx|mjs|json|md)$/.test(f))) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /scripts\/media|how-it-works/, `${f} must not depend on the animation`)
  }
})
