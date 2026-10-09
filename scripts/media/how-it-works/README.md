# "How CTK works" illustration

An animated illustration of the CTK workflow (one goal, a task graph, a ready frontier, three workers, a handoff,
a verification), used in the README and in [`docs/WORKFLOW.md`](../../../docs/WORKFLOW.md). It is an
**illustration, not a recording**: the scenario is invented, and the picture says so on every frame.

Nothing here is part of the plugin or the npm package. `plugins/ctk/` does not reference it (a test checks that),
`package.json` `files` does not list `scripts/`, and the generated MP4 and poster are excluded from the package.
There are no npm dependencies: Node 22 or newer, plus Google Chrome (or Chromium) and `ffmpeg` to render stills and
video.

## Files

| File | Role |
|---|---|
| `storyboard.mjs` | The data: tasks and their blockers, who works on what and when, captions, the closing line. `validate()` rejects an impossible moment (a task started before its blockers finished, two tasks at once for one worker, a fourth busy teammate, a handoff before the task is ready, captions overlapping). |
| `build.mjs` | Turns the storyboard into one animated SVG: CSS keyframes only, no script, no external reference, system fonts. |
| `render.mjs` | Seeks that SVG's animations in headless Chrome (DevTools protocol over Node's built-in WebSocket) and writes stills, the poster and the MP4. |
| `how-it-works.test.mjs` | Runs with `npm test`: storyboard checks and their mutations, SVG hygiene (no script or external URL, under 100 KB), wording limits, the loop seam, the packaging boundary. |

Outputs, in `docs/assets/`:

| Output | For |
|---|---|
| `how-it-works.svg` | The README and `docs/WORKFLOW.md`. About 50 KB, loops forever, no JavaScript, so GitHub shows it in an `<img>`. Under `prefers-reduced-motion` it holds one still frame (the poster time). |
| `how-it-works.mp4` | Sharing: 1920 x 1080, 30 fps, 24 s, H.264, no audio (the story reads without sound). Excluded from the npm package. |
| `how-it-works-poster.png` | A still at 12.9 s (the handoff moment) for places that cannot play either. Excluded from the npm package. |

The MP4 and the poster are screenshots of the SVG itself, so the three cannot disagree.

## Build

```sh
node scripts/media/how-it-works/build.mjs                 # writes docs/assets/how-it-works.svg
node scripts/media/how-it-works/render.mjs --svg docs/assets/how-it-works.svg \
  --mp4 docs/assets/how-it-works.mp4 --poster docs/assets/how-it-works-poster.png   # about 3 minutes
node --test scripts/media/how-it-works/how-it-works.test.mjs
```

Stills for a review (time in seconds, optional output width for a phone-sized check):

```sh
node scripts/media/how-it-works/render.mjs --svg docs/assets/how-it-works.svg --work-dir /tmp/hiw \
  --still 3 --still 12.9 --still 20.9 --still 12.9:390
```

`render.mjs` waits for two animation frames after each seek. Without that wait the first screenshot after
loading could miss elements that had been painted late.

## How the animation is made

- One loop is 24 s. Every moving part is an opacity or a progress bar (`scaleX`); there are no scripts, so the
  same keyframes drive the SVG, the poster and the MP4.
- Elements with identical keyframes share one CSS class. The whole stage fades in at the start and out at the
  end, so the loop has no visible seam (a test reads the keyframes to check that).
- Short text that replaces other text in the same place (the lead's status, a worker's status, a corner tag, the
  caption) is swapped: the old text fades out before the new one fades in, so two labels are never drawn over
  each other. Outlines cross-fade.
- Colours encode the three layers and the text always says them too (never colour alone): grey **Native**,
  purple **Skill-guided**, orange **Mod-enforced**.
- Type is large on purpose: the captions stay readable at phone width (about 390 px), while the small corner tags
  are decoration there.

## Changing it

1. Edit `storyboard.mjs` (times are seconds on the loop). Keep `validate()` green: it is the guard against
   drawing something the workflow cannot do.
2. Rebuild, render stills at the moments you touched (the opening, the plan, the graph, the capacity moment, the
   reassignment, the verification, the closing line, and a frame just before the loop restarts) and look at them
   at 1920 px and at 390 px.
3. Keep the wording inside what is true. The test rejects "guarantee", "faster", "cheaper", "saves", "orchestrator",
   "automatically", "always" and any percent sign, and allows the word "scheduler" only in "not a scheduler".
   Skill behaviour must stay drawn as skill-guided, and only the capacity caption may be mod-enforced.
4. Re-render the MP4 and the poster, then check the file sizes (the SVG should stay under 100 KB).

## Maintenance notes

- The loop is validated, not recorded: if the workflow in `plugins/ctk/skills/team/SKILL.md` changes (the handoff
  fields, the intent gate, the verification step), update the storyboard and
  [`docs/WORKFLOW.md`](../../../docs/WORKFLOW.md) together.
- Fonts are the visitor's system fonts (`ui-sans-serif`, `ui-monospace` and fallbacks), so text widths differ a
  little between platforms; the layout leaves room for that.
- Chrome is only needed to render. The SVG itself works in any browser that supports CSS animations in an
  `<img>`.
