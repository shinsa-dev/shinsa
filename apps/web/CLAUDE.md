# @shinsa/web

The web app: React 19, Vite and Tailwind 4, laid out like Buzzkit's dashboard. It renders the state `shinsa engine`
pushes over one WebSocket and owns nothing: every action is a `UserCommand` through `sendCommand`, and the next state
push is the answer. `docs/design.md` is the source of truth for everything visual (its "Where Shinsa differs"
wins over the rest); `/ui` renders every token, kit component, shared building block and feature piece in both
themes, from sample data.

## Layout

```
src/
├── main.tsx             Mounts Root; applies the stored theme and a `?layout=` override before the first paint
├── root.tsx             Providers (the page's one tooltip, toaster), the ⌘K menu, the setup lock (every route goes to
│                        /onboarding until setup is complete, resolveOnboardingRedirect), the shell switch (Cards,
│                        Sidebar, or setup's own OnboardingShell on /onboarding, which has no ⌘K)
│                        and the route switch, which keeps the pages you have been to mounted and hidden in
│                        React's Activity and renders Home, All tasks and Settings ahead at idle
│                        (lib/kept-views.ts, docs/design.md 35); starts the connection unless the route is /ui
├── router.ts            The pushState router: parseRoute, navigate, replaceRoute, updateSearchParams,
│                        useRoute, useSearchParam, resolveTaskPath (the only place a task URL is built)
├── app.css              Tailwind entry, prose styles, code tokens, chat motion; imports desktop.css (in the Mac app
│                        the arrow where a browser shows the pointer hand, every other cursor kept, and no
│                        rubber-band on the page root, docs/design.md 31)
├── routes/              One file per page: home.tsx, tasks.tsx (the roadmap), settings.tsx, onboarding.tsx
│   │                    (the setup steps), terminal.tsx (a project's terminals: tabs, panes, find, the ended bar)
│   ├── task/            index.tsx (header, tabs, Cards or Sidebar frame, the tabs you opened kept mounted and
│   │                    the rest rendered ahead at idle; resolves `/tasks/<handle or id>` with
│   │                    core's selectTaskByReference and replaces it with the canonical URL), overview.tsx,
│   │                    review.tsx (the Review tab: the report top to bottom), code.tsx, chat.tsx,
│   │                    lazy-code.tsx (the Code tab's chunk and its prefetch), prefetch.tsx (Prefetch: a task's
│   │                    reads on hover and ⌘K highlight, the queue's at idle, Settings' at idle; docs/design.md 36)
│   └── ui/              The showcase: index.tsx (the page, the section nav in page order, the theme switch),
│                        section.tsx (Section, Specimen), tokens.tsx, inputs.tsx, overlays.tsx and surfaces.tsx
│                        (the kit), composites.tsx (Shinsa's shared building blocks and the
│                        composer), onboarding.tsx (each kind of setup step and the finished page), accounts.tsx, overview.tsx, chat.tsx, review.tsx (the review card in each form), code.tsx (the editor, its diffs and Go to
│                        file) and settings.tsx (the feature pieces in
│                        each state), samples.ts, sample-accounts.ts, sample-delegations.ts, sample-extensions.ts,
│                        sample-versions.ts, sample-code.ts and sample-overview.ts (their sample data; samples.ts also has the toast every action
│                        shows; /ui never connects or sends anything)
├── components/<domain>/ Pieces a route composes, one folder per domain, files named for what they are:
│                        task (header, facts with why each was chosen, menus, composer, review draft, the
│                        handle), overview (now card and its
│                        frame, the wait, usage-wait, setup, sign-in, secret and operation cards, the plan's
│                        parameters, the quiet-agent note,
│                        question choices, finding verdicts, plan revision, suggested tasks, delegations and
│                        result panels, the Rounds panel and its round headers, progress track), chat (the chat line every one-line row is, round dividers, run sections, the role mark,
│                        live card, handover, delegation and notice rows, the context meter), review (note.tsx: ReviewNote, the one card every review comment is, on the Review tab and inline in the Code tab), code (the Code tab's workbench: explorer, changes and file trees, search panel and its search field, quick open, tree rows, editor pane, inline notes, code-loading.tsx (the centred wait every Code tab read shows), and editor/code-editor.tsx, the lazily loaded CodeMirror view with editor/find-bar.tsx: find and replace), command (⌘K), queue, home (guide,
│                        new task, recently finished and recent conversations), roadmap, settings (one file per
│                        section, group.tsx the shared rows, SettingsBlock, FoldingBlock and TOKEN_TEXT;
│                        projects.tsx with project-block.tsx, project-menu.tsx and workspace-select.tsx (where agents work);
│                        accounts.tsx is the Agent usage tab's Accounts card, with usage.tsx's windows, providers.tsx's
│                        Codex block and usage-account.tsx, the one block every provider's account renders in;
│                        integrations.tsx reads the extensions for the search, context-optimizer.tsx,
│                        mcp-servers.tsx (with mcp-server-row.tsx, mcp-server-menu.tsx and server-dialog.tsx),
│                        versions.tsx the Agents tab's Versions group;
│                        plugins.tsx and skills.tsx, whose long lists
│                        render only the rows in view through virtual-rows.tsx),
│                        onboarding (shell, stepper: the steps as a segmented Choice, section: the heading, body and footer every step and the finished page share, the step and its footer, the option list, accounts, checks, finished),
│                        terminal (the tab bar, a terminal's pane and its find bar, the place menu, the ended bar, the
│                        Terminal button in Desk's top bar), focus, layout (cards/ and sidebar/ shells, the nav item both the rail and
│                        Settings' tabs use, the list row and its LIST_ROW classes, the logo link home and home-link.tsx (the Home button
│                        that replaces it in the Mac app), page/ column, heading, toolbar, section
│                        label, the page scroller with its edge fade, surface/ card and chip classes, the icon slot, panel, disclosure-header.tsx (DisclosureHeader: every collapsible header, the whole header the trigger) with disclosure.ts (its heights and trailing inset), step number),
│                        status (tiles, glyphs, tones in text, check marks, priority, the health and engine banners, the Update button,
│                        loading-line.tsx: LoadingLine and LoadingSpinner, the waits that show only after 300ms), links (TaskLink, PrLink,
│                        RepoChip, BranchChip, FileLink, references), overlays (hint, info popover, image
│                        viewer, confirm dialog), text (time ago, markdown, code fence, file path, diff stats,
│                        finding text, code-diff.tsx: CodeDiff, the one wrapper for every diff outside the Code
│                        tab, with code-diff-view.tsx, the lazily loaded `@pierre/diffs` view; change-snippet.tsx: a
│                        file's lines as a folded diff for spots and findings), controls (choice, choice buttons, select field, options trigger, copy
│                        button), accounts (sign-in and percent dialogs, usage menu, bar and percent, refresh button, account
│                        status, the account named with its provider, Run on account items)
├── hooks/               use-*.ts: client hooks shared by components (task view, busy action, the minute clock and
│                        use-now, a per-second clock on one shared timer, attention: the tab title, Floaty tags,
│                        sound and notification, a menu item's answer (use-menu-answer), review draft, the Code
│                        tab's saving of the file you edit (use-file-saver), ⌘K key, the Review tab's J and K (use-review-keys),
│                        use-idle (useIdle: true once the browser is idle; useIdleValue: a value that catches up
│                        at idle, what hidden pages and tabs render with), the chat's rendered window
│                        (use-transcript-window), the rows in view of a list (use-row-window) and a long list's rows a
│                        batch at a time (use-progressive-count), use-delayed (useDelayed: true once a wait has
│                        lasted LOADING_DELAY_MS, 300ms)…)
└── lib/                 Everything that is not JSX, unit-tested at 100%:
    ├── connection/      socket.ts (the WebSocket client: the hello with this page's surface, the state and its
    │                    patches applied once per frame, acks, transcripts from the position held (every followed
    │                    run plus the 24 read last, TRANSCRIPT_CACHE_LIMIT), whether the desktop app is connected,
    │                    reconnect), optimistic.ts (the commands shown before the
    │                    server answers, decided on the page and converted to the socket's shape, so a run they
    │                    start has no prompt and a fix its focus), selectors.ts (useShinsaSelector, useTask, useRun,
    │                    useGate: render again only when the part read changes), commands.ts
    │                    (sendCommandWithToast, requestWithToast, copyText), http.ts (requestJson: a JSON
    │                    request whose refusal becomes the server's message), code.ts (the Code tab's reads: refs, paths, tree, blob,
    │                    search and diff, cached by commit in a bounded least-recently-used cache, the last answer shown
    │                    while a newer version loads, never read again for an unrelated task event, and requestFileWrite, the one
    │                    write: saving a file you edit), models.ts, worktree.ts (open in editor / Finder), onboarding.ts
    │                    (the onboarding status, folders, suggestions and the setup steps over HTTP),
    │                    projects.ts (/api/repos/local, adding a repository or a folder to a project),
    │                    terminals.ts (useTerminals over the snapshot the socket holds, /api/terminals changes,
    │                    openTerminal and openTaskTerminal),
    │                    accounts.ts (useAccounts over the snapshot the socket holds, /api/accounts/* changes,
    │                    the sign-in dialog state), health.ts (/api/health on start and after each reconnect,
    │                    the banner's text and its dismissal), engine.ts (the app against the engine: the engine
    │                    banner's view, the automatic restart and requestEngineRestart), extensions.ts (useExtensions over
    │                    /api/extensions, the server check, every /api/extensions/* change and the MCP
    │                    sign-in watch), versions.ts (useVersions over /api/versions, Check for updates, and
    │                    requestUpdate: the update's lines streamed into its toast; http.ts's requestLines reads them)
    ├── command/         ⌘K: registry.ts (useRegisterCommands, menu open state), score.ts, menu.ts (frames,
    │                    rows, the root's blocks and their scores, Recent, the New task action), global.ts, gates.ts (the commands of every open gate), task.ts and
    │                    task-actions.ts (a task's page), process.ts (check-ins, the quiet agent, suggested
    │                    tasks, delegations), accounts.ts (Accounts group, Run on account, usage waits),
    │                    schedules.ts, terminal.ts (the Terminal page's commands), review.ts (the Review tab's Next and Previous place), editor.ts (the Code tab's Editor group: every editing key), extensions.ts (the Integrations group), versions.ts (Update Claude Code and
    │                    Update Codex), and one file per page that
    │                    registers commands (tasks, home, settings)
    ├── accounts/        account.ts (every account label and toast, plans, Run on account choices, each provider's
    │                    name and icon), usage.ts (usage rows, tones,
    │                    an account's status and header, the glance at the account the server picks next and
    │                    which row it marks), limits.ts (switch thresholds, the Limits settings), providers.ts (a
    │                    provider's sign-in block: its header, state, the fix, the sign-in command), sign-in.ts (resolveSignInProvider: the Sign in gate's provider),
    │                    usage-wait.ts
    ├── chat/            Transcript → timeline → turns, tool descriptions and output, run roles and headlines,
    │                    who worked on a task (agents.ts), notice
    │                    rows, the context meter (context.ts), run evidence, delegations (delegations.ts: views, the tree, a parked step's wait),
    │                    the transcript's blocks and the window of them rendered (window.ts), prefetch.ts (a
    │                    task's last transcripts read ahead)
    ├── code/            The Code tab: location.ts (every view position in the URL: mode, file, line, ref, spot,
    │                    search), tree.ts, file-icons.ts (the icon of a file or folder), prefetch.ts (the Code tab's reads ahead of a
    │                    click: the tab, a hovered row, a file's neighbours and folders, the other refs, the review's snippets,
    │                    and a hovered changed file's side-by-side pair handed to the session to build at idle), rank.ts (quick open), search.ts, refs.ts (the ref picker), source.ts, notes.ts
    │                    (findings, comments and spots on a file), edits.ts (editing in place: whether the open
    │                    file is editable and why not, the FileSaver that saves each pause against the text on
    │                    disk, the line merge with a disk change, what you saved per read),
    │                    collapse.ts, pane.ts, keys.ts (⌘P, ⇧⌘F, ⌘F, ⌘G), grammar.ts (VS Code's choice of language by
    │                    name, folder, extension and shebang, the TextMate theme on the `--code-*` tokens, token classes),
    │                    marks.ts (the User Timing marks around an open and a folder toggle); editor/ (CodeMirror: the
    │                    Shinsa theme, session.ts (EditorSession: one view per Code tab, each file's state swapped in and
    │                    kept), tokens.ts (the tokenizer worker's client and its cache by text), tokenize.worker.ts,
    │                    textmate.ts and shiki-engine.ts (VS Code's grammars line by line in the worker), syntax.ts (the
    │                    tokens as decorations), folding.ts (VS Code's fold gutter and indentation folding),
    │                    languages, the unified diff with removed lines highlighted in context, note slots, the
    │                    comment gutter, find.ts: the find bar's panel, its replace row and match count, commands.ts: VS Code's editing keys as CodeMirror commands, one list for the keymap and ⌘K, collapsed.ts: the cursor
    │                    stepping over folded lines and the sideways scroll the folds and notes follow); diff-view.ts (every diff outside the Code tab: sources, a spot's slice of
    │                    the task diff, notes, the 14-line fold), diff-theme.ts (`@pierre/diffs` on the `--code-*`
    │                    tokens), line-changes.ts (an edit's added and removed counts), and highlight.ts (Shiki for
    │                    the chat on a theme of the `--code-*` tokens the editor reads)
    ├── terminal/        Terminals (docs/design.md, 37): view.ts (TerminalView: one xterm.js per terminal, kept outside
    │                    React, its socket and reconnect, WebGL while shown, find; resolveTerminalView), theme.ts (the
    │                    xterm.js options and theme from Ghostty's appearance over the `--terminal-*` tokens), color.ts
    │                    (OKLCH and rgb to hex), keys.ts (which keys a focused terminal keeps), replies.ts (the
    │                    questions the engine answers instead), tabs.ts (the project, tabs, places, order and words),
    │                    command.ts (a shell block's command for Run in terminal)
    ├── review/          The Review tab (report.ts: what needs your attention and in what order, the walkthrough's
    │                    sections, the other changed files, the review card's items; keys.ts: J and K; places.ts:
    │                    the paths into Code and into the Review tab), the Code tab's spot targets, the fallback
    │                    report, the line-comment draft (sides, ranges, kept in localStorage per gate, and your
    │                    Fix / Dismiss verdicts; serializeComments is what `gate.answer` sends as `comments`),
    │                    finding places
    ├── overview/        Now card titles, progress steps, activity glyphs, evidence kinds, waits,
    │                    questions, verdicts, plan versions, plan parameters, the operation gate and its notes, setup
    ├── tasks/           prefetch.ts (the task under the pointer or highlighted in ⌘K, the queue's tasks read at idle),
    │                    Rounds (rounds.ts: the handle with its round, chat sections per round and their dividers, earlier and waiting
    │                    rounds, a round's track and pull request, how a round ships), status and tone per task,
    │                    roadmap groups and chains, next action, the now line,
    │                    references, tabs, facts, dependencies, task actions, gate replies (gates.ts), what a message does
    │                    at each gate (messages.ts: the composer hint and toast, from core's resolveMessageEffect), the
    │                    messages on their way to the server (outbox.ts, read with hooks/use-outbox.ts), process
    │                    actions (process.ts), suggested tasks, cost, pull request facts, branch and request text,
    │                    kinds of task (shapes.ts: labels, composed steps, the result panel per step, your OK's
    │                    proposal gate, the steps a task takes), why triage decided each fact (triage.ts)
    ├── notifications/   attention.ts (decisions, the tab badge and status), watcher.ts, sounds.ts,
    │                    browser.ts, settings.ts (the Notifications rows), page.ts (the tab title and Floaty's
    │                    meta tags)
    ├── format/          Counts, times, money, labels, tones, the shared minute and second clocks (clock.ts), a small LRU
    │                    cache (cache.ts), the rows in view of a list (rows.ts)
    ├── preferences/     localStorage: theme, layout, rail width, recent tasks, section flags, notifications
    ├── desktop.ts       The desktop app's bridge (`window.shinsaDesktop`, absent in a browser and Floaty):
    │                    `data-desktop` on <html>, its navigation, the Dock badge, notifications, the page's
    │                    surface and whether it stays quiet (`isPageQuiet`), the app's version and protocol
    │                    (`selectDesktopBuild`) and its own update (`readDesktopUpdate`, `installDesktopUpdate`)
    ├── kept-views.ts    Which pages stay mounted: the hub pages (Home, All tasks, Settings, and Terminal, which is
    │                    never rendered ahead) and the last three task pages, by key, with the URL each was left at
    └── queue.ts, home.ts, focus.ts, projects.ts (Settings → Projects: rows, the key line, the dialog's copy and
        checks, repository choices, the actions), workspaces.ts (where agents work: the three modes, why GitButler is
        not offered yet, changing a repository's mode; its support comes from connection/workspaces.ts,
        useWorkspaceSupport over GET /api/repos/workspaces), settings.ts, settings-tabs.ts, schedules.ts, secrets.ts,
        onboarding.ts, image-view.ts (fit, zoom, pan and pinch), keys.ts, signal.ts, new-task.ts (the composer's project, start and priority),
        extensions.ts (MCP servers, plugins and skills: labels, status groups, places, skill groups, token text,
        search, what agents have not used lately and the optimizer's rows, the visible range of a long list, the
        server form and its checks), versions.ts (Settings → Agents → Versions: rows, statuses and the update labels)
```

`test/` follows `src/`: nearly every `lib/` and `hooks/` module has its test at the same path (a few are covered
through their callers), and components and routes have behaviour tests where they hold behaviour. `test/support/`
holds the shared helpers: `state.ts` builds `ShinsaState` fixtures, `pull-request.ts` a task's pull request,
`chat.ts` transcript entries and tool calls, `accounts.ts`, `schedules.ts`, `onboarding.ts`, `extensions.ts`,
`versions.ts` and `notifications.ts` their fixtures, `rounds.ts` rounds (`createRound`), `server.ts` a fake WebSocket server that drives the real `connection` (push state and transcripts,
hold or fail acks, read the commands sent; stop it in `afterEach`), `commands.ts` spies on `sendCommandWithToast`
and toasts, `hover.ts` hovers an element and waits for its tooltip's text, `wait.ts` waits for an element to
leave (`waitForGone`: a failing `expect(element).toBeNull()` prints the whole element on every retry, which took
seconds per closing dialog and timed tests out under load). Prefer these to `mock.module`: Bun runs every test file in one process, so a module mock leaks into the
files after it.

## Rules

- **The server is the source of truth.** Components read `ShinsaState` from `useConnection()` and act through
  `sendCommand` / `sendCommandWithToast`; there are no optimistic writes, and acting never navigates
  (`docs/design.md`, Where Shinsa differs, 9). The one exception is a chat message you send: it shows as sending
  from the moment you press send (`lib/tasks/outbox.ts`, `useOutbox`) until the state has it in the task's `inbox`,
  and leaves the outbox when the server answers either way; each sent message is matched to one message that
  landed, so a repeated message stays sending until it lands too. In the inbox it shows as queued, then as
  delivered, noted (needs no reply) or not delivered with the reason (`listHumanMessages` in `lib/chat/timeline.ts`,
  `describeMessageStatus` in `lib/tasks/messages.ts`; `docs/engine.md` → Rounds).
- **Setup is the server's steps.** The steps, their order, what each answer saves, going back and the accounts it
  imports all live on the server (`docs/engine.md` → The setup steps); `routes/onboarding.tsx` only renders
  `GET /api/onboarding/flow` and sends what you pick, a folder path you add, Back or a step you open
  (`useOnboardingFlow`; how it looks: `docs/design.md`, 24). Until `GET /api/onboarding` says setup is complete,
  every route replaces itself with `/onboarding`, and `/onboarding` has no way out: its own shell, no Home button
  and no ⌘K. `/onboarding` goes Home when the run it loads is finished. Run setup again (Settings → Setup, ⌘K) is
  `restartOnboarding`: it starts a new run on the server first, so the page opens on its first step; there is no
  URL flag. No folder path is written into the web.
- **URL state is the view state.** The task tab (`?tab=review|code|chat`), the Review tab's place (`?spot=`), the Code
  tab's whole workbench (`lib/code/location.ts`: `?mode=changes|files|search`, `file`, `diff`, `line`, `end`, `ref`,
  `spot`, `q`,
  `regex`, `case`, `word`, `glob`), focused run (`?run=`), the Settings tab (`?tab=agents`, `lib/settings-tabs.ts`) and the roadmap filters
  (`?status=`, `?q=`) live in the URL, read with
  `useSearchParam` and written with `updateSearchParams`. Build task URLs only with `resolveTaskPath`: it uses the
  handle (`/tasks/SW-142`), and the id for a task triage has not given one yet.
- **Logic lives in `lib/`, JSX in `components/` and `routes/`.** A `.tsx` file holds components and the small
  hooks private to them; anything that computes (a label, an order, a section list, a command list) is a `.ts`
  function in `lib/` with a test. A component used by one route still lives in `components/<domain>/` when the
  route file would otherwise grow past a screenful.
- **⌘K is the only shortcut, but for the Code and Review tabs.** Pages add commands with `useRegisterCommands(sections)` while
  mounted (`docs/design.md`, 14). A command or choice option is disabled only with its reason (`disabled: '…'`, a
  string shown in place of the hint); there is no boolean. While the Code tab is open it binds ⌘P, ⇧⌘F, ⌘F and ⌘G (`hooks/use-code-keys.ts`),
  and while the Review tab is open J and K (`hooks/use-review-keys.ts`, not while you type), each also a ⌘K command; `bun lint:conventions` rejects a global key listener anywhere else.
  A focused terminal keeps its own keys through xterm.js's handler on its element (`lib/terminal/keys.ts`): every
  Control key goes to the shell, ⌘ keys to Shinsa but ⌘C, ⌘V, ⌘A and ⌘F (`docs/design.md`, 37).
- **One owner per shared piece.** The visual ones (tones, times, cards, check marks, task actions, dependencies)
  are listed in `docs/design.md`, 15. In code, besides those: gate replies go through `lib/tasks/gates.ts`, what a message does (every composer's
  placeholder and toast for `task.message`, and ⌘K's Message the agent) through `lib/tasks/messages.ts`, HTTP
  through `lib/connection/http.ts` and `requestWithToast`, the `•••` trigger through `controls/options-trigger.tsx`,
  a remove confirmation through `overlays/confirm-dialog.tsx`, usage percentages through
  `accounts/usage-percent.tsx`, and the account picker is core's (`selectNextAccount`), never a web copy.
  `bun lint:conventions` rejects some hand-built copies; the rest is on review.
- **One surface notifies.** The socket's first message names this page's surface (`resolveSurface`), and while the
  server says the desktop app is connected (`useDesktopConnected`) a browser page or Floaty is quiet
  (`isPageQuiet`): `useAttention` plays no sound and shows no notification, but keeps the count and status in the
  title and Floaty's tags, which Floaty reads; Settings → Notifications says the app handles them. Anything new that
  alerts goes through that check (`docs/design.md`, 31).
- **No comments** (lint-enforced). Names, small modules and `docs/` explain.
- `@shinsa/ui` resolves through its package `exports`; there is no path alias to its sources.

## Commands

| Command | Description |
|---|---|
| `bun dev` | Vite on :5181, proxying `/api` and `/ws` to `shinsa engine` on `SHINSA_PORT` (default 5180) |
| `bun test` | Bun with happy-dom and Testing Library; fails below 100% line and function coverage of `src/**/*.ts` (`.tsx` is covered by behaviour tests, not counted) |
| `bun run check-types` | `tsc` over `src`, `test` and `vite.config.ts` |
| `bun run build` | The production bundle in `dist/`, served by `shinsa engine` |
