#!/usr/bin/env node
// Renders docs/assets/hud-widths.svg from docs/assets/hud-widths.json: the HUD rows copied from live
// tmux captures at five terminal widths. Nothing is computed here; the rows are drawn as captured.
//   node scripts/render-hud-widths.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const data = JSON.parse(readFileSync(join(root, 'docs/assets/hud-widths.json'), 'utf8'))

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const CELL = 8.1
const X0 = 150
const ROW = 22

// Dim the separators so the figures read first.
const styled = s => esc(s).replace(/ │ /g, '<tspan class="d"> │ </tspan>')

let y = 34
const out = []
const heading = (text, sub) => {
  out.push(`<text x="20" y="${y}" class="h">${esc(text)}</text><text x="20" y="${y + 18}" class="s">${esc(sub)}</text>`)
  y += 44
}
const row = (label, text, kind = 'band') => {
  out.push(`<text x="20" y="${y}" class="l">${label}</text><text x="${X0}" y="${y}" class="${kind}" xml:space="preserve">${styled(text)}</text>`)
  y += ROW
}

heading('Plugin only', 'One line above the prompt. The form follows the terminal width.')
for (const w of data.widths) row(`${w.columns} columns`, w.bandOnly)
y += 18
heading('With the optional status line', 'Split by what each can know, so nothing is drawn twice. Top: above the prompt. Bottom: under it.')
for (const w of data.widths) {
  row(`${w.columns} columns`, w.withStatusLine.band)
  out.push(`<text x="20" y="${y}" class="l"> </text>`)
  row('', w.withStatusLine.statusLine ?? '', 'status')
  y += 6
}
const longest = Math.max(...data.widths.flatMap(w => [w.bandOnly, w.withStatusLine.band, w.withStatusLine.statusLine ?? ''].map(t => [...t].length)))
const W = Math.ceil(X0 + longest * CELL + 30)
const H = y + 22
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="The CTK HUD at 200, 130, 100, 80 and 60 terminal columns, with and without the status line"><title>The CTK HUD at five terminal widths</title><desc>Rows copied from live captures of Claude Code ${esc(data.claudeCode)}, recorded ${esc(data.recorded)}. ${esc(data.note)}</desc><style>text{font-family:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono','DejaVu Sans Mono',monospace;font-size:13px;fill:#c9d1d9;white-space:pre}.h{font-size:15px;font-weight:700;fill:#f0f6fc}.s{font-size:12px;fill:#8b949e}.l{font-size:12px;fill:#8b949e}.band{fill:#c9d1d9}.status{fill:#a5d6ff}.d{fill:#6e7681}</style><rect width="${W}" height="${H}" rx="10" fill="#0d1117"/>${out.join('')}</svg>\n`
writeFileSync(join(root, 'docs/assets/hud-widths.svg'), svg)
console.log(`hud-widths.svg: ${svg.length} bytes, ${data.widths.length} widths`)
