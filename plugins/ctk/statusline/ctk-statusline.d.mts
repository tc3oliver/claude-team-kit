// Types for the tests and the type checker; the script itself is plain JavaScript.
export type Segment = {
  id: string
  prio: number
  forms: readonly [string, string, string]
  missing?: boolean
  bold?: boolean
}
export type Window = { pct: number | null | undefined; resetsAtMs: number | null }
export type LayoutOptions = { columns: number; tierColumns?: number; ambiguous?: 1 | 2; color?: boolean }

export const DASH: string
export const SEP: string
export const STATUS_LINE_MARGIN: number
export function charWidth(cp: number, ambiguous?: 1 | 2): number
export function displayWidth(s: string, ambiguous?: 1 | 2): number
export function truncateToWidth(s: string, max: number, ambiguous?: 1 | 2): string
export function stripAnsi(s: string): string
export function fmtPct(v: number | null | undefined): string
export function fmtCountdown(resetAtMs: number | null, nowMs: number): string | null
export function resetMs(v: unknown): number | null
export function tierOf(columns: number): 0 | 1 | 2
export function windowFigures(w: Window, nowMs: number): { pct: string; countdown: string | null; missing: boolean }
export function usageSegment(id: string, label: string, prio: number, w: Window, nowMs: number): Segment
export function layoutLine(segments: readonly Segment[], opts: LayoutOptions): string
export function segmentsFor(input: unknown, nowMs?: number): Segment[]
export function columnsFrom(env: Record<string, string | undefined> | undefined): number
export function render(input: unknown, env?: Record<string, string | undefined>, nowMs?: number): string
