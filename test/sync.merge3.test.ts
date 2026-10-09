import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Json } from '../src/core/jsonx.ts'
import { merge3, type Flat } from '../src/sync/merge3.ts'

const ABSENT = Symbol('absent')
type V = Json | typeof ABSENT
const mk = (v: V): Flat => (v === ABSENT ? {} : { '/k': v })

// base, ours, theirs -> expected merged value, conflict?, applied?
const table: [string, V, V, V, V, boolean, boolean][] = [
  ['all equal', 1, 1, 1, 1, false, false],
  ['only theirs changed', 1, 1, 2, 2, false, true],
  ['only ours changed', 1, 2, 1, 2, false, false],
  ['both changed to the same value', 1, 2, 2, 2, false, false],
  ['both changed differently', 1, 2, 3, 2, true, false],
  ['added by theirs', ABSENT, ABSENT, 5, 5, false, true],
  ['added by ours', ABSENT, 5, ABSENT, 5, false, false],
  ['added by both, same', ABSENT, 5, 5, 5, false, false],
  ['added by both, different', ABSENT, 5, 6, 5, true, false],
  ['deleted by theirs, ours unchanged', 1, 1, ABSENT, ABSENT, false, true],
  ['deleted by ours, theirs unchanged', 1, ABSENT, 1, ABSENT, false, false],
  ['deleted by both', 1, ABSENT, ABSENT, ABSENT, false, false],
  ['deleted by theirs, modified by ours', 1, 2, ABSENT, 2, true, false],
  ['deleted by ours, modified by theirs', 1, ABSENT, 2, ABSENT, true, false],
  ['null is a value, not absence', ABSENT, null, null, null, false, false],
  ['null vs absent is a change', 1, 1, null, null, false, true],
  ['object values compare structurally', { a: 1, b: 2 }, { b: 2, a: 1 }, { a: 1, b: 3 }, { a: 1, b: 3 }, false, true],
  ['array replaced by theirs', [1], [1], [1, 2], [1, 2], false, true],
  ['arrays conflict atomically', [1], [1, 3], [1, 2], [1, 3], true, false],
]

for (const [name, base, ours, theirs, want, conflict, applied] of table) {
  test(`merge3: ${name}`, () => {
    const r = merge3(mk(base), mk(ours), mk(theirs))
    assert.deepEqual(r.merged, mk(want))
    assert.equal(r.conflicts.length, conflict ? 1 : 0)
    assert.deepEqual(r.applied, applied ? ['/k'] : [])
    if (conflict) {
      const c = r.conflicts[0]!
      assert.equal(c.key, '/k')
      assert.equal(Object.hasOwn(c, 'base'), base !== ABSENT)
      assert.equal(Object.hasOwn(c, 'ours'), ours !== ABSENT)
      assert.equal(Object.hasOwn(c, 'theirs'), theirs !== ABSENT)
    }
  })
}

test('merge3: keys merge independently and output is sorted and deterministic', () => {
  const base: Flat = { '/a': 1, '/b': 1, '/c': 1, 'skills/s/x.md': 'h0' }
  const ours: Flat = { '/a': 2, '/b': 1, '/c': 1, 'skills/s/x.md': 'h0' }
  const theirs: Flat = { '/a': 1, '/b': 9, '/c': 7, 'skills/s/x.md': 'h1', 'skills/s/y.md': 'h2' }
  const r = merge3(base, { ...ours, '/c': 8 }, theirs)
  assert.deepEqual(r.merged, { '/a': 2, '/b': 9, '/c': 8, 'skills/s/x.md': 'h1', 'skills/s/y.md': 'h2' })
  assert.deepEqual(r.conflicts.map(c => c.key), ['/c'])
  assert.deepEqual(r.applied, ['/b', 'skills/s/x.md', 'skills/s/y.md'])
  assert.deepEqual(r, merge3(base, { ...ours, '/c': 8 }, theirs))
})

test('merge3: inputs are not mutated', () => {
  const base: Flat = { '/a': 1 }
  const ours: Flat = { '/a': 1 }
  const theirs: Flat = { '/a': 2 }
  merge3(base, ours, theirs)
  assert.deepEqual({ base, ours, theirs }, { base: { '/a': 1 }, ours: { '/a': 1 }, theirs: { '/a': 2 } })
})
