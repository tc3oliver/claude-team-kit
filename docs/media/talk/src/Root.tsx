import { Composition } from 'remotion'
import { Talk } from './Talk.tsx'
import { DURATION_FRAMES, FPS, HEIGHT, WIDTH } from './time.ts'

export const Root = () => <Composition id="Talk" component={Talk} durationInFrames={DURATION_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
