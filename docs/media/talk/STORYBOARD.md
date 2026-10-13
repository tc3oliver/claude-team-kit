# Storyboard and timeline

72 s, 1920 x 1080, 30 fps, silent. Every time below is in `src/data/timeline.ts` and `src/time.ts`; the scenes only
lay it out. `npm run check` fails if the story becomes impossible (a task starting before its blockers, a fourth busy
worker, overlapping toasts, less than three seconds on the finished board).

| Scene | Seconds | What the audience sees |
|---|---|---|
| 1 Ask | 0 to 8 | The request is typed into a large input (0.8 to 5.2), Enter at 5.8 (the button turns green), then the headline "以前，我得自己完成這些工作。" |
| 2 Plan | 8 to 18 | The lead's three-line plan is typed; T1 to T5 appear one at a time on the board with their blockers (T4 after T1 and T2, T5 after T3 and T4); three workers are created at 15.0, 15.8 and 16.6 and the cards get an agent |
| 3 Parallel | 18 to 32 | T1, T2 and T3 start at 18.3, 18.6 and 18.9: a diff, a checkout page that updates, a test list. A light zoom and dimming moves attention from the backend column (21.4) to the frontend (24.3) to the testing column (27.2), then back to all three at 30.9 |
| 4 Dependencies | 32 to 43 | T1 done at 33.0 (toast "Backend validation completed"), T2 at 36.0; T4 goes from "Waiting for dependencies" to "Ready → Running" and starts at 37.0; T3 done at 38.5; the lead's inbox lists each report |
| 5 Human | 43 to 53 | The amendment is typed at 43.8 and sent at 47.4; the lead adds T6 at 48.0, T5 now also waits for T6; the backend worker takes T6 at 49.0 and finishes at 52.0 |
| 6 Deliver | 53 to 72 | T5 starts at 53.5; Unit, Integration and E2E run one after another (54.4 to 64.8); T5 done at 65.0; the lead's summary at 65.6; the camera pulls back at 67.0 and holds on the finished board until 72; no closing text (the speaker says it) |

## What is invented and what is not

The video is an **illustration**, not a recording. The interface ("Agent Workspace") is drawn for the talk; it is not
CTK's Mission Control. The code lines, test names, test counts (12, 6 and 3) and timings are scripted for the story.
What follows the behaviour recorded in [`docs/DEMO.md`](../../DEMO.md) (Run F): the lead creates tasks with
dependencies before any worker starts, the cap is three workers, a task whose blockers are not done stays blocked,
and the person steers the team by talking to the lead, not by dragging tasks or commanding a worker.
