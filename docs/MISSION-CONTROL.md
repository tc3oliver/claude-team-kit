# Mission Control

Mission Control is a read-only view of your agent team, one click away from the CTK band above the
prompt. It shows what CTK and Claude Code reported, never a guess, and opening or closing it does not
touch the team.

## Open it

| How | Steps |
|---|---|
| Click | Click anywhere on the band (`CTK ▸ …`). It is one button. |
| Keyboard | `Ctrl+X` then `Tab` focuses the band (it is drawn inverted), `Enter` opens the pane, `Ctrl+X` then `Tab` again moves into it. |
| Command | `/ctk-mission` opens the pane with the keyboard already in it. Also the way in when the band is hidden (`hudBand` off, or `hudIdle` hidden). |
| Where no pane can be drawn | `/ctk-mission` prints the same overview as text. |

Inside the pane: click a tab, or press its digit (`1` Overview, `2` Workers, `3` Tasks, `4` Usage,
`5` Config, `6` Stats, `7` Doctor); `Tab` walks the buttons and `Enter` presses one; the arrows scroll;
`Esc` closes the pane and gives the keys back to the prompt. In the fullscreen layout the pane docks
beside the transcript; on the main screen it opens above the prompt.

## What it shows

| View | Contents | Source |
|---|---|---|
| Overview | A state pill in the header (`● ACTIVE`, `◇ READY`, `▲ CAPACITY`, `✗ ERROR`, `○ unavailable`); a slot meter with one glyph per cap slot (running, idle, free) and the finished and failed counts; four cards (WORKERS, TASKS, REFUSED, COST); 5-hour and weekly quota bars with reset times; one line each for task states, ordinary subagents, the guard's reason and the session | the roster (`$.agent.list`), CTK's counters, `$.session.usage()` |
| Workers | two lines per worker when there is room (name, status, model, activity bar; then current task, tool calls, time since spawn, last activity), one line otherwise; select one for its detail page, which also lists its last tool calls | the spawn result (model), `tool.call` events carrying the worker's agent id, turn and `TeammateIdle` events |
| Tasks | a progress bar with `n/N marked complete`, the ready frontier, a layered graph of the declared dependencies, then the list (id, status, owner, what it waits for); select one for what it waits for and what waits for it | the `TaskCreate` and `TaskUpdate` calls CTK saw (their named fields only) |
| Usage | model, context, 5-hour and weekly bars with reset countdowns, session cost, tool calls | `$.session.usage()`, `$.session.model()`, CTK's tool-call count |
| Config | any change waiting for your confirmation first, then the HUD form for this session, then the options in groups | the plugin's options |
| Stats | the `/ctk-stats` summary in two sections, what CTK counted and what Claude Code measured | CTK's counters and Claude Code's figures |
| Doctor | the `/ctk-doctor` report with what needs a fix first, then what is unknown or off, then one line for everything that is fine; read when you open the view | `$.env.get`, `$.settings.read`, `$.tool.list` |

The cap is enforced by the CTK mod; Mission Control only displays it and never changes it.

**The state pill.** `ACTIVE` appears only after a spawn has reached the guard in this session. `CAPACITY` appears
once the live teammates reach the cap: amber while nothing was refused, red once a spawn was refused with
`TEAM_CAPACITY_REACHED`. A full team is never shown as plain `ACTIVE`. The Overview's guard line is a short
sentence built from the same counts; the full reason is in Doctor, in `/ctk-mission` text and in the status tool.

**The workers' activity bar** compares a worker's tool calls with the busiest worker's. It is not progress and
not a share of the work, only a relative count of calls the worker's own loop made.

**Recent calls** (worker detail) show the tool name and, for file tools, the file's base name, nothing else: a
command, a pattern or any other input can carry a secret, so CTK does not keep it. Only the last six are kept.

**The task graph** is drawn only from the dependencies the model declared (`addBlockedBy`, `addBlocks`). CTK infers
none. When the declared graph cannot be drawn faithfully (a cycle, more than 12 linked tasks, or no room) the page
falls back to the list. A task that `TaskUpdate` set to completed is shown as **marked complete (TaskUpdate; not
verified)**: CTK does not check the work. A task that failed is not observable from these calls, so there is no
failed state.

**Teammates and ordinary subagents are shown apart.** The Workers view lists *teammates*: named agents that
Claude Code started as members of a team, which the worker cap counts. An `Agent` call with no `name` starts an
ordinary subagent: the cap does not count it, and it is not a worker. Those are listed in their own section
("Ordinary subagents", with the type, status and description the roster reports), counted on the Overview as
`Subagents`, and shown on the band as `Sub 2`. Nothing else is known about them: no model, no tool calls, no cost.
`Guard ON` means a spawn event has reached the guard, and its text says how many of those were teammates; it does
not mean a team started.

**An empty page says why.** With no teammate, Workers says whether Agent Teams are off, or that none has started
and how to start one (`/ctk:team <goal>`, or ask for a team); Tasks says the lead has made no task list yet and
names `TaskCreate` and `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. The `ctk_team_status` tool returns the same sentences in
`explain` so the lead can tell you the same thing. CTK never creates a task or an agent to fill the page.

A figure that was not observed reads **unavailable**; nothing is estimated. In particular:

- **Task detail needs task calls.** Claude Code leaves the Task tools out on current models unless
  `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. Without them the Tasks view says so and the overview falls back to
  the created/completed counts from the task events. Tasks created before CTK loaded, or changed in any
  other way than a `TaskCreate`/`TaskUpdate` call, are not shown.
- **Per-worker figures exist only for workers that run a loop in this process.** A teammate in a
  terminal pane of its own (tmux or iTerm2 mode) raises no events here: its model comes from the spawn,
  its tool calls and last activity read unavailable.
- **Idle time** starts at the teammate's idle notice; before one arrives it falls back to its last
  activity.
- **"Current task"** is the in-progress task whose owner is the worker's name.
- **Per-worker cost is never shown**: Claude Code does not report it.

## HUD form

The Config view has four buttons (the Overview shows them only when it has rows to spare): Auto (follow the terminal width), Compact, Standard and
Full. The choice applies to the band for this session only; it is not saved. To keep a form, there is no
setting yet: Auto follows the width as [ARCHITECTURE](ARCHITECTURE.md#layout) describes.

## Changing an option

Mission Control never changes anything by itself. The one write it can make is an option change that you
confirm:

1. You ask in plain words ("set the worker cap to 2"), or Claude calls the `ctk_config` tool.
2. CTK checks the request against its own schema (a whole number from 1 to 12 for the cap, a model alias
   or id, on/off switches) and stores it as **pending**. Nothing is written. The Config view opens with
   `Waiting for you: Max live teammates (maxWorkers): 3 -> 2` and **Confirm** and **Cancel** buttons.
3. Only your press on Confirm calls Claude Code's `$.config.set`, once, after checking the request again
   against the options as they are now, that managed settings do not lock the option, and that no
   teammate is starting. A proposal older than ten minutes is dropped.
4. Claude Code writes the value to the plugin's options and reloads the mod a moment later. The worker
   cap in force follows at once; Mission Control's per-worker detail starts over (the counters in the
   stats file continue).

You do not have to know to look: the lead is told to say "press Confirm in Mission Control", Mission Control opens
on the Config view with the Confirm button, and the band above the prompt reads `Confirm setting: click here` until
you answer (it shows even when `hudIdle` hides the idle band).

Because step 3 is a button press, auto-approve modes and permission settings cannot confirm it for you.
Where no pane can be drawn, the answer to the model says to change the option with
`/plugin configure ctk@ctk-kit` instead.

## Limits

- Mods, and with them the band, the pane and the command, are early access and need Claude Code 2.1.287
  or newer. Without them the skills, agents and the optional status line still work, and
  `/ctk-stats` and `/ctk-doctor` are not available (see [LIMITATIONS](LIMITATIONS.md)).
- Opening the pane from the band by keyboard does not give it the keys (Claude Code refuses focus while
  the band holds it): press `Ctrl+X` `Tab` once more, or use `/ctk-mission`.
- The pane is redrawn when Claude Code reports something (a turn ends, a worker changes, a tool
  call, a press). The only timer is the one described under Motion.
- Colours are theme keys, so they follow the theme, but only a dark terminal was checked in real cells.

## How much fits

Every view stays inside a row budget. The pane above the prompt opens 16 rows high, and after the header, tabs,
spacing and footer a view has **11 body rows**; a longer list would push the prompt off screen. When the pane is
docked beside the transcript it gets the rows the terminal reports (taller terminal, more rows), and the views
use that. What does not fit is summarised in one line, for example `+3 more lines not shown · enlarge the
terminal or ask Claude`, shortened as the pane gets narrower; the Tasks page also says it lists done tasks last.
Nothing is cut in the middle of a sentence or a word: text wraps, and the code `TEAM_CAPACITY_REACHED` always
stays whole. The tabs shrink in steps (full labels from 69 columns, then short words, then digits with only the
current view spelled out). The band, past six tasks, adds `full list: Mission Control`.

## Motion

Motion is small and optional.

- **What moves:** a running worker's glyph dims and brightens once a second; a worker that just started, a task
  that was just marked complete and a new refusal are highlighted for three seconds.
- **When a timer exists:** only while the pane is drawn and something is running or a highlight is still to end.
  There is one timer at most, at least a second long, and each firing redraws the pane and arms the next. With the
  pane closed, or with nothing running, there is no timer and nothing runs.
- **Off switches:** `CTK_REDUCED_MOTION=1`, or any non-empty `NO_COLOR`, turns motion off: static glyphs and no
  timer at all. Claude Code gives mods no reduced-motion setting, so CTK reads these two variables. `NO_COLOR` does
  not remove colour here; the colours are the theme's.
- Motion never takes the keyboard, never changes the team and is not saved.
