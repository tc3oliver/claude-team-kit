export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080

/** Scene boundaries in seconds. The scenes only decide layout; what is on screen comes from timeline.ts. */
export const SCENES = [
  { id: 'ask', from: 0, to: 8 },
  { id: 'plan', from: 8, to: 18 },
  { id: 'parallel', from: 18, to: 32 },
  { id: 'deps', from: 32, to: 43 },
  { id: 'human', from: 43, to: 53 },
  { id: 'deliver', from: 53, to: 74 },
] as const

export const DURATION_SEC = SCENES[SCENES.length - 1].to
export const DURATION_FRAMES = DURATION_SEC * FPS

export const sec = (s: number) => Math.round(s * FPS)
export const toSec = (frame: number) => frame / FPS
