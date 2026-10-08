#!/usr/bin/env node
// Prints the plugin's always-on context (what Claude Code lists every turn) with a rough
// token estimate (chars / 4). Exits 1 when the estimate exceeds the budget (default 500).
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'ctk')
const budget = Number(process.argv[2] ?? 500)

export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out = {}
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const rows = []
const skillsDir = join(root, 'skills')
for (const name of existsSync(skillsDir) ? readdirSync(skillsDir) : []) {
  const file = join(skillsDir, name, 'SKILL.md')
  if (!existsSync(file)) continue
  const fm = frontmatter(readFileSync(file, 'utf8'))
  // A skill with disable-model-invocation keeps its description out of context.
  if (fm['disable-model-invocation'] === 'true') continue
  rows.push({ kind: 'skill', name: `ctk:${fm.name ?? name}`, text: fm.description ?? '' })
}
const agentsDir = join(root, 'agents')
for (const f of existsSync(agentsDir) ? readdirSync(agentsDir).filter((x) => x.endsWith('.md')) : []) {
  const fm = frontmatter(readFileSync(join(agentsDir, f), 'utf8'))
  rows.push({ kind: 'agent', name: `ctk:${fm.name ?? f.replace(/\.md$/, '')}`, text: fm.description ?? '' })
}

let chars = 0
for (const r of rows) {
  const n = r.name.length + r.text.length
  chars += n
  console.log(`${r.kind.padEnd(6)} ${r.name.padEnd(24)} ${String(n).padStart(4)} chars`)
}
const tokens = Math.ceil(chars / 4)
console.log(`total  ${chars} chars, ~${tokens} tokens (budget ${budget})`)
if (tokens > budget) {
  console.error('over budget')
  process.exit(1)
}
