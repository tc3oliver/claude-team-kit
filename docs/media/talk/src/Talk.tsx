import { AbsoluteFill, Sequence } from 'remotion'
import { Ask } from './scenes/Ask.tsx'
import { Deliver } from './scenes/Deliver.tsx'
import { Deps } from './scenes/Deps.tsx'
import { Human } from './scenes/Human.tsx'
import { Parallel } from './scenes/Parallel.tsx'
import { Plan } from './scenes/Plan.tsx'
import { SCENES, sec } from './time.ts'
import { Background, Fade } from './ui/Stage.tsx'
import { SceneClock } from './ui/kit.tsx'

const BY_ID = { ask: Ask, plan: Plan, parallel: Parallel, deps: Deps, human: Human, deliver: Deliver }
const OVERLAP = 8 // frames a scene stays under the next one, for the cross-fade

export function Talk() {
  return (
    <AbsoluteFill>
      <Background />
      {SCENES.map((s, i) => {
        const Scene = BY_ID[s.id]
        const last = i === SCENES.length - 1
        const frames = sec(s.to - s.from) + (last ? 0 : OVERLAP)
        return (
          <Sequence key={s.id} from={sec(s.from)} durationInFrames={frames} name={s.id}>
            <SceneClock from={s.from}>
              <Fade frames={frames} fadeIn={i === 0 ? 0 : OVERLAP} fadeOut={last ? 0 : OVERLAP}>
                <Scene />
              </Fade>
            </SceneClock>
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
