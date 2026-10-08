#!/usr/bin/env node
// Renders a .frames.jsonl recording to a GIF and/or MP4 with the same timing as render-svg.mjs:
// every distinct frame becomes a static SVG, headless Chrome screenshots them (several frames per
// page, one page per screenshot), ffmpeg crops the tiles apart and stitches them at the playback
// timing. Needs Google Chrome (or Chromium) and ffmpeg; no npm dependencies.
//
//   render-video.mjs in.frames.jsonl --work-dir <dir> [--gif out.gif] [--mp4 out.mp4] [--target-seconds 40]
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildTimeline, fitSpeed, measureGrid, parseFrames, renderStaticSvg } from './render-svg.mjs'

const USAGE = `usage: render-video.mjs <in.frames.jsonl> --work-dir DIR [--gif out.gif] [--mp4 out.mp4]
  --target-seconds N   playback length (default 40); --speed N / --max-gap S / --end-pause S as in render-svg.mjs
  --fps N              output frame rate (default 8)
  --width N            output width in pixels (default 960 for the GIF, the full size for the MP4)
  --title TEXT         window title
  --tile N             frames per screenshot page (default 8)
  --chrome PATH        Chrome binary (default: macOS Google Chrome, then chromium / google-chrome on PATH)
  --ffmpeg PATH        ffmpeg binary (default: ffmpeg on PATH)`

const CHROME_CANDIDATES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'google-chrome', 'chromium', 'chromium-browser']
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Runs headless Chrome until the screenshot file is written and stable, then kills it (it does not always exit by itself). */
async function screenshot(chrome, profile, page, png, width, height) {
  rmSync(png, { force: true })
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${profile}`, `--screenshot=${png}`, `--window-size=${width},${height}`, pathToFileURL(page).href], { stdio: 'ignore' })
  let exited = false
  child.on('exit', () => { exited = true })
  let last = -1
  for (let i = 0; i < 240; i++) {
    await sleep(500)
    const size = existsSync(png) ? statSync(png).size : -1
    if (size > 0 && size === last) break
    last = size
    if (exited && size > 0) break
  }
  child.kill('SIGKILL')
  if (!(existsSync(png) && statSync(png).size > 0)) throw new Error(`chrome produced no screenshot for ${page}`)
}

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${bin} failed: ${(r.stderr || '').split('\n').slice(-6).join('\n')}`)
}

async function main(argv) {
  const o = { fps: 8, tile: 8, 'target-seconds': 40 }
  const num = new Set(['fps', 'tile', 'target-seconds', 'speed', 'max-gap', 'end-pause', 'width'])
  const str = new Set(['work-dir', 'gif', 'mp4', 'title', 'chrome', 'ffmpeg'])
  const files = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') { console.log(USAGE); return 0 }
    if (!a.startsWith('--')) { files.push(a); continue }
    const name = a.slice(2)
    const v = argv[++i]
    if (v === undefined) throw new Error(`${a} needs a value`)
    if (num.has(name)) o[name] = Number(v)
    else if (str.has(name)) o[name] = v
    else throw new Error(`unknown option ${a}`)
  }
  if (files.length !== 1 || !o['work-dir'] || (!o.gif && !o.mp4)) { console.error(USAGE); return 1 }
  const chrome = o.chrome ?? CHROME_CANDIDATES.find(c => (c.startsWith('/') ? existsSync(c) : spawnSync('which', [c]).status === 0))
  if (!chrome) throw new Error('no Chrome/Chromium found (use --chrome)')
  const ffmpeg = o.ffmpeg ?? 'ffmpeg'
  const work = resolve(o['work-dir'])
  mkdirSync(work, { recursive: true })

  const { meta, frames } = parseFrames(readFileSync(files[0], 'utf8'))
  const opts = { speed: o.speed, maxGap: o['max-gap'], endPause: o['end-pause'], title: o.title }
  if (o.speed === undefined) opts.speed = fitSpeed(frames, opts, o['target-seconds'])
  const { timeline, total } = buildTimeline(frames, opts, 100)
  const grid = measureGrid(frames, {}, meta)
  const sizeOpts = { ...opts, cols: grid.cols, rows: grid.rows }

  // One output frame per 1/fps tick; consecutive ticks on the same source frame merge into one run.
  const ticks = Math.max(1, Math.round(total * o.fps))
  const runs = []
  let ti = 0
  for (let k = 0; k < ticks; k++) {
    const t = k / o.fps
    while (ti + 1 < timeline.length && timeline[ti].end <= t + 1e-9) ti++
    if (runs.length > 0 && runs.at(-1).index === ti) runs.at(-1).ticks++
    else runs.push({ index: ti, ticks: 1 })
  }
  const unique = [...new Set(runs.map(r => r.index))]
  console.error(`render-video: speed ${opts.speed}, ${total.toFixed(1)} s, ${ticks} ticks, ${unique.length} distinct frames`)

  const svgs = unique.map((fi, n) => {
    const file = join(work, `f${String(n).padStart(4, '0')}.svg`)
    writeFileSync(file, renderStaticSvg([{ t: 0, text: timeline[fi].text }], 0, { ...sizeOpts, maxBytes: 5_000_000 }, meta))
    return file
  })
  const sample = readFileSync(svgs[0], 'utf8')
  const width = Number(/ width="(\d+)"/.exec(sample)?.[1])
  const height = Number(/ height="(\d+)"/.exec(sample)?.[1])
  const profile = join(work, 'chrome-profile')
  const pngs = []
  for (let start = 0; start < svgs.length; start += o.tile) {
    const group = svgs.slice(start, start + o.tile)
    const page = join(work, `page${start / o.tile}.html`)
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}img{display:block;width:${width}px;height:${height}px}body::after{content:'';display:block;height:150px}</style>${group.map(f => `<img src="${pathToFileURL(f).href}">`).join('')}`)
    const sheet = join(work, `page${start / o.tile}.png`)
    // extra room below the last tile: Chrome smears the page's first pixels into the bottom ~25 px of a screenshot
    await screenshot(chrome, profile, page, sheet, width, height * group.length + 150)
    group.forEach((_, i) => {
      const png = join(work, `f${String(start + i).padStart(4, '0')}.png`)
      run(ffmpeg, ['-y', '-v', 'error', '-i', sheet, '-vf', `crop=${width}:${height}:0:${i * height}`, '-frames:v', '1', png])
      pngs[start + i] = png
    })
    console.error(`render-video: screenshots ${Math.min(start + o.tile, svgs.length)}/${svgs.length}`)
  }
  rmSync(profile, { recursive: true, force: true })

  const list = join(work, 'frames.txt')
  const lines = runs.map(r => `file '${pngs[unique.indexOf(r.index)]}'\nduration ${(r.ticks / o.fps).toFixed(4)}`)
  // ffmpeg's concat demuxer ignores the duration of the last entry unless the file is repeated
  lines.push(`file '${pngs[unique.indexOf(runs.at(-1).index)]}'`)
  writeFileSync(list, lines.join('\n') + '\n')
  const base = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-t', total.toFixed(3)]
  if (o.mp4) {
    run(ffmpeg, [...base, '-vf', `fps=${o.fps},scale=${o.width ?? width}:-2:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', o.mp4])
    console.error(`render-video: ${o.mp4} ${statSync(o.mp4).size} bytes`)
  }
  if (o.gif) {
    run(ffmpeg, [...base, '-vf', `fps=${o.fps},scale=${o.width ?? 960}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`, '-loop', '0', o.gif])
    console.error(`render-video: ${o.gif} ${statSync(o.gif).size} bytes`)
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (e) {
    console.error(`render-video: ${e.message}`)
    process.exitCode = 1
  }
}
