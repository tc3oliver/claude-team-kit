#!/usr/bin/env node
// Renders stills and the MP4 from the animated SVG by seeking its CSS animations in headless Chrome
// over the DevTools protocol (Node's built-in WebSocket; no npm dependency). Needs Google Chrome
// (or Chromium) and, for the MP4, ffmpeg.
//
//   node scripts/media/how-it-works/render.mjs --svg docs/assets/how-it-works.svg \
//     [--mp4 out.mp4] [--poster out.png] [--poster-at 12.9] [--fps 30] [--work-dir DIR] \
//     [--still 5.5 --still 12.9:390 ...]     # time[:output width], written to <work-dir>/still-<time>-<width>.png
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { DURATION, POSTER_AT } from './storyboard.mjs'
import { H, W } from './build.mjs'

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'google-chrome', 'chromium', 'chromium-browser']

const USAGE = `usage: render.mjs --svg FILE [--mp4 FILE] [--poster FILE] [--poster-at S] [--fps N] [--work-dir DIR]
                  [--still TIME[:WIDTH]]... [--chrome PATH] [--ffmpeg PATH]`

const sleep = ms => new Promise(r => setTimeout(r, ms))

export const findChrome = explicit => {
  for (const c of explicit ? [explicit] : CHROME) {
    if (c.includes('/') ? existsSync(c) : spawnSync('which', [c]).status === 0) return c
  }
  throw new Error('no Chrome or Chromium found (use --chrome PATH)')
}

/** Starts headless Chrome and returns a minimal DevTools session for one page. */
export const launch = async (chrome, profile) => {
  const child = spawn(
    chrome,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1', '--disable-gpu', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  let log = ''
  const ws = await new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error(`Chrome did not start: ${log.slice(-300)}`)), 20000)
    child.stderr.on('data', d => {
      log += d
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(log)
      if (m) {
        clearTimeout(timer)
        ok(m[1])
      }
    })
    child.on('exit', () => no(new Error('Chrome exited early')))
  })
  const port = new URL(ws).port
  let page = null
  for (let i = 0; i < 40 && page === null; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    page = list.find(t => t.type === 'page') ?? null
    if (page === null) await sleep(250)
  }
  if (page === null) throw new Error('no page target')
  const sock = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, no) => {
    sock.onopen = ok
    sock.onerror = () => no(new Error('DevTools socket failed'))
  })
  let id = 0
  const waiting = new Map()
  const events = []
  sock.onmessage = m => {
    const d = JSON.parse(m.data)
    if (d.id !== undefined && waiting.has(d.id)) {
      const [ok, no] = waiting.get(d.id)
      waiting.delete(d.id)
      d.error ? no(new Error(`${d.error.message}`)) : ok(d.result)
    } else if (d.method) events.push(d.method)
  }
  const send = (method, params = {}) =>
    new Promise((ok, no) => {
      const i = ++id
      waiting.set(i, [ok, no])
      sock.send(JSON.stringify({ id: i, method, params }))
    })
  const close = () => {
    try {
      sock.close()
    } catch {}
    child.kill('SIGKILL')
  }
  return { send, events, close }
}

export const open = async (cdp, svg) => {
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: pathToFileURL(svg).href })
  for (let i = 0; i < 100 && !cdp.events.includes('Page.loadEventFired'); i++) await sleep(100)
  const count = await cdp.send('Runtime.evaluate', { expression: 'document.getAnimations().length', returnByValue: true })
  if (!(count.result.value > 0)) throw new Error('the SVG has no running animations to seek')
  return count.result.value
}

// Seeks every animation, then waits for two animation frames so the screenshot cannot show a frame that
// was painted before the new state (the first still after loading used to miss some elements).
export const seek = (cdp, t) =>
  cdp.send('Runtime.evaluate', {
    expression: `new Promise(done=>{const a=document.getAnimations();for(const x of a){x.pause();x.currentTime=${Math.round(t * 1000)}}requestAnimationFrame(()=>requestAnimationFrame(()=>done(a.length)))})`,
    returnByValue: true,
    awaitPromise: true,
  })

const shot = async (cdp, t, width = W) => {
  await seek(cdp, t)
  const clip = { x: 0, y: 0, width: W, height: H, scale: width / W }
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false })
  return Buffer.from(r.data, 'base64')
}

const main = async argv => {
  const o = { still: [], fps: 30, 'poster-at': POSTER_AT }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') {
      console.log(USAGE)
      return 0
    }
    if (!a.startsWith('--')) throw new Error(`unexpected ${a}`)
    const name = a.slice(2)
    const v = argv[++i]
    if (v === undefined) throw new Error(`${a} needs a value`)
    if (name === 'still') o.still.push(v)
    else o[name] = ['fps', 'poster-at'].includes(name) ? Number(v) : v
  }
  if (!o.svg) throw new Error(USAGE)
  const svg = resolve(o.svg)
  const work = resolve(o['work-dir'] ?? mkdtempSync(join(tmpdir(), 'hiw-')))
  mkdirSync(work, { recursive: true })
  const chrome = findChrome(o.chrome)
  const profile = mkdtempSync(join(tmpdir(), 'hiw-chrome-'))
  const cdp = await launch(chrome, profile)
  try {
    const animations = await open(cdp, svg)
    console.log(`${animations} animations; duration ${DURATION}s`)

    for (const s of o.still) {
      const [t, w] = s.split(':')
      const width = w === undefined ? W : Number(w)
      const png = join(work, `still-${t}-${width}.png`)
      writeFileSync(png, await shot(cdp, Number(t), width))
      console.log(png)
    }
    if (o.poster) {
      writeFileSync(resolve(o.poster), await shot(cdp, o['poster-at']))
      console.log(resolve(o.poster))
    }
    if (o.mp4) {
      const frames = join(work, 'frames')
      rmSync(frames, { recursive: true, force: true })
      mkdirSync(frames)
      const total = Math.round(DURATION * o.fps)
      for (let i = 0; i < total; i++) {
        writeFileSync(join(frames, `f${String(i).padStart(5, '0')}.png`), await shot(cdp, i / o.fps))
        if (i % 60 === 59) console.log(`frames ${i + 1}/${total}`)
      }
      const ffmpeg = o.ffmpeg ?? 'ffmpeg'
      const r = spawnSync(
        ffmpeg,
        ['-y', '-v', 'error', '-framerate', String(o.fps), '-i', join(frames, 'f%05d.png'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', resolve(o.mp4)],
        { encoding: 'utf8' },
      )
      if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`)
      rmSync(frames, { recursive: true, force: true })
      console.log(resolve(o.mp4), `(${readdirSync(work).length} files kept in ${work})`)
    }
  } finally {
    cdp.close()
    await sleep(300)
    rmSync(profile, { recursive: true, force: true })
  }
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    c => process.exit(c),
    e => {
      console.error(`render: ${e.message}`)
      process.exit(1)
    },
  )
}
