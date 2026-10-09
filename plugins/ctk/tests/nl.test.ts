import { describe, expect, test } from 'claude-code/testing'

import { TEAM_HINT, teamHintFor, teamIntent } from '../hooks/team.ts'
import { engine, fresh } from './world.ts'

// The natural-language entry: a small, fixed phrase check that attaches one hint line to the prompt. It cannot
// start a team; the model reads the hint and decides. These tests pin which words count and which prompts are left alone.

describe('which prompts ask for several agents, a team or CTK', () => {
  const yes = [
    '用多agent，幫 src/ 的兩個模組各補測試',
    '用多 agent 把這個做完',
    '使用多個 Agent 平行處理',
    '看一下backlog 把該處理的處理一下使用 ctk 的流程',
    '用 ctk 做',
    '使用 CTK 的流程',
    'Use a team to implement this feature and review the result.',
    'run this with multiple agents',
    'several agents in parallel please',
    'spin up an agent team for the migration',
    'do it in parallel',
    '幫我開個團隊來做',
    '用 team 來做這個',
    '兩個模組平行處理',
    '請開一個團隊來做',
    '組一個團隊',
    '分頭做這兩件事',
    'spawn 3 teammates for the migration',
    'parallelize this please',
    'run these concurrently',
    '多個 subagent 處理',
    '/Users/x/repo 裡用多agent做完',
    'please use /ctk:team for this and use a team',
  ]
  const no = [
    '',
    'my team keeps the repo on a monorepo layout',
    'ask the team lead about the release date',
    '解釋一下 agent 是什麼',
    '幫我看一下 backlog',
    'fix the typo in README',
    '/ctk:team add tests',
    '/ctk-doctor',
    '/ctk:team use a team of three',
    'the build fails because ctk is not installed',
    'summarize this multi-agentic workflow paper',
    '/ctk-doctor extra words about a team',
  ]
  for (const t of yes) test(`asks: ${t}`, () => expect(teamIntent(t)).toBe(true))
  for (const t of no) test(`does not ask: ${t || '(empty)'}`, () => expect(teamIntent(t)).toBe(false))

  test('only the first 2000 characters are read', () => {
    expect(teamIntent(`${'x '.repeat(1100)}用多agent`)).toBe(false)
  })
})

describe('the hint is for the person’s own words only', () => {
  const ask = '用多agent做完'
  test('typed at the terminal or sent through the bridge: hinted', () => {
    expect(teamHintFor({ text: ask, origin: { kind: 'composer' } })).toBe(TEAM_HINT)
    expect(teamHintFor({ text: ask, origin: { kind: 'bridge' } })).toBe(TEAM_HINT)
  })
  test('a notification, a peer, a schedule, another plugin or no origin: left alone', () => {
    for (const kind of ['task-notification', 'scheduled-trigger', 'peer', 'plugin', 'sdk', 'coordinator', 'observer']) {
      expect(teamHintFor({ text: ask, origin: { kind } })).toBeNull()
    }
    expect(teamHintFor({ text: ask })).toBeNull()
  })
  test('the hint is conditional and short, so a stray "team" costs nothing', () => {
    expect(TEAM_HINT).toMatch(/if this request asks for several agents, a team or parallel work/)
    expect(TEAM_HINT).toMatch(/ignore this note/)
    expect(TEAM_HINT.length).toBeLessThan(500)
  })
})

describe('the hook never changes the prompt', () => {
  // $.prompt.submit always arrives with origin { kind: 'plugin' }, so this proves only that a prompt that is not the
  // person's own is left alone. The composer path is covered by teamHintFor above and was seen once in a real session.
  test('a prompt from another plugin passes through with its text and no CTK context', async ($, on) => {
    const w = fresh()
    engine(on, w)
    on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    const r = await $.prompt.submit({ text: '用多agent做完' })
    expect(r.text).toBe('用多agent做完')
    expect(r.context ?? []).toEqual([])
  })
})
