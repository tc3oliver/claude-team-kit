export const LABEL: string
export const SCENES: string[]
export const WIDTHS: number[]
export interface Meta { ctkCommit: string; date: string; claudeCodeVersion: string }
export function parseArgs(argv: string[]): { out: string; name: string; ctk: string; config: string; cwd: string; scenes: string[]; widths: number[]; jobs: number }
export function metadata(ctk: string, claude: string): Meta
export function metaLine(m: Meta, cols: number | string): string
export function cropPane(text: string): string | null
export function buildPlugin(dir: string, ctk: string): void
export function pick(rawPath: string, scene: string, cols: number, meta: Meta): { t: number; text: string }
export function sheetSvg(panels: { cols: number; svg: string }[], title: string): string
