export interface Frame { t: number; text: string }
export interface Cell { t: string; w: number; k: string; fg: string; bg: string | null; bold: boolean; dim: boolean; italic: boolean; underline: boolean; strike: boolean }
export interface RenderOptions { speed?: number; maxGap?: number; endPause?: number; title?: string; cols?: number; rows?: number; maxBytes?: number }
export function escapeXml(s: string): string
export function color256(n: number): string
export function cellWidth(cp: number): number
export function parseAnsiLine(line: string): Cell[]
export function plainText(text: string): string
export function parseFrames(source: string): { meta: Record<string, unknown>; frames: Frame[] }
export function renderAnimatedSvg(frames: Frame[], opts?: RenderOptions, meta?: Record<string, unknown>): string
export function renderStaticSvg(frames: Frame[], index: number, opts?: RenderOptions, meta?: Record<string, unknown>): string
export function findFrame(frames: Frame[], regex: string): number
export function wrapCells(cells: Cell[], cols: number | undefined): Cell[][]
export function buildTimeline(frames: Frame[], opts?: RenderOptions, minStep?: number): { timeline: { text: string; start: number; end: number }[]; total: number }
export function fitSpeed(frames: Frame[], opts: RenderOptions, target: number): number
export function measureGrid(frames: Frame[], opts?: RenderOptions, meta?: Record<string, unknown>): { cols: number; rows: number }
