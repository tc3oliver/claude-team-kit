// Renders representative frames to stills/ for review: node scripts/stills.mjs [sec ...]
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FPS = 30
const DEFAULT = [3, 5.9, 7.2, 10, 13, 17, 19.5, 23, 26, 29.5, 33.4, 36.4, 40, 45, 47.8, 50, 52.4, 56, 60, 63, 65.8, 68, 70, 73.5]
const secs = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : DEFAULT
const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

mkdirSync(join(ROOT, 'stills'), { recursive: true })
const serveUrl = await bundle({ entryPoint: join(ROOT, 'src/index.ts'), onProgress: () => {} })
const comp = await selectComposition({ serveUrl, id: 'Talk', browserExecutable: executablePath })
for (const s of secs) {
  const frame = Math.min(comp.durationInFrames - 1, Math.round(s * FPS))
  const name = `t${String(s).padStart(5, '0').replace('.', '_')}.png`
  await renderStill({ composition: comp, serveUrl, frame, output: join(ROOT, 'stills', name), browserExecutable: executablePath, imageFormat: 'png' })
  console.log('still', name)
}
