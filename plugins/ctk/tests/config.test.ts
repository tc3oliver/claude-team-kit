import { describe, expect, test } from 'claude-code/testing'

import * as config from '../hooks/config.ts'
import {
  cancel,
  confirm,
  describeOptions,
  emptyPending,
  isExpired,
  OPTION_NAMES,
  optionKey,
  PENDING_TTL_MS,
  propose,
  sweep,
  validateChange,
} from '../hooks/config.ts'
import type { Change, PendingState, ValidateOk } from '../hooks/config.ts'
import { DEFAULT_OPTIONS } from '../shared/policy.ts'
import type { PolicyOptions } from '../shared/policy.ts'

const T0 = Date.UTC(2026, 9, 9, 3, 0, 0)
const MIN = 60_000

const freeze = (o: PolicyOptions): PolicyOptions => Object.freeze({ ...o })
const OPTS = freeze(DEFAULT_OPTIONS)

const good = (name: string, raw: unknown, opts: PolicyOptions = OPTS): ValidateOk => {
  const r = validateChange(name, raw, opts)
  if (!r.ok) throw new Error(`expected ${name}=${String(raw)} to validate: ${r.reason}`)
  return r
}

const reason = (name: string, raw: unknown, opts: PolicyOptions = OPTS): string => {
  const r = validateChange(name, raw, opts)
  if (r.ok) throw new Error(`expected ${name}=${String(raw)} to be rejected`)
  return r.reason
}

const changeOf = (name = 'maxWorkers', raw: unknown = 2): Change => {
  const { ok: _ok, ...change } = good(name, raw)
  return change
}

describe('option names', () => {
  test('exactly the nine userConfig fields', () => {
    expect([...OPTION_NAMES]).toEqual([
      'maxWorkers',
      'explorerModel',
      'implementerModel',
      'reviewerModel',
      'highRiskModel',
      'hudBand',
      'hudIdle',
      'recordStats',
      'teamHint',
    ])
    expect(Object.keys(DEFAULT_OPTIONS).sort()).toEqual([...OPTION_NAMES].sort())
  })

  test('the $.config row key is <plugin>.<field>', () => {
    expect(optionKey('maxWorkers')).toBe('ctk.maxWorkers')
    expect(OPTION_NAMES.map(optionKey).every(k => k.startsWith('ctk.'))).toBe(true)
  })

  test('describeOptions lists every option with its current value', () => {
    const rows = describeOptions({ ...DEFAULT_OPTIONS, maxWorkers: 5, hudBand: false })
    expect(rows.map(r => r.name)).toEqual([...OPTION_NAMES])
    expect(rows[0]).toMatchObject({ name: 'maxWorkers', value: 5, shown: '5', defaultShown: '3' })
    expect(rows.find(r => r.name === 'hudBand')).toMatchObject({ value: false, shown: 'off' })
    for (const r of rows) {
      expect(r.label).not.toBe('')
      expect(r.hint).not.toBe('')
      expect(r.allowed).not.toBe('')
    }
  })
})

describe('maxWorkers', () => {
  test('whole numbers 1..12 are accepted', () => {
    for (const n of [1, 2, 7, 12]) expect(good('maxWorkers', n).value).toBe(n)
  })

  test('the change carries the key, the old and the new value and a line of text', () => {
    const r = good('maxWorkers', 2)
    expect(r).toMatchObject({ ok: true, name: 'maxWorkers', key: 'ctk.maxWorkers', from: 3, to: 2, value: 2 })
    expect(r.text).toBe('Max live teammates (maxWorkers): 3 -> 2')
  })

  test('a numeric string is read as the number, never stored as a string', () => {
    expect(good('maxWorkers', '4').value).toBe(4)
    expect(good('maxWorkers', ' 4 ').value).toBe(4)
  })

  test('out of range is rejected', () => {
    for (const n of [0, 13, 99, -1]) expect(reason('maxWorkers', n)).toContain('1 to 12')
  })

  test('a fraction is rejected (the engine alone would store 2.5)', () => {
    expect(reason('maxWorkers', 2.5)).toContain('whole number')
  })

  test('non-numbers are rejected', () => {
    for (const v of ['two', '', '2.5', '1e1', '0x2', null, undefined, true, [], {}, NaN, Infinity]) {
      expect(validateChange('maxWorkers', v, OPTS).ok).toBe(false)
    }
  })

  test('the value now is reported as nothing to change', () => {
    const r = validateChange('maxWorkers', 3, OPTS)
    expect(r).toMatchObject({ ok: false, code: 'unchanged' })
  })
})

describe('model options', () => {
  test('aliases, full ids and inherit are accepted', () => {
    for (const v of ['opus', 'inherit', 'claude-haiku-5-5', 'claude-sonnet-4-5[1m]', 'us.anthropic.claude-x:0', 'gpt_4.1']) {
      expect(good('explorerModel', v).value).toBe(v)
    }
  })

  test('surrounding whitespace is trimmed', () => {
    expect(good('reviewerModel', '  opus ').value).toBe('opus')
  })

  test('all four model options accept a change', () => {
    for (const name of ['explorerModel', 'implementerModel', 'reviewerModel', 'highRiskModel']) {
      expect(good(name, 'inherit')).toMatchObject({ name, key: `ctk.${name}`, value: 'inherit' })
    }
  })

  test('empty, over-long, spaced or shell-looking text is rejected', () => {
    expect(validateChange('explorerModel', '', OPTS).ok).toBe(false)
    expect(validateChange('explorerModel', '   ', OPTS).ok).toBe(false)
    expect(validateChange('explorerModel', 'a'.repeat(101), OPTS).ok).toBe(false)
    for (const v of ['bad model', 'opus; rm -rf /', '$(id)', 'a/b', '../x', 'op"us', "o'pus", 'op\nus', '<b>']) {
      expect(validateChange('explorerModel', v, OPTS).ok).toBe(false)
    }
  })

  test('exactly 100 characters is the longest accepted', () => {
    expect(validateChange('explorerModel', ('a'.repeat(9) + '.').repeat(10), OPTS).ok).toBe(true)
    expect(validateChange('explorerModel', 'a'.repeat(101), OPTS).ok).toBe(false)
  })

  test('non-strings are rejected', () => {
    for (const v of [5, true, null, undefined, ['opus'], { a: 1 }]) {
      expect(validateChange('explorerModel', v, OPTS).ok).toBe(false)
    }
  })

  test('credential-shaped text is rejected and never echoed', () => {
    // Fake, and written in pieces so no scanner mistakes this file for a leak.
    const secrets = ['sk-ant-' + 'api03-abcdefghijklmnop', 'ghp' + '_abcdefghijklmnop1234', 'AKIA' + 'ABCDEFGHIJKLMNOP', 'a'.repeat(45)]
    for (const s of secrets) {
      const r = validateChange('explorerModel', s, OPTS)
      expect(r.ok).toBe(false)
      expect(JSON.stringify(r)).not.toContain(s)
    }
  })

  test('a rejection never echoes the rejected string', () => {
    const r = validateChange('explorerModel', 'bad model; rm -rf', OPTS)
    expect(JSON.stringify(r)).not.toContain('rm -rf')
    expect(JSON.stringify(validateChange('maxWorkers', 'Hunter2-password', OPTS))).not.toContain('Hunter2')
  })

  test('a model name starting like a key prefix is still a model', () => {
    expect(validateChange('explorerModel', 'skylark-large', OPTS).ok).toBe(true)
  })
})

describe('switches', () => {
  test('real booleans are accepted', () => {
    expect(good('hudBand', false).value).toBe(false)
    expect(good('recordStats', false, { ...OPTS, recordStats: true }).value).toBe(false)
  })

  test('true, false, on and off are accepted as text, in any case', () => {
    expect(good('hudBand', 'off').value).toBe(false)
    expect(good('hudBand', 'FALSE').value).toBe(false)
    expect(good('hudBand', 'on', { ...OPTS, hudBand: false }).value).toBe(true)
    expect(good('hudBand', ' True ', { ...OPTS, hudBand: false }).value).toBe(true)
  })

  test('anything else is rejected', () => {
    for (const v of [1, 0, 'yes', 'no', '1', '', null, undefined, [], {}]) {
      expect(validateChange('hudBand', v, OPTS).ok).toBe(false)
    }
  })

  test('the text shows on and off', () => {
    expect(good('hudBand', false).text).toBe('Team band (hudBand): on -> off')
  })

  test('setting the value it already has is nothing to change', () => {
    expect(validateChange('hudBand', true, OPTS)).toMatchObject({ ok: false, code: 'unchanged' })
  })
})

describe('unknown options', () => {
  test('are rejected with the list of valid names', () => {
    const r = validateChange('maxworkers', 2, OPTS)
    expect(r).toMatchObject({ ok: false, code: 'unknown_option' })
    expect(reason('theme', 'dark')).toContain(OPTION_NAMES.join(', '))
  })

  test('only the exact name counts, including the row key form', () => {
    for (const n of ['ctk.maxWorkers', 'MaxWorkers', '', ' maxWorkers', 'constructor', '__proto__', 'toString']) {
      expect(validateChange(n, 2, OPTS)).toMatchObject({ ok: false, code: 'unknown_option' })
    }
  })

  test('a hostile name is not echoed', () => {
    const r = reason('x"; DROP\n', 1)
    expect(r).not.toContain('DROP')
  })
})

describe('pending change', () => {
  const now = T0

  test('a proposal gets an id and waits', () => {
    const { state, outcome } = propose(emptyPending(), changeOf(), now)
    expect(outcome).toMatchObject({ kind: 'proposed', replaced: null })
    expect(state.pending).toEqual({ id: 'c1', change: changeOf(), createdAt: now })
  })

  test('confirm releases the change once', () => {
    const p = propose(emptyPending(), changeOf(), now)
    const first = confirm(p.state, 'c1', now + MIN)
    expect(first.outcome).toEqual({ kind: 'confirmed', change: changeOf() })
    expect(first.state.pending).toBeNull()
    const second = confirm(first.state, 'c1', now + MIN)
    expect(second.outcome).toEqual({ kind: 'none' })
  })

  test('confirm with a different id releases nothing and keeps the proposal', () => {
    const p = propose(emptyPending(), changeOf(), now)
    const r = confirm(p.state, 'c9', now + MIN)
    expect(r.outcome).toEqual({ kind: 'mismatch', pendingId: 'c1' })
    expect(r.state).toBe(p.state)
    expect(confirm(r.state, 'c1', now + MIN).outcome.kind).toBe('confirmed')
  })

  test('confirm with nothing pending releases nothing', () => {
    expect(confirm(emptyPending(), 'c1', now).outcome).toEqual({ kind: 'none' })
  })

  test('cancel discards; a second cancel finds nothing', () => {
    const p = propose(emptyPending(), changeOf(), now)
    const c = cancel(p.state, 'c1')
    expect(c.outcome).toEqual({ kind: 'cancelled', change: changeOf() })
    expect(c.state.pending).toBeNull()
    expect(cancel(c.state, 'c1').outcome).toEqual({ kind: 'none' })
  })

  test('a cancelled proposal cannot be confirmed afterwards', () => {
    const p = propose(emptyPending(), changeOf(), now)
    const c = cancel(p.state, 'c1')
    expect(confirm(c.state, 'c1', now).outcome).toEqual({ kind: 'none' })
  })

  test('cancel with a different id keeps the proposal', () => {
    const p = propose(emptyPending(), changeOf(), now)
    const c = cancel(p.state, 'zzz')
    expect(c.outcome).toEqual({ kind: 'mismatch', pendingId: 'c1' })
    expect(c.state.pending).not.toBeNull()
  })

  test('ten minutes is still live; one millisecond more is expired', () => {
    const p = propose(emptyPending(), changeOf(), now)
    expect(PENDING_TTL_MS).toBe(10 * MIN)
    expect(confirm(p.state, 'c1', now + PENDING_TTL_MS).outcome.kind).toBe('confirmed')
    const late = confirm(p.state, 'c1', now + PENDING_TTL_MS + 1)
    expect(late.outcome.kind).toBe('expired')
    expect(late.state.pending).toBeNull()
  })

  test('an expired proposal cannot be confirmed later, whatever the clock', () => {
    const p = propose(emptyPending(), changeOf(), now)
    const late = confirm(p.state, 'c1', now + 11 * MIN)
    expect(confirm(late.state, 'c1', now).outcome).toEqual({ kind: 'none' })
  })

  test('a new proposal replaces the waiting one and the old id stops working', () => {
    const a = propose(emptyPending(), changeOf('maxWorkers', 2), now)
    const b = propose(a.state, changeOf('maxWorkers', 4), now + MIN)
    expect(b.outcome).toMatchObject({ kind: 'proposed', replaced: { id: 'c1' } })
    expect(b.state.pending?.id).toBe('c2')
    expect(confirm(b.state, 'c1', now + MIN).outcome).toEqual({ kind: 'mismatch', pendingId: 'c2' })
    const done = confirm(b.state, 'c2', now + MIN)
    expect(done.outcome).toMatchObject({ kind: 'confirmed', change: { value: 4 } })
  })

  test('ids are not reused after a confirm or a cancel', () => {
    const a = propose(emptyPending(), changeOf(), now)
    const done = confirm(a.state, 'c1', now)
    const b = propose(done.state, changeOf(), now)
    expect(b.state.pending?.id).toBe('c2')
    expect(confirm(b.state, 'c1', now).outcome.kind).toBe('mismatch')
  })

  test('sweep drops an expired proposal and leaves a live one alone', () => {
    const p = propose(emptyPending(), changeOf(), now)
    expect(sweep(p.state, now + MIN)).toBe(p.state)
    expect(sweep(p.state, now + 11 * MIN).pending).toBeNull()
    expect(isExpired(p.state.pending!, now + 11 * MIN)).toBe(true)
  })
})

describe('the band while no team runs', () => {
  test('hudIdle takes full, minimal or hidden, in any case, and nothing else', () => {
    expect(validateChange('hudIdle', 'Minimal', OPTS)).toMatchObject({ ok: true, value: 'minimal', key: 'ctk.hudIdle' })
    expect(validateChange('hudIdle', 'hidden', OPTS)).toMatchObject({ ok: true, value: 'hidden' })
    for (const bad of ['', 'off', true, 3, 'full; rm', null]) expect(validateChange('hudIdle', bad, OPTS)).toMatchObject({ ok: false, code: 'invalid_value' })
    expect(validateChange('hudIdle', 'full', OPTS)).toMatchObject({ ok: false, code: 'unchanged' })
  })
})

describe('purity', () => {
  test('transitions never modify the state they were given', () => {
    const base: PendingState = emptyPending()
    Object.freeze(base)
    const p = propose(base, changeOf(), T0)
    expect(base).toEqual({ pending: null, seq: 0 })
    Object.freeze(p.state)
    Object.freeze(p.state.pending)
    confirm(p.state, 'c1', T0)
    cancel(p.state, 'c1')
    sweep(p.state, T0 + 20 * MIN)
    expect(p.state.pending?.id).toBe('c1')
  })

  test('validation and description never modify the options', () => {
    const opts = freeze({ ...DEFAULT_OPTIONS })
    for (const n of OPTION_NAMES) validateChange(n, 'x y', opts)
    validateChange('maxWorkers', 2, opts)
    describeOptions(opts)
    expect(opts).toEqual(DEFAULT_OPTIONS)
  })

  test('the same input always gives the same answer', () => {
    expect(validateChange('maxWorkers', 2, OPTS)).toEqual(validateChange('maxWorkers', 2, OPTS))
    const a = propose(emptyPending(), changeOf(), T0)
    const b = propose(emptyPending(), changeOf(), T0)
    expect(a).toEqual(b)
  })

  test('the module exports functions and plain data only', () => {
    for (const [name, v] of Object.entries(config)) {
      const t = typeof v
      expect(['function', 'number', 'string', 'object'].includes(t)).toBe(true)
      if (t === 'object') expect(Array.isArray(v) || v === null || Object.getPrototypeOf(v) === Object.prototype).toBe(true)
      expect(name).not.toBe('')
    }
  })

  test('exercising every function raises no host event', async ($, on) => {
    const seen: string[] = []
    const hook = on as unknown as (event: string, h: (...a: unknown[]) => unknown) => void
    const watch = (event: string) =>
      hook(event, (_$, e, next) => {
        seen.push(event)
        return (next as (x: unknown) => unknown)(e)
      })
    for (const ev of ['config.set', 'fs.write', 'fs.read', 'settings.write', 'tool.call', 'ui.open', 'agent.spawn']) watch(ev)
    let st = emptyPending()
    for (const n of OPTION_NAMES) {
      const r = validateChange(n, n === 'maxWorkers' ? 2 : n.endsWith('Model') ? 'inherit' : n === 'hudIdle' ? 'minimal' : false, OPTS)
      if (!r.ok) throw new Error(r.reason)
      const { ok: _ok, ...change } = r
      st = propose(st, change, T0).state
      st = confirm(st, `c${st.seq}`, T0).state
    }
    describeOptions(OPTS)
    expect(seen).toEqual([])
    expect(typeof $).toBe('object')
  })
})
