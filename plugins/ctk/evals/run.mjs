#!/usr/bin/env node
// Headless runner for the evals in this directory. Plain Node, no dependencies.
//
// Each case is evals/<name>/prompt.md (front matter + prompt) with graders/*.md. The same files work with
// `claude plugin eval`; this runner exists because it needs nothing but a `claude` binary and lets you pick
// the config dir and working directory. Only graders of `type: tool_used` are understood here.
//
// A case may carry alt.json {alt_tool, alt_input_match}: a tool call matching both also passes its first grader
// (used where the model may reach a CTK MCP tool directly, without the skill).
//
//   node evals/run.mjs [--runs 2] [--case <substring>] [--concurrency 4] [--json out.json]
//
// Environment:
//   CTK_EVAL_CLAUDE   claude binary (default: claude)
//   CTK_EVAL_CWD      working directory of every run (default: the current directory); use a scratch git repo
//   CTK_EVAL_MODEL    model alias (default: sonnet)
//   CTK_EVAL_GUARD    settings file with a PreToolUse hook that blocks Agent, used instead of --disallowedTools Agent
//   CTK_EVAL_PLUGIN   plugin directory to load (default: the plugin that contains this file)
//
// Safety: every run passes --disallowedTools Agent (or the CTK_EVAL_GUARD hook), so no prompt can spawn teammates, and --max-turns from the
// case (default 1), so the run stops right after the first tool call. Each run still costs real tokens.
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : dflt
}
const runs = Number(arg('runs', 2))
const only = arg('case', '')
const concurrency = Number(arg('concurrency', 4))
const jsonOut = arg('json', '')
const claude = process.env.CTK_EVAL_CLAUDE ?? 'claude'
const model = process.env.CTK_EVAL_MODEL ?? 'sonnet'
const plugin = process.env.CTK_EVAL_PLUGIN ?? join(here, '..')
const cwd = process.env.CTK_EVAL_CWD ?? process.cwd()

/** Minimal front matter: `key: value` lines. Returns { meta, body }. */
function split(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  const meta = {}
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv) meta[kv[1]] = kv[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')
  }
  return { meta, body: (m?.[2] ?? text).trim() }
}

const cases = []
for (const name of readdirSync(here).sort()) {
  const dir = join(here, name)
  if (!existsSync(join(dir, 'prompt.md')) || !name.includes(only)) continue
  const { meta, body } = split(readFileSync(join(dir, 'prompt.md'), 'utf8'))
  const gdir = join(dir, 'graders')
  const graders = (existsSync(gdir) ? readdirSync(gdir).filter((f) => f.endsWith('.md')) : []).map((f) => split(readFileSync(join(gdir, f), 'utf8')).meta)
  // Optional alt.json: a second route that also passes the grader (kept out of the grader files, which
  // `claude plugin eval` validates strictly).
  const altFile = join(dir, 'alt.json')
  if (existsSync(altFile)) Object.assign(graders[0], JSON.parse(readFileSync(altFile, 'utf8')))
  cases.push({ name, prompt: body, maxTurns: Number(meta.max_turns ?? 1), graders })
}

function runOnce(c) {
  return new Promise((resolve) => {
    const args = ['-p', c.prompt, '--output-format', 'stream-json', '--verbose', '--model', model, '--setting-sources', 'project',
      '--plugin-dir', plugin, '--max-turns', String(c.maxTurns)]
    // Default: remove the Agent tool. With CTK_EVAL_GUARD=<settings.json> the model keeps the real tool list and
    // that file must carry a PreToolUse hook that blocks Agent (exit 2); verify the guard before trusting it.
    if (process.env.CTK_EVAL_GUARD) args.push('--settings', process.env.CTK_EVAL_GUARD)
    else args.push('--disallowedTools', 'Agent')
    const p = spawn(claude, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('close', () => {
      const toolUses = []
      let cost = 0
      let text = ''
      for (const line of out.split('\n')) {
        let e
        try { e = JSON.parse(line) } catch { continue }
        if (e.type === 'assistant') {
          for (const b of e.message?.content ?? []) {
            if (b.type === 'tool_use') toolUses.push({ name: b.name, input: JSON.stringify(b.input ?? {}) })
            if (b.type === 'text') text += b.text
          }
        }
        if (e.type === 'result') cost = e.total_cost_usd ?? cost
      }
      resolve({ toolUses, cost, text })
    })
  })
}

function grade(c, r) {
  const results = []
  for (const g of c.graders) {
    if (g.type !== 'tool_used') continue
    const re = new RegExp(g.input_match ?? '.')
    const n = r.toolUses.filter((t) => t.name === g.tool && re.test(t.input)).length
    let ok = n >= Number(g.min ?? 1) && (g.max === undefined || n <= Number(g.max))
    // Optional second route that also counts as success (a CTK tool reached without the skill).
    if (!ok && g.alt_tool) {
      const alt = new RegExp(g.alt_input_match ?? '.')
      ok = r.toolUses.some((t) => new RegExp(`^(?:${g.alt_tool})$`).test(t.name) && alt.test(t.input))
    }
    results.push({ ok, n })
  }
  return results.length > 0 && results.every((x) => x.ok)
}

const jobs = cases.flatMap((c) => Array.from({ length: runs }, (_, i) => ({ c, i })))
const report = new Map(cases.map((c) => [c.name, { pass: 0, runs: 0, skills: [], text: [] }]))
let next = 0
let spent = 0
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < jobs.length) {
      const { c } = jobs[next++]
      const r = await runOnce(c)
      const row = report.get(c.name)
      row.runs++
      if (grade(c, r)) row.pass++
      row.skills.push(r.toolUses.map((t) => (t.name === 'Skill' ? (/"skill":"([^"]+)"/.exec(t.input) ?? [])[1] ?? 'Skill' : t.name === 'ToolSearch' ? 'ToolSearch' : t.name)).join('+') || '-')
      row.text.push(r.text.slice(0, 120).replace(/\s+/g, ' '))
      spent += r.cost
    }
  }),
)

console.log('case'.padEnd(24), 'pass', ' skills invoked per run')
let pass = 0
let total = 0
for (const [name, r] of report) {
  console.log(name.padEnd(24), `${r.pass}/${r.runs}`.padEnd(5), r.skills.join(' | '))
  pass += r.pass
  total += r.runs
}
console.log(`total ${pass}/${total} runs passed, cost about $${spent.toFixed(2)}`)
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ model, runs, pass, total, cost: spent, cases: Object.fromEntries(report) }, null, 2))
process.exit(pass === total ? 0 : 1)
