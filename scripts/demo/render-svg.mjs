#!/usr/bin/env node
// Converts a .frames.jsonl recording (see record.mjs) into an animated SVG and/or a static SVG of
// one frame. Output is plain SVG with CSS keyframes: no scripts, no external references.
//
//   render-svg.mjs in.frames.jsonl --out anim.svg [--speed 1] [--max-gap 2] [--end-pause 3]
//   render-svg.mjs in.frames.jsonl --static-out still.svg [--frame N | --at-regex RE]
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const USAGE = `usage: render-svg.mjs <in.frames.jsonl> [--out anim.svg] [--static-out still.svg]
  --speed N        playback speed factor (default 1)
  --max-gap S      cap any idle gap at S seconds after scaling (default 2)
  --end-pause S    pause on the last frame before looping (default 3)
  --frame N        frame index for --static-out (negative counts from the end)
  --at-regex RE    first frame whose plain text matches RE, for --static-out (default: the last frame)
  --title TEXT     window title (default "Terminal")
  --cols N / --rows N   override the grid size (default: from the recording)
  --max-bytes N    size budget per SVG (default 400000); frames are coalesced to fit`

const BG = '#0d1117'
const FG = '#c9d1d9'
const BAR_BG = '#161b22'
const PALETTE = ['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4', '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc']
const FONT = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'DejaVu Sans Mono', monospace"
const FS = 14
const CW = 8.4
const LH = 18
const PAD = 16
const BAR = 36
const MAX_BYTES = 400_000

export const escapeXml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

// ---- ANSI -----------------------------------------------------------------------------------

const hex2 = n => n.toString(16).padStart(2, '0')
const rgb = (r, g, b) => `#${hex2(r & 255)}${hex2(g & 255)}${hex2(b & 255)}`

/** Colour index 0-255 to a hex string. */
export function color256(n) {
  if (n < 16) return PALETTE[n]
  if (n < 232) {
    const c = n - 16
    const lv = i => (i === 0 ? 0 : 55 + 40 * i)
    return rgb(lv(Math.floor(c / 36)), lv(Math.floor(c / 6) % 6), lv(c % 6))
  }
  const g = 8 + 10 * (n - 232)
  return rgb(g, g, g)
}

/** Terminal cell width of a code point: 0 combining/joiners, 2 wide (CJK, emoji), else 1. */
export function cellWidth(cp) {
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
  if (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd)
  ) return 2
  return 1
}

const blankStyle = () => ({ fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false, strike: false })

function applySgr(st, paramStr) {
  // ';' separates parameters; ':' joins sub-parameters of one (38:2::r:g:b, 38:5:n)
  const groups = paramStr === '' ? [[0]] : paramStr.split(';').map(g => g.split(':').map(x => (x === '' ? 0 : Number(x))))
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const c = g[0]
    if (c === 0) Object.assign(st, blankStyle())
    else if (c === 1) st.bold = true
    else if (c === 2) st.dim = true
    else if (c === 3) st.italic = true
    else if (c === 4) st.underline = true
    else if (c === 7) st.inverse = true
    else if (c === 9) st.strike = true
    else if (c === 22) { st.bold = false; st.dim = false }
    else if (c === 23) st.italic = false
    else if (c === 24) st.underline = false
    else if (c === 27) st.inverse = false
    else if (c === 29) st.strike = false
    else if (c >= 30 && c <= 37) st.fg = c - 30
    else if (c === 39) st.fg = null
    else if (c >= 40 && c <= 47) st.bg = c - 40
    else if (c === 49) st.bg = null
    else if (c >= 90 && c <= 97) st.fg = c - 90 + 8
    else if (c >= 100 && c <= 107) st.bg = c - 100 + 8
    else if (c === 38 || c === 48) {
      const key = c === 38 ? 'fg' : 'bg'
      // semicolon form: the arguments are the following groups; colon form: they are inside this group
      const args = g.length > 1 ? g.slice(1) : groups.slice(i + 1).map(x => x[0])
      const used = g.length > 1 ? 0 : args[0] === 5 ? 2 : args[0] === 2 ? 4 : 0
      if (args[0] === 5 && args[1] !== undefined) st[key] = Math.max(0, Math.min(255, args[1]))
      else if (args[0] === 2 && args.length >= 4) { const [r, gg, b] = args.slice(-3); st[key] = rgb(r, gg, b) }
      i += used
    }
  }
}

const resolveColor = (c, dflt) => (c === null ? dflt : typeof c === 'number' ? color256(c) : c)

/**
 * Parses one line of `tmux capture-pane -e` output into cells {t, w, k, fg, bg, bold, dim, italic, underline, strike}.
 * Colours are resolved to hex; inverse swaps foreground and background (defaults included).
 */
export function parseAnsiLine(line) {
  const cells = []
  const st = blankStyle()
  const re = /\x1b\[([0-9;:]*)([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b\[[0-9;:?]*[ -/]*[@-~]/gy
  const push = chunk => {
    for (const ch of chunk) {
      const cp = ch.codePointAt(0)
      if (cp < 0x20 || cp === 0x7f) continue
      const w = cellWidth(cp)
      if (w === 0) { if (cells.length > 0) cells.at(-1).t += ch; continue }
      const inv = st.inverse
      const fg = inv ? resolveColor(st.bg, BG) : resolveColor(st.fg, FG)
      const bg = inv ? resolveColor(st.fg, FG) : st.bg === null ? null : resolveColor(st.bg, BG)
      const cell = { t: ch, w, fg, bg: bg === BG ? null : bg, bold: st.bold, dim: st.dim, italic: st.italic, underline: st.underline, strike: st.strike }
      cell.k = [cell.fg, cell.bold ? 1 : 0, cell.dim ? 1 : 0, cell.italic ? 1 : 0, cell.underline ? 1 : 0, cell.strike ? 1 : 0].join()
      cells.push(cell)
    }
  }
  let pos = 0
  while (pos < line.length) {
    const esc = line.indexOf('\x1b', pos)
    if (esc < 0) { push(line.slice(pos)); break }
    push(line.slice(pos, esc))
    re.lastIndex = esc
    const m = re.exec(line)
    if (!m) { pos = esc + 1; continue }
    if (m[2] === 'm') applySgr(st, m[1])
    pos = re.lastIndex
  }
  return cells
}

export const plainText = text => text.split('\n').map(l => parseAnsiLine(l).map(c => c.t).join('')).join('\n')

// ---- frames ---------------------------------------------------------------------------------

/** Reads JSON lines; {"meta": ...} lines are collected, {t, text} lines are frames. */
export function parseFrames(source) {
  const frames = []
  let meta = {}
  source.split('\n').forEach((raw, n) => {
    if (raw.trim() === '') return
    let row
    try { row = JSON.parse(raw) } catch { throw new Error(`line ${n + 1}: not valid JSON`) }
    if (row && typeof row === 'object' && row.meta && typeof row.meta === 'object') { meta = { ...meta, ...row.meta }; return }
    if (!row || !Number.isFinite(row.t) || typeof row.text !== 'string') throw new Error(`line ${n + 1}: expected {"t": number, "text": string}`)
    if (frames.length > 0 && row.t < frames.at(-1).t) throw new Error(`line ${n + 1}: time goes backwards`)
    frames.push({ t: row.t, text: row.text })
  })
  if (frames.length === 0) throw new Error('no frames')
  return { meta, frames }
}

/** Drops consecutive duplicates, then frames closer than minStep ms to the previous kept one (the last frame is always kept). */
function coalesce(frames, minStep) {
  const out = []
  for (const f of frames) {
    const prev = out.at(-1)
    if (prev && prev.text === f.text) continue
    if (prev && minStep > 0 && f.t - prev.t < minStep) { out[out.length - 1] = { t: prev.t, text: f.text }; continue }
    out.push(f)
  }
  return out
}

// ---- layout ---------------------------------------------------------------------------------

const fmt = n => String(Math.round(n * 1000) / 1000)

/** capture-pane -J joins wrapped lines; split them again where the terminal wrapped them. */
export function wrapCells(cells, cols) {
  if (!(cols > 0)) return [cells]
  const out = [[]]
  let used = 0
  for (const c of cells) {
    if (used + c.w > cols) { out.push([]); used = 0 }
    out.at(-1).push(c)
    used += c.w
  }
  return out
}

function gridSize(parsed, opts, meta) {
  let rows = 1
  let cols = 1
  for (const lines of parsed) {
    lines.forEach((cells, r) => {
      const w = cells.reduce((a, c) => a + c.w, 0)
      if (w > 0) { rows = Math.max(rows, r + 1); cols = Math.max(cols, w) }
    })
  }
  return { cols: opts.cols ?? Math.max(cols, Math.min(meta.cols ?? 0, 200)), rows: opts.rows ?? rows }
}

class Palette {
  constructor() { this.map = new Map() }
  cls(hex) {
    if (!this.map.has(hex)) this.map.set(hex, this.map.size.toString(36))
    return `f${this.map.get(hex)}`
  }
  css() { return [...this.map].map(([hex, id]) => `.f${id}{fill:${hex}}`).join('') }
}

/** Markup (rects + text) for one terminal row; '' for an empty row. */
function rowMarkup(cells, row, pal) {
  const top = BAR + PAD + row * LH
  const rects = []
  const runs = []
  let col = 0
  let run = null
  const flush = () => { if (run) runs.push(run); run = null }
  let bgRun = null
  const flushBg = () => { if (bgRun) rects.push(bgRun); bgRun = null }
  cells.forEach((c, idx) => {
    const x = col
    col += c.w
    if (c.bg !== null) {
      if (bgRun && bgRun.bg === c.bg && bgRun.end === x) bgRun.end = col
      else { flushBg(); bgRun = { bg: c.bg, start: x, end: col } }
    } else flushBg()
    if (c.t === ' ') {
      const next = cells[idx + 1]
      if (run && run.k === c.k && next && next.t !== ' ' && next.k === run.k) { run.text += ' '; run.w += 1 }
      else flush()
      return
    }
    if (run && run.k === c.k) { run.text += c.t; run.w += c.w; run.ascii &&= c.t.charCodeAt(0) < 128 }
    else { flush(); run = { k: c.k, c, x, text: c.t, w: c.w, ascii: c.t.charCodeAt(0) < 128 } }
  })
  flush()
  flushBg()
  if (runs.length === 0 && rects.length === 0) return ''
  const rectXml = rects.map(r => `<rect x="${fmt(PAD + r.start * CW)}" y="${top}" width="${fmt((r.end - r.start) * CW)}" height="${LH}" class="${pal.cls(r.bg)}"/>`).join('')
  const spans = runs.map(r => {
    const cls = [r.c.fg === FG ? '' : pal.cls(r.c.fg), r.c.bold ? 'b' : '', r.c.dim ? 'd' : '', r.c.italic ? 'i' : '', r.c.underline ? 'u' : '', r.c.strike ? 's2' : ''].filter(Boolean).join(' ')
    const adj = r.ascii ? '' : ` textLength="${fmt(r.w * CW)}" lengthAdjust="spacingAndGlyphs"`
    return `<tspan x="${fmt(PAD + r.x * CW)}"${cls ? ` class="${cls}"` : ''}${adj}>${escapeXml(r.text)}</tspan>`
  }).join('')
  return rectXml + (spans ? `<text y="${top + 13}">${spans}</text>` : '')
}

function metaDesc(meta) {
  const parts = []
  for (const [k, label] of [['date', 'recorded'], ['claudeCodeVersion', 'Claude Code'], ['ctkCommit', 'ctk commit'], ['model', 'model']]) if (meta[k]) parts.push(`${label}: ${meta[k]}`)
  return parts.join('; ')
}

/**
 * Shared builder. `timeline` is [{text, start, end}] in seconds, `total` the loop length; animated=false renders one frame.
 */
function build(timeline, total, animated, opts, meta) {
  const wrapAt = opts.cols ?? meta.cols
  const parsed = timeline.map(f => f.text.split('\n').flatMap(l => wrapCells(parseAnsiLine(l), wrapAt)))
  const { cols, rows } = gridSize(parsed, opts, meta)
  const width = Math.ceil(PAD * 2 + cols * CW)
  const height = PAD * 2 + BAR + rows * LH
  const pal = new Palette()
  const segs = new Map()
  parsed.forEach((lines, fi) => {
    const { start, end } = timeline[fi]
    lines.slice(0, rows).forEach((cells, r) => {
      const markup = rowMarkup(cells, r, pal)
      if (markup === '') return
      let seg = segs.get(markup)
      if (!seg) { seg = { markup, spans: [] }; segs.set(markup, seg) }
      const last = seg.spans.at(-1)
      if (last && Math.abs(last[1] - start) < 1e-9) last[1] = end
      else seg.spans.push([start, end])
    })
  })
  let keyframes = ''
  let n = 0
  const body = []
  for (const { markup, spans } of segs.values()) {
    const full = !animated || (spans.length === 1 && spans[0][0] <= 1e-9 && spans[0][1] >= total - 1e-9)
    if (full) { body.push(`<g>${markup}</g>`); continue }
    const pts = [[0, spans[0][0] <= 1e-9 ? 1 : 0]]
    for (const [s, e] of spans) {
      if (s > 1e-9) pts.push([s, 1])
      if (e < total - 1e-9) pts.push([e, 0])
    }
    pts.push([total, pts.at(-1)[1]])
    const name = `k${n++}`
    keyframes += `@keyframes ${name}{${pts.map(([t, v], i) => `${i === pts.length - 1 ? '100' : fmt((t / total) * 100)}%{opacity:${v}}`).join('')}}`
    const lastOn = spans.at(-1)[1] >= total - 1e-9
    body.push(`<g class="s" style="animation-name:${name}"${lastOn ? '' : ' opacity="0"'}>${markup}</g>`)
  }
  const css = `text{font-family:${FONT};font-size:${FS}px;fill:${FG};white-space:pre}.b{font-weight:700}.d{opacity:.6}.i{font-style:italic}.u{text-decoration:underline}.s2{text-decoration:line-through}` +
    (animated ? `.s{animation-duration:${fmt(total)}s;animation-iteration-count:infinite;animation-timing-function:step-end}` : '') +
    pal.css() + keyframes
  const title = escapeXml(opts.title ?? 'Terminal')
  const desc = metaDesc(meta)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">` +
    `<title>${title}</title>${desc ? `<desc>${escapeXml(desc)}</desc>` : ''}<style>${css}</style>` +
    `<rect width="${width}" height="${height}" rx="10" fill="${BG}"/>` +
    `<path d="M0 10a10 10 0 0 1 10-10h${width - 20}a10 10 0 0 1 10 10v${BAR - 10}H0z" fill="${BAR_BG}"/>` +
    `<circle cx="20" cy="${BAR / 2}" r="6" fill="#ff5f56"/><circle cx="40" cy="${BAR / 2}" r="6" fill="#ffbd2e"/><circle cx="60" cy="${BAR / 2}" r="6" fill="#27c93f"/>` +
    `<text x="${width / 2}" y="${BAR / 2 + 5}" text-anchor="middle" style="fill:#8b949e;font-size:13px">${title}</text>` +
    body.join('') + '</svg>\n'
  return svg
}

const STEPS = [0, 100, 250, 500, 1000, 2000]

function fit(label, make, maxBytes) {
  for (const step of STEPS) {
    const svg = make(step)
    if (Buffer.byteLength(svg) <= maxBytes) return svg
  }
  throw new Error(`${label}: cannot fit ${maxBytes} bytes even with frames coalesced to ${STEPS.at(-1)} ms`)
}

/** Animated SVG: every frame shown for its real duration / speed, gaps capped at maxGap s, a pause on the last frame, then loop. */
export function renderAnimatedSvg(frames, opts = {}, meta = {}) {
  const speed = opts.speed ?? 1
  const maxGap = opts.maxGap ?? 2
  const endPause = opts.endPause ?? 3
  if (!(speed > 0)) throw new Error('speed must be > 0')
  return fit('animated svg', step => {
    const fs = coalesce(frames, step)
    let at = 0
    const timeline = fs.map((f, i) => {
      const real = i + 1 < fs.length ? (fs[i + 1].t - f.t) / 1000 / speed : endPause
      const d = i + 1 < fs.length ? Math.min(real, maxGap) : real
      const start = at
      at += d
      return { text: f.text, start, end: at }
    })
    return build(timeline, at, true, opts, meta)
  }, opts.maxBytes ?? MAX_BYTES)
}

/** Static SVG of frames[index] (negative counts from the end). */
export function renderStaticSvg(frames, index, opts = {}, meta = {}) {
  const i = index < 0 ? frames.length + index : index
  if (!Number.isInteger(i) || i < 0 || i >= frames.length) throw new Error(`frame ${index} out of range (0..${frames.length - 1})`)
  const svg = build([{ text: frames[i].text, start: 0, end: 1 }], 1, false, opts, meta)
  if (Buffer.byteLength(svg) > (opts.maxBytes ?? MAX_BYTES)) throw new Error('static svg exceeds the size budget')
  return svg
}

/** Index of the first frame whose plain text matches the regex. */
export function findFrame(frames, regex) {
  const rx = new RegExp(regex)
  const i = frames.findIndex(f => rx.test(plainText(f.text)))
  if (i < 0) throw new Error(`no frame matches /${regex}/`)
  return i
}

// ---- cli ------------------------------------------------------------------------------------

function main(argv) {
  const o = {}
  const files = []
  const num = new Set(['speed', 'max-gap', 'end-pause', 'frame', 'cols', 'rows', 'max-bytes'])
  const str = new Set(['out', 'static-out', 'at-regex', 'title'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') { console.log(USAGE); return 0 }
    if (!a.startsWith('--')) { files.push(a); continue }
    const name = a.slice(2)
    const v = argv[++i]
    if (v === undefined) throw new Error(`${a} needs a value`)
    if (num.has(name)) {
      o[name] = Number(v)
      if (!Number.isFinite(o[name])) throw new Error(`${a} must be a number`)
    } else if (str.has(name)) o[name] = v
    else throw new Error(`unknown option ${a}`)
  }
  if (files.length !== 1 || (!o.out && !o['static-out'])) { console.error(USAGE); return 1 }
  const { meta, frames } = parseFrames(readFileSync(files[0], 'utf8'))
  const opts = { speed: o.speed, maxGap: o['max-gap'], endPause: o['end-pause'], cols: o.cols, rows: o.rows, title: o.title, maxBytes: o['max-bytes'] }
  if (o.out) {
    const svg = renderAnimatedSvg(frames, opts, meta)
    writeFileSync(o.out, svg)
    console.error(`render-svg: ${o.out} ${Buffer.byteLength(svg)} bytes`)
  }
  if (o['static-out']) {
    const index = o.frame !== undefined ? o.frame : o['at-regex'] !== undefined ? findFrame(frames, o['at-regex']) : -1
    const svg = renderStaticSvg(frames, index, opts, meta)
    writeFileSync(o['static-out'], svg)
    console.error(`render-svg: ${o['static-out']} ${Buffer.byteLength(svg)} bytes (frame ${index < 0 ? frames.length + index : index})`)
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (e) {
    console.error(`render-svg: ${e.message}`)
    process.exitCode = 1
  }
}
