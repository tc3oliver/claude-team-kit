#!/usr/bin/env node
// A short clip that steps through the captured scenes of one showcase set, two seconds each. It is cut
// from the stored frames (<scene>.frames.jsonl): no terminal is started and nothing is redrawn. Every
// frame is a real capture with its SYNTHETIC DATA label. Needs Chrome and ffmpeg (see render-video.mjs).
//
//   node scripts/showcase/clip.mjs docs/assets/mission-control-ui/after docs/assets/mission-control-ui/mission-control-ui-showcase
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ORDER = ['empty', 'team', 'workers', 'dag', 'guard', 'usage', 'config']
const STEP_MS = 2000
const HERE = dirname(fileURLToPath(import.meta.url))

const [dir, stem] = process.argv.slice(2)
if (!dir || !stem) {
  console.error('usage: clip.mjs <showcase set dir> <output path without extension>')
  process.exit(1)
}
const lines = ORDER.map(s => readFileSync(join(dir, `${s}.frames.jsonl`), 'utf8').trim().split('\n'))
const meta = JSON.parse(lines[0][0])
const frames = lines.map((l, i) => ({ ...JSON.parse(l[1]), t: i * STEP_MS }))
const work = mkdtempSync(join(tmpdir(), 'ctk-showcase-clip-'))
try {
  const src = join(work, 'clip.frames.jsonl')
  writeFileSync(src, `${JSON.stringify({ meta: { ...meta.meta, scene: ORDER.join(',') } })}\n${frames.map(f => JSON.stringify(f)).join('\n')}\n`)
  const r = spawnSync(
    'node',
    [join(HERE, '..', 'demo', 'render-video.mjs'), src, '--work-dir', join(work, 'video'), '--mp4', resolve(`${stem}.mp4`), '--gif', resolve(`${stem}.gif`), '--speed', '1', '--max-gap', '2', '--end-pause', '2', '--title', 'Mission Control - SYNTHETIC DATA, not a live agent run'],
    { stdio: 'inherit' },
  )
  process.exitCode = r.status ?? 1
} finally {
  rmSync(work, { recursive: true, force: true })
}
