import type { EngineInterface } from 'claude-code'

export type Kit = ReturnType<EngineInterface['ui']['resolve']>

export type OptionRow = { label: string; value: string }

export type Pending = { id: string; text: string }

export type Extras = {
  statsText: string
  options: OptionRow[]
  pending: Pending | null
  /** The outcome of the last confirmed or cancelled change; null when there is none. */
  notice: string | null
}
