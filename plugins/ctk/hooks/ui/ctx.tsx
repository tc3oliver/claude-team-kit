import { truncateToWidth } from '../../shared/hudline.ts'
import { padCells, wrapCells } from './text.ts'
import { COLOR, dividerText, GLYPH, progressBar, statusColor } from './theme.ts'
import type { Status, ThemeColor } from './theme.ts'
import type { Kit } from './types.ts'

/** Below this many cells of room the tables use their compact form. */
export const TABLE_ROOM = 62

export type LineOpts = { dim?: boolean; color?: ThemeColor; bold?: boolean }

const noop = () => {}

/**
 * The drawing kit one render shares: the width it has, and primitives bound to the host's components.
 * Every line is cut or wrapped to `room` because a Text inside a Button wraps instead of truncating.
 */
export const createCtx = (kit: Kit, props: { bodyColumns: number; ambiguous?: 1 | 2 }) => {
  const { Box, Text, Button } = kit
  const ambiguous = props.ambiguous ?? 1
  const room = Math.max(10, props.bodyColumns - 1)
  const clip = (t: string, width = room): string => truncateToWidth(t, width, ambiguous)
  const pad = (s: string, n: number): string => padCells(s, n, ambiguous)
  const wrap = (t: string, width = room): string[] => wrapCells(t, width, ambiguous)

  const line = (key: string, text: string, opts: LineOpts = {}) => (
    <Text key={key} wrap="truncate-end" dimColor={opts.dim} color={opts.color} bold={opts.bold}>
      {clip(text)}
    </Text>
  )
  /** A wrapped paragraph: one line per wrapped row, nothing cut except a single word wider than the room. */
  const para = (key: string, text: string, opts: LineOpts = { dim: true }) => wrap(text).map((t, i) => line(`${key}-${i}`, t, opts))
  const field = (key: string, label: string, value: string, color?: ThemeColor, labelWidth = 13) => (
    <Text key={key} wrap="truncate-end">
      <Text dimColor>{pad(label, labelWidth)}</Text>
      <Text color={color}>{clip(value, room - labelWidth)}</Text>
    </Text>
  )
  const button = (key: string, label: string, hotkey?: string) => (
    <Button key={key} label={label} {...(hotkey === undefined ? {} : { hotkey })} onPress={noop} />
  )
  const link = (key: string, text: string, label: string) => (
    <Button key={key} plain label={label} onPress={noop}>
      <Text wrap="truncate-end">{clip(text)}</Text>
    </Button>
  )
  const divider = (key: string, title = '') => line(key, dividerText(room, title), { color: COLOR.muted })
  /** A bar for a percentage; null (not observed) draws the muted dash bar. */
  const bar = (key: string, pct: number | null, width = 10) => {
    const b = progressBar(pct, width)
    return line(key, b.text, { color: b.color })
  }
  /** A dim label over a bold value, for a row of figures. */
  const metric = (key: string, label: string, value: string, color?: ThemeColor, width = 14) => (
    <Box key={key} flexDirection="column" width={width}>
      <Text dimColor wrap="truncate-end">{clip(label, width)}</Text>
      <Text bold color={color} wrap="truncate-end">{clip(value, width)}</Text>
    </Box>
  )
  /** `● running`: the status glyph and word in the status colour. */
  const badge = (key: string, status: Status, word: string = status) => (
    <Text key={key} color={statusColor(status)} wrap="truncate-end">
      {GLYPH[status]} {clip(word, room - 2)}
    </Text>
  )

  return { kit, room, ambiguous, compact: room < TABLE_ROOM, clip, pad, wrap, line, para, field, button, link, divider, bar, metric, badge }
}

export type Ctx = ReturnType<typeof createCtx>
