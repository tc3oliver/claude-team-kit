import { cancelKey, confirmKey, guardWord } from '../mission.ts'
import type { McState, Mission } from '../mission.ts'
import type { Ctx } from './ctx.tsx'
import { hudButtons } from './hud.tsx'
import { guardColor } from './theme.ts'
import type { Extras, Kit } from './types.ts'

export const renderConfig = (kit: Kit, m: Mission, mc: McState, extras: Extras, ctx: Ctx) => {
  const { Box } = kit
  const { field, line, para, button } = ctx
  return [
    field('c-guard', 'Guard', `${guardWord(m.guard)} · ${m.guard.why}`, guardColor(m), 26),
    ...extras.options.map((o, i) => field(`c-o${i}`, o.label, o.value, undefined, 26)),
    hudButtons(kit, mc, ctx),
    ...(extras.notice === null ? [] : [line('c-notice', extras.notice, { color: extras.notice.startsWith('Applied') ? 'success' : 'warning' })]),
    ...(extras.pending === null
      ? para('c-how', 'Nothing changes without your confirmation here. To change an option, ask in plain words ("set the worker cap to 6"): a Confirm button then appears on this page and you press it. Or use /plugin configure ctk@ctk-kit.')
      : [
          // Wrapped, never clipped: this is the change the person is about to confirm.
          ...para('c-pending', `Waiting for you: ${extras.pending.text}`, { bold: true, color: 'warning' }),
          ...para('c-pending-how', 'Nothing has changed yet. Press Confirm to apply it, or Cancel.', { dim: true }),
          <Box key="c-confirm" flexDirection="row" columnGap={2}>
            {button(confirmKey(extras.pending.id), 'Confirm')}
            {button(cancelKey(extras.pending.id), 'Cancel')}
          </Box>,
        ]),
  ]
}
