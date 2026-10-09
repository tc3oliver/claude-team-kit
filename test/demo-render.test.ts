import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'

import { maskFramesText } from '../scripts/demo/mask-frames.mjs'
import { assertScratchConfigDir, locateText, sgrClick } from '../scripts/demo/record.mjs'
import { cellWidth, color256, escapeXml, findFrame, parseAnsiLine, parseFrames, plainText, renderAnimatedSvg, renderStaticSvg, wrapCells } from '../scripts/demo/render-svg.mjs'
import type { Frame } from '../scripts/demo/render-svg.mjs'

// Everything below is synthetic input made up for these tests; none of it is a recording or a published demo.
const RENDER = join(import.meta.dirname, '..', 'scripts', 'demo', 'render-svg.mjs')
const RECORD = join(import.meta.dirname, '..', 'scripts', 'demo', 'record.mjs')
const ESC = '\x1b'
const FRAMES: Frame[] = [
  { t: 0, text: '$' },
  { t: 500, text: `$ echo hi\n${ESC}[31mred${ESC}[0m plain` },
  { t: 900, text: `$ echo hi\n${ESC}[31mred${ESC}[0m plain\n${ESC}[1;32mdone${ESC}[0m` },
]

const tmp = (t: TestContext): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ctk-demo-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Fails unless every tag opens and closes in order; returns the number of elements. */
function assertWellFormed(svg: string): number {
  const stack: string[] = []
  let count = 0
  for (const m of svg.matchAll(/<(\/?)([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, close, name, , selfClose] = m
    assert.ok(name)
    if (close) assert.equal(stack.pop(), name, `unbalanced </${name}>`)
    else {
      count++
      if (!selfClose) stack.push(name)
    }
  }
  assert.deepEqual(stack, [], 'unclosed tags')
  return count
}

test('parseAnsiLine maps 16-colour, bright, 256, truecolor and colon-form colours', () => {
  const [a, b, c, d, e, f] = parseAnsiLine(`${ESC}[31ma${ESC}[92mb${ESC}[38;5;196mc${ESC}[38;5;244md${ESC}[38;2;1;2;3me${ESC}[38:2::9:8:7mf`)
  assert.equal(a?.fg, '#ff7b72')
  assert.equal(b?.fg, '#56d364')
  assert.equal(c?.fg, '#ff0000')
  assert.equal(d?.fg, '#808080')
  assert.equal(e?.fg, '#010203')
  assert.equal(f?.fg, '#090807')
  assert.equal(color256(16), '#000000')
  assert.equal(color256(231), '#ffffff')
  assert.equal(color256(1), '#ff7b72')
})

test('parseAnsiLine handles bold, dim, inverse, background, reset and ignores other escapes', () => {
  const cells = parseAnsiLine(`${ESC}[1mB${ESC}[22;2mD${ESC}[0m${ESC}[7mI${ESC}[27m${ESC}[44mG${ESC}[0m${ESC}[2K${ESC}[?25hx${ESC}]0;title\x07y`)
  assert.equal(cells.map(c => c.t).join(''), 'BDIGxy')
  assert.equal(cells[0]?.bold, true)
  assert.equal(cells[1]?.bold, false)
  assert.equal(cells[1]?.dim, true)
  assert.equal(cells[2]?.fg, '#0d1117', 'inverse swaps the default colours')
  assert.equal(cells[2]?.bg, '#c9d1d9')
  assert.equal(cells[3]?.bg, '#58a6ff')
  assert.equal(cells[4]?.fg, '#c9d1d9')
  assert.equal(cells[4]?.bg, null)
})

test('cell widths: wide characters take two columns, combining marks none; long lines re-wrap', () => {
  assert.equal(cellWidth(0x4e2d), 2)
  assert.equal(cellWidth(0x301), 0)
  assert.equal(cellWidth(0x41), 1)
  const cells = parseAnsiLine('ab中é')
  assert.equal(cells.length, 4)
  assert.equal(cells[3]?.t, 'é')
  assert.deepEqual(wrapCells(parseAnsiLine('abcdefg'), 3).map(l => l.map(c => c.t).join('')), ['abc', 'def', 'g'])
  assert.deepEqual(wrapCells(parseAnsiLine('ab中'), 3).map(l => l.map(c => c.t).join('')), ['ab', '中'])
  assert.equal(plainText(`${ESC}[31mred${ESC}[0m\nx`), 'red\nx')
})

test('animated svg is well-formed, self-contained and aligned to the cell grid', () => {
  const svg = renderAnimatedSvg(FRAMES, { title: 'T' }, { cols: 80, claudeCodeVersion: '9.9.9', model: 'none' })
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /)
  assert.ok(svg.trimEnd().endsWith('</svg>'))
  assert.ok(assertWellFormed(svg) > 10)
  assert.doesNotMatch(svg, /<script|<foreignObject|href=|url\(|@import|xlink|on\w+=/i)
  assert.deepEqual([...svg.matchAll(/https?:\/\/[^"' <)]+/g)].map(m => m[0]), ['http://www.w3.org/2000/svg'])
  assert.match(svg, /<desc>Claude Code: 9\.9\.9; model: none<\/desc>/)
  assert.match(svg, /@keyframes k0\{/)
  assert.match(svg, /animation-iteration-count:infinite/)
  // "red" starts at column 0 and "plain" at column 4: x = 16 + col * 8.4
  assert.match(svg, /<tspan x="16" class="f\w+">red<\/tspan>/)
  assert.match(svg, /<tspan x="49\.6">plain<\/tspan>/)
  assert.match(svg, /<tspan x="16" class="f\w+ b">done<\/tspan>/)
})

test('colours become classes and a duplicate row is emitted once', () => {
  const svg = renderAnimatedSvg(FRAMES, {})
  const red = /\.f(\w+)\{fill:#ff7b72\}/.exec(svg)
  assert.ok(red, 'red palette colour has a class')
  assert.match(svg, /\.f\w+\{fill:#3fb950\}/)
  assert.equal(svg.split('>red<').length - 1, 1, 'the unchanged row "red plain" is one element across frames')
  assert.equal(svg.split('>echo hi<').length - 1, 0, 'a single space is kept inside a run, not split')
  assert.equal(svg.split('$ echo hi').length - 1, 1)
})

test('inverse video and backgrounds become rects', () => {
  const svg = renderAnimatedSvg([{ t: 0, text: `${ESC}[7m ab ${ESC}[0m` }], {})
  assert.match(svg, /<rect x="16" y="52" width="33.6" height="18" class="f\w+"\/>/)
  assert.match(svg, /\.f\w+\{fill:#c9d1d9\}/)
})

test('text is XML-escaped and control characters are dropped', () => {
  assert.equal(escapeXml(`a<b>&"c"'d'`), 'a&lt;b&gt;&amp;&quot;c&quot;&apos;d&apos;')
  const svg = renderAnimatedSvg([{ t: 0, text: `x<y> & "q" 'z'\x00\x07 ok` }], { title: 'A & <B>' })
  assert.match(svg, />x&lt;y&gt;<\/tspan>|>x&lt;y&gt; &amp; &quot;q&quot; &apos;z&apos; ok</)
  assert.match(svg, /<title>A &amp; &lt;B&gt;<\/title>/)
  assert.doesNotMatch(svg, /[\x00-\x08\x0b\x0c\x0e-\x1f]/)
  assertWellFormed(svg)
})

test('timing: real durations scale with --speed, idle gaps are capped, the last frame pauses', () => {
  const frames: Frame[] = [{ t: 0, text: 'a' }, { t: 1000, text: 'b' }, { t: 2000, text: 'c' }]
  assert.match(renderAnimatedSvg(frames, { endPause: 3 }), /animation-duration:5s/)
  assert.match(renderAnimatedSvg(frames, { speed: 2, endPause: 3 }), /animation-duration:4s/)
  const gap: Frame[] = [{ t: 0, text: 'a' }, { t: 100, text: 'b' }, { t: 60_000, text: 'c' }]
  // 0.1 s + the 59.9 s idle gap capped at 2 s + a 3 s end pause
  assert.match(renderAnimatedSvg(gap, { maxGap: 2, endPause: 3 }), /animation-duration:5\.1s/)
  assert.match(renderAnimatedSvg(gap, { maxGap: 10, endPause: 1 }), /animation-duration:11\.1s/)
  // b is visible from 0.1 s of 5.1 s to 2.1 s: 1.961% .. 41.176%
  assert.match(renderAnimatedSvg(gap, { maxGap: 2, endPause: 3 }), /0%\{opacity:0\}1\.961%\{opacity:1\}41\.176%\{opacity:0\}/)
})

test('a non-animating viewer sees the final frame', () => {
  const svg = renderAnimatedSvg([{ t: 0, text: 'first' }, { t: 1000, text: 'last' }], {})
  assert.match(svg, /<g class="s" style="animation-name:k\d+" opacity="0"><text[^>]*><tspan[^>]*>first</)
  assert.match(svg, /<g class="s" style="animation-name:k\d+"><text[^>]*><tspan[^>]*>last</)
})

test('size limit: a long recording is coalesced under 400 KB, an impossible budget throws', () => {
  // 23 static rows plus one ticking row, 4000 frames: too big as-is, fine once frames are merged
  const still = Array.from({ length: 23 }, (_, r) => `${ESC}[3${r % 8}mrow ${r} ${'x'.repeat(60)}${ESC}[0m`).join('\n')
  const frames: Frame[] = Array.from({ length: 3000 }, (_, i) => ({ t: i * 50, text: `${still}\nstep ${i} ${'y'.repeat(60)}` }))
  const svg = renderAnimatedSvg(frames, {})
  assert.ok(Buffer.byteLength(svg) < 400_000, `${Buffer.byteLength(svg)} bytes`)
  assert.match(svg, /step 2999/, 'the final frame is always kept')
  assertWellFormed(svg)
  assert.ok(Buffer.byteLength(renderAnimatedSvg(frames.slice(0, 40), {})) < 100_000)
  assert.throws(() => renderAnimatedSvg(frames, { maxBytes: 2000 }), /cannot fit 2000 bytes/)
})

test('static svg renders one chosen frame, by index, from the end, or by regex', () => {
  const svg = renderStaticSvg(FRAMES, 1)
  assertWellFormed(svg)
  assert.doesNotMatch(svg, /@keyframes|animation/)
  assert.match(svg, /echo/)
  assert.doesNotMatch(svg, /done/)
  assert.match(renderStaticSvg(FRAMES, -1), /done/)
  assert.equal(findFrame(FRAMES, 'done'), 2)
  assert.throws(() => findFrame(FRAMES, 'never appears'), /no frame matches/)
  assert.throws(() => renderStaticSvg(FRAMES, 3), /out of range/)
})

test('parseFrames reads metadata lines and rejects malformed input', () => {
  const ok = parseFrames(`{"meta":{"model":"none"}}\n{"t":0,"text":"a"}\n\n{"t":5,"text":"b"}\n`)
  assert.equal(ok.frames.length, 2)
  assert.equal(ok.meta.model, 'none')
  assert.throws(() => parseFrames('{"t":0,"text":"a"}\nnot json'), /line 2: not valid JSON/)
  assert.throws(() => parseFrames('{"t":"x","text":"a"}'), /expected \{"t"/)
  assert.throws(() => parseFrames('{"t":5,"text":"a"}\n{"t":1,"text":"b"}'), /backwards/)
  assert.throws(() => parseFrames('{"meta":{}}'), /no frames/)
})

test('render-svg CLI writes the animated and the static svg', t => {
  const dir = tmp(t)
  const input = join(dir, 'in.frames.jsonl')
  writeFileSync(input, [JSON.stringify({ meta: { cols: 40, date: '2000-01-01T00:00:00Z' } }), ...FRAMES.map(f => JSON.stringify(f))].join('\n') + '\n')
  const r = spawnSync(process.execPath, [RENDER, input, '--out', join(dir, 'a.svg'), '--static-out', join(dir, 's.svg'), '--at-regex', 'done', '--speed', '2'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assertWellFormed(readFileSync(join(dir, 'a.svg'), 'utf8'))
  assert.match(readFileSync(join(dir, 's.svg'), 'utf8'), /done/)
  assert.match(readFileSync(join(dir, 'a.svg'), 'utf8'), /recorded: 2000-01-01/)
  const bad = spawnSync(process.execPath, [RENDER, join(dir, 'missing.jsonl'), '--out', join(dir, 'x.svg')], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.equal(existsSync(join(dir, 'x.svg')), false)
})

test('record refuses a config dir that is missing or inside ~/.claude*', t => {
  const home = tmp(t)
  mkdirSync(join(home, '.claude'))
  mkdirSync(join(home, 'scratch'))
  let linked = true
  try {
    symlinkSync(join(home, '.claude'), join(home, 'scratch', 'link'), 'dir')
  } catch {
    linked = false // Windows without symlink privilege
  }
  assert.throws(() => assertScratchConfigDir(undefined, home), /must be set/)
  assert.throws(() => assertScratchConfigDir(join(home, '.claude'), home), /must not be inside ~\/\.claude/)
  assert.throws(() => assertScratchConfigDir(join(home, '.claude', 'nested', 'new'), home), /must not be inside/)
  assert.throws(() => assertScratchConfigDir(join(home, '.claude-local'), home), /must not be inside/)
  if (linked) assert.throws(() => assertScratchConfigDir(join(home, 'scratch', 'link'), home), /must not be inside/)
  assert.throws(() => assertScratchConfigDir(home, home), /home directory/)
  assert.doesNotThrow(() => assertScratchConfigDir(join(home, 'scratch', 'cfg'), home))

  const out = join(home, 'x.frames.jsonl')
  const env = { ...process.env }
  delete env.CLAUDE_CONFIG_DIR
  const none = spawnSync(process.execPath, [RECORD, '--out', out, '--', 'true'], { encoding: 'utf8', env })
  assert.equal(none.status, 2)
  assert.match(none.stderr, /CLAUDE_CONFIG_DIR must be set/)
  const real = spawnSync(process.execPath, [RECORD, '--out', out, '--', 'true'], { encoding: 'utf8', env: { ...env, CLAUDE_CONFIG_DIR: join(homedir(), '.claude') } })
  assert.equal(real.status, 2)
  assert.match(real.stderr, /must not be inside/)
  assert.equal(existsSync(out), false)
})

// The recorder needs tmux, /bin/sh and /usr/bin/env: skip cleanly anywhere they are missing (Windows).
const hasTmux = process.platform !== 'win32' && spawnSync('tmux', ['-V']).status === 0 && existsSync('/bin/sh') && existsSync('/usr/bin/env')
test('record captures a real tmux session, types scripted keys and stops on a match', { skip: !hasTmux && 'tmux (or /bin/sh) not available' }, t => {
  const dir = tmp(t)
  const script = join(dir, 'script.json')
  const out = join(dir, 'out.frames.jsonl')
  // the delay lets the shell finish starting before it is typed at
  writeFileSync(script, JSON.stringify([{ waitFor: 'never-on-screen', softTimeout: true, timeout: 300 }, { waitForLine: '\\$$', delay: 300, keys: 'echo typed-ok\n', typed: 5 }]))
  // --idle and --limit are far above the time the run needs: only a missed match can reach them
  const r = spawnSync(process.execPath, [RECORD, '--out', out, '--script', script, '--until', '\\ntyped-ok\\n\\S*\\$$', '--idle', '30000', '--limit', '60000', '--interval', '100', '--cols', '60', '--rows', '10', '--home', dir, '--path', '/usr/bin:/bin', '--claude-bin', 'false', '--', '/bin/sh'], {
    encoding: 'utf8',
    timeout: 90_000,
    env: { PATH: process.env.PATH ?? '', CLAUDE_CONFIG_DIR: join(dir, 'cfg') },
  })
  assert.equal(r.status, 0, r.stderr)
  const { meta, frames } = parseFrames(readFileSync(out, 'utf8'))
  assert.equal(meta.stopReason, 'until')
  assert.equal(meta.cols, 60)
  assert.equal(meta.claudeCodeVersion, 'unknown')
  assert.match(plainText(frames.at(-1)?.text ?? ''), /^\S*\$ echo typed-ok\ntyped-ok$/m)
  assert.ok(frames.every((f, i) => i === 0 || f.text !== frames[i - 1]?.text), 'only changed frames are stored')
})

test('record masks text at capture time, lists labels not patterns, and aborts on a guard match', { skip: !hasTmux && 'tmux (or /bin/sh) not available' }, t => {
  const dir = tmp(t)
  const maskFile = join(dir, 'masks.json')
  writeFileSync(maskFile, JSON.stringify([{ match: 'hunter2', replace: '*******', label: 'password' }]))
  const run = (extra: string[], command: string) => {
    const out = join(dir, `${extra.length}.frames.jsonl`)
    const r = spawnSync(process.execPath, [RECORD, '--out', out, '--idle', '600', '--limit', '30000', '--interval', '100', '--cols', '60', '--rows', '10', '--home', dir, '--path', '/usr/bin:/bin', '--claude-bin', 'false', ...extra, '--', command], {
      encoding: 'utf8',
      timeout: 90_000,
      env: { PATH: process.env.PATH ?? '', CLAUDE_CONFIG_DIR: join(dir, 'cfg') },
    })
    return { r, out }
  }
  // The command stays alive and the run ends on --until, so no step depends on how fast a command exits:
  // a command that exits at once can lose its output to tmux (the session or the unread tty data goes first).
  const masked = run(['--mask-file', maskFile, '--mask', 'abc=XYZ', '--until', 'pw \\*{7} XYZ'], 'echo "pw hunter2 abc"; sleep 30')
  assert.equal(masked.r.status, 0, masked.r.stderr)
  const text = readFileSync(masked.out, 'utf8')
  assert.doesNotMatch(text, /hunter2/)
  const { meta, frames } = parseFrames(text)
  assert.equal(meta.stopReason, 'until')
  // the masked output is in a stored frame itself; the command line in the meta also carries it, so check the frames
  assert.match(plainText(frames.at(-1)?.text ?? ''), /^pw \*{7} XYZ$/m)
  assert.deepEqual(meta.masked, ['masked text', 'password'])
  assert.equal(meta.maskedReplacements, 2, 'counted once per stored frame, not once per capture')
  assert.doesNotMatch(JSON.stringify(meta), /hunter2/)

  const aborted = run(['--abort-on', 'STOP-NOW'], 'echo STOP-NOW; sleep 20')
  assert.equal(aborted.r.status, 4, aborted.r.stderr)
  assert.equal(parseFrames(readFileSync(aborted.out, 'utf8')).meta.stopReason, 'abort')
})

test('team-demo.sh guard: aborts at a cost of $2.00 or more or more than 3 busy teammates, not at $0.78', () => {
  const script = readFileSync(join(import.meta.dirname, '..', 'scripts', 'demo', 'team-demo.sh'), 'utf8')
  const patterns = [...script.matchAll(/ABORT='([^']+)'/g)].map(m => m[1] as string)
  assert.equal(patterns.length, 3, 'a default guard, the Mission Control one and Run F')
  assert.match(script, /--abort-on "\$ABORT"/)
  const guard = new RegExp(patterns[0] as string)
  for (const hit of ['· $2.00', '· $12.40', 'team 4 busy · 0 idle', 'team 12 busy']) assert.match(hit, guard, hit)
  for (const miss of ['· $0.78', '· $1.99 ·', 'team 3 busy · 0 idle · 0 done / cap 3 · models x×3 · $0.78 · 1m', 'team 0 busy']) assert.doesNotMatch(miss, guard, miss)
})

test('team-demo.sh guard for the Mission Control run: more than 3 agents or $3.00 or more', () => {
  const script = readFileSync(join(import.meta.dirname, '..', 'scripts', 'demo', 'team-demo.sh'), 'utf8')
  const guard = new RegExp([...script.matchAll(/ABORT='([^']+)'/g)].map(m => m[1] as string)[1] as string)
  for (const hit of ['Agents 4/3', 'Agents 12/3', 'Guard ON │ Ctx 5% │ $3.00 (2m)', '│ $12.10']) assert.match(hit, guard, hit)
  for (const miss of ['Agents 3/3 (1 busy)', 'Agents 0/3', '│ $2.99 (4m)', 'Tools 31 │ Agents 3/3', '$0.94']) assert.doesNotMatch(miss, guard, miss)
})

test('team-demo.sh guard for Run F: more than 3 agents or $10.00 or more, not $9.99', () => {
  const script = readFileSync(join(import.meta.dirname, '..', 'scripts', 'demo', 'team-demo.sh'), 'utf8')
  const guard = new RegExp([...script.matchAll(/ABORT='([^']+)'/g)].map(m => m[1] as string)[2] as string)
  for (const hit of ['Agents 4/3', 'Agents 12/3', 'Guard ON │ Ctx 5% │ $10.00 (2m)', '│ $12.10']) assert.match(hit, guard, hit)
  for (const miss of ['Agents 3/3 (1 busy)', 'Agents 0/3', '│ $9.99 (4m)', '│ $3.50 (4m)', 'Tools 31 │ Agents 3/3']) assert.doesNotMatch(miss, guard, miss)
})

test('mask-frames applies masks after capture and says so in the meta line', () => {
  const src = [JSON.stringify({ meta: { masked: ['email'] } }), JSON.stringify({ t: 0, text: 'a\nPROMO line here\nb' }), JSON.stringify({ t: 5, text: 'no match' })].join('\n') + '\n'
  const out = maskFramesText(src, [{ match: '[^\\n]*PROMO[^\\n]*', replace: '', label: 'promotional banner line' }])
  assert.ok(out)
  const { meta, frames } = parseFrames(out)
  assert.deepEqual(meta.maskedAfterCapture, ['promotional banner line'])
  assert.equal(meta.maskedAfterCaptureReplacements, 1)
  assert.deepEqual(meta.masked, ['email'])
  assert.deepEqual(frames.map(f => f.t), [0, 5])
  assert.equal(frames[0]?.text, 'a\n\nb', 'the line is blanked, the frame keeps its shape')
  assert.equal(maskFramesText(src, [{ match: 'nothing-here', replace: 'x' }]), null)
})

test('recorder click: the target is found by its cells on the current screen and sent as one SGR press and release', () => {
  const screen = 'first line\n分支 │CTK ▸ Sonnet │ 5h\nlast CTK'
  assert.deepEqual(locateText(screen, 'CTK ▸', 2), { col: 9, row: 2 })
  assert.deepEqual(locateText(screen, 'CTK', 0, true), { col: 6, row: 3 })
  assert.equal(locateText(screen, 'nowhere'), null)
  assert.equal(sgrClick({ col: 12, row: 35 }), '\x1b[<0;12;35M\x1b[<0;12;35m')
})
