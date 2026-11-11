---
name: evidence
description: How to prove user-facing work in Shinsa before the human reviews it: a before and after comparison of each view you changed at the right widths and themes, a short recording for behaviour, simulator captures for iOS, and the focused test run for logic. Use whenever your change is visible to a user, and as the reviewer when the evidence is missing or doubtful.
---

# Evidence

The human reviews the evidence before the diff, in the review's Evidence section, as items, each with its kind: a
comparison (one view before and after, or in light and dark) side by side, a recording that plays in the image viewer,
a screenshot, a test or check run as the result and output of the check Shinsa ran, a note. "4 pieces of evidence" counts items, not files: a before and
its after are one comparison, and so are a view's light and dark shots. Without it they have to run your change
themselves, which is the work Shinsa exists to save. Attach every item with `attach_evidence`; Shinsa copies the files
into its own store (`<data>/evidence/<task id>/round-<n>/`), so a file you leave in `/tmp` is fine.

## Which kind

| The change | Attach | Kind |
|---|---|---|
| A screen looks different | A comparison of each view you changed, the same view before and after, at 1280px and 390px wide, light and dark | `comparison` |
| One view in several states (empty, loading, error, filled) | One comparison with a part per state, each named by its `label` | `comparison` |
| Something moves or responds (a menu, a drag, a scroll, a form) | A recording of the flow, 5 to 20 seconds, at 1280px | `recording` |
| A new screen with nothing before it | Per width, its light and dark as one comparison, parts labelled `Light` and `Dark` | `comparison` |
| One view in light and dark | One comparison, never two screenshots: a part per theme, labelled `Light` and `Dark` | `comparison` |
| Logic, an API, a script | The focused test that fails without your change and passes with it, as a check you link | `test` |
| What a run cannot show (a failing run before the fix, a manual check, a measurement) | A short note in markdown | `note` |
| A preview deployment exists | Its URL | `preview` |
| The project has a service that shows the change (its dev server) | Its local preview: the URL `run_service` reports, with the path to the screen | `preview` |

Skip a width or a theme only when it cannot differ (a command's output has no theme), and say so in `detail`. A
comparison counts as the screenshots (or recordings) a plan asks for.

## Fill the fields

- `title`: what it shows: "Settings, appearance section". Never a file name.
- `width`, `theme`: the viewport width in CSS pixels (1280, never the file's 2560), and `light` or `dark`. Shinsa
  shows a shot at that width, so a 2x file stays sharp.
- `detail`: what to look at, in one sentence: "The muted labels now pass 4.5:1 contrast."
- A comparison takes `parts`, two to six files in order, each with its `path` and a `stage` (`before`, `after`) or a
  short `label` ("Empty", "Loading", "Light", "Dark"):

  ```json
  { "kind": "comparison", "title": "Settings, appearance section", "width": 1280, "theme": "dark",
    "parts": [{ "path": "/tmp/evidence/settings-before.png", "stage": "before" },
              { "path": "/tmp/evidence/settings-after.png", "stage": "after" }] }
  ```

  Light and dark shots of one view are one comparison too, a part per theme named by its `label`, with no `theme`
  on the comparison (the labels say it):

  ```json
  { "kind": "comparison", "title": "Review tab, a finding with its fix", "width": 1280,
    "parts": [{ "path": "/tmp/evidence/review-light.png", "label": "Light" },
              { "path": "/tmp/evidence/review-dark.png", "label": "Dark" }] }
  ```

  You take the before shot before you edit, so you may attach it on its own then (`kind: "screenshot"`,
  `stage: "before"`) and its after later with the same `key` (`stage: "after"`): Shinsa shows the two as one
  comparison.
- Give every item a `key` for what it shows (`settings-dark-900`); without one its title, width and theme are its key.
  Evidence shows the work as it is now: when a later change alters a view, attach it again with the same key and it
  replaces the earlier item (a new after keeps its before). Remove an item that no longer applies with
  `remove_evidence` and a reason. The human sees only the current items; the old ones fold under Earlier versions.
- A `test` or `check` takes only `check`, the id of one of the task's checks (`c1`, as `read_task` lists them), and
  an optional `detail`: `{ "kind": "test", "check": "c2", "detail": "Fails before the fix with the empty name." }`.
  Shinsa shows that check's result and the output of its last run; never paste test output.
- Every other kind takes exactly one source: `path` for a file (absolute, or relative to the worktree), `text` for a
  note, `url` for a preview.
- A note is markdown, rendered as it is in the chat: lists, code, links. Put measurements in a table, one row per
  thing measured, and link the file you changed with a reference (`[theme.css](shinsa://file/src/theme.css#L12-L16)`)
  so the human can open it. A test or check run is a linked check, never a note.

  ```md
  | Token | Before | After | Needs |
  | --- | --- | --- | --- |
  | Hint text (`--muted`) | 2.6:1 | 6.9:1 | 4.5:1 |
  | Borders (`--border`) | 1.2:1 | 1.6:1 | none, decorative |
  ```

## Web UI

1. Start the app the way the repository says (its CLAUDE.md, README, package scripts), on a free port, with its own
   data or seed if it has one. Never stop or reuse a server you did not start, and stop yours when you are done.
2. **Before shots first.** Capture the before shots before you edit anything a user sees. If you already changed the
   code, capture them from a scratch checkout of the base: `git worktree add --detach /tmp/before <base commit>`,
   install, run it on another port, capture, then `git worktree remove /tmp/before`.
3. Capture at a device scale factor of 2: the human reviews on a Retina screen, where a shot with one pixel per CSS
   pixel looks soft. A 1280px wide view is a 2560px wide file. Your project's shared browser already renders at that
   scale, and so does the Playwright MCP when your task has no project; take its screenshots with `scale: "device"`
   (its default, `"css"`, halves them again). On the command line pass `--device="Desktop Chrome HiDPI"` with your
   `--viewport-size`; in a script set `deviceScaleFactor: 2` on every page and context.
4. Capture with the browser tools you have (the Playwright MCP tools), or the Playwright command line for a single
   page. Your browser tools open pages in your project's shared browser (The shared browser, below), which runs
   headless and may already be signed in. Every browser you start yourself runs headless too: the human works on this
   machine, and a window that opens takes their screen. In a script, launch with `headless: true`, never with
   `headless: false` or `--headed`, and never open a page with `open` or in a desktop browser.

   ```sh
   bunx playwright screenshot --device="Desktop Chrome HiDPI" --viewport-size=1280,800 --color-scheme=dark \
     --wait-for-timeout=500 http://localhost:5900/settings /tmp/evidence/settings-1280-dark-after.png
   ```

   For a page you must click through first, or a recording, write a short script and run it from a scratch folder,
   so the repository's dependencies stay as they are:

   ```sh
   mkdir -p /tmp/evidence && cd /tmp/evidence && bun add playwright && bunx playwright install chromium
   ```

   ```ts
   import { chromium } from 'playwright';

   const browser = await chromium.launch({ headless: true });
   for (const theme of ['light', 'dark'] as const) {
     for (const width of [1280, 390]) {
       const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2, colorScheme: theme });
       await page.goto('http://localhost:5900/settings');
       await page.getByRole('button', { name: 'Appearance' }).click();
       await page.screenshot({ path: `/tmp/evidence/settings-${width}-${theme}-after.png` });
       await page.close();
     }
   }
   const context = await browser.newContext({
     viewport: { width: 1280, height: 800 },
     deviceScaleFactor: 2,
     recordVideo: { dir: '/tmp/evidence/video', size: { width: 2560, height: 1600 } },
   });
   const page = await context.newPage();
   await page.goto('http://localhost:5900/settings');
   await page.getByRole('button', { name: 'Appearance' }).click();
   await context.close();
   console.log(await page.video()?.path());
   await browser.close();
   ```

5. Read the browser console on every page you captured. An error you introduced is a bug, not evidence.
6. Look at every image before you attach it: the right screen, the change visible, nothing half loaded, and twice the
   width you captured at (`sips -g pixelWidth` or `file` on the PNG).
7. Attach each view's before and after as one comparison, each recording as a `recording`, with the fields above.

## The shared browser

Every task of a project shares one Chrome, kept by Shinsa on this machine. Your Playwright MCP tools already drive it
(`PLAYWRIGHT_MCP_CDP_ENDPOINT` in your environment holds its address, valid only while your run lasts). It keeps its
sign-ins across runs and tasks, so a site the human signed it in to once stays signed in for you and every later task.

- **Open the page first.** It may be signed in already; sign in or ask only when it asks you to.
- **The repository's own test users come first.** When the repository says how agents sign in (test accounts, a
  test-user MCP server, a seeded user), do that and never use the human's own session.
- **Ask with `request_browser_sign_in`**, with the full address of the sign-in page and one sentence on what you need
  there. The human copies the sign-in from their everyday browser or signs in by hand in a window on their machine;
  when the tool answers that they did, open the page again. Ask once per site, never per task, and never ask for a
  password or a code with `ask`. Before it answers, Shinsa opens the address in the shared browser: when the page
  still ends on another site, the answer says so and where it landed, and you are not signed in.
- **A local dev server's sign-in belongs to its exact port.** Many apps keep their session in the page's storage,
  which copying a sign-in does not carry and which belongs to one origin, port included. Ask with the exact address of
  the service run you screenshot (`http://localhost:64892/`, not `localhost`), say in the reason that it is a local dev
  server so the human uses Open sign-in window, and keep that same run for every screenshot: restarting the service
  gives it a new port, and the sign-in has to happen again.
- **Never launch a browser of your own to sign in.** A browser you start is a fresh one with no sign-ins, and Google
  refuses to sign in to a browser a program drives.
- **Share it politely.** Other agents use the same browser at the same time: open your own pages, close them when you
  are done, and never sign out of a site or clear its cookies. Closing the whole browser is refused.
- **A script** reaches the same browser with `chromium.connectOverCDP(process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT)`. For a
  recording or a clean viewport, make your own context with the shared one's sign-ins, which leaves them untouched:

  ```ts
  const shared = await chromium.connectOverCDP(process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT!);
  const storageState = await shared.contexts()[0].storageState();
  const context = await shared.newContext({ storageState, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  ```

- **When it is not there.** A task with no project has no shared browser: your tools start a headless one of their
  own with no sign-ins. When the browser tools fail because Chrome is not installed, or because the human has the
  sign-in window open (it is back once they press Done), say so in your hand-over; never work around it with a
  browser of your own.

## iOS

Build for a simulator with `xcodebuild`, install it with `xcrun simctl install`, launch it, and capture with
`xcrun simctl io <device> screenshot` and `xcrun simctl io <device> recordVideo`, light and dark
(`xcrun simctl ui <device> appearance dark`). They are in the device's own pixels, sharp already; use the device's
width in points as `width`.

## Logic

Write the test that fails without your change and passes with it, and make it a check: in the plan's
`verification`, or with `check_changes` on the phase that adds it (the `handover` skill). Shinsa runs it after that
phase and keeps its output, so link it with `kind: "test"` and `check` (its id) instead of pasting the run. Run it once
before the fix yourself and attach that failing run as a `note` when it shows something the passing run does not.
Scope the check to the test that proves your change, never the whole suite: CI runs that on the pull request.

## A local preview

When the project has services (`list_services`), the human can look at the change themselves on this machine. Before
the last hand-over, start each service that shows the change with `run_service` and leave it running: each run of a
task gets a port of its own, and the start reports the run's preview URL. Add the path to the screen to check and
attach it: `{ "kind": "preview", "url": "http://localhost:4123/tasks/SW-17", "title": "Task page, Services fact" }`.
Attach one preview per screen that shows the change, each the direct URL of that screen (its task, tab and state in
the path and query), never a start page or an index the human has to click through. Name those links in How to
test. The preview stays up while the task waits for review and stops when
the task is finished, so never stop it yourself. No preview URL in the start's reply means the service has none set:
say so and attach the screenshots alone. When no service shows the change, add the one that would with
`add_service` (with its `preview_url`) and then start it.

## As the reviewer

You did not write the change, so your evidence is independent. Check the agent's evidence against the diff: the
right screens, both themes, the states it claims. Where a user-visible claim has no evidence, or you doubt one,
capture your own the same way and attach it; the human sees it marked as from the agent review. You may run the app;
never edit the worktree.

## When you cannot

If the app cannot run here (missing secrets, services, a device), say so plainly in your summary and attach what you
could: a test, a type check, a rendered component. Never claim something works that you did not see work.
