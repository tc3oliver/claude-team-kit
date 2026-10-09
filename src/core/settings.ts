import { JsonParseError, readTextIfExists, sha256, writeFileAtomic } from './fsx.ts'
import { isObject, type JsonObject } from './jsonx.ts'

/**
 * settings.json as read from disk, plus what is needed to write it back in the user's own style.
 * `sha256` is the hash of the bytes that were read (null: there was no file) and is what makes
 * writeSettings a compare-and-swap.
 */
export type SettingsFile = { exists: boolean; data: JsonObject; indent: string; finalNewline: boolean; sha256: string | null }

/**
 * Read settings.json. A missing file is an empty object. A file that is not a JSON object
 * throws JsonParseError: CTK never overwrites a settings file it cannot read.
 */
export const readSettings = (path: string): SettingsFile => {
  const text = readTextIfExists(path)
  if (text === null) return { exists: false, data: {}, indent: '  ', finalNewline: true, sha256: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new JsonParseError(path, e)
  }
  if (!isObject(parsed)) throw new JsonParseError(path, new Error('top-level value is not an object'))
  return {
    exists: true,
    data: parsed,
    // A minified single-line file has no indentation to copy: '' writes it back compact instead of reformatting it.
    indent: /^([ \t]+)"/m.exec(text)?.[1] ?? (text.trimEnd().includes('\n') ? '  ' : ''),
    finalNewline: text === '' || text.endsWith('\n'),
    sha256: sha256(text),
  }
}

/**
 * Write settings.json back, refusing the write when the file is no longer what readSettings saw:
 * Claude Code and CTK both read-modify-write it, and an atomic rename stops corruption but not a
 * lost update. A lockfile cannot bind Claude Code, so a content-hash compare-and-swap is the
 * strongest check available here. It is not a guarantee: a write that lands between the re-read
 * below and the rename is still lost, and only controlling the other writer would close that.
 */
export const writeSettings = (path: string, file: SettingsFile, data: JsonObject): void => {
  const live = readTextIfExists(path)
  if ((live === null ? null : sha256(live)) !== file.sha256) {
    throw new Error(`${path} changed while ctk was working; nothing was written. Re-run the command to pick up the new content.`)
  }
  const text = `${JSON.stringify(data, null, file.indent)}${file.finalNewline ? '\n' : ''}`
  writeFileAtomic(path, text)
  file.sha256 = sha256(text) // a second write in the same run must not trip its own check
}
