export function assertScratchConfigDir(dir: string | undefined, home?: string): void
export function stripAnsi(s: string): string
export function compileMasks(specs: { match: string; replace: string; label?: string }[]): { one: RegExp; all: RegExp; replace: string; label: string }[]
