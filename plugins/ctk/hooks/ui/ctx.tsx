import { displayWidth, truncateToWidth } from '../../shared/hudline.ts'
import { STATIC_MOTION } from './motion.ts'
import type { Motion } from './motion.ts'
import { padCells, wrapCells } from './text.ts'
import { COLOR, dividerText, GLYPH, progressBar, statusColor } from './theme.ts'
import type { Status, ThemeColor } from './theme.ts'
import type { Kit } from './types.ts'

/** Below this many cells of room the tables use their compact form. */
export const TABLE_ROOM = 62

/** Rows the body gets in the inline pane: PANE_ROWS (16) minus header, tabs, two gaps and the footer. A docked pane gets more (see `bodyRowsFor`). */
export const BODY_ROWS = 11

/** From this much room the overview draws its metric cards and the bars grow. */
export const WIDE_ROOM = 100

/** The overflow line every view uses: how many were left out and how to see them. The longest wording that fits the room; the 'ask Claude' route is kept down to 40 cells. */
export const moreText = (n: number, room: number): string =>
  [`+${n} more lines not shown · enlarge the terminal or ask Claude`, `+${n} more · enlarge terminal or ask Claude`, `+${n} more · enlarge terminal`, `+${n} more`].find(t => displayWidth(t) <= room) ?? `+${n}`

export type LineOpts = { dim?: boolean; color?: ThemeColor; bold?: boolean }

const noop = () => {}

/**
 * The drawing kit one render shares: the width it has, and primitives bound to the host's components.
 * Every line is cut or wrapped to `room` because a Text inside a Button wraps instead of truncating.
 */
export const createCtx = (kit: Kit, props: { bodyColumns: number; ambiguous?: 1 | 2; motion?: Motion; rows?: number }) => {
  const { Box, Text, Button } = kit
  const ambiguous = props.ambiguous ?? 1
  const room = Math.max(10, props.bodyColumns - 1)
  const bodyRows = props.rows ?? BODY_ROWS
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
  /** A field whose value wraps with a hanging indent under the value, so a long value is never cut. */
  const fieldWrap = (key: string, label: string, value: string, color?: ThemeColor, labelWidth = 13) =>
    wrap(value, room - labelWidth).map((t, i) => (
      <Text key={`${key}-${i}`} wrap="truncate-end">
        <Text dimColor>{pad(i === 0 ? label : '', labelWidth)}</Text>
        <Text color={color}>{t}</Text>
      </Text>
    ))
  /** Keeps a view inside the row budget: the first rows-1 nodes and a "+N more" line, or all of them when they fit. */
  const fit = (key: string, nodes: ReturnType<typeof line>[], rows = bodyRows) =>
    nodes.length <= rows ? nodes : [...nodes.slice(0, rows - 1), line(`${key}-more`, moreText(nodes.length - rows + 1, room), { dim: true })]
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

  return { kit, room, ambiguous, motion: props.motion ?? STATIC_MOTION, rows: bodyRows, wide: room >= WIDE_ROOM, compact: room < TABLE_ROOM, fieldWrap, fit, clip, pad, wrap, line, para, field, button, link, divider, bar, metric, badge }
}

export type Ctx = ReturnType<typeof createCtx>

/** Rows the frame itself takes around the body: header, tabs, the gap above the body, the gap above the footer, the footer. */
export const FRAME_ROWS = 5

/**
 * The body's row budget. Inline the pane opens 16 rows high and must not push the prompt off screen, so it keeps
 * BODY_ROWS; docked, the engine reports the rows the pane may use and the body takes what the frame leaves.
 */
export const bodyRowsFor = (props: { placement?: 'dock' | 'inline'; scroll?: { bodyRows: number } }): number =>
  props.placement === 'dock' && props.scroll !== undefined ? Math.max(BODY_ROWS, props.scroll.bodyRows - FRAME_ROWS) : BODY_ROWS
