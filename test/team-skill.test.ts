import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// The team skill must never start its workers in a way that escapes the teammate cap. Claude Code starts
// a named Agent call as a teammate unless it is a fork or passes `isolation`; a probe on 2.1.295 showed the
// isolated call arrives without `isTeammate` and starts above the cap (docs/REVIEW.md). These checks keep
// the skill, its reference and the agent definitions from drifting back to advising it.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(ROOT, 'plugins/ctk')
const read = (rel: string): string => readFileSync(join(PLUGIN, rel), 'utf8')

const markdownUnder = (dir: string): string[] =>
  readdirSync(join(PLUGIN, dir), { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? markdownUnder(join(dir, d.name)) : d.name.endsWith('.md') ? [join(dir, d.name)] : [],
  )

test('no skill or reference recommends isolation for workers: every mention is a prohibition or a warning', () => {
  const mentions = [...markdownUnder('skills'), ...markdownUnder('agents')].flatMap(f =>
    read(f)
      .split('\n')
      .filter(l => /isolation/i.test(l))
      .map(l => ({ f, l })),
  )
  assert.ok(mentions.length > 0, 'the skill is expected to say why isolation is avoided')
  for (const { f, l } of mentions) {
    assert.match(l, /never|do not|not a teammate|outside|not limited|ordinary subagent|asks for/i, `${f}: "${l.trim()}" reads as advice to use isolation`)
  }
  assert.doesNotMatch(read('skills/team/SKILL.md'), /isolation: worktree|isolation:\s*"?worktree/)
})

test('the team skill tells the lead to name every worker, reuse idle teammates first, and never set isolation', () => {
  const s = read('skills/team/SKILL.md')
  assert.match(s, /`Agent` with a `name` on every worker/)
  assert.match(s, /Never set `isolation` on a worker/)
  assert.match(s, /Idle teammate first/)
  assert.match(s, /one owner per task/)
})

test('the team skill bounds retries and refuses to call an unverified or failed goal complete', () => {
  const s = read('skills/team/SKILL.md')
  assert.match(s, /retry that task once/)
  assert.match(s, /Never loop on a refused spawn or a failing task/)
  assert.match(s, /goal is NOT complete/)
  assert.match(s, /unverified until you run its verify command/)
})

test('the preflight reads the guard state and does not imply a cap it has not confirmed', () => {
  const s = read('skills/team/SKILL.md')
  assert.match(s, /`guard\.state` is `error` or `unavailable`/)
  assert.match(s, /ask before starting anyone/)
  assert.match(s, /never imply a cap you have not confirmed/)
})

test('no agent definition sets isolation in its frontmatter', () => {
  for (const f of markdownUnder('agents')) {
    const front = /^---\n([\s\S]*?)\n---/.exec(read(f))?.[1] ?? ''
    assert.doesNotMatch(front, /^\s*isolation\s*:/m, `${f} would start every spawn of it outside the cap`)
  }
})

test('the shutdown request is described as a structured object, the form Claude Code accepts', () => {
  assert.match(read('skills/team/SKILL.md'), /`message` an\s+object `\{"type":"shutdown_request"\}`, never a JSON string/)
  assert.match(read('skills/team/references/protocol.md'), /`SendMessage` with `message` as an \*\*object\*\*/)
})

test('the description and the intent gate recognise a plain request to use CTK, and a named worker is the thing Mission Control lists', () => {
  const skill = readFileSync(join(import.meta.dirname, '..', 'plugins', 'ctk', 'skills', 'team', 'SKILL.md'), 'utf8')
  const description = /^description: "(.*)"$/m.exec(skill)?.[1] ?? ''
  assert.match(description, /asked to use CTK/)
  assert.match(description, /ctk 流程/)
  assert.ok(description.length < 220, `the always-on description stays short (${description.length} characters)`)
  assert.match(skill, /or asking to use CTK, counts as one/)
  assert.match(skill, /named = a teammate the cap counts and Mission Control lists; unnamed = a plain subagent neither does/)
})
