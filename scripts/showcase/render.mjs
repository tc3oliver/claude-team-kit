#!/usr/bin/env node
// Renders the real Mission Control pane from fixed synthetic data inside a real Claude Code terminal.
//
//   CLAUDE_CONFIG_DIR is not read: pass --config, a scratch config dir that is already logged in and
//   trusts --cwd. Nothing here makes a model call; see scripts/showcase/README.md.
//
//   node scripts/showcase/render.mjs --out docs/assets/mission-control-ui --name before --ctk <checkout>
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseFrames, plainText, renderStaticSvg } from '../demo/render-svg.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')

export const LABEL = 'SYNTHETIC DATA - UI showcase, not a live agent run'
export const SCENES = ['empty', 'team', 'workers', 'dag', 'usage', 'guard', 'many', 'config', 'stats', 'doctor']
export const WIDTHS = [60, 80, 100, 130, 200]
const MAIN_WIDTH = 100
const ROWS = 70

const USAGE = `usage: node scripts/showcase/render.mjs --out DIR [options]
  --out DIR        output directory (a <name>/ folder is created inside it)
  --name NAME      set name, default "after" (use "before" for an older commit)
  --ctk DIR        checkout whose plugins/ctk is rendered (default: this repository)
  --config DIR     scratch Claude Code config dir, logged in (default: ~/Developer/scratch/ctk-demo/config)
  --cwd DIR        working directory trusted by that config (default: /private/tmp/ctk-demo/wordkit)
  --scenes a,b     default ${SCENES.join(',')}
  --widths 60,100  default ${WIDTHS.join(',')}; ${MAIN_WIDTH} is the width of the single-scene SVGs
  --jobs N         terminals recorded at once (default 3)`

const die = msg => {
  throw new Error(msg)
}

export function parseArgs(argv) {
  const o = { name: 'after', ctk: REPO, config: join(homedir(), 'Developer/scratch/ctk-demo/config'), cwd: '/private/tmp/ctk-demo/wordkit', scenes: SCENES, widths: WIDTHS, jobs: 3 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') die(USAGE)
    const v = argv[++i]
    if (!a.startsWith('--') || v === undefined) die(`bad argument ${a}\n${USAGE}`)
    const k = a.slice(2)
    if (k === 'scenes') o.scenes = v.split(',')
    else if (k === 'widths') o.widths = v.split(',').map(Number)
    else if (k === 'jobs') o.jobs = Number(v)
    else if (['out', 'name', 'ctk', 'config', 'cwd'].includes(k)) o[k] = v
    else die(`unknown option ${a}\n${USAGE}`)
  }
  if (!o.out) die(`--out is required\n${USAGE}`)
  for (const s of o.scenes) if (!SCENES.includes(s)) die(`unknown scene ${s} (${SCENES.join(', ')})`)
  if (o.widths.some(w => !Number.isInteger(w) || w < 20)) die('--widths must be integers')
  return o
}

const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })

/** Commit, its committer date and the claude version: the same on every run of the same inputs. */
export function metadata(ctk, claude) {
  const head = git(ctk, 'rev-parse', '--short', 'HEAD').stdout.trim()
  const dirty = git(ctk, 'status', '--porcelain', '--', 'plugins/ctk').stdout.trim() !== ''
  const date = git(ctk, 'show', '-s', '--format=%cs', 'HEAD').stdout.trim()
  const version = spawnSync(claude, ['--version'], { encoding: 'utf8' }).stdout.trim().split(/\s+/)[0]
  if (!head || !date || !version) die('could not read the commit, its date or the claude version')
  return { ctkCommit: head + (dirty ? '-dirty' : ''), date, claudeCodeVersion: version }
}

export const metaLine = (m, cols) => `ctk ${m.ctkCommit} · claude ${m.claudeCodeVersion} · ${m.date} · ${cols} cols`

/**
 * What of a captured screen belongs in the picture. Inline (narrow terminals) the pane is a box between
 * the transcript and the prompt: only that box is kept. Docked (wide terminals) it shares the screen with
 * the transcript, so the whole screen is kept down to its last row with content.
 */
export function cropPane(text) {
  const lines = text.split('\n')
  const plain = plainText(text).split('\n')
  const top = plain.findIndex(l => l.startsWith('╭'))
  const bottom = plain.findIndex((l, i) => i > top && l.startsWith('╰'))
  if (top >= 0 && bottom >= 0) return lines.slice(top, bottom + 1).join('\n')
  const at = plain.findIndex(l => l.includes(LABEL))
  if (at < 0) return null
  // The dock starts where the label does; the prompt and footer rows below the pane are not part of it.
  const dock = plain[at].indexOf(LABEL)
  let last = plain.length - 1
  while (last > at && plain[last].slice(dock).replace(/[\s\u2500-\u257F]/g, '') === '') last--
  return lines.slice(0, last + 1).join('\n')
}

/** Copies the ctk modules the pane needs, plus the showcase mod, into a loadable plugin folder. */
export function buildPlugin(dir, ctk) {
  const src = join(ctk, 'plugins', 'ctk')
  if (!existsSync(join(src, 'hooks', 'missionui.tsx'))) die(`${src} has no hooks/missionui.tsx`)
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  mkdirSync(join(dir, 'hooks'))
  cpSync(join(src, 'shared'), join(dir, 'shared'), { recursive: true })
  // Everything but the real mod's own wiring: the pane only needs its pure modules.
  for (const f of readdirSync(join(src, 'hooks'))) {
    if (f !== 'register.tsx' && f !== 'hooks.json') cpSync(join(src, 'hooks', f), join(dir, 'hooks', f), { recursive: true })
  }
  cpSync(join(HERE, 'plugin'), join(dir, 'hooks'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'showcase', version: '0.0.0', description: 'scratch UI showcase', author: { name: 'ctk' } }))
  writeFileSync(join(dir, 'hooks', 'hooks.json'), JSON.stringify({ modules: ['./register.tsx'] }))
}

const SCRIPT = [
  { waitFor: 'accept edits on', timeout: 60000 },
  { delay: 800, keys: '/showcase\n' },
  { waitFor: 'SYNTHETIC DATA', stable: 2500, timeout: 30000 },
]

function record({ scene, cols, plugin, work, o, meta }) {
  const out = join(work, `${scene}-${cols}.raw.jsonl`)
  const script = join(work, `${scene}-${cols}.script.json`)
  writeFileSync(script, JSON.stringify(SCRIPT))
  const claude = join(homedir(), '.local/bin/claude')
  const args = [
    join(REPO, 'scripts/demo/record.mjs'), '--out', out, '--script', script, '--cols', String(cols), '--rows', String(ROWS),
    '--cwd', o.cwd, '--home', homedir(), '--path', `${join(homedir(), '.local/bin')}:/usr/bin:/bin`, '--claude-bin', claude,
    '--env', `SHOWCASE_SCENE=${scene}`, '--env', `SHOWCASE_META=${metaLine(meta, cols)}`, '--idle', '1500', '--limit', '90000',
    '--', claude, '--plugin-dir', plugin, '--settings', JSON.stringify({ enabledPlugins: { 'ctk@ctk-kit': false } }),
  ]
  return new Promise((res, rej) => {
    const p = spawn('node', args, { env: { ...process.env, CLAUDE_CONFIG_DIR: o.config }, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', d => (err += d))
    p.on('exit', code => (code === 0 ? res(out) : rej(new Error(`${scene} at ${cols} columns: record exited ${code}: ${err.trim().slice(-300)}`))))
  })
}

/** Raw recording -> one cropped frame that must carry the label and the metadata line. */
export function pick(rawPath, scene, cols, meta) {
  const { frames } = parseFrames(readFileSync(rawPath, 'utf8'))
  for (let i = frames.length - 1; i >= 0; i--) {
    const pane = cropPane(frames[i].text)
    if (pane === null) continue
    const plain = plainText(pane)
    if (!plain.includes(LABEL)) throw new Error(`${scene} at ${cols} columns: the label is missing from the pane`)
    if (!plain.includes('cols') || !plain.includes(`ctk ${meta.ctkCommit}`)) throw new Error(`${scene} at ${cols} columns: the metadata line is missing from the pane`)
    return { t: 0, text: pane }
  }
  throw new Error(`${scene} at ${cols} columns: no pane was captured`)
}

export function sheetSvg(panels, title) {
  const pad = 16
  const head = 28
  // Each panel's colour classes (.f1, .b ...) are numbered per picture and would override each other in one
  // document, so every panel gets its own prefix.
  const parsed = panels.map((p, i) => {
    const m = /<svg [^>]*width="(\d+)" height="(\d+)"/.exec(p.svg)
    const svg = p.svg
      .replace(/<style>([\s\S]*?)<\/style>/, (_, css) => `<style>${css.replace(/\.([a-z][\w]*)(?=[{,])/g, `.p${i}$1`)}</style>`)
      .replace(/class="([^"]*)"/g, (_, c) => `class="${c.split(' ').map(t => `p${i}${t}`).join(' ')}"`)
    return { ...p, svg, w: Number(m[1]), h: Number(m[2]) }
  })
  const width = Math.max(...parsed.map(p => p.w)) + pad * 2
  let y = pad
  const body = parsed
    .map(p => {
      const cap = `<text x="${pad}" y="${y + 14}" style="fill:#8b949e;font-size:13px">${p.cols} columns</text>`
      const nested = p.svg.replace('<svg ', `<svg x="${pad}" y="${y + head - 8}" `)
      y += p.h + head + pad
      return cap + nested
    })
    .join('')
  const esc = title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}" role="img" aria-label="${esc}"><title>${esc}</title><rect width="${width}" height="${y}" fill="#010409"/>${body}</svg>\n`
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (!existsSync(o.config)) die(`--config ${o.config} does not exist`)
  if (!existsSync(o.cwd)) die(`--cwd ${o.cwd} does not exist`)
  const meta = metadata(o.ctk, join(homedir(), '.local/bin/claude'))
  const work = mkdtempSync(join(tmpdir(), 'ctk-showcase-'))
  const plugin = join(work, 'showcase')
  const dest = join(resolve(o.out), o.name)
  try {
    buildPlugin(plugin, resolve(o.ctk))
    const check = spawnSync(join(homedir(), '.local/bin/claude'), ['plugin', 'validate', plugin], { encoding: 'utf8' })
    if (check.status !== 0) die(`the generated showcase plugin does not validate:\n${check.stdout}${check.stderr}`)
    const widths = [...new Set([...o.widths, MAIN_WIDTH])]
    const jobs = o.scenes.flatMap(scene => widths.map(cols => ({ scene, cols })))
    const frames = new Map()
    const queue = [...jobs]
    await Promise.all(
      Array.from({ length: Math.max(1, o.jobs) }, async () => {
        for (let j = queue.shift(); j; j = queue.shift()) {
          const raw = await record({ ...j, plugin, work, o, meta })
          frames.set(`${j.scene}-${j.cols}`, pick(raw, j.scene, j.cols, meta))
        }
      }),
    )
    mkdirSync(dest, { recursive: true })
    const full = { schema: 1, ...meta, model: 'none (no model call)', synthetic: true }
    for (const scene of o.scenes) {
      const panels = []
      for (const cols of widths) {
        const f = frames.get(`${scene}-${cols}`)
        const m = { ...full, cols, rows: f.text.split('\n').length, scene }
        const svg = renderStaticSvg([f], 0, { title: `Mission Control - ${scene} - ${LABEL}`, cols }, { ...m, date: `${meta.date}T00:00:00.000Z` })
        panels.push({ cols, svg })
        const stem = cols === MAIN_WIDTH ? scene : `${scene}-${cols}`
        if (cols === MAIN_WIDTH) writeFileSync(join(dest, `${scene}.svg`), svg)
        writeFileSync(join(dest, `${stem}.frames.jsonl`), `${JSON.stringify({ meta: m })}\n${JSON.stringify(f)}\n`)
      }
      writeFileSync(join(dest, `${scene}-widths.svg`), sheetSvg(panels, `${scene}: ${widths.join('/')} columns. ${LABEL}`))
    }
    writeFileSync(join(dest, 'METADATA.txt'), `${LABEL}\n${metaLine(meta, widths.join('/'))}\n`)
    console.log(`showcase: ${jobs.length} terminals -> ${dest}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(e => {
    console.error(`showcase: ${e.message}`)
    process.exitCode = 1
  })
}
