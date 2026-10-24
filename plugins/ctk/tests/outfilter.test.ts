import { describe, expect, test } from 'claude-code/testing'

import { filterBashOutput, hashOutput, MAX_LINES } from '../hooks/outfilter.ts'

const noisy = (n: number, fail?: string) =>
  [...Array.from({ length: n }, (_, i) => `ok ${i} passing test number ${i}`), ...(fail ? [fail] : []), 'done'].join('\n')

describe('filterBashOutput', () => {
  test('keeps a failure from the middle, caps length, never grows', () => {
    const out = noisy(400).split('\n')
    out.splice(200, 0, 'FAIL src/a.test.ts: assertion error')
    const original = out.join('\n')
    const r = filterBashOutput('npm test', original)
    expect(r.changed).toBe(true)
    expect(r.text.includes('FAIL src/a.test.ts')).toBe(true)
    expect(r.text.length < original.length).toBe(true)
    expect(r.text.split('\n').length <= MAX_LINES).toBe(true)
    expect(r.hash).toBe(hashOutput(original))
    expect(hashOutput(original)).not.toBe(hashOutput(original + 'x'))
  })

  test('collapses duplicate lines', () => {
    const original = Array(300).fill('retrying connection to database host').join('\n')
    const r = filterBashOutput('docker logs web', original)
    expect(r.text).toBe('retrying connection to database host\n... previous line repeated 299 more times ...')
  })

  test('fails open: unrelated command, short output, non-string', () => {
    const big = noisy(400)
    expect(filterBashOutput('cat notes.txt', big).text).toBe(big)
    expect(filterBashOutput('npm test', 'ok').changed).toBe(false)
    expect(filterBashOutput('npm test', undefined as unknown as string).changed).toBe(false)
    expect(filterBashOutput(undefined as unknown as string, big).changed).toBe(false)
  })

  test('output with nothing to gain is returned as is', () => {
    const unique = Array.from({ length: 100 }, (_, i) => `line ${i} ${'x'.repeat(30)}`).join('\n')
    const r = filterBashOutput('make', unique)
    expect(r.text).toBe(unique)
    expect(r.changed).toBe(false)
  })

  test('only a test, build or log program counts, never a path that contains the word', () => {
    const big = noisy(400)
    for (const cmd of ['cat test/a.ts', 'sed -n 1,400p plugins/ctk/tests/x.ts', 'git diff -- src/build.ts', 'tail -n 400 build.log'])
      expect(filterBashOutput(cmd, big).changed).toBe(false)
    for (const cmd of ['npm test', 'CI=1 npx vitest run', 'cd web && pnpm run build', 'docker compose logs api', 'node --test x.ts'])
      expect(filterBashOutput(cmd, big).changed).toBe(true)
  })

  test('a failure keeps the lines after it: the expected/received diff and the stack frame', () => {
    const out = noisy(400).split('\n')
    out.splice(200, 0, '● sum > adds', '  Expected: 3', '  Received: 4', '    at sum.test.ts:7:5')
    const r = filterBashOutput('npx jest', out.join('\n'))
    for (const l of ['● sum > adds', 'Expected: 3', 'Received: 4', 'at sum.test.ts:7:5']) expect(r.text).toContain(l)
  })
})
