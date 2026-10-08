import { JsonParseError, readTextIfExists, writeFileAtomic } from './fsx.ts'
import { isObject, type JsonObject } from './jsonx.ts'

/** settings.json as read from disk, plus what is needed to write it back in the user's own style. */
export type SettingsFile = { exists: boolean; data: JsonObject; indent: string; finalNewline: boolean }

/**
 * Read settings.json. A missing file is an empty object. A file that is not a JSON object
 * throws JsonParseError: CTK never overwrites a settings file it cannot read.
 */
export const readSettings = (path: string): SettingsFile => {
  const text = readTextIfExists(path)
  if (text === null) return { exists: false, data: {}, indent: '  ', finalNewline: true }
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
    indent: /^([ \t]+)"/m.exec(text)?.[1] ?? '  ',
    finalNewline: text === '' || text.endsWith('\n'),
  }
}

export const writeSettings = (path: string, file: SettingsFile, data: JsonObject): void => {
  writeFileAtomic(path, `${JSON.stringify(data, null, file.indent)}${file.finalNewline ? '\n' : ''}`)
}
