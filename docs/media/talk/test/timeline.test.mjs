// Run with `npm run check` (Node 24 strips the types). Rejects a story that could not happen.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SCENES, DURATION_SEC } from '../src/time.ts'
import { TASKS } from '../src/data/scenario.ts'
import { KEY, SUITE_TIMES, TASK_TIMES, busyCount, depsAt, taskStatus, TOASTS, CLOSING_FROM } from '../src/data/timeline.ts'

test('the video is 60 to 75 seconds', () => assert.ok(DURATION_SEC >= 60 && DURATION_SEC <= 75))

test('scenes are contiguous', () => {
  SCENES.forEach((s, i) => i && assert.equal(s.from, SCENES[i - 1].to))
})

test('no task starts before every dependency it has at that moment is done', () => {
  for (const { id } of TASKS) {
    const { created, start, done } = TASK_TIMES[id]
    assert.ok(created < start && start < done, id)
    for (const d of depsAt(id, start)) assert.ok(TASK_TIMES[d].done <= start, `${id} starts before ${d}`)
  }
})

test('at most three workers are busy, and one task per worker at a time', () => {
  for (let t = 0; t < DURATION_SEC; t += 0.1) {
    assert.ok(busyCount(t) <= 3, `busy at ${t}`)
    for (const agent of ['backend', 'frontend', 'testing']) {
      const running = TASKS.filter(k => k.agent === agent && taskStatus(k.id, t) === 'running')
      assert.ok(running.length <= 1, `${agent} double-booked at ${t}`)
    }
  }
})

test('the three first tasks run at the same time inside the parallel scene', () => {
  const p = SCENES[2]
  const t = (p.from + p.to) / 2
  assert.deepEqual(['T1', 'T2', 'T3'].map(id => taskStatus(id, t)), ['running', 'running', 'running'])
  for (const id of ['T1', 'T2', 'T3']) assert.ok(TASK_TIMES[id].start >= p.from && TASK_TIMES[id].start < p.from + 2)
})

test('Task 4 waits, becomes ready when Tasks 1 and 2 are done, then runs', () => {
  assert.equal(taskStatus('T4', 30), 'blocked')
  assert.equal(taskStatus('T4', 36.5), 'ready')
  assert.equal(taskStatus('T4', 38), 'running')
})

test('the human amendment lands after the typing and Task 6 follows it', () => {
  assert.ok(KEY.amendEnter > KEY.amendTypeTo && TASK_TIMES.T6.created > KEY.amendEnter)
  assert.ok(depsAt('T5', 40).length === 2 && depsAt('T5', 50).includes('T6'))
})

test('suites run in order and finish before the last task is done', () => {
  assert.ok(SUITE_TIMES.unit.to <= SUITE_TIMES.integration.from && SUITE_TIMES.integration.to <= SUITE_TIMES.e2e.from)
  assert.ok(SUITE_TIMES.e2e.to < TASK_TIMES.T5.done)
})

test('toasts do not overlap, and the closing lines leave three seconds before the end', () => {
  const sorted = [...TOASTS].sort((a, b) => a.t - b.t)
  sorted.forEach((x, i) => i && assert.ok(x.t >= sorted[i - 1].until, 'toast overlap'))
  assert.ok(DURATION_SEC - CLOSING_FROM[1] >= 2.9)
})
