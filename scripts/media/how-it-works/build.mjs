#!/usr/bin/env node
// Builds the "How CTK works" illustration as ONE animated SVG: CSS keyframes only, no script, no
// external reference, system fonts. The MP4 and the poster are screenshots of this same file
// (render.mjs seeks its animations), so the three can never disagree.
//
//   node scripts/media/how-it-works/build.mjs [--out docs/assets/how-it-works.svg]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  CAP,
  CAPTIONS,
  DURATION,
  FINAL,
  FRONTIER_AT,
  GOAL,
  HANDOFFS,
  HANDOFF_CARD,
  LAYERS,
  LEAD_STATES,
  POSTER_AT,
  SCHEDULE,
  TAGLINE,
  TASKS,
  VERIFY_CARD,
  WORKERS,
  WORKER_UP,
  endOf,
  planAppearAt,
  readyAt,
  startOf,
  validate,
} from './storyboard.mjs'

export const W = 1920
export const H = 1080

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

const C = {
  bg: '#0b0f14',
  panel: '#121821',
  line: '#3a4352',
  text: '#e6edf3',
  muted: '#9aa4b2',
  ready: '#58a6ff',
  busy: '#e3b341',
  done: '#3fb950',
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const n = v => String(Math.round(v * 100) / 100)

// ---------------------------------------------------------------------------------------------
// Animation registry: every animated element is `class="an aK"`; elements whose keyframes are
// identical share one class, which keeps the file small.

const FADE = 0.3
const kinds = {
  opacity: { prop: 'opacity', fmt: v => n(v), timing: 'cubic-bezier(.4,0,.2,1)' },
  scaleX: { prop: 'transform', fmt: v => `scaleX(${n(v)})`, timing: 'linear' },
}
const registry = new Map()
const css = []

const pct = t => `${Math.round((t / DURATION) * 100000) / 1000}%`

/** Keyframes for a list of [time, value] points; the first and last points sit at 0 and DURATION. */
const register = (kind, points) => {
  const k = kinds[kind]
  const pts = [...points].sort((a, b) => a[0] - b[0])
  if (pts[0][0] > 0) pts.unshift([0, pts[0][1]])
  if (pts[pts.length - 1][0] < DURATION) pts.push([DURATION, pts[pts.length - 1][1]])
  const body = pts.map(([t, v]) => `${pct(t)}{${k.prop}:${k.fmt(v)}}`).join('')
  const key = `${kind}|${body}`
  let id = registry.get(key)
  if (id === undefined) {
    id = `a${registry.size}`
    registry.set(key, id)
    css.push(`@keyframes k${id}{${body}}.${id}{animation-name:k${id};animation-timing-function:${k.timing}}`)
  }
  return `an ${id}`
}

/** Opacity points that show an element during each [from, to] window, with a short fade at each edge. */
const windows = (list, fade = FADE) => {
  const w = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const merged = []
  for (const [a, b] of w) {
    const last = merged[merged.length - 1]
    if (last !== undefined && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  const pts = [[0, 0]]
  for (const [a, b] of merged) {
    // two windows whose gap is shorter than a fade merge into one hold
    pts.push([a, 0], [a + fade, 1], [b, 1], [b + fade, 0])
  }
  // drop points that would go backwards in time (windows closer together than a fade)
  const out = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last !== undefined && p[0] < last[0]) continue
    out.push(p)
  }
  return out
}

const show = list => register('opacity', windows(list))

// Text that replaces other text in the same place fades quickly and starts after the old text has gone,
// so two labels are never drawn over each other.
const SWAP = 0.12
const swap = list => register('opacity', windows(list.map(([a, b]) => [a + SWAP, b - SWAP]), SWAP))

// ---------------------------------------------------------------------------------------------
// Geometry

const NODE = { w: 230, h: 106 }
const COLS = [80, 440, 800, 1160]
const POS = {
  T1: [COLS[0], 440],
  T2: [COLS[0], 640],
  T3: [COLS[0], 790],
  T4: [COLS[1], 290],
  T5: [COLS[1], 440],
  T6: [COLS[1], 610],
  T7: [COLS[2], 790],
  T8: [COLS[3], 700],
}
const box = id => {
  const [x, yc] = POS[id]
  return { x, y: yc - NODE.h / 2, yc }
}

const PANEL_X = 1530
const PANEL_W = 310
const WORKER_Y = { W1: 470, W2: 606, W3: 742 }
const WORKER_H = 118
const LEAD = { x: PANEL_X, y: 250, w: PANEL_W, h: 84 }
const HANDOFF_BOX = { x: 1150, y: 250, w: 330, h: 340 }

const edgePath = (from, to) => {
  const a = box(from)
  const b = box(to)
  const x1 = a.x + NODE.w
  const x2 = b.x
  const xm = (x1 + x2) / 2
  return `M${x1} ${a.yc}C${xm} ${a.yc} ${xm} ${b.yc} ${x2 - 4} ${b.yc}`
}

const worker = id => ({ x: PANEL_X, y: WORKER_Y[id], w: PANEL_W, h: WORKER_H })

// ---------------------------------------------------------------------------------------------
// Pieces

const text = (x, y, size, fill, str, extra = '') =>
  `<text x="${n(x)}" y="${n(y)}" font-size="${size}" fill="${fill}" ${extra}>${esc(str)}</text>`

const chipWidth = label => Math.round(label.length * 18.5 + 48)

const chip = (x, y, layer) => {
  const { name, color } = LAYERS[layer]
  const label = name.toUpperCase()
  const w = chipWidth(label)
  return {
    w,
    svg:
      `<rect x="${x}" y="${y}" width="${w}" height="52" rx="26" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-width="3"/>` +
      text(x + w / 2, y + 36, 29, color, label, `text-anchor="middle" font-weight="700" letter-spacing="1"`),
  }
}

const nodeLayers = id => {
  const t = TASKS.find(x => x.id === id)
  const { x, y } = box(id)
  const appear = planAppearAt(id)
  const start = startOf(id)
  const end = endOf(id)
  const ready = Math.max(FRONTIER_AT, readyAt(id))
  const lead = SCHEDULE.find(s => s.task === id).by
  const rect = (stroke, fill, extra = '') =>
    `<rect x="${x}" y="${y}" width="${NODE.w}" height="${NODE.h}" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="4" ${extra}/>`
  const tag = (str, fill) => text(x + NODE.w - 18, y + 40, 24, fill, str, `text-anchor="end" font-weight="700"`)
  const hasDeps = t.after.length > 0
  const parts = []
  parts.push(
    `<g class="${show([[appear, 23.5]])}">` +
      `<rect x="${x}" y="${y}" width="${NODE.w}" height="${NODE.h}" rx="18" fill="${C.panel}" stroke="${C.line}" stroke-width="3"/>` +
      text(x + 20, y + 40, 26, C.muted, id, `font-family='${MONO}' font-weight="700"`) +
      text(x + 20, y + 80, 30, C.text, t.label, `font-weight="600"`) +
      `</g>`,
  )
  // Outlines cross-fade; the small tag in the corner is swapped, so two tags are never drawn over each other.
  const layer = (from, to, outline, tagSvg, extra = '') => {
    parts.push(`<g class="${show([[from, to]])}">${outline}${extra}</g>`)
    parts.push(`<g class="${swap([[from, to]])}">${tagSvg}</g>`)
  }
  if (hasDeps) {
    const needs = `needs ${t.after[0]}${t.after.slice(1).map(a => `,${a.slice(1)}`).join('')}`
    layer(FRONTIER_AT, ready, rect('#5b6675', 'none', 'stroke-dasharray="12 9"'), tag(needs, C.muted).replace('font-size="24"', 'font-size="22"'))
  }
  layer(ready, start, rect(C.ready, 'rgba(88,166,255,.12)'), tag('ready', C.ready))
  const bar =
    `<rect x="${x + 20}" y="${y + NODE.h - 15}" width="${NODE.w - 40}" height="6" rx="3" fill="${C.line}"/>` +
    `<rect class="${register('scaleX', [[start, 0], [end, 1]])}" style="transform-box:fill-box;transform-origin:left center" x="${x + 20}" y="${y + NODE.h - 15}" width="${NODE.w - 40}" height="6" rx="3" fill="${C.busy}"/>`
  layer(start, end, rect(C.busy, 'rgba(227,179,65,.13)'), tag(lead === 'Lead' ? 'Lead' : lead, C.busy), bar)
  layer(end, 23.5, rect(C.done, 'rgba(63,185,80,.13)'), tag(id === 'T8' ? '\u2713 verified' : '\u2713', C.done))
  return parts.join('')
}

const waitTag = id => {
  const { x, y } = box(id)
  const from = readyAt(id) + 0.3
  const to = startOf(id)
  return `<g class="${show([[from, to]])}">${text(x + 4, y + NODE.h + 32, 25, C.busy, 'waits for a slot', 'font-weight="600"')}</g>`
}

const edges = () => {
  const out = []
  for (const t of TASKS) {
    for (const from of t.after) {
      const d = edgePath(from, t.id)
      const appear = planAppearAt(t.id) + 0.15
      out.push(
        `<path class="${show([[appear, 23.5]])}" d="${d}" fill="none" stroke="${C.line}" stroke-width="3" marker-end="url(#ag)"/>` +
          `<path class="${show([[endOf(from), 23.5]])}" d="${d}" fill="none" stroke="${C.done}" stroke-width="3.5" marker-end="url(#ad)"/>`,
      )
    }
  }
  return out.join('')
}

const complement = (list, from, to) => {
  const out = []
  let cursor = from
  for (const [a, b] of [...list].sort((x, y) => x[0] - y[0])) {
    if (a > cursor) out.push([cursor, a])
    cursor = Math.max(cursor, b)
  }
  if (cursor < to) out.push([cursor, to])
  return out
}

const leadCard = () => {
  const l = LEAD
  const states = LEAD_STATES.map(s => `<g class="${swap([[s.from, s.to]])}">${text(l.x + 24, l.y + 68, 26, C.muted, s.text)}</g>`).join('')
  const idle = `<g class="${swap(complement(LEAD_STATES.map(s => [s.from, s.to]), 0.5, 23.5))}">${text(l.x + 24, l.y + 68, 26, '#6b7684', 'waiting')}</g>`
  return (
    `<g class="${show([[0.5, 23.5]])}">` +
    `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="18" fill="${C.panel}" stroke="${LAYERS.skill.color}" stroke-width="3"/>` +
    text(l.x + 24, l.y + 38, 31, C.text, 'Lead', 'font-weight="700"') +
    `</g>` +
    idle +
    states
  )
}

const capacity = () => {
  const y = 392
  const counts = [0, 1, 2, 3]
  const times = [0, WORKER_UP.W1, WORKER_UP.W2, WORKER_UP.W3]
  const nums = counts
    .map((c, i) => {
      const from = times[i]
      const to = i < 3 ? times[i + 1] : 23.5
      return from === 0 && to <= 0 ? '' : `<g class="${swap([[Math.max(from, 0.6), to]])}">${text(PANEL_X + PANEL_W, y + 8, 46, i === 3 ? LAYERS.mod.color : C.text, `${c}/${CAP}`, `text-anchor="end" font-weight="800" font-family='${MONO}'`)}</g>`
    })
    .join('')
  const pips = WORKERS.map((w, i) => {
    const x = PANEL_X + i * 106
    return (
      `<rect x="${x}" y="${y + 28}" width="98" height="14" rx="7" fill="${C.line}"/>` +
      `<rect class="${show([[WORKER_UP[w], 23.5]])}" x="${x}" y="${y + 28}" width="98" height="14" rx="7" fill="${LAYERS.mod.color}"/>`
    )
  }).join('')
  return `<g class="${show([[0.5, 23.5]])}">${text(PANEL_X, y + 8, 30, C.muted, 'Capacity', 'font-weight="600"')}${pips}</g>${nums}`
}

const workerCards = () =>
  WORKERS.map(id => {
    const w = worker(id)
    const label = `Worker ${id.slice(1)}`
    const jobs = SCHEDULE.filter(s => s.by === id)
    const busyWindows = jobs.map(s => [s.start, s.end])
    const idleWindows = []
    let cursor = WORKER_UP[id]
    for (const s of jobs) {
      if (s.start > cursor) idleWindows.push([cursor, s.start])
      cursor = s.end
    }
    idleWindows.push([cursor, 23.5])
    const busy = jobs
      .map(
        s =>
          `<g class="${swap([[s.start, s.end]])}">` +
          `<circle cx="${w.x + w.w - 34}" cy="${w.y + 40}" r="13" fill="${C.busy}"/>` +
          text(w.x + 24, w.y + 92, 30, C.busy, `working on ${s.task}`, 'font-weight="700"') +
          `</g>`,
      )
      .join('')
    return (
      `<g class="${show([[WORKER_UP[id], 23.5]])}">` +
      `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="18" fill="${C.panel}" stroke="${C.line}" stroke-width="3"/>` +
      text(w.x + 24, w.y + 46, 31, C.text, label, 'font-weight="700"') +
      `</g>` +
      `<g class="${swap(idleWindows)}">` +
      `<circle cx="${w.x + w.w - 34}" cy="${w.y + 40}" r="11" fill="none" stroke="${C.muted}" stroke-width="3"/>` +
      text(w.x + 24, w.y + 92, 30, C.muted, 'idle, still counted', 'font-weight="600"') +
      `</g>` +
      busy
    )
  }).join('')

const handoffArrows = () =>
  HANDOFFS.map(h => {
    const w = worker(h.worker)
    const y1 = LEAD.y + LEAD.h / 2
    const y2 = w.y + w.h / 2
    return `<path class="${show([[h.from, h.until]])}" d="M${PANEL_X - 2} ${y1}C${PANEL_X - 48} ${y1} ${PANEL_X - 48} ${y2} ${PANEL_X - 6} ${y2}" fill="none" stroke="${LAYERS.skill.color}" stroke-width="5" marker-end="url(#ap)"/>`
  }).join('')

const handoffCard = () => {
  const b = HANDOFF_BOX
  const rows = HANDOFF_CARD.fields
    .map(([k, v], i) => {
      const y = b.y + 92 + i * 60
      return text(b.x + 24, y, 22, C.muted, k) + text(b.x + 24, y + 30, 27, C.text, v, `font-family='${MONO}'`)
    })
    .join('')
  return (
    `<g class="${show([[HANDOFF_CARD.from, HANDOFF_CARD.to]])}">` +
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="18" fill="${C.panel}" stroke="${LAYERS.skill.color}" stroke-width="3"/>` +
    text(b.x + 24, b.y + 48, 30, LAYERS.skill.color, 'Handoff to Worker 1', 'font-weight="700"') +
    rows +
    `</g>`
  )
}

const verifyCard = () => {
  const b = HANDOFF_BOX
  return (
    `<g class="${show([[VERIFY_CARD.from, VERIFY_CARD.to]])}">` +
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h - 90}" rx="18" fill="${C.panel}" stroke="${LAYERS.skill.color}" stroke-width="3"/>` +
    text(b.x + 24, b.y + 48, 30, LAYERS.skill.color, 'The lead runs it', 'font-weight="700"') +
    text(b.x + 24, b.y + 110, 25, C.text, '$ npm test &&', `font-family='${MONO}'`) +
    text(b.x + 24, b.y + 146, 25, C.text, '  npm run typecheck', `font-family='${MONO}'`) +
    `<g class="${show([[VERIFY_CARD.from + 0.9, VERIFY_CARD.to]])}">${text(b.x + 24, b.y + 200, 30, C.done, `${VERIFY_CARD.result} ✓`, `font-family='${MONO}' font-weight="700"`)}</g>` +
    `</g>`
  )
}

const captions = () =>
  CAPTIONS.map(c => {
    let x = 80
    const chips = c.layers
      .map(l => {
        const ch = chip(x, 892, l)
        x += ch.w + 16
        return ch.svg
      })
      .join('')
    return (
      `<g class="${swap([[c.from, c.to]])}">${chips}` +
      text(80, 1010, 58, C.text, c.title, 'font-weight="700"') +
      text(80, 1054, 32, C.muted, c.note) +
      `</g>`
    )
  }).join('')

const SUBLINES = ['Provided by Claude Code', 'Guided by CTK skills, followed by the model', 'Enforced by the CTK mod, on teammate spawns']

const closing = () => {
  const lines = TAGLINE.map((t, i) => {
    const y = 450 + i * 134
    const color = LAYERS[t.layer].color
    const at = FINAL.from + 0.15 + i * 0.3
    return (
      `<g class="${show([[at, FINAL.to]])}">` +
      `<rect x="520" y="${y - 54}" width="12" height="104" rx="6" fill="${color}"/>` +
      text(560, y, 72, C.text, t.text, 'font-weight="800"') +
      text(560, y + 44, 32, C.muted, SUBLINES[i]) +
      `</g>`
    )
  }).join('')
  return (
    `<rect class="${show([[FINAL.from, FINAL.to]])}" x="0" y="122" width="${W}" height="${H - 122}" fill="${C.bg}"/>` +
    lines +
    `<g class="${show([[FINAL.from + 1, FINAL.to]])}">${text(560, 900, 30, C.muted, 'An illustration of the workflow, not a recording of a run.')}</g>`
  )
}

// ---------------------------------------------------------------------------------------------

export const buildSvg = () => {
  registry.clear()
  css.length = 0
  validate()

  const header =
    text(80, 92, 48, C.text, 'How CTK works', 'font-weight="800"') +
    `<rect x="1342" y="52" width="498" height="54" rx="27" fill="none" stroke="${C.line}" stroke-width="3"/>` +
    text(1591, 89, 28, C.muted, 'Illustration · not a recording', 'text-anchor="middle" font-weight="600"')

  const prompt =
    `<g class="${show([[0.3, 23.5]])}">` +
    `<rect x="80" y="130" width="1760" height="84" rx="18" fill="${C.panel}" stroke="${C.line}" stroke-width="3"/>` +
    text(112, 184, 32, LAYERS.skill.color, '❯', `font-family='${MONO}' font-weight="700"`) +
    text(160, 184, 31, C.text, GOAL, `font-family='${MONO}'`) +
    `</g>`

  const body =
    prompt +
    edges() +
    TASKS.map(t => nodeLayers(t.id)).join('') +
    waitTag('T5') +
    leadCard() +
    capacity() +
    workerCards() +
    handoffArrows() +
    handoffCard() +
    verifyCard() +
    captions() +
    closing()

  const markers = [
    ['ag', C.line],
    ['ad', C.done],
    ['ap', LAYERS.skill.color],
  ]
    .map(
      ([id, fill]) =>
        `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" markerUnits="strokeWidth" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${fill}"/></marker>`,
    )
    .join('')

  // registered before the style is assembled, so its keyframes are in the stylesheet
  const stage = register('opacity', [[0, 0], [0.35, 1], [23.45, 1], [23.9, 0]])

  const style =
    `text{font-family:${SANS}}` +
    `.an{animation-duration:${DURATION}s;animation-iteration-count:infinite;animation-fill-mode:both}` +
    css.join('') +
    `@media (prefers-reduced-motion:reduce){.an{animation-play-state:paused!important;animation-delay:-${POSTER_AT}s!important}}`

  const desc =
    'An illustration, not a recording. One goal becomes eight vertical-slice tasks with real dependencies. Only ready tasks start. ' +
    'Three native teammates work at once; the CTK mod limits native teammate spawns to three, so a fourth ready task waits. ' +
    'The lead hands the next ready task to an idle teammate with a short handoff (task id, spec path, file scope, verification command). ' +
    'The final task runs the verification command and the lead reads the result.'

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">` +
    `<title id="t">How CTK works: one goal, a task graph, a ready frontier, three workers, verification</title>` +
    `<desc id="d">${esc(desc)}</desc>` +
    `<defs>${markers}<style>${style}</style></defs>` +
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>` +
    `<g>${header}</g>` +
    // the whole stage fades in at the start and out at the end, so the loop has no visible seam
    `<g class="${stage}">${body}</g>` +
    `</svg>\n`
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const here = dirname(fileURLToPath(import.meta.url))
  const i = process.argv.indexOf('--out')
  const out = resolve(i > 0 ? process.argv[i + 1] : resolve(here, '../../../docs/assets/how-it-works.svg'))
  const svg = buildSvg()
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, svg)
  console.log(`${out} ${Buffer.byteLength(svg)} bytes, ${registry.size} keyframe sets`)
}
