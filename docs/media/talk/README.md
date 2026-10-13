# Talk video: one person managing several AI engineers

A 72-second silent animation for a university talk, built with Remotion. It is an illustration (see
[STORYBOARD.md](STORYBOARD.md)), not a recording and not part of the plugin or the npm package.

## Files

| Path | Role |
|---|---|
| `coupon-team-talk.mp4` | The finished video, 1920 x 1080, 30 fps, H.264, no audio |
| `stills/review/` | Frames for a quick review, one or more per scene |
| `STORYBOARD.md` | Scenes, times, what is invented |
| `src/data/scenario.ts` | Everything said and shown: the request, tasks, code, tests, summary |
| `src/data/timeline.ts` | The story as events; every frame is a pure function of time |
| `src/scenes/`, `src/ui/` | One component per scene; shared task, worker and kit components |
| `test/timeline.test.mjs` | Rejects an impossible story |

## Build

Needs Node 22 or newer and Google Chrome (the config points at the macOS path; change `remotion.config.ts` and
`scripts/stills.mjs` elsewhere). Fonts are the system's Traditional Chinese UI fonts (PingFang TC on macOS), so a
render on another OS looks slightly different.

```sh
cd docs/media/talk
npm install
npm run check      # types and the timeline test
npm run studio     # live preview
npm run render     # out/talk.mp4
node scripts/stills.mjs 23 36.4   # chosen seconds, into stills/
```

## Versions

CTK 0.1.3 (commit `570a87f`), Claude Code 2.1.296, Remotion 4.0.535, Node 24, macOS. No new live CTK session was
recorded for this video; the behaviour it illustrates is the one in `docs/DEMO.md` (Run F).
