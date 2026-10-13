import { PROMPT } from '../data/scenario.ts'
import { KEY } from '../data/timeline.ts'
import { Typed, fill, ramp, useT } from '../ui/kit.tsx'
import { C } from '../ui/theme.ts'

/** Scene 1: one person types a request and presses Enter. */
export function Ask() {
  const t = useT()
  const press = t >= KEY.enter && t < KEY.enter + 0.3
  const sent = ramp(t, KEY.enter + 0.2, KEY.enter + 0.8)
  const head = ramp(t, KEY.headline[0], KEY.headline[0] + 0.6)
  return (
    <div style={fill}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', fontSize: 40, color: C.dim, fontWeight: 600, opacity: 1 - sent }}>
        <span style={{ color: C.accent }}>◆</span> Agent Workspace · shop-demo
      </div>
      <div style={{ position: 'absolute', left: 180, width: 1560, top: 250, height: 470, borderRadius: 36, background: C.panel, border: `4px solid ${press ? C.ok : C.accent}`, boxShadow: `0 0 ${press ? 120 : 60}px ${press ? C.ok : C.accent}44`, padding: '44px 56px', boxSizing: 'border-box', transform: `translateY(${260 * sent}px) scale(${1 - 0.14 * sent})`, opacity: 1 - 0.65 * sent }}>
        <div style={{ fontSize: 28, color: C.dim, marginBottom: 20 }}>你想完成什麼？</div>
        <div style={{ fontSize: 46, lineHeight: 1.5, fontWeight: 600 }}>
          <Typed text={PROMPT} from={KEY.promptTypeFrom} to={KEY.promptTypeTo} />
        </div>
        <div style={{ position: 'absolute', right: 40, bottom: 32, padding: '14px 34px', borderRadius: 18, fontSize: 34, fontWeight: 800, background: press ? C.ok : C.accent, color: C.bg, transform: `scale(${press ? 0.92 : 1})` }}>
          送出 ⏎
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 740, textAlign: 'center', fontSize: 30, color: C.dim, opacity: ramp(t, KEY.promptTypeTo, KEY.promptTypeTo + 0.4) * (1 - sent) }}>按下 Enter</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 250, textAlign: 'center', fontSize: 76, fontWeight: 800, opacity: head, transform: `translateY(${(1 - head) * 24}px)` }}>
        以前，我得自己完成這些工作。
      </div>
    </div>
  )
}
