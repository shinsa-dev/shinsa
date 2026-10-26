# Performance

What Shinsa measures, how, and the numbers before and after each pass. Each section belongs to one part of the
system; the scripts that produce its numbers are under `scripts/perf/`.

## Server, protocol and state

The path of a click: command → `decide` → events in SQLite → state → socket → the page's state → render-ready, plus
how the server boots and how transcripts stream.

### How it is measured

- **Data.** The user's own data copied to `/tmp` with `sqlite3 .backup` (1,645 events, 5 tasks, 19 runs, a 338 KB state),
  and a synthetic log written by `scripts/perf/synthetic.ts` through the real `decide` and `EventLog`: 200 tasks over
  five repositories walked through planning, phases, checks, review and pull request updates, 50,000 events, 1,125
  runs, an 18.5 MB state, 20 transcripts of 5,000 entries (1.5 MB each) and 60 entries for the rest.
- **The bench.** `bun scripts/perf/bench.ts <data dir> <scratch dir>` copies the data to the scratch folder and
  measures, in one process: boot (a cold boot that replays the log, then a warm one from the snapshot the first wrote);
  60 commands dispatched with the socket hub attached (latency, CPU per command, bytes per push, and the time to parse
  and apply each push the way the page does); 60 clicks over a real WebSocket to the web's own `Connection` (time until
  the changed priority is in the page's state, with and without the optimistic path, and until the ack; then 60
  project edits, which are not optimistic, until the server's change is in the page's state); a 5,000-entry
  transcript (reading it, the subscription's bytes, an appended entry, one appended by another writer); memory after
  boot. The "before" numbers ran the same bench on `git archive HEAD` of this pass's starting point
  (`/tmp/shinsa-before`, with `resolveStateVersion` stubbed out because it did not exist).
- **Machine.** An Apple silicon Mac, Bun 1.4.4, other work running beside it; numbers are p50 / p95 of each sample.

### Before and after

| Measure | Real data before | Real data after | 50k events before | 50k events after |
| --- | --- | --- | --- | --- |
| Click to state shown in the page (optimistic: priority) | 1.07 / 1.63 ms | 0.02 / 0.08 ms | 43.0 / 72.9 ms | 0.07 / 0.16 ms |
| Click to the server's state in the page (project edit) | 1.01 / 1.40 ms | 0.17 / 0.35 ms | 41.8 / 62.8 ms | 0.21 / 0.44 ms |
| Click to ack | 1.07 / 1.65 ms | 0.26 / 0.72 ms | 43.1 / 72.9 ms | 0.46 / 1.31 ms |
| Server: dispatch latency | 0.61 / 1.39 ms | 0.13 / 0.33 ms | 24.6 / 31.2 ms | 0.17 / 0.66 ms |
| Server: CPU per command | 0.83 ms | 0.25 ms | 25.6 ms | 0.48 ms |
| `decide` alone (a priority change) | | | 9.44 ms | 0.046 ms |
| Bytes per push | 342 KB | 340 B | 18.5 MB | 336 B |
| Page: parse and apply a push | 0.17 / 0.24 ms | 0.00 / 0.01 ms | 11.1 / 12.2 ms | 0.01 / 0.02 ms |
| `resolveQueue` (Home, the shells) | | | 1.29 ms | 0.038 ms |
| Boot (file cache warm) | 1.9 ms (replay of 1,645 events) | 0.7 ms (snapshot; 319 events after pruning) | 39.5 ms (replay) | 24.2 ms (snapshot) |
| RSS after boot | 56 MB | 34 MB | 221 MB | 188 MB |
| Generating the 50k log (≈ 1 `decide` per command on a growing state) | | | 348 s | 3.2 s |

Unchanged by that pass: the first state on connect (338 KB / 18.5 MB, about 2 ms / 45 ms to send and parse; the second
pass below cut it), reading a 5,000-entry
transcript (about 3 ms), appending an entry (0.05 ms) and the 50 ms an entry another writer appends takes to arrive,
which is the file watch's own latency. The snapshot costs 1.5 ms to write on the real data and 77 ms on the 50k log
(written only once the server has been quiet for 3 s), and adds the state's size to `shinsa.sqlite`.

On the user's own log, the first start of this version pruned 1,326 superseded briefings (1,645 events to 319) and
wrote a snapshot; the state from the snapshot, the state from replaying the pruned log and the state from replaying
the original log are the same (checked by comparing them key by key on the `/tmp` copy).

### What changed and why

- **`decide` copied the whole state.** `Decider` ran `structuredClone(state)` on every command: 9.4 ms of the 9.4 ms
  `decide` took on the 50k log, and most of the 348 s the generator spent. It now works on a copy-on-write draft
  (`createDraft`): a record is copied the first time an event writes to it and entities are never changed in place,
  so a command copies the one task it changes. The engine adopts the decided state instead of applying the events a
  second time (`docs/engine.md` → State in memory).
- **O(tasks × runs) liveness.** `enforceLiveness`, run after every command, listed open gates and active runs per
  task, each a scan of every gate and run. The tasks with a gate or a run are now one pass (`resolveMovingTasks`);
  `resolveQueue` did the same per task, and counted each gate's dependents with a scan of every task.
- **The whole state on every change.** Every command broadcast `JSON.stringify(state)` (18.5 MB) to every socket and
  every page parsed it and replaced its state, so every component rendered again. The server now sends a patch of
  the entries that changed (`state.patch`, `docs/protocol.md` → The socket); the page applies it with structural
  sharing, once per frame, and asks for the whole state only if a patch does not fit.
- **Clicks waited for the server.** Commands that settle the same way on the server are decided on the page and shown
  at once, then reconciled with the server's patch and ack.
- **Boot replayed the whole log, mostly briefings.** 81% of the user's events were rewrites of the Home guide. Boot
  now reads a snapshot and the events after it, and superseded briefings were pruned at start (the second pass
  took the guide out of the log altogether).
- **Transcripts.** Following a run read the whole file on every appended line, every server reader (`listEntries`)
  parsed the whole file, a subscription sent every entry again after each reconnect, and the page copied the whole
  list on every entry. The server now reads only appended bytes and keeps parsed entries of followed and recent runs,
  the page asks from the position it holds, pages of 500 entries keep each message short, and entries apply once per
  frame.

### Second pass: snapshots in `shinsa engine`, runs without their prompts, the guide beside the log

- **How it is measured.** Boot: `Engine` construction on copies (`sqlite3 .backup`) of the 50k log, seven runs each,
  median, the file cache warm; and a real `shinsa engine` on a `/tmp` copy (fake `claude`, `gh`, `eunoe` and login
  shell from `apps/server/test/helpers/bin`, `SHINSA_QUICK=off`) timed from spawn to `/api/health` and to the first
  state on a socket, then left idle 4.5 s before it is stopped, three or four runs. The first state: `bench.ts`
  (which now also reports the state as the page gets it, `client.wireStateBytes` and `client.wireStateParseMs`),
  median of three runs. Before is `/tmp/shinsa-perf2/base`, a clone of the tree before this pass.

| Measure | Real data before | Real data after | 50k events before | 50k events after |
| --- | --- | --- | --- | --- |
| A real `shinsa engine` writes a snapshot | never | 3 s after boot, and on stop | never | 3 s after boot, and on stop |
| Engine boot in `shinsa engine` | replay | from the snapshot | 73.7 ms (50,000 events, the first start), then 68.8 ms (34,700 after pruning) | 25.9 ms from the snapshot (5 ms of it hashing core's source) |
| Spawn to `/api/health` | | | 274 to 288 ms | 250 to 257 ms |
| First state on connect | 354 KB | 100 KB | 18.5 MB | 2.43 MB |
| Connect to the first state in the page | 5.1 ms | 4.7 ms | 48.7 ms | 14.8 ms |
| Page: parse the first state | 0.18 ms | 0.08 ms | 7.5 ms | 2.0 ms |
| Bytes per push (p50 / max) | 340 / 374 B | 340 / 374 B | 336 / 370 B | 336 / 370 B |
| Briefing rows in the event log | 2 of 320 | 0 | 15,533 of 50,000 (pruned to 1 per project at each start) | 0 |

The engine's replay of the log with its briefings moved out takes as long as the pruned log did (70 ms); the guide
leaving the log is about the log not growing, not boot. On the user's own log the move left the state the same key
by key (compared on a `/tmp` copy, and again on the 50k log), and the live server's first start of this version moved
2 briefing rows and wrote a snapshot at once.

Measured again on a 50k log generated afresh with the same script (its state is 20.4 MB, with more task activity
than the log above): the engine boots in 54 ms replaying the log and 21 ms from the snapshot (5 ms of it hashing
core's source); a real `shinsa engine` reaches `/api/health` in 443 ms on its first start (it replays, then writes the
snapshot 3 s later) and in 240 to 255 ms on the next starts, which boot from it. The first state on connect is
4.25 MB where the whole state is 20.3 MB: the runs are 0.73 MB of it without their prompts, and most of the rest is
the tasks' activity (2.36 MB, the last entries of each task). On a `/tmp` copy of the user's data the first state is
100 KB (the whole state 369 KB); the first start replays and writes a snapshot 3.0 s after boot, the next start reads
it, and `/api/health` answers `ok` with no problems in 209 to 216 ms.

- **The real server never wrote a snapshot.** `serve.ts` built its engine without a state version, so snapshots
  existed only in tests and the bench, and every start replayed the whole log. It now passes `resolveStateVersion()`.
  A snapshot that cannot be written is logged, never thrown (a test that stops a server after its folder is gone).
- **Runs went to the page with their prompts.** 90% of the first state was `run.prompt` and `run.rolePrompt` (about
  14 KB each), which the page read only to name a fix's focus. Runs now go without them, as `WireRun`s with the
  focus decided in core (`fixFocus`, `resolveFixFocus`); nothing on the page shows a prompt (a run's brief is the
  first entry of its transcript), so there is no route to read one.
- **The Home guide was an event.** Every rewrite of the guide added a `briefing.written` row that a later one made
  useless, pruned only at the next start. The guide now lives in its own table, changes the state without an event
  and reaches the page as a patch at the same log position; the first start moved the old rows out once
  (`docs/engine.md` → State in memory).

### What is left

- Accounts still go whole on every change (a few KB, deduplicated by content).
- The tasks' activity is now the largest part of the first state on a big log (2.36 MB of 4.25 MB on the 50k log).
- Spawn to `/api/health` is about 250 ms, almost all of it Bun loading the server's modules; the engine's part is
  now about 25 ms.

## Chat, overview, review and lists

How long the task page's content views (Chat, Overview, Review) and the long lists (Home's queue, All tasks) take to
paint, scroll and take a keystroke, on a production build in a real browser.

### How it is measured

- **Data.** `bun run seed` into a scratch folder, then `bun scripts/perf/content-seed.ts <data dir>`, which copies
  seeded tasks up to 300 and adds `perf-long-chat`: 60 runs of 40 entries each (2,400 entries), every run a brief,
  six interim messages, 15 tool calls (300-line reads, 200-line command output, 20-to-24-line edits) and a final
  markdown reply with a 12-line code fence and a task link; the last run is live. Second, the user's own data copied
  to `/tmp` (5 tasks, 19 runs; its chats are short, so it shows the floor, not the long-chat case).
- **The page.** `vite build` of the web app, served by `vite preview` against `shinsa engine` with `SHINSA_INSPECT=1`,
  in headless Chromium driven over the DevTools protocol by `bun scripts/perf/content-measure.ts <url>`
  (`content-cdp.ts`, `content-probe.ts`). Each scenario runs in three fresh browsers; the table shows the median.
  Navigation is the router's own `pushState`, timed to the frame after the content is in the DOM. Frames are
  `requestAnimationFrame` deltas while the chat scrolls up 150 frames of 160px. Typing is 41 keys into the composer
  while 20 transcript entries a second and a full state a second arrive on the page's own socket, timed from each
  key's input event to the next frame. Pushes dispatch a state or a transcript entry on the socket and time it to
  the next frame (so one frame, about 17 ms, is the floor). Long tasks come from the Long Tasks API.
- **Where the time goes.** `content-profile.ts` (a CPU profile of a navigation or a scroll on a build without minification:
  self time, and time inside each component) and `content-trace.ts` (a Chrome trace: script, style, layout, paint).
- **Machine.** An Apple silicon Mac, other agents' builds and tests running beside it.

### Before and after

| Measure (seeded, 300 tasks, 2,400-entry chat) | Before | After |
| --- | --- | --- |
| Open the long chat from Home: to paint | 75 ms | 54 ms |
| … longest task while it settles | 65 ms | none over 50 ms |
| Back to Chat after visiting Overview and Review | 181 ms | 31 ms |
| Back to Overview / Review | 51 / 17 ms | 19 / 17 ms |
| Scroll the chat up: longest frame | 63 ms | 28 ms |
| Scroll: p95 frame / frames over 17.5 ms of 150 | 18.3 ms / 27 | 18.5 ms / 26 |
| Scroll: time painting over the 150 frames (Chrome trace, second pass) | 242 ms | 160 ms |
| Type while the agent streams: slowest key to paint | 20 ms | 19 ms |
| A full state push, on the long chat, to paint | 37 ms (54 max) | 27 ms (31 max) |
| All tasks (300 tasks): to paint / longest task | 199 / 173 ms | 33 ms / none |
| Home (158 queue rows): to paint / longest task | 112 / 96 ms | 29 ms / none |
| DOM nodes with the long chat open | 23,158 | 9,586 (16 of 60 runs rendered) |

| Measure (the user's data) | Before | After |
| --- | --- | --- |
| Open the chat with most runs: to paint | 72 ms | 65 ms |
| Back to Chat / Overview / Review | 42 / 21 / 13 ms | 17 / 13 / 12 ms |

The tab switches also gain from the kept-alive tab views (Shell, navigation and global CSS). The push numbers ran
against the new state protocol (Server, protocol and state), where a push is a patch applied once per frame.

**Third pass: the scroll frame.** `content-probe.ts`'s scroll now also records each frame's own timestamp (the time
`requestAnimationFrame` hands its callback), not only `performance.now()` after the callback ran: the second is the
gap between two callbacks, which wobbles by a millisecond or two with where in the frame they ran, so an idle page
reads 16.8 to 17.6 ms on it. A frame that misses its vsync shows as 33 ms on the timestamp. Before is
`git archive HEAD` with its own seed and server, after the whole working tree; eight fresh browsers each, median:

| Scroll the long chat up, 150 frames of 160px | Before | After |
| --- | --- | --- |
| p95 frame (frame timestamps) | 16.7 ms | 16.7 ms |
| Longest frame (frame timestamps) | 66.6 ms | 16.8 ms |
| Frames that missed their vsync (over 20 ms) | 1 to 2 | 0 |
| p95 / longest gap between callbacks (the old measure) | 18.5 / 77.6 ms | 18.3 / 19.3 ms |
| Longest task | 54 ms | none |
| Paint / pre-paint / layerize over the scroll (Chrome trace, three each) | 166 to 180 / 60 / 35 to 38 ms | 61 to 66 / 33 to 35 / 23 to 25 ms |

Every frame of the scroll now lands on its vsync: 16.7 ms is the display's own period, so a p95 under it cannot be
measured; the 18 ms of the old measure is callback jitter, not a late frame. The trace row compares the after build
with and without `content-visibility` on runs (below); layout rose from 22 to 35 ms, as a run is laid out when it
comes into view.

### What changed and why

- **The chat renders its newest runs and grows upward.** `routes/task/chat.tsx` flattens the transcript into blocks
  (messages before the first run, round dividers, runs: `lib/chat/window.ts`) and renders the last eight;
  `hooks/use-transcript-window.ts` adds four older ones whenever the view is within three screens of the top (in a
  transition, so a click or a key is never queued behind it), keeps what you read in place by moving the scroll by
  the first block's shift, fills a short page before the first paint, and reaches back to a focused run
  (`?run=`, a delegation's chat run) before the jump. A run that is not rendered does not subscribe to its
  transcript, so opening a 60-run chat subscribes to about 16, not 60. Mounted blocks stay mounted, so a folded row
  you opened stays open.
- **Markdown is parsed once per text.** `components/text/markdown.tsx` caches the element tree per text
  (`lib/format/cache.ts`, 400 entries), and `useReferenceMarkdown` caches the linked text per reference catalog and
  scope and reads only the catalog and the route's task through `useShinsaSelector`, so a state push no longer
  renders every message. Core's title matching skips a task whose title is not in the text before building its
  pattern (`listTitleSpans` was 300 regular expressions per message with 300 tasks).
- **Code is highlighted where it shows, when the page is idle.** `CodeLines` highlights only the lines it shows (14 of
  a 300-line read until you ask for more); `useLanguageTokens` asks Shiki on `requestIdleCallback` and reads a block
  it already highlighted synchronously, so a remounted fence paints coloured at once.
- **Long lists render what is in view.** All tasks renders each group's rows in view of its scroller
  (`components/queue/windowed-rows.tsx`, `hooks/use-row-window.ts`, rows 36px, in chunks of eight so scrolling
  re-renders rarely; rows are memoized). Home's queue sections, the Overview's activity and an opened turn's detail
  render their first rows at once and the rest a batch per task after the paint (`hooks/use-progressive-count.ts`);
  queue rows are not one height, so they are not windowed.
- **Times format with shared `Intl.DateTimeFormat`s** (`lib/format/time.ts`; `toLocale*` built a formatter per
  call), and `TimeAgo` and `Duration` build their tooltip text only when the tooltip opens.
- **The scroll fade no longer repaints** (second pass). The `ScrollArea` fade was a mask on the scroller, which the
  browser repainted with the whole chat on every scroll frame. The mask now sits on a still box around the scroller
  and reads the scroll position through a named, scoped scroll timeline (`docs/design.md`, 6), so it is painted once
  and the content scrolls under it on the compositor: paint over the 150-frame scroll went from 242 to 160 ms (the
  same as with no fade at all, 152 to 169 ms; six traces each), and the fade looks the same at the top, middle and
  bottom of every scroller in both themes (screenshots compared pixel for pixel).
- **Images keep their place.** Thumbnails decode off the main thread and keep a 96px height before they load; an
  evidence image keeps a 16:10 box. `RunSection` is memoized.
- **Runs out of view are not painted, and the browser holds the place** (third pass). A run section is
  `content-visibility: auto` with a remembered size (`components/chat/run-section.tsx`), so the browser skips
  painting the runs above and below the screen, and where the browser anchors scrolling (`overflow-anchor`), the
  window leaves the scroll to it instead of moving it by the first block's shift in the commit
  (`resolveScrollShift`); the growth render then has no layout read and write of its own. Where anchoring is missing
  (Safari), neither applies and the shift is moved by hand as before. The reading position stays put on the way up
  (`holdPlace`: no jumps, at most 1px).

### What is left

- The scroll is at the display's rate (third pass above); what is left in it is script (about 160 ms of the 150
  frames, React's growth renders) and style (about 90 ms).
- Each row of All tasks and Home still measures its `Truncate`s; its hints, times and clipped text share the page's
  one tooltip, and its menus mount on first use (Shell and navigation).
- Hidden, kept-alive pages and tabs still render on every push, at low priority.
- The user's own data crashes the task page: a run with a role `RUN_ROLE` no longer knows (`operator`) makes
  `resolveCostFacts` read `undefined.name` (`lib/tasks/cost.ts`).

## Shell and navigation

Click to paint for every route switch (Home, a task and its tabs Overview, Review, Code and Chat, All tasks,
Settings), ⌘K, what a state push re-renders, and how fast the Mac app starts.

### How it is measured

- **Navigation.** `bun scripts/perf/shell-navigation.ts <origin>` opens the page in headless Chromium (Playwright's
  build, 1440 × 1000) over the DevTools protocol, with `scripts/perf/shell-probe.ts` installed before the app loads:
  a React DevTools hook that counts the components each commit rendered, a Long Tasks observer, and a timer per
  step. Each step hovers its target for 120 ms (real intent), clicks with a trusted mouse event, and measures from
  the click's `timeStamp` to the end of the frame in which the new view is in the DOM (for Code, the editor's
  lines); ⌘K is a trusted key press until the input exists. Six laps: lap 1 is the first visit, laps 2 to 6 are
  revisits. After the task, All tasks and Home steps it replays three state messages on the page's own socket (one
  task's priority flipped) and measures push to paint. `SHELL_PERF_TABS` picks the tabs (the real data has no
  Review tab and its worktrees were not copied, so it runs `Overview,Chat`), `SHELL_PERF_ATTACH=<port>` measures a
  running app instead of a fresh Chromium.
- **Start-up.** `bun scripts/perf/shell-startup.ts <app dir> <origin>` launches Electron on a built copy of
  `apps/desktop` (its own user data folder, never the installed app's) with `SHINSA_URL`, and reads from the page,
  relative to the moment of `spawn`: navigation start, the first paint, and Home's composer in the DOM. Run 1
  starts from an empty cache, the median is over the later runs.
- **Builds.** "Before" is `git archive HEAD` built on its own; "after" is the same tree with only this pass's files
  copied in, so other work in progress is in neither. Both were served by `shinsa engine` in inspect mode
  (`SHINSA_INSPECT=1`, `SHINSA_WEB_DIR`) from copies in `/tmp`: the seed (`~/.shinsa-seed`, 46 tasks) and the user's
  own data (`sqlite3 .backup`, 12 tasks). Numbers are medians in ms on an Apple silicon Mac with other agents'
  builds and tests running beside them; headless Chromium paints at 60 Hz, so about 10 ms is one frame and the
  floor of this measure.

### Before and after

Seed data, click to paint (median ms, and components rendered by that click):

| Step | First visit before | First visit after | Revisit before | Revisit after |
| --- | --- | --- | --- | --- |
| Home → task | 51.1 (1193) | 52.1 (1129) | 30.2 (1200) | 21.8 (170) |
| Overview → Review | 35.5 (2071) | 29.6 (1633) | 40.9 (2113) | 26.4 (947) |
| Review → Code | 66.6 (1657) | 65.6 (1236) | 36.3 (1657) | 37.6 (1021) |
| Code → Chat | 12.0 (310) | 17.3 (598) | 42.3 (2203) | 23.7 (623) |
| Chat → Overview | 30.8 (1131) | 17.3 (178) | 27.7 (1131) | 17.2 (178) |
| Task → Home | 32.5 (2825) | 17.9 (128) | 27.2 (2825) | 16.1 (128) |
| Home → All tasks | 45.0 (4374) | 23.4 (730) | 39.1 (4374) | 23.6 (731) |
| All tasks → Home | 31.8 (2825) | 18.6 (139) | 29.0 (2825) | 20.6 (139) |
| Home → Settings | 18.2 (322) | 9.1 (172) | 14.6 (322) | 10.5 (165) |
| Settings → Home | 33.6 (2825) | 16.4 (133) | 23.7 (2825) | 17.1 (133) |
| ⌘K opens | 25.3 (1059) | 21.9 (627) | 26.1 (1097) | 16.4 (647) |
| State push on Home | | | 17.5 (2672) | 16.5 (1721) |
| State push on All tasks | | | 19.5 (3639) | 19.8 (2778) |

Real data (revisits): Home → task 18.0 → 12.8, Overview → Chat 33.5 → 18.6, Task → Home 12.6 → 12.8, ⌘K 17.5 →
10.3; the rest was already within a frame or two and stays there. No step had a long task after its first visit,
before or after.

The Mac app, from launch (median of later launches, run 1 in brackets): navigation start 302 (335) before, 316
(338) after; first paint 394 (427) before, 424 (446) after; Home 447 (506) before, 479 (508) after. Repeated runs
moved by ±30 ms either way, so start-up did not measurably change: about 300 ms of it is Electron starting before
the page is asked for, and the page itself takes about 100 ms to first paint and 50 ms more to Home.

**Second pass: one shared tooltip.** Before is the tree as this pass found it, after is the same tree with only the
tooltip change (`packages/ui/src/components/tooltip.tsx`, `truncate.tsx`, `overlays/hint.tsx`, `text/time-ago.tsx`).
Seed data, revisits (laps 2 to 6), median of two runs of six laps, ms and components rendered:

| Step | Revisit before | Revisit after |
| --- | --- | --- |
| Home → task | 18.6 (169) | 18.0 (170) |
| Overview → Review | 22.0 (796) | 22.5 (624) |
| Review → Code | 25.4 (1002) | 24.4 (654) |
| Code → Chat | 14.4 (558) | 14.4 (385) |
| Chat → Overview | 14.1 (178) | 13.9 (156) |
| Task → Home | 15.3 (128) | 14.8 (179) |
| Home → All tasks | 19.1 (417) | 12.5 (180) |
| All tasks → Home | 16.1 (139) | 13.8 (95) |
| Home → Settings | 15.6 (170) | 12.7 (169) |
| Settings → Home | 14.9 (133) | 14.7 (119) |
| ⌘K opens | 20.3 (647) | 18.4 (647) |
| State push on a task | 10.3 (2235) | 8.1 (1504) |
| State push on All tasks | 7.7 (1426) | 5.6 (742) |
| State push on Home | 22.8 (1726) | 16.0 (884) |

First visits: Home → task 978 → 692 components, Overview → Review 1,301 → 979, Review → Code 1,205 → 784, Home →
All tasks 420 → 185; the times stay within a frame. Task → Home counts 51 more components after because the hidden
Home's reveal renders (29 `MarkdownWithReferences`, the tab lists) now land inside the measured window instead of the
frame after it; counted over the whole step and the frame after (one run), it went from 212 to 179. The page's JS
heap (below) went from 28.3 to 20.0 MB.

**Third pass: menus on first use, an instant press.** Seed data, a production build of the whole working tree; each
before is that tree with only the one change taken out.

| Measure | Before | After |
| --- | --- | --- |
| Task page's JS heap (`/tasks/SMP-2`, 8 s, three forced collections; three runs) | 18.4 MB | 16.5 MB |
| Kit button press, frames until the fill's inset settles (three runs) | 9 (a 150 ms transition) | 0 |
| Kit button release, frames until it settles | 9 | 0 |

With everyone's changes of the day, revisits (laps 2 to 6) now read: Overview → Review 21.8 ms (624 components),
Review → Code 27.4 ms (414), Code → Chat 16.1 ms (286), Home → All tasks 11.3 ms (134); Review renders the 624 it
did after the shared tooltip, against 947 before the kept pages and 796 before the shared tooltip.

### What changed and why

- **Leaving a page threw it away.** Every route switch unmounted the page and the next visit built it again: Home
  is 2,800 components, All tasks 4,400, and building them was most of each click. Pages you have been to now stay
  mounted in React's `Activity` (Home, All tasks, Settings and the last three tasks), hidden with `display: none`,
  and a task keeps its tabs the same way (`docs/design.md`, 35). Showing a kept page re-renders only what changed:
  130 to 170 components instead of 2,800.
- **The first visit built the page too.** Once the browser is idle, Home, All tasks and Settings and a task's
  other tabs render hidden, so the first click on them is a reveal (All tasks 45 → 23 ms on its first visit).
- **A memo has to see the same props.** The kept pages are `React.memo` on their state and route (compared by
  value: the router makes a new route object per visit), and a tab on the fields it reads, so showing one does not
  render the rest of the task again. A first version scoped the URL hooks of hidden pages through context, which
  made every `useRoute` and `useSearchParam` consumer (every task reference link) re-render on each reveal; it was
  dropped, and hidden pages read the live URL with their effects off.
- **Hidden pages would follow every push.** They get the state as of the last idle moment (`useIdleValue`), so a
  burst of pushes renders them once, at idle, not once per push.
- **Every truncated label carried a tooltip.** `Truncate` rendered a tooltip provider, root, trigger and content
  for every label, clipped or not: about six components per row. It now renders the bare span until the text is
  cut off, which took ⌘K from 1,097 to 647 components and Home's push from 2,672 to 1,721.
- **Every hint, time and clipped label was a tooltip of its own** (second pass). Each mounted a Base UI provider,
  root, trigger, portal and content, with their contexts, stores and effects: about 370 of them on a task page with
  Home and All tasks kept, 4,000 of its 11,700 fibers. `Activity` re-runs those effects when a page or tab shows, and
  they re-rendered the tooltip. Now the outermost `TooltipProvider` mounts one tooltip for the page and listens for
  hover, focus, taps and Escape on the document; a trigger is its own element, registered by a ref and marked
  `data-tooltip-trigger`, and what it shows is read only when it opens (`docs/design.md`, 13). Revealing Review
  renders 624 components instead of 796, Code 654 instead of 1,002, Chat 385 instead of 558, All tasks 180 instead
  of 417, and a push on All tasks 742 instead of 1,426. A clipped `Truncate` also keeps the same span when it gains
  its tooltip, so its observers stay on the live element (two clipped task lines on Home had lost their tooltip that
  way).
- **Hover and highlight trailed the pointer.** Washes and text colours eased over 150 ms and menu highlights slid
  over 180 ms; they now land in the frame of the hover (`docs/design.md` → Motion). This is felt, not measured
  here.
- **Every row of All tasks mounted two menus** (third pass). A row's context menu and its chain arrow's dropdown
  were Base UI roots with their stores, positioners and effects, for menus almost never opened. `LazyMenu`
  (`components/controls/lazy-menu.tsx`, `hooks/use-lazy-menu.ts`) renders only the trigger, with the closed menu's
  attributes, until a right click, a long press (500 ms, cancelled by a 10px move), a click or an arrow key asks for
  it; then it mounts the menu and replays that event on the trigger, so the menu opens where and how it was asked.
- **A press eased over 150 ms** (third pass). The kit `Button`'s fill deflated, and its colour, opacity and the link
  button's scale changed, through 150 ms transitions, so a quick click showed half a press. All of it now changes in
  the frame of the press, as hover does (`docs/design.md` → Motion).
- **Start-up.** The first health check now leaves before Electron is ready, V8 keeps a code cache from the first
  run (`v8CacheOptions: 'bypassHeatCheck'`), and `shinsa engine` sends hashed assets as immutable and the page as
  `no-cache`, so a relaunch reads the bundle from disk instead of downloading 1.6 MB again. None of it showed above
  the noise of a launch on this machine.

### What is left

- **Revealing Review still renders about 620 components** and Code about 650: what is left is the tabs' own effects
  and the markdown they re-render.
- **The Code tab rebuilds its editor on each reveal** (its view is made in a layout effect), about 35 ms.
- **The first visit to a task** (about 50 ms, 1,100 components) is still a full build: nothing renders a task page
  before you open it. Rendering the task under the pointer after a short hover would make it a reveal.
- **A push re-renders the visible page.** Home renders 1,700 components for a change to one task; the lists are the
  rendering pass's.
- **Start-up** is mostly Electron's own boot and the 1.6 MB main bundle (React DOM, Base UI, the icon paths and
  motion are 70% of it).

**The task page's heap.** `scripts/perf/code-tab.ts` read 28.5 MB on SMP-2 after its file opens, against 16.7 MB for
a tree with only the Code tab's changes. Heap snapshots (CDP `HeapProfiler`, three forced collections first) of the
task page put the difference in React fibers and their props and hook state: 12,230 `FiberNode`s against about
3,000, 250,000 plain objects against 53,000, and 4,218 elements against 865. Nothing in it was an unbounded cache:
strings grew by 170 KB, the markdown cache holds 400 entries, and after fourteen more task visits the three-task
limit holds (the 3.3 MB that grows is code loaded once: the Settings chunk, the Code tab and its grammar). It is the
kept pages (`docs/design.md`, 35) and, inside them, the per-element tooltips: Home kept 3,175 fibers, All tasks
rendered ahead 4,647, Settings 397, the visible task 1,800 and its hidden Review and Chat tabs 1,585, and 373 tooltip
roots with 121 providers were about a third of all of them. One shared tooltip takes the page to 20.0 MB
(code-tab.ts 28.5 → 20.2 MB, three runs of the page alone 28.3 → 20.0 MB). Of what is left above the old 16.7 MB,
All tasks and Settings rendered ahead are 3.3 MB and the hidden tabs 0.6 MB (measured by builds without them, which
are not shipped); a task page with only Home kept is 16.0 MB. Both stay, for the instant first visit
(`docs/design.md`, 35).

With the rest of the day's changes the same page read 18.4 MB, and mounting All tasks' row menus on first use (third
pass above) takes it to 16.5 MB, under the 16.7 MB of the Code tab's changes alone, with every page still kept and
rendered ahead. After twenty Code tab opens, `code-tab.ts` reads 17.0 MB.

## Code tab

Opening a file, expanding and scrolling the file tree, hover and selection feedback, and highlighting, on the seed
and on two large repositories.

### How it is measured

- **Data.** Three tasks. `SMP-2` from `bun run seed` (1,255 files, opening the TypeScript files of
  `packages/core/src/decide`); `SW-6` on a throwaway clone of paywall-next (`/Users/christo/Developer/Superwall/pwn`,
  12,950 files, `main` 400 commits back, opening the 21 TSX files of an integrations route folder, then a 475 KB, a
  711 KB and an 890 KB file); and a synthetic 100,000-file repository (100 packages × 100 folders × 10 files, plus a
  50,000-line file). `bun scripts/perf/code-seed.ts <seed dir> <paywall-next checkout>` turns a `bun run seed` copy
  into the second and third (it clones, never touches the original).
- **The bench.** `bun scripts/perf/code-tab.ts --base <server> --task <handle> --folder <dir> --tree <folders>
  [--files <paths>]` drives headless Chrome over the DevTools protocol (`scripts/perf/code-cdp.ts`, the page side in
  `code-probe.ts`), at 1280 × 900, against a production build served by an inspect-mode `shinsa engine` on a copy of
  the seed. It presses tree rows with real mouse events: **cold** is a file nothing has read (no hover, not next to an
  open file), **warm** a file opened before, **prefetched** a file hovered for 400 ms first. **Work** is the User
  Timing measure from the press to the editor's commit (`shinsa:code-open` → `shinsa:code-shown`, only in the new
  build); **visible** is the animation frame in which the file's text is in a visible editor, from the press, so it
  includes waiting for the next frame (input lands late in a frame here, so one frame reads as 8 to 16 ms);
  **highlighted** the frame in which its first lines carry token colours. Hover and selection count the frames
  between the event and the row's final background (`getComputedStyle` every frame). A folder is expanded with and
  without a 400 ms hover and collapsed again; then 6 to 12 folders are opened and the tree scrolled 700 px a frame,
  240 frames, for the frame gaps and long tasks. The JS heap is `Runtime.getHeapUsage` after three forced
  collections. Each number is the median of two runs. The before build is `git archive HEAD` of this pass's starting
  point with its own server; for the heap the after build is that same starting point with only this pass's web
  changes, because the other agents' changes of the same day moved the page's heap on their own.
- **Machine.** Apple M4 Pro, Chrome 152 headless, Bun 1.4.4, other work running beside it.

### Before and after

| Measure | SMP-2 before | SMP-2 after | paywall-next before | paywall-next after | 100k files before | 100k files after |
| --- | --- | --- | --- | --- | --- | --- |
| Open a cold file: work | | 15 ms | | 11 ms | | 12 ms |
| Open a cold file: visible | 49 ms | 31 ms | 70 ms | 24 ms | 71 ms | 26 ms |
| Open a cold file: highlighted | 49 ms | 40 ms | 70 ms | 29 ms | 71 ms | 26 ms |
| Open a warm file: work | | 6.3 ms | | 6.8 ms | | 3.4 ms |
| Open a warm file: visible and highlighted | 49 ms | 14 ms | 45 ms | 8 ms | 46 ms | 11 ms |
| Open a prefetched (hovered) file: work | | 4.3 ms | | 4.5 ms | | 3.1 ms |
| Open a prefetched file: visible and highlighted | 48 ms | 12 ms | 69 ms | 8 ms | 70 ms | 9 ms |
| Hover background: frames of transition | 6 | 0 | 6 to 7 | 0 | 7 | 0 |
| Selected background: frames of transition | 2 to 3 | 0 | 2 | 0 | 2 | 0 |
| Expand a folder (no hover): work / visible | — / 40 ms | 2.2 / 13 ms | — / 46 ms | 4.2 / 12 ms | — / 47 ms | 3.5 / 13 ms |
| Expand a hovered folder: work / visible | — / 39 ms | 2.4 / 12 ms | — / 46 ms | 4.1 / 10 ms | — / 46 ms | 3.6 / 11 ms |
| Collapse a folder: work / visible | — / 15 ms | 2.0 / 14 ms | — / 15 ms | 4.2 / 15 ms | — / 15 ms | 3.8 / 15 ms |
| Scroll the tree (frame gap p95 / max, long tasks) | 17 / 17 ms, 0 | 17 / 17 ms, 0 | 17 / 17 ms, 0 | 17 / 17 ms, 0 | 17 / 17 ms, 0 | 17 / 17 ms, 0 |
| Long tasks over 50 ms while opening files | 0 | 0 | 0 | 0 | 0 | 0 |
| JS heap after 20 opens | 15.3 MB | 14.1 MB | | | | |

The JS heap row is the Code tab's own change; with the whole tree of the same day the page read 28.5 MB, and 20.2 MB
once the page's tooltips were shared (Shell and navigation → the task page's heap).

Large files on paywall-next, opened by URL (visible / highlighted; no long task before or after, and a 2,000 px a
frame scroll keeps a 17 ms frame gap):

| File | Before | After |
| --- | --- | --- |
| `Organization.ts`, 475 KB | 77 / 77 ms | 15 / 32 ms |
| `schema.d.ts`, 711 KB | 72 / 72 ms | 17 / 34 ms |
| `v3-api-contracts.json`, 890 KB | 86 / 86 ms | 20 / 28 ms |
| `AGENTS.md`, 4 KB | 66 / 66 ms | 22 / 31 ms |

A folder is expanded 2 s after the tree appears, by which time the Files tree has read the closed folders in view; a
folder clicked before that (or beyond the 64 read ahead) costs one server read and one frame more: about 18 ms of work
and 30 ms to the frame.

Server, one cold read on paywall-next (curl): a `blob` took about 40 ms before (three `git` processes) and 1 to 2 ms
after (the long-lived `git cat-file --batch-command`); a folder about 27 ms before and 2 to 10 ms after (its tree
object through the same reader), then from the cache. Switching changed files in Changes mode (side by side, a new merge view each time): 5 to 8 ms of work, up to
21 ms for the first and largest.

**Third pass: one merge view, and Better Comments.** `code-tab.ts --changes apps --switches 8` on SMP-2 opens the
task's five changed code files side by side and presses each in turn, hovered 400 ms first, three times over; the
first pass is each file's first side-by-side view, the second and third are revisits. Two runs each; before is the
same tree building a new `MergeView` per file (what the session did before this pass).

| Switch files side by side | Before | After |
| --- | --- | --- |
| First view of a file: work, median (max) | 10.3 to 11.1 ms (20.2) | 5.3 to 6.9 ms (9.5) |
| A file seen before: work, median (max) | 10.4 to 10.5 ms (18.2) | 4.3 to 4.6 ms (9.6) |
| Visible, median | 6.3 to 8.6 ms | 8.4 to 10.9 ms |
| Long tasks | 0 | 0 |

Visible is the frame the text shows in, so both sit within the frame after the press (8 to 16 ms here); the
difference is noise of where the press lands in a frame. Colouring Better Comments' tags in the worker costs nothing
measurable: opening the decide folder's files with and without the tagging (two runs each) gives the same work
(12.8 to 15.4 ms cold, 7.0 to 8.1 ms warm) and the same frames to colour.

**Fourth pass: the pair built on hover.** Same bench and seed (a fresh `bun run seed`), seven runs each, before and
after alternating, on production builds that differ only in this change (before builds no pair ahead). The machine
was busier than in the third pass, so every median sits higher and drifts from run to run; the difference within a
run (a file's first view against the revisits of the same run) is what the change moves.

| Switch files side by side | Before | After |
| --- | --- | --- |
| First view: work, median of the runs (range) | 12.0 ms (4.6 to 13.2) | 12.1 ms (4.4 to 12.5) |
| Revisit: work, median of the runs (range) | 11.0 ms (6.7 to 11.7) | 10.6 ms (7.4 to 12.0) |
| First view less revisit, within a run: median | +1.6 ms | +0.3 ms |
| First view: the slowest press, range over the runs | 10.3 to 23.6 ms | 8.5 to 19.1 ms |
| Long tasks | 0 | 0 |

Timed inside the page (a build with `performance.now()` around the step, eight files hovered 400 ms and pressed in
turn): building a pair took 1.1 to 2.9 ms; on a press after the hover, finding the pair took 0.0 to 0.2 ms, against
2.4 ms for the one file nothing had read ahead. The heap after the run is unchanged (20.0 to 20.1 MB before, 20.4 to
20.6 MB after: the extra pairs of the files hovered and of the open file's neighbours, within the 24 kept).

### What changed and why

- **The click was three frames of waiting.** A file row opened on the click, then the editor pane mounted, waited a
  microtask for its language, built the editor in a `setTimeout`, coloured it in another and kept it hidden until
  CodeMirror had measured: about 40 ms with everything cached. Now a row acts on the mouse press, the one editor
  view swaps in the file's state (or a new one, built synchronously), and its language joins when the browser is
  idle; the frame after the press shows the file (`EditorSession`, `lib/code/editor/session.ts`).
- **Files and folders are read before you click them.** A hovered (40 ms) or focused row reads its file and has the
  worker tokenize it; opening a file reads its neighbours when the browser is idle; the Files tree reads the closed
  folders in view when idle, and a folder not read yet opens in the render its rows arrive in; the press itself
  starts the read before React renders; and the Code tab's read hooks subscribe in a layout effect, so an answer that
  lands before the first paint is not held for a frame.
- **A cold read was three processes.** The server now asks one long-lived `git cat-file --batch-command` per
  repository for a file's or a folder's object and its contents, remembers every commit it has checked, and caches
  folders by commit.
- **Highlighting moved off the main thread.** VS Code's TextMate grammars run in a worker, a slice at a time, with
  the file on screen ahead of prefetching and a prefetch of the same text joined rather than repeated; the editor
  shows plain text at once and the visible lines' tokens as classes. Lezer no longer parses for colour, so a large
  file opens in about 15 to 20 ms instead of 70 to 90 ms, and its colours follow within about 15 ms.
- **Nothing in the Code tab animates.** The tree rows' hover and selection, the indent guides, the chevrons and the
  kit's buttons inside the workbench change in the frame they are asked to (`INSTANT` in `workbench.tsx`).
- **⌘P ranked every path on every render.** Quick open, closed, recomputed its ranking whenever the workbench
  rendered (each file switch), over every path of the repository; it now ranks only while open.
- **Side by side built a new merge view per file** (third pass). `MergeView` takes its documents only when it is
  made, so each switch built two editors, their DOM and gutters. Now one `SplitView` (`lib/code/editor/merge.ts`)
  keeps the merge view and swaps a pair of editor states into its two editors, with the diff's chunks set on it;
  each file's pair is kept (24, least recently used first out) with its scroll position, so a revisit is two
  `setState`s. The states are made with the merge view's own extensions read from its first state
  (`findConfigBase`), which throws if CodeMirror stops keeping them there, rather than silently losing the diff.
- **A side-by-side pair is built while its row is hovered** (fourth pass). The read on hover (and of the open
  file's neighbours at idle) now hands both sides of a changed file, once read, to the editor session at idle
  (`prefetchPair` in `lib/code/prefetch.ts`, `EditorSession.prefetchPair`), which builds its pair of editor states
  under the key the pane will show it with (`resolvePaneKey`), so the press finds it as on a revisit. Only in side
  by side, only for a file with both sides that the pane would show (not one too large, binary or held back), and
  never the file on screen; building a pair swaps the merge view's chunks in for the states' creation and back, so
  the shown pair is untouched, and the pair on screen is never the one dropped past the 24 kept.
- **Better Comments** (third pass). A comment that starts with `!`, `?`, `TODO`, `*` or a second `//` (after its
  marker, or the margin star of a doc comment) takes `--code-comment-alert`, `-query`, `-todo`, `-highlight` or
  `-strike` (`apps/web/src/app.css`), as the user's VS Code extension (aaron-bond.better-comments) does, from the
  tag to the end of the line. One scanner (`lib/code/comment-tags.ts`) runs on the comment tokens of the editor's
  worker (`textmate.ts`) and of the chat's Shiki fences (`highlight.ts`), so both colour the same lines; a `#!`
  first line is left alone.

### What is left

- **A folder not read ahead still waits for the server and a frame** (about 18 ms of work, 30 ms to the frame): a
  fetch's answer reaches the page a frame later than it arrives. Building the tree from the paths list ⌘P already
  reads would remove that wait too, at the cost of folder kinds (symlinks, submodules).
- **A side-by-side file pressed without a hover** (a ⌘P pick, a review spot, the first file of a task) still builds
  its pair on the press, 1 to 3 ms of the open's work.
- **Visible is bounded by the frame.** Work is 3 to 7 ms for a warm file; what remains is the wait for the next
  frame, which no change in the page can remove.

## Loading states

Whether any spinner, skeleton or "Reading…" line shows while you use the app (`docs/design.md`, 36): on Home, a task
and each of its tabs, the Code tab's trees, ⌘P, the ref picker and search, All tasks and Settings.

### How it is measured

- **The walk.** `bun scripts/perf/loading-walk.ts <origin>` opens headless Chromium (`shell-cdp.ts`) at 1440 and 900
  px wide, with `scripts/perf/loading-probe.ts` installed before the app loads, and walks: Home → All tasks → a
  task (by its row, or ⌘K when the row is not on screen) → Overview, Review, Code, Chat → in Code: three changed
  files from the tree, Files, a folder, three files from the tree, Changes, ⌘P with a query and Enter, the ref
  picker (Base, Working copy, Head of the branch), ⇧⌘F and a search, a match → back to Overview, Home → Settings
  → Home. Every press is a trusted mouse event after a 120 ms hover; each step settles for 700 ms. It does this
  for two tasks with changes (`LOADING_WALK_TASKS`, `LOADING_WALK_HANDLES`, `LOADING_WALK_WIDTHS`).
- **What counts.** On every frame and every DOM change the probe records any visible `[data-loading-state]`, any
  `Spinner` outside a button and the progress track, and any text that starts with Reading, Loading, Opening or
  Searching and ends with "…" (outside the editor, inputs and the agents' shimmering lines), with when it showed
  and for how long. `[data-loading-pending]` (a wait inside its first 300 ms, drawn empty) is listed as "blank".
  The walk fails (exit 1) when anything but a blank or a step marked cold (the ⌘P pick, the first search) showed.
  `LOADING_WALK_WARM_UP=1` walks without failing (it prints what showed and exits 0).
- **In CI.** The `loading` job of `.github/workflows/test.yml` builds the web app in production mode
  (`NODE_ENV=production`, `vite build --mode production`), serves a fresh seed under `SHINSA_INSPECT` and fails
  with the server's log when it is not healthy within 120 s, walks once at 1440 px as a warm-up (the server's git
  readers and caches, the OS's file cache and Bun's JIT are cold on a fresh runner, which is not normal use), then
  walks at 1440 and 900 px for the verdict, once more if that walk fails. The rule is the same on both checked
  walks; the retry absorbs a runner stalling, not a loading state that shows each time. Run it locally the same
  way: `NODE_ENV=production bun run --cwd apps/web build --mode production`, seed to a scratch directory, serve it
  on a free port, then the warm-up and the checked walk.
- **Data.** A fresh `bun run seed` copy and a copy of the user's own data (`sqlite3 .backup`, 318 events, tasks
  with no changes, so its Code tab is Files only), each served by an inspect-mode `shinsa engine` from a
  production build: "before" is the tree as this pass found it, "after" the same tree with this pass. Apple M4
  Pro, Chrome for Testing headless, other agents' builds running beside it.

### Inventory, before and after

| Loading state | Where | Before (seed and real data) | After |
| --- | --- | --- | --- |
| Full-page spinner before the first state | `root.tsx` (`Loading`) | every load and reload, 41 to 67 ms | blank page for that time; the spinner only after 300 ms (a slow server) |
| "Opening the code…" (the Code tab's chunk) | `routes/task/lazy-code.tsx` | first Code click on a task, 14 to 52 ms | never: the chunk loads when a task row is hovered, highlighted in ⌘K, or at idle |
| "Reading the code…" (the refs) | `routes/task/code.tsx` | first Code click after another task, 7 to 14 ms (the hidden tab kept its first "loading" snapshot) | never: a read settled while the tab was hidden shows at once, and refs are read ahead |
| "Reading the changes…" (the explorer's diff) | `components/code/explorer.tsx` | not seen (prefetched since the Code tab pass) | never; after 300 ms for a cold diff |
| "Reading the files…" (the Files tree) | `components/code/file-tree.tsx` | Changes → Files with a file open in a folder, 5 to 24 ms | never: the folders above an opened file and above the first file are read ahead |
| "Opening ‹path›…" (the editor's read or chunk) | `components/code/editor-pane.tsx` | each ref switch, 2 to 5 ms; opening a search match, 9 to 23 ms; a ⌘P pick, 16 to 30 ms | never: the open file at the other refs, a hovered match and ⌘P's top match are read ahead; a never-read file after 300 ms |
| "Reading the files" (⌘P's paths) | `components/code/quick-open.tsx` | not seen | never: the paths are read with the tab's prefetch; after 300 ms otherwise |
| "Searching" (and the results blanked) | `components/code/search-panel.tsx` | every search, 19 to 46 ms | the last results stay; a cold search is blank for 20 to 50 ms, the line only after 300 ms |
| "Reading the changes" (the Review tab without a report) | `routes/task/review.tsx` | not seen | never in the walk; after 300 ms |
| "Loading the changes…" (the diff view's chunk) | `components/text/code-diff.tsx` | first Review visit, 7 to 9 ms (a `React.lazy` boundary) | never: no `Suspense`; the chunk loads at idle on a task with a review and on hover |
| "Loading…" (a review snippet's lines) | `components/text/change-snippet.tsx` | first Review visit, 3 to 30 ms | never: the snippet uses the task diff's patch, and its file is read ahead (8 per task); "Reading the lines" after 300 ms |
| "Loading…" (text evidence) | `components/overview/evidence-item.tsx` | each time its card mounted (not in the walk) | kept once read (32 texts); "Reading the evidence" after 300 ms |
| "Checking the versions…", the integrations' first read | `components/settings/versions.tsx`, `integrations.tsx` | first Settings visit, until `/api/versions` and `/api/extensions` answer (not seen on these machines) | read at idle after start |
| A task's chat, empty until its transcript arrives | `routes/task/chat.tsx` (no indicator) | first Chat visit, one frame or more | the last two runs' transcripts are read on hover and at idle on the task page |
| Setup's first read | `routes/onboarding.tsx` | while `/api/onboarding/flow` answers | after 300 ms |
| Sign-in's wait for Claude | `components/accounts/sign-in-dialog.tsx` | until the sign-in starts | after 300 ms (the work is Claude's) |
| `/ui`'s chunk | `root.tsx` (`Suspense`) | the catalog page only | after 300 ms |

Walk totals (both widths, two tasks each): on the seed, 28 loading states showed before, 21 of them in steps
that must never show one; after, none showed (six blanks under 300 ms: the first state and the cold searches). On
the real data, 18 before (9 not allowed), none after. The page's JS heap after the walk, after three forced
collections, stays at about 26 MB on the seed (25.9 before, 26.1 after) and 19.7 MB on the real data.

Not loading states, and unchanged: a busy `Button` (an action you started), the live agent's shimmering lines
("Delivering", a running tool, "Waiting for the result…"), "Working out
the steps" on the progress track, and an update's toast.

### What changed and why

- **Reads ahead of the click.** Hovering a task anywhere (any row with its handle, a task reference) for 40 ms, or
  highlighting it in ⌘K, reads its Code tab (refs, diff summary, root folder, ⌘P's paths, the first file and its
  folders), its review snippets, the diff view's chunk and its last two transcripts (`routes/task/prefetch.tsx`,
  `lib/tasks/prefetch.ts`, `lib/chat/prefetch.ts`). At idle the first four tasks of the queue get the code reads,
  and Settings' versions and integrations are read once. Inside the Code tab, the open file at the other refs, the
  folders above it, ⌘P's top match and a hovered search match are read when the browser is idle or on hover.
- **A hidden tab rendered "loading" forever.** A tab rendered ahead (35) runs no effects, so its first render's
  snapshot of a read ("loading") stayed until its effect ran after the reveal, one frame later, even when the read
  had settled meanwhile. `useCodeRead` now checks the cache when its own snapshot is still loading.
- **Stale while revalidate.** A read whose version moved (a working-copy read after a task update, the refs after
  a push) shows its last answer at once and updates in place; a search keeps the last results while the next one
  runs.
- **Bounded.** The code reads' cache is least recently used, not first in, at 300 reads (`CODE_READ_LIMIT`), the
  finished searches 20, the evidence texts 32. The socket (`lib/connection/socket.ts`) keeps every transcript a chat
  follows and the 24 others read or let go of last (`TRANSCRIPT_CACHE_LIMIT`), so the two read per hovered task no
  longer pile up for the page's life; a hidden kept chat lets go of its run, which counts as a read, so it is the
  last to be dropped.
- **A wait never flashes.** Every remaining wait draws nothing for 300 ms (`useDelayed`), then its spinner.

### What is left

- **The first state after a reload** is 40 to 70 ms of blank page: it is the socket's first message.
- **A cold search** is 20 to 50 ms of blank results, and a file opened from ⌘P that is not the top match, or from a
  path typed nowhere else, waits for its read (blank under 300 ms).
- **Idle reads cost the server git work**: four tasks' refs, diff, root folder, paths and first file after each
  change to the queue's top (the server caches them by commit, so a repeat is cheap).
