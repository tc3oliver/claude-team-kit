// Figure formatting shared by the mod (hooks/band.ts) and `ctk stats`, so the two never
// drift. Pure, no imports. A figure that was not reported renders as a dash, never a guess.

export const DASH = '–'

export const usd = (v: number | null | undefined): string => (v === null || v === undefined ? DASH : `$${v.toFixed(2)}`)

export const pct = (v: number | null | undefined): string => (v === null || v === undefined ? DASH : `${Math.round(v)}%`)

/** `haiku×1 sonnet×2`, sorted by name; empty string when there are none. */
export const fmtModels = (models: Record<string, number>): string =>
  Object.keys(models)
    .sort()
    .map(m => `${m}×${models[m]}`)
    .join(' ')
