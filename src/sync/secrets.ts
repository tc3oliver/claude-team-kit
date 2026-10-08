// Pure secrets scanner for everything sync would publish or apply. No network, no I/O.
// A finding carries file, line, rule id and a redacted preview; never the secret itself.

export type Finding = { file: string; line: number; rule: string; preview: string }

export type ScanOptions = { json?: boolean }

type Rule = { id: string; re: RegExp; secret?: number; skip?: (m: RegExpMatchArray) => boolean }

/** First two and last two characters only: enough to find the line, not enough to use the value. */
export const redact = (v: string): string => (v.length <= 8 ? '****' : `${v.slice(0, 2)}…${v.slice(-2)}`)

export const shannon = (s: string): number => {
  const counts = new Map<string, number>()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length)
  return h
}

const KEYWORD = '(?:api[_-]?key|access[_-]?key|private[_-]?key|secret|token|passw(?:or)?d|pwd|auth|credential)'
// Prose such as `token: use-the-keychain-instead` is not a credential: two or more lowercase words of 3+ letters.
const wordsOnly = (v: string) => /^[a-z]{3,}(?:[-_][a-z]{3,})+$/.test(v)
// Documentation placeholders after a keyword: `token: required`, `password: redacted`.
const PLACEHOLDER = /^(?:required|optional|disabled|enabled|default|unset|redacted|example|placeholder|sensitive)$/i
// `${VAR}`, `$VAR`, `<your-key>`, `{{ secret }}` and plain file paths are references, not values.
const reference = (v: string) => /^(?:\$|<|\{\{|%)/.test(v) || /^(?:~|\.{1,2})?\/[\w.-]+(?:\/[\w.-]+)+$/.test(v)

const RULES: Rule[] = [
  { id: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'openai-key', re: /\bsk-(?:proj-|svcacct-|admin-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}/g },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[A-Z0-9]{16}\b/g },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'slack-webhook', re: /hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]{16,}/g },
  { id: 'stripe-key', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { id: 'private-key', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    id: 'bearer-token',
    re: /authorization["']?\s*[:=]\s*["']?bearer\s+((?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{16,})/gi,
    secret: 1,
  },
  {
    id: 'url-credentials',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"'<>]+:([^\s/@"'<>]+)@/gi,
    secret: 1,
    skip: m => /^[$<{%]/.test(m[1] ?? ''),
  },
  {
    id: 'generic-secret',
    re: new RegExp(`${KEYWORD}["']?\\s*[:=]\\s*["']?([^\\s"'\`]{8,})`, 'gi'),
    secret: 1,
    skip: m => wordsOnly(m[1] ?? '') || PLACEHOLDER.test(m[1] ?? '') || reference(m[1] ?? ''),
  },
]

const ENTROPY_MIN = 4.2
const ENTROPY_LEN = 24
const CANDIDATE = /[A-Za-z0-9+/_=-]{24,}/g
// Lockfile style digests are public: npm/yarn/pnpm `sha512-<base64>`, go.sum `h1:<base64>`.
const DIGEST = /\b(?:sha(?:1|256|384|512)-|h1:)[A-Za-z0-9+/=]+/g

const isHex = (c: string) => /^[0-9a-f]+$/i.test(c)
const isBase32 = (c: string) => /^(?:[a-z2-7]+|[A-Z2-7]+)$/.test(c) && (c.match(/[2-7]/g)?.length ?? 0) >= 2 && /[a-zA-Z]/.test(c)

/** Random-looking token. Hex is never judged on its own (git SHAs, digests); it needs a keyword or URL context. */
const looksRandom = (c: string) => {
  if (isHex(c)) return false
  if (/[A-Z]/.test(c) && /[a-z]/.test(c) && /\d/.test(c) && shannon(c) > ENTROPY_MIN) return true
  return c.length >= 32 && isBase32(c) && shannon(c) > 4
}

// A long hex or base32 segment in a URL path or query is a bearer token (webhooks, signed links),
// unless the segment before it says it names a git object or digest.
const URL_RE = /\bhttps?:\/\/[^\s"'<>)#]+/gi
const OBJECT_SEGMENTS = new Set(['commit', 'commits', 'blob', 'blobs', 'tree', 'raw', 'compare', 'archive', 'sha', 'digest', 'objects'])
const tokenSegment = (seg: string) => seg.length >= 32 && /\d/.test(seg) && /[a-zA-Z]/.test(seg) && (isHex(seg) || isBase32(seg))

const DENIED_KEYS = new Set(['apikey', 'token', 'secret', 'password', 'credentials', 'authorization', 'refreshtoken', 'apikeyhelper', 'env'])
const SUFFIXES = ['apikey', 'secret', 'password', 'token']
const KEY_RE = /"((?:[^"\\]|\\.)+)"\s*:/g

export const isDeniedKey = (key: string): boolean => {
  const k = key.toLowerCase().replace(/[_-]/g, '')
  return DENIED_KEYS.has(k) || k.startsWith('oauth') || SUFFIXES.some(s => k.endsWith(s))
}

type Span = [number, number]
const overlaps = (spans: Span[], s: number, e: number) => spans.some(([a, b]) => s < b && a < e)

/** Scan one file's text. JSON files (by extension or `opts.json`) also get the deny-listed key check. */
export const scanText = (file: string, text: string, opts: ScanOptions = {}): Finding[] => {
  const json = opts.json ?? file.toLowerCase().endsWith('.json')
  const out: Finding[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const spans: Span[] = []
    const add = (rule: string, preview: string, s: number, e: number) => {
      if (overlaps(spans, s, e)) return
      spans.push([s, e])
      out.push({ file, line, rule, preview })
    }
    for (const rule of RULES) {
      for (const m of raw.matchAll(rule.re)) {
        if (rule.skip?.(m)) continue
        const idx = m.index ?? 0
        add(rule.id, redact(m[rule.secret ?? 0] ?? m[0]), idx, idx + m[0].length)
      }
    }
    for (const u of raw.matchAll(URL_RE)) {
      const base = u.index ?? 0
      const segs = [...u[0].replace(/^\w+:\/\/[^/?]*/, m => ' '.repeat(m.length)).matchAll(/[^/?&=;\s]+/g)]
      segs.forEach((sg, i) => {
        const prev = segs[i - 1]?.[0].toLowerCase() ?? ''
        if (tokenSegment(sg[0]) && !OBJECT_SEGMENTS.has(prev)) add('url-token', redact(sg[0]), base + (sg.index ?? 0), base + (sg.index ?? 0) + sg[0].length)
      })
    }
    if (json) {
      for (const m of raw.matchAll(KEY_RE)) {
        const key = m[1] ?? ''
        if (isDeniedKey(key)) out.push({ file, line, rule: `denied-key:${key}`, preview: '' })
      }
    }
    // Digests are public, and a URL is judged one path segment at a time.
    const masked = raw.replace(DIGEST, s => ' '.repeat(s.length)).replace(URL_RE, u => u.replace(/\//g, ' '))
    for (const m of masked.matchAll(CANDIDATE)) {
      const idx = m.index ?? 0
      if (m[0].length >= ENTROPY_LEN && looksRandom(m[0])) add('high-entropy', redact(m[0]), idx, idx + m[0].length)
    }
  })
  return out
}

export const scanFiles = (files: Iterable<{ path: string; content: string }>): Finding[] => {
  const out: Finding[] = []
  for (const f of files) out.push(...scanText(f.path, f.content))
  return out
}

export const formatFinding = (f: Finding): string =>
  `${f.file}:${f.line} ${f.rule}${f.preview ? ` (${f.preview})` : ''}`
