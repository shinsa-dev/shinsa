# @shinsa/web

The web app: React 19, Vite and Tailwind 4, laid out like Buzzkit's dashboard. It renders the state `shinsa serve`
pushes over one WebSocket and owns nothing: every action is a `UserCommand` through `sendCommand`, and the next state
push is the answer. `docs/design.md` is the source of truth for everything visual (its "Where Shinsa differs"
wins over the rest); `/ui` renders every token, kit component, shared building block and feature piece in both
themes, from sample data.

## Layout

```
src/
├── main.tsx             Mounts Root; applies the stored theme and a `?layout=` override before the first paint
├── root.tsx             Providers (tooltips, toaster), the ⌘K menu, the layout switch (Cards or Sidebar shell)
│                        and the route switch; starts the connection unless the route is /ui
├── router.ts            The pushState router: parseRoute, navigate, replaceRoute, updateSearchParams,
│                        useRoute, useSearchParam, resolveTaskPath (the only place a task URL is built)
├── app.css              Tailwind entry, prose styles, code tokens, chat motion; imports desktop.css (the arrow cursor
│                        everywhere in the Mac app, docs/design.md 31)
├── routes/              One file per page: home.tsx, tasks.tsx (the roadmap), settings.tsx, onboarding.tsx
│   │                    (the setup chat)
│   ├── task/            index.tsx (header, tabs, Cards or Sidebar frame; resolves `/tasks/<handle or id>` with
│   │                    core's selectTaskByReference and replaces it with the canonical URL), overview.tsx,
│   │                    code.tsx, chat.tsx
│   └── ui/              The showcase: index.tsx (the page, the section nav in page order, the theme switch),
│                        section.tsx (Section, Specimen), tokens.tsx, inputs.tsx, overlays.tsx and surfaces.tsx
│                        (the kit), composites.tsx (Shinsa's shared building blocks, the setup pieces and the
│                        composer), accounts.tsx, overview.tsx, chat.tsx, code.tsx (the editor, its diffs and Go to
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
│                        live card, handover, delegation and notice rows, the context meter), code (the Code tab's workbench: explorer, review walkthrough, changes and file trees, search panel and its search field, quick open, tree rows, editor pane, inline notes, and editor/code-editor.tsx, the lazily loaded CodeMirror view with editor/find-bar.tsx), command (⌘K), queue, home (guide,
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
│                        onboarding (checks, choices), focus, layout (cards/ and sidebar/ shells, the nav item both the rail and
│                        Settings' tabs use, the list row, the logo link home, page/ column, heading, toolbar, section
│                        label, the page scroller with its edge fade, surface/ card and chip classes, the icon slot, panel, step number),
│                        status (tiles, glyphs, tones in text, check marks, priority, the health banner), links (TaskLink, PrLink,
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
│                        tab's saving of the file you edit (use-file-saver), ⌘K key…)
└── lib/                 Everything that is not JSX, unit-tested at 100%:
    ├── connection/      socket.ts (the WebSocket client: the hello with this page's surface, state, acks,
    │                    transcripts, whether the desktop app is connected, reconnect), commands.ts
    │                    (sendCommandWithToast, requestWithToast, copyText), http.ts (requestJson: a JSON
    │                    request whose refusal becomes the server's message), code.ts (the Code tab's reads: refs, paths, tree, blob,
    │                    search and diff, cached by commit, never read again for an unrelated task event, and requestFileWrite, the one
    │                    write: saving a file you edit), models.ts, worktree.ts (open in editor / terminal / Finder), onboarding.ts
    │                    (the onboarding status, folders, suggestions and the setup chat over HTTP),
    │                    projects.ts (/api/repos/local, adding a repository or a folder to a project),
    │                    accounts.ts (useAccounts over the snapshot the socket holds, /api/accounts/* changes,
    │                    the sign-in dialog state), health.ts (/api/health on start and after each reconnect,
    │                    the banner's text and its dismissal), extensions.ts (useExtensions over
    │                    /api/extensions, the server check, every /api/extensions/* change and the MCP
    │                    sign-in watch), versions.ts (useVersions over /api/versions, Check for updates, and
    │                    requestUpdate: the update's lines streamed into its toast; http.ts's requestLines reads them)
    ├── command/         ⌘K: registry.ts (useRegisterCommands, menu open state), score.ts, menu.ts (frames,
    │                    rows, the root's blocks and their scores, Recent, the New task action), global.ts, gates.ts (the commands of every open gate), task.ts and
    │                    task-actions.ts (a task's page), process.ts (check-ins, the quiet agent, suggested
    │                    tasks, delegations), accounts.ts (Accounts group, Run on account, usage waits),
    │                    schedules.ts, extensions.ts (the Integrations group), versions.ts (Update Claude Code and
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
    │                    rows, the context meter (context.ts), run evidence, delegations (delegations.ts: views, the tree, a parked step's wait)
    ├── code/            The Code tab: location.ts (every view position in the URL: mode, file, line, ref, spot,
    │                    search), tree.ts, file-icons.ts (the icon of a file or folder), prefetch.ts (the Code tab's reads ahead of a
    │                    click), rank.ts (quick open), search.ts, refs.ts (the ref picker), source.ts, notes.ts
    │                    (findings, comments and spots on a file), edits.ts (editing in place: whether the open
    │                    file is editable and why not, the FileSaver that saves each pause against the text on
    │                    disk, the line merge with a disk change, what you saved per read),
    │                    collapse.ts, pane.ts, keys.ts (⌘P, ⇧⌘F, ⌘F, ⌘G); editor/ (CodeMirror: the Shinsa theme,
    │                    languages, the unified diff with removed lines highlighted in context, note slots, the
    │                    comment gutter, find.ts: the find bar's panel and match count, collapsed.ts: the cursor
    │                    stepping over folded lines and the sideways scroll the folds and notes follow); diff-view.ts (every diff outside the Code tab: sources, a spot's slice of
    │                    the task diff, notes, the 14-line fold), diff-theme.ts (`@pierre/diffs` on the `--code-*`
    │                    tokens), line-changes.ts (an edit's added and removed counts), and highlight.ts (Shiki for
    │                    the chat on a theme of the `--code-*` tokens the editor reads)
    ├── review/          Review targets, the fallback report, the line-comment draft (sides, ranges, kept in
    │                    localStorage per gate; serializeComments is what `gate.answer` sends
    │                    as `comments`), finding places
    ├── overview/        Now card titles, progress steps, activity glyphs, evidence kinds, waits,
    │                    questions, verdicts, plan versions, plan parameters, the operation gate and its notes, setup
    ├── tasks/           Rounds (rounds.ts: the handle with its round, chat sections per round and their dividers, earlier and waiting
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
    ├── format/          Counts, times, money, labels, tones, the shared minute and second clocks (clock.ts)
    ├── preferences/     localStorage: theme, layout, rail width, recent tasks, section flags, notifications
    ├── desktop.ts       The desktop app's bridge (`window.shinsaDesktop`, absent in a browser and Floaty):
    │                    `data-desktop` on <html>, its navigation, the Dock badge, notifications, the page's
    │                    surface and whether it stays quiet (`isPageQuiet`)
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
  (`docs/design.md`, Where Shinsa differs, 9). The one exception is a chat message you send: it shows as delivering
  from the moment you press send (`lib/tasks/outbox.ts`, `useOutbox`) until the state has it in the task's `inbox`,
  and leaves the outbox when the server answers either way (`docs/engine.md` → Rounds).
- **Setup is the server's chat.** The questions, their order and what an answer means all live on the server
  (`docs/engine.md` → The setup chat); `routes/onboarding.tsx` only renders `GET /api/onboarding/chat` and sends
  what you pick or type (how it looks: `docs/design.md`, 24). Home redirects to `/onboarding` while
  `GET /api/onboarding` says it is not complete, and `/onboarding` goes Home when the chat it loads is finished
  (`useOnboardingChat`). Run setup again (Settings → Setup, ⌘K) is `restartOnboarding`: it restarts the chat on
  the server first, so the page opens on an open question; there is no URL flag. No folder path is written into
  the web.
- **URL state is the view state.** The task tab (`?tab=code|chat`), the Code tab's whole workbench (`lib/code/location.ts`:
  `?mode=review|changes|files|search`, `file`, `diff`, `line`, `end`, `ref`, `spot`, `order`, `q`,
  `regex`, `case`, `word`, `glob`), focused run (`?run=`), the Settings tab (`?tab=agents`, `lib/settings-tabs.ts`) and the roadmap filters
  (`?status=`, `?q=`) live in the URL, read with
  `useSearchParam` and written with `updateSearchParams`. Build task URLs only with `resolveTaskPath`: it uses the
  handle (`/tasks/SW-142`), and the id for a task triage has not given one yet.
- **Logic lives in `lib/`, JSX in `components/` and `routes/`.** A `.tsx` file holds components and the small
  hooks private to them; anything that computes (a label, an order, a section list, a command list) is a `.ts`
  function in `lib/` with a test. A component used by one route still lives in `components/<domain>/` when the
  route file would otherwise grow past a screenful.
- **⌘K is the only shortcut, but for the Code tab.** Pages add commands with `useRegisterCommands(sections)` while
  mounted (`docs/design.md`, 14). A command or choice option is disabled only with its reason (`disabled: '…'`, a
  string shown in place of the hint); there is no boolean. While the Code tab is open it binds ⌘P, ⇧⌘F, ⌘F and ⌘G (`hooks/use-code-keys.ts`),
  each also a ⌘K command; `bun lint:conventions` rejects a global key listener anywhere else.
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
| `bun dev` | Vite on :5181, proxying `/api` and `/ws` to `shinsa serve` on `SHINSA_PORT` (default 5180) |
| `bun test` | Bun with happy-dom and Testing Library; fails below 100% line and function coverage of `src/**/*.ts` (`.tsx` is covered by behaviour tests, not counted) |
| `bun run check-types` | `tsc` over `src`, `test` and `vite.config.ts` |
| `bun run build` | The production bundle in `dist/`, served by `shinsa serve` |
