#!/usr/bin/env node
// Applies masks to an existing .frames.jsonl after capture, for something found on screen after the
// recording was made. The meta line says so: `maskedAfterCapture` lists the labels that matched and
// `maskedAfterCaptureReplacements` counts the replacements. Frame structure and timing are untouched.
//
//   mask-frames.mjs file.frames.jsonl --mask-file masks.json [--out other.frames.jsonl]
//
// The mask file is the same JSON as record.mjs --mask-file: [{"match": regex, "replace": text, "label": "..."}].
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { compileMasks } from './record.mjs'

/** Returns the new file text, or null when nothing matched. */
export function maskFramesText(source, specs) {
  const masks = compileMasks(specs)
  const matched = new Set()
  let count = 0
  const apply = text => masks.reduce((t, m) => t.replace(m.all, found => { matched.add(m.label); count++; return found.replace(m.one, m.replace) }), text)
  const lines = source.split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l))
  const out = lines.map(row => (row.meta ? row : { ...row, text: apply(row.text) }))
  if (count === 0) return null
  const meta = out.find(r => r.meta)
  if (!meta) throw new Error('no meta line to record the mask in')
  const prior = Array.isArray(meta.meta.maskedAfterCapture) ? meta.meta.maskedAfterCapture : []
  meta.meta.maskedAfterCapture = [...new Set([...prior, ...matched])]
  meta.meta.maskedAfterCaptureReplacements = (meta.meta.maskedAfterCaptureReplacements ?? 0) + count
  return out.map(r => JSON.stringify(r)).join('\n') + '\n'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2)
  const opt = n => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined)
  const file = a.find(x => x.endsWith('.jsonl'))
  const maskFile = opt('--mask-file')
  if (!file || !maskFile) {
    console.error('usage: mask-frames.mjs <file.frames.jsonl> --mask-file <masks.json> [--out <file>]')
    process.exit(1)
  }
  try {
    const result = maskFramesText(readFileSync(file, 'utf8'), JSON.parse(readFileSync(maskFile, 'utf8')))
    if (result === null) console.error(`mask-frames: no match in ${file}; nothing written`)
    else {
      writeFileSync(opt('--out') ?? file, result)
      console.error(`mask-frames: masked ${file}`)
    }
  } catch (e) {
    console.error(`mask-frames: ${e.message}`)
    process.exit(1)
  }
}
