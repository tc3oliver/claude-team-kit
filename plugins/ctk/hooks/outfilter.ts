// Pure logic for the opt-in `bashFilter` option: shrink the output of a test, build or log
// command to its failures. No host calls here; the caller stores `original` under `hash` so the
// full text can be recalled. It fails open: any doubt returns the original, and the result is
// never longer than the original.

/**
 * A test, build, lint or log program at the start of one step of a command (after `VAR=x`
 * assignments and a runner such as `npx`). Matched per step, so a file path that merely contains
 * `test` or `build` (`cat test/a.ts`, `git diff -- src/build.ts`) is never filtered.
 */
const NOISY_STEP =
  /^(?:\w+=\S*\s+)*(?:(?:npx|bunx|pnpm exec|uv run|poetry run)\s+)?(?:jest|vitest|pytest|mocha|tsc|make|cargo|gradle|\.\/gradlew|mvn|eslint|ruff|mypy|journalctl|(?:npm|pnpm|yarn|bun)\s+(?:test|t|run|build|ci|install|lint)|go\s+(?:test|build|vet)|(?:docker|kubectl)\s+(?:compose\s+)?logs|node\s+--test|python3?\s+-m\s+(?:pytest|unittest))\b/
const FAILURE_LINE = /\b(fail(ed|ure|s)?|error|panic|exception|traceback|assert(ion)?|fatal|not ok|expected|received)\b|[✗✖×●]|\bat \S+:\d+/i
/** Lines kept after a failure line: the expected/received diff and the first stack frames. */
const CONTEXT_AFTER = 5

export const isNoisyCommand = (command: string): boolean =>
  command.split(/&&|\|\||;|\|/).some(step => NOISY_STEP.test(step.trim()))

/** Output at or under this many lines is only de-duplicated, never cut. */
export const MAX_LINES = 120
const HEAD_LINES = 20
const TAIL_LINES = 30
const MAX_FAILURE_LINES = 40
/** Skipping a short output saves nothing and risks the fail-open rule. */
const MIN_CHARS = 2000
/** A rewrite must save at least this much, or the note the caller adds can make it longer. */
export const MIN_SAVING = 500

export type FilterResult = {
  /** What the model should see: the filtered text, or the original when nothing was gained. */
  text: string
  /** hash of the original (see hashOutput); the key under which the caller keeps the full output. */
  hash: string
  changed: boolean
}

// shortcut: cyrb53 (not cryptographic) because a hooks module may import nothing but its own files; fine as a recall key, upgrade if keys must resist forgery.
export const hashOutput = (output: string): string => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < output.length; i++) {
    const c = output.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}-${output.length.toString(16)}`
}

const collapseRuns = (lines: string[]): string[] => {
  const out: string[] = []
  for (let i = 0; i < lines.length; ) {
    let j = i + 1
    while (j < lines.length && lines[j] === lines[i]) j++
    // The line itself stays verbatim: a marker on it would read as part of the program's output.
    out.push(lines[i]!)
    if (j - i > 1) out.push(`... previous line repeated ${j - i - 1} more times ...`)
    i = j
  }
  return out
}

const cap = (lines: string[]): string[] => {
  if (lines.length <= MAX_LINES) return lines
  const keep = new Set<number>()
  for (let i = 0; i < HEAD_LINES; i++) keep.add(i)
  for (let i = lines.length - TAIL_LINES; i < lines.length; i++) keep.add(i)
  let kept = 0
  for (let i = HEAD_LINES; i < lines.length - TAIL_LINES && kept < MAX_FAILURE_LINES; i++) {
    if (!FAILURE_LINE.test(lines[i]!)) continue
    for (let k = i; k <= i + CONTEXT_AFTER && k < lines.length && kept < MAX_FAILURE_LINES; k++) {
      if (!keep.has(k)) kept++
      keep.add(k)
    }
  }
  const out: string[] = []
  let skipped = 0
  for (let i = 0; i < lines.length; i++) {
    if (keep.has(i)) {
      if (skipped > 0) out.push(`... ${skipped} lines omitted ...`)
      skipped = 0
      out.push(lines[i]!)
    } else skipped++
  }
  return out
}

export const filterBashOutput = (command: string, output: string): FilterResult => {
  const hash = hashOutput(typeof output === 'string' ? output : '')
  const same: FilterResult = { text: output, hash, changed: false }
  try {
    if (typeof command !== 'string' || typeof output !== 'string') return same
    if (output.length < MIN_CHARS || !isNoisyCommand(command)) return same
    const text = cap(collapseRuns(output.split('\n'))).join('\n')
    return text.length <= output.length - MIN_SAVING ? { text, hash, changed: true } : same
  } catch {
    return same
  }
}
