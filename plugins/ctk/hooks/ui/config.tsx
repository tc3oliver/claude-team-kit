import { OPTION_GROUPS, groupOfLabel } from '../config.ts'
import { cancelKey, confirmKey, guardWord } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { hudButtons } from './hud.tsx'
import { COLOR, guardColor } from './theme.ts'
import type { Extras, Kit } from './types.ts'

const TWO_COLUMNS = 90

/** Splits "Label (name): old -> new" into its label and values; null when the text has another shape. */
const parsePending = (text: string): { label: string; from: string; to: string } | null => {
  const m = /^(.+?) \(\w+\): (.*) -> (.*)$/.exec(text)
  return m === null ? null : { label: m[1]!, from: m[2]!, to: m[3]! }
}

export const renderConfig = (kit: Kit, m: Mission, mc: McState, extras: Extras, ctx: Ctx) => {
  const { Box, Text } = kit
  const { line, para, button, divider, pad, clip, room } = ctx
  const pending = extras.pending === null ? null : { ...extras.pending, parsed: parsePending(extras.pending.text) }
  // Set once the head is known: two columns only when the whole page fits the row budget, else one column and `fit`.
  let wide = room >= TWO_COLUMNS
  let colWidth = wide ? Math.floor((room - 2) / 2) : room
  let labelWidth = Math.min(26, Math.max(10, colWidth - 14))

  const row = (key: string, label: string, value: string) => {
    const changing = pending?.parsed?.label === label
    return (
      <Text key={key} wrap="truncate-end">
        <Text dimColor>{pad(label, labelWidth)}</Text>
        <Text color={changing ? COLOR.ready : undefined} bold={changing}>
          {clip(changing ? `${value} → ${pending!.parsed!.to} (pending)` : value, colWidth - labelWidth)}
        </Text>
      </Text>
    )
  }
  const groups = OPTION_GROUPS.map(g => ({
    title: g.title,
    rows: extras.options.filter(o => groupOfLabel(o.label) === g.title),
  })).filter(g => g.rows.length > 0)
    // Models is the longest group and changes least: a short pane cuts it first.
    .sort((a, b) => Number(a.title === 'Models') - Number(b.title === 'Models'))
  const heading = (g: (typeof groups)[number]) => (
    <Text key={`c-h-${g.title}`} bold wrap="truncate-end">{clip(g.title, colWidth)}</Text>
  )
  const rowsOf = (g: (typeof groups)[number]) => g.rows.map((o, i) => row(`c-${g.title}-${i}`, o.label, o.value))
  const section = (g: (typeof groups)[number]) => (
    <Box key={`c-g-${g.title}`} flexDirection="column" width={colWidth}>
      {heading(g)}
      {rowsOf(g)}
    </Box>
  )
  // Two columns balance by row count so the pane stays short; one column below TWO_COLUMNS.
  const left: typeof groups = []
  const right: typeof groups = []
  let leftRows = 0
  for (const g of groups) {
    if (leftRows * 2 <= extras.options.length + groups.length) {
      left.push(g)
      leftRows += g.rows.length + 1
    } else right.push(g)
  }

  // One dim line: the reason is dropped, not cut mid-sentence, when it does not fit; Guard's full reason is on the Overview.
  const guardText = `Guard ${guardWord(m.guard)} · ${m.guard.why}`
  const guardLine = line('c-guard', ctx.clip(guardText) === guardText ? guardText : `Guard ${guardWord(m.guard)}`, { color: guardColor(m) })
  const how = para('c-how', 'Nothing changes without your confirmation here. Ask in plain words ("set the worker cap to 6"), then press Confirm. Or use /plugin configure ctk@ctk-kit.')
  const head = [
    // The change waiting for the person comes first and is wrapped, never clipped: it is what they confirm.
    ...(pending === null
      ? []
      : [
          divider('c-pd', 'PENDING CHANGE'),
          ...para('c-pending', `Waiting for you: ${pending.text}`, { bold: true, color: COLOR.ready }),
          <Box key="c-confirm" flexDirection="row" columnGap={2}>
            {button(confirmKey(pending.id), 'Confirm')}
            {button(cancelKey(pending.id), 'Cancel')}
            <Text dimColor>nothing has changed yet</Text>
          </Box>,
        ]),
    ...(extras.notice === null ? [] : [line('c-notice', extras.notice, { color: extras.notice.startsWith('Applied') ? 'success' : 'warning' })]),
    guardLine,
    hudButtons(kit, mc, ctx),
  ]
  const columnLines = Math.max(left.reduce((a, g) => a + g.rows.length + 1, 0), right.reduce((a, g) => a + g.rows.length + 1, 0))
  if (wide && head.length + columnLines + (pending === null ? how.length : 0) > ctx.rows) {
    wide = false
    colWidth = room
    labelWidth = Math.min(26, Math.max(10, colWidth - 14))
  }
  if (!wide) {
    // Group headers and rows are separate nodes so a short pane drops the tail with the shared "+N more" line.
    const body = [...head, ...groups.flatMap(g => [heading(g), ...rowsOf(g)]), ...(pending === null ? how : [])]
    return ctx.fit('c', body as ReturnType<typeof line>[])
  }
  return [
    ...head,
    <Box key="c-cols" flexDirection="row" columnGap={2}>
      <Box flexDirection="column" width={colWidth}>{left.map(section)}</Box>
      <Box flexDirection="column" width={colWidth}>{right.map(section)}</Box>
    </Box>,
    ...(pending === null ? how : []),
  ]
}
