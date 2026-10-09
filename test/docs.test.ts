import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { main } from '../src/cli/index.ts'
import { runSync } from '../src/cli/commands/sync.ts'
import type { Ctx } from '../src/cli/context.ts'

// Keeps the documentation and the CLI consistent: every command a doc shows must parse against the
// router and its help text, every relative link and anchor must resolve, and no doc may carry a
// machine-local path or a first-person voice.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const rootDocs = (): string[] => readdirSync(ROOT).filter(n => n.endsWith('.md')).sort()
const docsDir = (): string[] => (existsSync(join(ROOT, 'docs')) ? readdirSync(join(ROOT, 'docs')).filter(n => n.endsWith('.md')).sort().map(n => `docs/${n}`) : [])
/** Every tracked markdown document. */
const ALL = (): string[] => [...rootDocs(), ...docsDir()]
/** Documents whose commands and links are checked. */
const COMMAND_DOCS = (): string[] => ['README.md', 'INSTALL.md', 'CONTRIBUTING.md', ...docsDir()].filter(f => existsSync(join(ROOT, f)))

const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8')

type Segment = { text: string; line: number; fenced: boolean }

/** Splits a markdown file into fenced-code lines and prose lines, with 1-based line numbers. */
const segments = (text: string): Segment[] => {
  const out: Segment[] = []
  let fence: string | null = null
  text.split('\n').forEach((raw, i) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(raw)
    if (m) {
      const mark = (m[1] as string)[0] as string
      if (fence === null) fence = mark
      else if (fence === mark) fence = null
      return
    }
    out.push({ text: raw, line: i + 1, fenced: fence !== null })
  })
  return out
}

// ---------------------------------------------------------------------------------------------
// (a) + (b): commands

const cap = async (fn: (out: (l: string) => void) => Promise<unknown>): Promise<string> => {
  const lines: string[] = []
  await fn(l => lines.push(l))
  return lines.join('\n')
}

const helpText = async (): Promise<string> => {
  const main_ = await cap(out => main(['--help'], { out, err: out, env: {}, cwd: ROOT }))
  const sync = await cap(out => runSync(['--help'], { out, err: out } as unknown as Ctx))
  return `${main_}\n${sync}`
}

const VALUE_FLAGS = new Set(['--config-dir', '--profile', '--device', '--to', '--remote', '--branch', '--message', '-m'])
const SHORT_FLAGS = new Set(['-h', '-v', '-m'])
const placeholder = (t: string): boolean => /^[<[]/.test(t) || t.includes('|') || t === '...'

export type Cmd = { file: string; line: number; text: string; tokens: string[] }

const CMD_START = /^(?:\$\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:ctk|node\s+\S*dist\/src\/cli\/bin\.js)(?=\s|$)(?!\s+[(│])/

/** The tokens of a shell-ish command after `ctk`, cut at comments, pipes and redirects. */
const tokensOf = (s: string): string[] => {
  const body = s.replace(CMD_START, '').split(/\s(?:#|\||>|2>|&&|;)/)[0] as string
  return body
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(t => t.replace(/^["']|["']$/g, ''))
}

export const extractCommands = (file: string, text: string): Cmd[] => {
  const cmds: Cmd[] = []
  const add = (line: number, s: string) => {
    if (!CMD_START.test(s)) return
    const tokens = tokensOf(s)
    if (tokens.length > 0) cmds.push({ file, line, text: s, tokens })
  }
  let pending: { line: number; text: string } | null = null
  for (const seg of segments(text)) {
    if (seg.fenced) {
      const t = seg.text.trim()
      if (pending) {
        pending.text += ` ${t.replace(/\\$/, '').trim()}`
        if (!t.endsWith('\\')) {
          add(pending.line, pending.text)
          pending = null
        }
      } else if (t.endsWith('\\') && CMD_START.test(t)) pending = { line: seg.line, text: t.replace(/\\$/, '').trim() }
      else add(seg.line, t)
    } else {
      for (const m of seg.text.matchAll(/`([^`]+)`/g)) add(seg.line, (m[1] as string).trim())
    }
  }
  return cmds
}

const SUBS: Record<string, string[]> = {
  config: ['get', 'set', 'list', 'unset'],
  sync: ['init', 'status', 'pull', 'publish', 'resolve'],
}

/** Problems with the given commands against the help text; empty when all of them parse. */
export const commandErrors = (cmds: Cmd[], help: string): string[] => {
  const commands = [...(/Commands:\n([\s\S]*?)\n\nGlobal options:/.exec(help)?.[1] ?? '').matchAll(/^ {2}(\w+)\s/gm)].map(m => m[1] as string)
  assert.ok(commands.length >= 8, `could not read the command list from the help text:\n${help}`)
  const flags = new Set([...help.matchAll(/(?<![\w-])(--[a-z][a-z-]*)/g)].map(m => m[1] as string))
  const errors: string[] = []
  for (const c of cmds) {
    const where = `${c.file}:${c.line}: \`${c.text}\``
    let command: string | undefined
    let sub: string | undefined
    for (let i = 0; i < c.tokens.length; i++) {
      const t = c.tokens[i] as string
      if (t.startsWith('-')) {
        const name = t.split('=')[0] as string
        if (!flags.has(name) && !SHORT_FLAGS.has(name)) errors.push(`${where}: unknown option ${name}`)
        if (VALUE_FLAGS.has(name) && !t.includes('=')) i++
      } else if (command === undefined) {
        if (placeholder(t)) break
        command = t
        // `ctk help [command]` is handled by the router but is not a row of the Commands list.
        if (t === 'help') break
        if (!commands.includes(t)) errors.push(`${where}: unknown command "${t}"`)
      } else if (sub === undefined && SUBS[command]) {
        sub = t
        if (!placeholder(t) && !(SUBS[command] as string[]).includes(t)) errors.push(`${where}: unknown ${command} action "${t}"`)
      }
    }
  }
  return errors
}

test('docs: every ctk command parses against the router and the help text', async () => {
  const help = await helpText()
  const cmds = COMMAND_DOCS().flatMap(f => extractCommands(f, read(f)))
  assert.ok(cmds.length >= 20, `only ${cmds.length} commands found in the docs; the extractor is probably broken`)
  assert.deepEqual(commandErrors(cmds, help), [])
})

test('docs: the command check rejects unknown commands, options and actions', async () => {
  const help = await helpText()
  const md = ['`ctk frobnicate`', '`ctk install --nope`', '`ctk config bogus x`', '`ctk --config-dir /x doctor`', '`ctk sync init --remote r --branch b`', '`ctk rollback --to <id>`'].join('\n')
  const errors = commandErrors(extractCommands('t.md', md), help)
  assert.deepEqual(errors.map(e => e.replace(/^t\.md:\d+: `[^`]*`: /, '')), ['unknown command "frobnicate"', 'unknown option --nope', 'unknown config action "bogus"'])
})

test('docs: the command extractor reads fenced, continued and inline forms', () => {
  const md = ['text `ctk doctor --json` and `ctk:team` and `ctk` alone', '```sh', '$ CLAUDE_CONFIG_DIR=/x ctk install --dry-run   # note', 'ctk config set a.b 1 \\', '  --device-layer', 'node dist/src/cli/bin.js --version', 'ctk: not a command', '```'].join('\n')
  const got = extractCommands('t.md', md).map(c => c.tokens.join(' '))
  assert.deepEqual(got, ['doctor --json', 'install --dry-run', 'config set a.b 1 --device-layer', '--version'])
})

// ---------------------------------------------------------------------------------------------
// (c): links and anchors

const stripInline = (s: string): string =>
  s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/<[^>]+>/g, '')

/** GitHub-style heading slugs, with -1, -2 suffixes for repeats. */
export const anchorsOf = (text: string): Set<string> => {
  const seen = new Map<string, number>()
  const out = new Set<string>()
  for (const seg of segments(text)) {
    if (seg.fenced) continue
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(seg.text)
    if (!m) continue
    const base = stripInline(m[1] as string)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\- _]/gu, '')
      .trim()
      .replace(/ /g, '-')
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    out.add(n === 0 ? base : `${base}-${n}`)
  }
  return out
}

test('docs: relative links and anchors resolve', () => {
  const errors: string[] = []
  let checked = 0
  for (const f of COMMAND_DOCS()) {
    for (const seg of segments(read(f))) {
      if (seg.fenced) continue
      const prose = seg.text.replace(/`[^`]*`/g, '')
      for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const link = m[1] as string
        if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue
        checked++
        const [path = '', anchor] = link.split('#') as [string, string | undefined]
        const target = path === '' ? join(ROOT, f) : resolve(dirname(join(ROOT, f)), path)
        const where = `${f}:${seg.line}: ${link}`
        if (!existsSync(target)) {
          errors.push(`${where}: ${relative(ROOT, target)} does not exist`)
          continue
        }
        if (anchor !== undefined && anchor !== '' && statSync(target).isFile() && target.endsWith('.md')) {
          if (!anchorsOf(readFileSync(target, 'utf8')).has(anchor)) errors.push(`${where}: no heading "#${anchor}" in ${relative(ROOT, target)}`)
        }
      }
    }
  }
  assert.ok(checked >= 20, `only ${checked} links found; the extractor is probably broken`)
  assert.deepEqual(errors, [])
})

test('docs: anchor slugs follow the GitHub rules', () => {
  const a = anchorsOf('# One `two` (three)\n## Dup\n## Dup\n```\n# not a heading\n```\n### What I did: [x](y)')
  assert.deepEqual([...a], ['one-two-three', 'dup', 'dup-1', 'what-i-did-x'])
})

// ---------------------------------------------------------------------------------------------
// (d): no machine-local paths, no first-person voice

const LOCAL_PATHS: { re: RegExp; allowFenced?: RegExp }[] = [
  { re: /\/Users\/[^\s/"'`<>)\]]+/g, allowFenced: /^\/Users\/you$/ },
  { re: /\/home\/[^\s/"'`<>)\]]+/g },
  { re: /\/private\/tmp/g },
  { re: /scratchpad/gi },
  { re: /claude-501/g },
  { re: /[A-Za-z]:[\\/]Users[\\/][^\s/\\"'`<>)\]]+/g, allowFenced: /^[A-Za-z]:[\\/]Users[\\/](?:you|\.\.\.)$/ },
]

test('docs: no machine-local paths', () => {
  const errors: string[] = []
  for (const f of ALL()) {
    for (const seg of segments(read(f))) {
      for (const { re, allowFenced } of LOCAL_PATHS) {
        for (const m of seg.text.matchAll(re)) {
          if (seg.fenced && allowFenced?.test(m[0])) continue
          errors.push(`${f}:${seg.line}: machine-local path "${m[0]}"`)
        }
      }
    }
  }
  assert.deepEqual(errors, [])
})

test('docs: no first-person singular voice in docs/', () => {
  const FIRST = /(?<![\w-])(?:I|I'm|I've|I'll|I'd|me|my|mine|myself)(?![\w-])/g
  const errors: string[] = []
  for (const f of docsDir()) {
    for (const seg of segments(read(f))) {
      if (seg.fenced) continue
      // Inline code and quotations ("..." quoting another project's own words) are not this document's voice.
      const prose = seg.text.replace(/`[^`]*`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/"[^"]*"/g, '').replace(/\u201c[^\u201d]*\u201d/g, '')
      for (const m of prose.matchAll(FIRST)) errors.push(`${f}:${seg.line}: first person "${m[0]}"`)
    }
  }
  assert.deepEqual(errors, [])
})

test('docs: nothing refers to the retired docs/SECURITY.md', () => {
  const errors: string[] = []
  for (const f of ALL()) {
    segments(read(f)).forEach(seg => {
      if (/docs\/SECURITY\.md/.test(seg.text)) errors.push(`${f}:${seg.line}: refers to docs/SECURITY.md (now docs/THREAT-MODEL.md; the policy is SECURITY.md at the root)`)
      if (/\]\(SECURITY\.md/.test(seg.text) && f.startsWith('docs/')) errors.push(`${f}:${seg.line}: ${'SECURITY.md'} next to a docs file is the retired threat model; link THREAT-MODEL.md or ../SECURITY.md`)
    })
  }
  assert.deepEqual(errors, [])
})
