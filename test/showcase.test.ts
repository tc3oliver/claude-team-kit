import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { plainText } from '../scripts/demo/render-svg.mjs'
import { buildPlugin, cropPane, CONTEXTS, LABEL, maskPlan, metaLine, parseArgs, pick, SCENES, sheetSvg, WIDTHS } from '../scripts/showcase/render.mjs'

const ROOT = join(import.meta.dirname, '..')
const META = { ctkCommit: 'abc1234', date: '2026-10-09', claudeCodeVersion: '2.1.295' }

test('the label is the fixed synthetic-data wording', () => {
  assert.equal(LABEL, 'SYNTHETIC DATA - UI showcase, not a live agent run')
  assert.deepEqual(WIDTHS, [60, 80, 100, 130, 200])
  assert.equal(SCENES.length, 10)
})

test('the metadata line carries commit, claude version and date, and nothing that changes between runs', () => {
  const line = metaLine(META, 100)
  assert.equal(line, 'ctk abc1234 · claude 2.1.295 · 2026-10-09 · 100 cols')
  assert.equal(metaLine(META, 100), line)
})

test('the generated mod mounts the real renderMission and prints the label', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctk-showcase-test-'))
  try {
    const plugin = join(dir, 'p')
    buildPlugin(plugin, ROOT)
    const register = readFileSync(join(plugin, 'hooks', 'register.tsx'), 'utf8')
    assert.match(register, /renderMission\(/)
    assert.match(register, /\{LABEL\}/)
    assert.ok(readFileSync(join(plugin, 'hooks', 'scenes.ts'), 'utf8').includes(`LABEL = '${LABEL}'`))
    // The real mod's wiring is not copied: the showcase registers one command of its own.
    assert.match(readFileSync(join(plugin, 'hooks', 'hooks.json'), 'utf8'), /register\.tsx/)
    assert.doesNotMatch(register, /ctk-mission/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cropPane keeps the inline box, or the whole docked screen, and refuses a screen without the label', () => {
  const inline = `header\n╭──╮\n│ ${LABEL} │\n╰──╯\n❯ prompt`
  assert.equal(cropPane(inline), `╭──╮\n│ ${LABEL} │\n╰──╯`)
  const docked = `left │${LABEL}\nmore │body\n     │\n❯ p│`
  assert.equal(cropPane(docked), `left │${LABEL}\nmore │body`)
  assert.equal(cropPane('╭──╮\n╰──╯'), '╭──╮\n╰──╯')
  assert.equal(cropPane('nothing here'), null)
})

test('cropPane with context screen keeps the whole terminal down to its last row with content', () => {
  const docked = `left │${LABEL}\nmore │body\n     │\n❯ p│\n\n  footer\n\n`
  assert.equal(cropPane(docked, 'screen'), `left │${LABEL}\nmore │body\n     │\n❯ p│\n\n  footer`)
  assert.equal(cropPane('x │'+LABEL+'\x1b[39m', 'screen'), 'x │'+LABEL)
  assert.equal(cropPane(`header\n╭──╮\n│ ${LABEL} │\n╰──╯\n❯ prompt`, 'screen'), `header\n╭──╮\n│ ${LABEL} │\n╰──╯\n❯ prompt`)
  assert.equal(cropPane(`x │${LABEL}\x1b[39m\ny\x1b[0m\x1b[39m`, 'screen'), `x │${LABEL}\ny`)
  assert.equal(cropPane('nothing here', 'screen'), null)
})

test('pick fails when the label or the metadata line is missing from the captured pane', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctk-showcase-test-'))
  try {
    const raw = join(dir, 'raw.jsonl')
    const frame = (body: string) => `${JSON.stringify({ meta: {} })}\n${JSON.stringify({ t: 0, text: `╭─╮\n│ ${body} │\n╰─╯` })}\n`
    writeFileSync(raw, frame(`${LABEL} ${metaLine(META, 80)}`))
    assert.ok(plainText(pick(raw, 'team', 80, META).text).includes(LABEL))
    writeFileSync(raw, frame(metaLine(META, 80)))
    assert.throws(() => pick(raw, 'team', 80, META), /label is missing/)
    writeFileSync(raw, frame(LABEL))
    assert.throws(() => pick(raw, 'team', 80, META), /metadata line is missing/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the width sheet stacks one nested svg per width, deterministically', () => {
  const panel = (cols: number) => ({ cols, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * 8}" height="100" viewBox="0 0 ${cols * 8} 100"></svg>` })
  const a = sheetSvg([panel(60), panel(100)], `x. ${LABEL}`)
  assert.equal(a, sheetSvg([panel(60), panel(100)], `x. ${LABEL}`))
  assert.equal(a.match(/<svg /g)?.length, 3)
  assert.ok(a.includes('60 columns') && a.includes('100 columns') && a.includes(LABEL))
})

test('the width sheet keeps the colour classes of each panel apart', () => {
  const panel = (fill: string) => ({ cols: 60, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><style>text{fill:#fff}.f1{fill:${fill}}</style><text class="f1">x</text></svg>` })
  const sheet = sheetSvg([panel('#f00'), panel('#00f')], 'x')
  assert.ok(sheet.includes('.p0f1{fill:#f00}') && sheet.includes('.p1f1{fill:#00f}'))
  assert.ok(sheet.includes('class="p0f1"') && sheet.includes('class="p1f1"'))
})

test('arguments are checked', () => {
  assert.throws(() => parseArgs(['--scenes', 'nope', '--out', 'x']), { name: 'Error' })
  assert.throws(() => parseArgs(['--context', 'half', '--out', 'x']), { name: 'Error' })
  assert.deepEqual(CONTEXTS, ['pane', 'screen'])
  assert.equal(parseArgs(['--context', 'screen', '--main', '130', '--rows', '36', '--out', 'x']).main, 130)
})

test('every published showcase svg carries the label and a metadata line', { skip: !existsSync(join(ROOT, 'docs/assets/mission-control-ui')) }, () => {
  const base = join(ROOT, 'docs/assets/mission-control-ui')
  for (const set of readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const svgs = readdirSync(join(base, set.name)).filter(f => f.endsWith('.svg') && !f.endsWith('-widths.svg'))
    assert.ok(svgs.length >= 1, `${set.name} has no svg`)
    for (const f of svgs) {
      const text = readFileSync(join(base, set.name, f), 'utf8')
      assert.ok(text.includes(LABEL), `${set.name}/${f}: label missing`)
      assert.match(text, /ctk [0-9a-f]{7}(-dirty)? · claude \d+\.\d+\.\d+ · \d{4}-\d\d-\d\d · \d+ cols/, `${set.name}/${f}: metadata line missing`)
    }
  }
})

test('every published showcase set holds all scenes, each with a 100-column svg and a width sheet', { skip: !existsSync(join(ROOT, 'docs/assets/mission-control-ui')) }, () => {
  const base = join(ROOT, 'docs/assets/mission-control-ui')
  for (const set of readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())) {
    if (set.name !== 'after' && set.name !== 'before') continue // docked/ and readme/ hold the --context screen stills
    const files = new Set(readdirSync(join(base, set.name)))
    for (const scene of SCENES) {
      assert.ok(files.has(`${scene}.svg`) && files.has(`${scene}-widths.svg`), `${set.name}: ${scene} is missing`)
      for (const w of WIDTHS) assert.ok(files.has(w === 100 ? `${scene}.frames.jsonl` : `${scene}-${w}.frames.jsonl`), `${set.name}: ${scene} at ${w}`)
    }
  }
})

test('the docked set and the README stills keep the whole 130-column screen, header and prompt included', { skip: !existsSync(join(ROOT, 'docs/assets/mission-control-ui/docked')) }, () => {
  const base = join(ROOT, 'docs/assets/mission-control-ui')
  for (const f of ['docked/team.svg', 'docked/workers.svg', 'docked/dag.svg', 'readme/overview.svg', 'readme/workers.svg', 'readme/tasks.svg']) {
    const text = readFileSync(join(base, f), 'utf8')
    assert.ok(text.includes('docked beside the transcript') && text.includes('Claude Code') && text.includes('/showcase') && text.includes('accept edits on'), `${f}: not the whole docked screen`)
    assert.match(text, /130 cols/, `${f}: not 130 columns`)
  }
})

test('the plan or billing mode in the captured header is masked, keeping the column', () => {
  for (const plan of ['Claude Max', 'Claude Pro', 'Claude Team', 'Claude Enterprise', 'Claude Max 5x', 'API Usage Billing']) {
    const line = `\x1b[38;5;246mSonnet 5.5 · ${plan}\x1b[39m        │pane`
    const out = maskPlan(line)
    assert.ok(out.includes('Sonnet 5.5 · plan hidden') && !out.includes(plan), plan)
    assert.equal(plainText(out).length, plainText(line).length, `${plan}: width changed`)
  }
  assert.equal(maskPlan('Claude Max in the transcript'), 'Claude Max in the transcript')
})

test('no published showcase frame or picture names a plan, an email or the maintainer', { skip: !existsSync(join(ROOT, 'docs/assets/mission-control-ui')) }, () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  const files = walk(join(ROOT, 'docs/assets/mission-control-ui')).filter(f => /\.(svg|jsonl|txt)$/.test(f))
  assert.ok(files.length > 0)
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    assert.doesNotMatch(text, /Claude (Max|Pro|Team|Enterprise)|[\w.+-]+@[\w-]+\.[\w.]+|oliver/i, f)
  }
})
