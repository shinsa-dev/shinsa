# @shinsa/web

The web app: React 19, Vite and Tailwind 4, laid out like Buzzkit's dashboard. It renders the state `shinsa engine`
pushes over one WebSocket and owns nothing: every action is a `UserCommand` through `sendCommand`, and the next state
push is the answer. `docs/design.md` is the source of truth for everything visual (its "Where Shinsa differs"
wins over the rest); `/ui` renders every token, kit component, shared building block and feature piece in both
themes, from sample data.

## Layout

```
src/
├── main.tsx             Mounts Root (in the remote build, RemoteRoot around it); applies the stored theme and a
│                        `?layout=` override before the first paint
├── remote-sw.ts         The remote build's service worker (/sw.js, scope /): hands the page's /api/ requests to the page
├── root.tsx             Providers (the page's one tooltip, toaster), the ⌘K menu, the setup lock (every route goes to
│                        /onboarding until setup is complete, resolveOnboardingRedirect), the frame (AppFrame for Cards and
│                        Sidebar, or setup's own OnboardingShell on /onboarding, which has no ⌘K)
│                        and the route switch, which keeps the pages you have been to mounted and hidden in
│                        React's Activity and renders Home, All tasks and Settings ahead at idle
│                        (lib/kept-views.ts, docs/design.md 35); starts the connection unless the route is /ui
├── router.ts            The pushState router: parseRoute, navigate, replaceRoute, updateSearchParams,
│                        useRoute, useSearchParam, resolveTaskPath (the only place a task URL is built);
│                        RouteScope renders a subtree at a fixed route (the site's demos); the build's base path
│                        (from BASE_URL; both builds use `/` today) is taken off the address and put on every path
│                        it pushes and every in-app link (stripRouteBase, withRouteBase)
├── app.css              Tailwind entry, prose styles, code tokens, chat motion; imports desktop.css (in the Mac app
│                        the arrow where a browser shows the pointer hand, every other cursor kept, and no
│                        rubber-band on the page root, docs/design.md 31)
├── routes/              One file per page: home.tsx, tasks.tsx (All tasks), settings.tsx, automation.tsx (a
│   │                    automation's own page at /automations/<id>, laid out like a task page: facts row, the question, sign-in, secret or cost-limit pause a read waits on, the tasks it filed in task list rows, an Activity log of its runs), onboarding.tsx
│   │                    (the setup steps), terminal.tsx (a project's terminals: tabs, panes, find, the ended bar;
│   │                    in the remote build, a note that terminals stay on the machine)
│   ├── remote/          The remote build's own pages on app.shinsa.dev (docs/engine.md → Remote access): index.tsx
│   │                    (RemoteRoot: the session, then the page for the path), shell.tsx (the header with Sign out, sign-in, RemoteHero: the icon, title and line the pair and enroll pages open with),
│   │                    pair.tsx, enroll.tsx, slack.tsx (SlackLinkedPage: /slack/linked after connecting Slack,
│   │                    the workspace and what happens next, or why it failed), fleet.tsx (FleetApp: every machine this device was added to joined
│   │                    into one Fleet, the service worker, then the app; or the steps to pair a machine or add this
│   │                    device, the benefits card and Check again), share.tsx (/share/t/<token>#<key>: a
│   │                    shared task, live, read-only and without sign-in, docs/engine.md → Sharing a task),
│   │                    team-join.tsx (/share/team#…: the team key kept in this browser, then the request to join)
│   ├── task/            index.tsx (header, tabs, Cards or Sidebar frame, the tabs you opened kept mounted and
│   │                    the rest rendered ahead at idle; resolves `/tasks/<handle or id>` with
│   │                    core's selectTaskByReference and replaces it with the canonical URL), overview.tsx,
│   │                    review.tsx (the Review tab: the report top to bottom), code.tsx, chat.tsx,
│   │                    lazy-code.tsx (the Code tab's chunk and its prefetch), prefetch.tsx (Prefetch: a task's
│   │                    reads on hover and ⌘K highlight, the queue's at idle, Settings' at idle; docs/design.md 36)
│   └── ui/              The showcase: index.tsx (the page, the section nav in page order, the theme switch),
│                        section.tsx (Section, Specimen), tokens.tsx, inputs.tsx, overlays.tsx and surfaces.tsx
│                        (the kit), checklist.tsx (the checklist: ticking, commands, a disabled row, read-only, a
│                        Markdown task list), composites.tsx (Shinsa's shared building blocks and the
│                        composer), errors.tsx (the error fallbacks in each size), onboarding.tsx (each kind of setup step), accounts.tsx, overview.tsx, chat.tsx, review.tsx (the review card in each form), evidence.tsx (the Evidence panel on sample files from public/samples/evidence, every kind once, and after a revision: an updated shot and the earlier versions), checks.tsx (the Checks list in each state, both stages, a linked test, the plan's Checks, check activity and Always run before review, on sample-checks.ts), code.tsx (the editor, its diffs and Go to
│                        file) and settings.tsx (the feature pieces in
│                        each state), samples.ts, sample-accounts.ts, sample-delegations.ts, sample-extensions.ts,
│                        sample-versions.ts, sample-code.ts, sample-evidence.ts, sample-checks.ts, sample-overview.ts and sample-merge-steps.ts (their sample data; merge-steps.tsx,
│                        the steps around the merge on the merge gate, a merged task and the Review tab, ticking in place; samples.ts also has the toast every action
│                        shows; /ui never connects or sends anything)
├── components/<domain>/ Pieces a route composes, one folder per domain, files named for what they are:
│                        task (header, facts with why each was chosen, menus, composer (attach, paste and drop
│                        through chat/attachment-chips.tsx and hooks/use-attachments.ts, which Home's composer shares; the task's composer on
│                        Overview, Review and Chat is one draft per task, lib/chat/task-drafts.ts), review draft, the
│                        handle, bundle.tsx: BundleFact, the toolbar's Bundle item and its popover of the bundle's
│                        tasks, and BundleMark, its count beside a queue row's name, command-runner.tsx: TaskCommandRunner, Run in terminal's runner for the task's
│                        page while it has a folder), overview (now card and its
│                        frame, the wait, usage-wait, setup, sign-in, secret and operation cards, merge-steps-card.tsx (a merged task's
│                        steps left after the merge), the plan's
│                        parameters, the quiet-agent note,
│                        question choices, finding verdicts, plan revision, suggested tasks, delegations and
│                        result panels, the Rounds panel and its round headers, progress track, mini-track.tsx: the track as dots for a queue row), chat (the chat line every one-line row is, round dividers, run sections, the role mark,
│                        live card, handover, delegation and notice rows, the context meter, message-queue.tsx:
│                        the queued messages docked above the composer, file-card.tsx: FileCard, the one card a non-image attachment is in a message and in a composer, a grey bordered tile with the kind's icon from lib/chat/attachments.ts; it and every image attachment take the composer card's corner, ATTACHMENT_CORNER, and its tile ATTACHMENT_TILE_CORNER, 4px in on every side, so the tile is 46px in the 56px card), review (merge-steps.tsx: the steps around the
│                        merge as a checklist, its block on a now card and its panel on the Review tab, a step's command as a shell code block;
│                        testing.tsx: the Review tab's How to test, what the tests cover and the steps to try with their targets;
│                        note.tsx: ReviewNote, the one card every review comment is, on the Review tab and inline in the Code tab, with a foldable header bar for points and comments and FindingNote with Fix / Dismiss for findings; verdict-choice.tsx: a finding's Fix / Dismiss on the shared review draft, the only one, which the Overview's finding verdicts use too, and VerdictChoice, the same control on a value alone, for /ui; point-index.tsx: the Review tab's pinned Every point line and its popover index), checks (checks-list.tsx: the Checks list in its two stages, Building and CI, ChecksBlock with each check's output behind a toggle, CheckRowItem, the row the Evidence panel's linked checks reuse, and ChecksSections, the compact form the checks fact's and the pull request's popovers show), evidence (evidence-section.tsx: the Review tab's Evidence panel, its current items grouped by kind (comparisons, recordings, screenshots, tests and checks, each a reference to its check, notes, previews), an updated item's quiet mark, the replaced and removed items under a collapsed Earlier versions, the folder on disk; evidence-figure.tsx and evidence-text.tsx its pieces; evidence-pointer.tsx: the Overview's one line pointing at it, counting the items by kind), code (the Code tab's workbench: explorer, changes and file trees, search panel and its search field, quick open, tree rows, editor pane, inline notes, code-loading.tsx (the centred wait every Code tab read shows), and editor/code-editor.tsx, the lazily loaded CodeMirror view with editor/find-bar.tsx: find and replace), command (⌘K), queue (row-summary.tsx: a row's summary line, the handle and status, the mini track and the agent's latest action or the current step's count), home (guide,
│                        new task, recently finished and recent conversations), tasks, settings (one file per
│                        section, group.tsx the shared rows, SettingsBlock, FoldingBlock and TOKEN_TEXT;
│                        projects.tsx with project-block.tsx, project-menu.tsx, workspace-select.tsx (where agents work) and baseline-select.tsx (Always run before review);
│                        accounts.tsx is the Agent usage tab's Accounts card, with usage.tsx's windows, providers.tsx's
│                        Codex block and usage-account.tsx, the one block every provider's account renders in;
│                        integrations.tsx reads the extensions for the search, slack.tsx (General, right under
│                        Remote access, and below Machines on app.shinsa.dev: the status, Connect Slack, each
│                        linked workspace, and Disconnect on the machine only), context-optimizer.tsx,
│                        mcp-servers.tsx (with mcp-server-row.tsx, mcp-server-menu.tsx and server-dialog.tsx),
│                        versions.tsx the Agents tab's Versions group;
│                        plugins.tsx and skills.tsx, whose long lists
│                        render only the rows in view through virtual-rows.tsx),
│                        onboarding (shell, header: Set up Shinsa over the path, path: the steps as the task page's path of gates, section: the heading, body and footer every step shares, the step and its footer, the option list, defaults: the three pick-one lists, projects: the suggested projects to keep, rename or trim, access: a folder macOS keeps private, accounts: Sign in with Claude and the accounts, checks: each check with Install and its terminal in the card, help: Ask an agent for help and its reply with Run in terminal),
│                        terminal (the tab bar, a terminal's pane and its find bar, the place menu, the ended bar),
│                        services (menu.tsx: Services beside Tasks and in the rail, its popover (SERVICES_PANEL, the
│                        queue popover's COMPACT_POPOVER, which the queue's QUEUE_POPOVER widens to fit its rows: the list as tall as its content, the forms at one height)
│                        whose views are the list drawn as the compact queue (each project a CompactSection, its
│                        play button that starts them all), Manage with its inline removal, Add services, the custom
│                        form and a service's form, the always-there footer (Manage, Add…, Terminal) and the trigger
│                        label; panel-views.tsx: Add services (what the engine found, ticked, with Custom service…, then the
│                        list the AI check returns; also the view a project with no services opens on),
│                        the custom and edit forms, the views' header (12px at the top, as at the side), body and
│                        footer, the found list's boxes the kit's outline Checkbox; service-form.tsx: the form's
│                        fields with Environment under Advanced and when a field shows its problem; service-row.tsx: a
│                        service's row, tile and run buttons (Restart and Stop 1px apart, as on the Terminal page),
│                        and Manage's row, which a press ticks (an outline Checkbox), with its bare edit button;
│                        task-menu.tsx: a task's Services fact (beside its other facts) and popover, its runs in the task's worktree;
│                        use-service-actions.ts: the row handlers and the panel's server calls), errors (boundary.tsx: ErrorBoundary, which catches a
│                        render error, logs it and resets on its resetKey; fallback.tsx: ErrorFallback, the page, inline
│                        and icon looks with Try again, Reload and Copy details), focus (menu.tsx: the Focus menu and
│                        the project trigger and rows the Terminal page's picker shares), layout (cards/ and sidebar/ shells, the nav item both the rail and
│                        Settings' tabs use, the list row and its LIST_ROW classes, compact-section.tsx (the compact queue's section and
│                        popover classes, which the Services popover's list shares; the fold chevron right after a
│                        header's counts, its action at the end), the logo link home and home-link.tsx (the Home button
│                        that replaces it in the Mac app), nav-button.tsx (NavButton: the Cards top bar's Home, Tasks and
│                        icon-only Settings, filled on their own page), page/ column, heading, toolbar, section
│                        label, the page scroller with its edge fade, surface/ card, inset (INSET: the edge of every box nested in a card; TONE_INSET: a toned box on its tone’s edge) and chip classes, the icon slot, panel, disclosure-header.tsx (DisclosureHeader: every collapsible header, the whole header the trigger) with disclosure.ts (its heights and trailing inset), step number),
│                        status (tiles, glyphs, tones in text, check marks, priority, the health and engine banners, the Update button,
│                        loading-line.tsx: LoadingLine and LoadingSpinner, the waits that show only after 300ms), links (TaskLink, PrLink,
│                        RepoChip, BranchChip, FileLink, references), overlays (hint, info popover, image
│                        viewer, confirm dialog), text (time ago, markdown, code fence, code-block.tsx: CodeBlock, the frame and the one corner every code block shares
│                        (fences and the chat's tool-call blocks): Copy, and Run in terminal on a shell fence marked run where
│                        CommandRunnerProvider has a runner, centred beside one line or top-right on several), inset-note.tsx (InsetNote and
│                        SuggestedFix: a labelled note on the inset), file path, diff stats,
│                        finding text, finding-note.tsx: FindingNote, the one finding layout: the severity in its tone
│                        over the issue left, the action right, the proposed fix below, code-diff.tsx: CodeDiff, the one wrapper for every diff outside the Code
│                        tab, with code-diff-view.tsx, the lazily loaded `@pierre/diffs` view; change-snippet.tsx: a
│                        file's lines as a folded diff for spots and findings), controls (choice, choice buttons, select field, options trigger, copy
│                        button, checklist.tsx: ItemChecklist and ChecklistBlock, every list of things to do on the
│                        kit's Checklist), accounts (sign-in and percent dialogs, usage menu, bar and percent, refresh button, account
│                        status, the account named with its provider, Run on account items)
├── hooks/               use-*.ts: client hooks shared by components (task view, busy action, the minute clock and
│                        use-now, a per-second clock on one shared timer, attention: the tab title, Floaty tags,
│                        sound and notification, a menu item's answer (use-menu-answer), review draft, the Code
│                        tab's saving of the file you edit (use-file-saver), ⌘K key, the Review tab's J and K (use-review-keys),
│                        the Terminal page's ⌘T and ⌘W (use-terminal-keys),
│                        use-idle (useIdle: true once the browser is idle; useIdleValue: a value that catches up
│                        at idle, what hidden pages and tabs render with), the chat's rendered window
│                        (use-transcript-window, trimmed back to its newest blocks when hidden through use-on-hide, which the Overview's activity cap shares), the rows in view of a list (use-row-window) and a long list's rows a
│                        batch at a time (use-progressive-count), use-delayed (useDelayed: true once a wait has
│                        lasted LOADING_DELAY_MS, 300ms), use-settling (useSettling: active, then settling for
│                        SETTLE_MS, 400ms, so an effect can fade out: the delivering light), use-usage-recheck
│                        (useUsageRecheck: re-reads account usage while Settings → Agent usage or the usage menu is open)…)
└── lib/                 Everything that is not JSX, unit-tested at 100%:
    ├── share/           Sharing a task: dialog.ts (Share task's state, its five views, how long a task is shared, share,
    │                    Stop sharing and its confirmation, the banner's words),
    │                    live.ts (openShareStream: the link's live channel to the machine, the hello and welcome
    │                    checked with the key, the views and files it pushes as blob addresses, reconnecting),
    │                    sources.ts (a shared file's text, who is looking), view.ts (the read-only state and task the tab components render),
    │                    page.ts (the shared page's tabs, notes and Shared by line, "you" for its owner; resolveOwnerName: the owner's
    │                    first name and profile, Kai with no `@`, in place of "You" for anyone else), code.ts (the streamed diff and
    │                    whole files in place of a worktree's refs and blobs, a base rebuilt from its hunks);
    │                    components/share/shared-task-page.tsx renders the owner's TaskFrame inside
    │                    components/task/read-only.tsx (ReadOnlyProvider, useReadOnly: every control hides; useReadOnlyNote: the line
    │                    the header shows above the title; useReadOnlyOwner: the owner's name for activity, fact hints,
    │                    the now card, the requests and the hand-over card, null on your own page), and
    │                    lib/connection/read-only.ts (enterReadOnly: while held, sendCommand and every POST refuse);
    │                    components/task/share-dialog.tsx is Share task and Stop sharing's confirmation,
    │                    components/task/sharing-banner.tsx the banner a shared task's page shows
    ├── teams/           Teams (docs/engine.md → Teams): settings.ts (Settings → Teams' words, the new team draft,
    │                    the shared projects dropdown's label, who can reach this machine), admit.ts (adding this
    │                    browser to a teammate's machine with the team key), join.ts (the join page's fragment and the
    │                    browser's team keys in IndexedDB), join-machines.ts (the join page's projects from your own
    │                    machines, and joining and sharing them there), channel.ts (a team channel from the browser with its own
    │                    key, and the engine relay of one task), feeds.ts (teammates' tasks for the focused team,
    │                    merged from the machines and the browser, without machines the dashboard reaches);
    │                    components/teams/ (the new team dialog, the shared projects dropdown, the team rows on All tasks and Home),
    │                    components/settings/teams.tsx and routes/team-task.tsx (a teammate's task, read-only)
    ├── remote/          The remote build: mode.ts (isRemoteBuild, the page for a path, the service worker's path and
    │                    scope, the enrollment link kept through sign-in, MACHINE_ICON, This machine and resolveMachineLabel), dashboard.ts (app.shinsa.dev's
    │                    /__remote/ routes), fleet.ts (Fleet: every machine's connection as one, the merged state, which
    │                    machine owns each id, each machine's own state for placement (listMachines), each machine's own remote access for its access requests (listMachineAccess), the account's machines it cannot reach (listUnreachableMachines), commands sent to the
    │                    machine named or the one that owns them, transcripts and requests sent to their machine), services.ts (the
    │                    remote services and their context, for Settings → Machines),
    │                    devices.ts and indexed-store.ts (this device's key per machine, in IndexedDB, and whether it sits on that machine),
    │                    channel.ts (openRemoteChannel: the handshake, sealed frames, the app socket and HTTP
    │                    inside), link.ts (RemoteLink: the channel per machine, reconnecting, and ChannelSocket, the
    │                    app socket on it), relay.ts (the service worker's relay and the page's side of it),
    │                    enroll.ts (requestDeviceAccess: a link's access request through the invite's connect token, asked again with the same key while it waits and kept as waiting so the page can close; requestWaitingAnswer: the dashboard asking again for a device that left while it waited), device-name.ts (the device name a request starts with, from the browser and system), users.ts (a GitHub user's name, first name, login, initial and profile address, the member who added a device; components/people/user-tag.tsx: UserTag, a person's name with a small avatar in front, as a task chip has its tile, that opens the one user card on hover, UserAvatar, and UserIdentity, the avatar beside "Name login" on one line (no `@`) over a description, View on GitHub in the card and the row's detail in every settings UserRow), policies.ts (Settings → Routing policies: each machine's plain-English routing policies, the machines it can write to and the
    │                    ones this device cannot reach yet, the form's checks and the
    │                    settings each add, edit, move or removal writes), machines.ts (a machine's row, the rows of the account, task capacity's choices, a machine as a
    │                    fleet member)
    ├── connection/      socket.ts (the WebSocket client: the hello with this page's surface, the state and its
    │                    patches applied once per frame, acks, transcripts from the position held (every followed
    │                    run plus the 24 read last, TRANSCRIPT_CACHE_LIMIT), whether the desktop app is connected,
    │                    reconnect), optimistic.ts (the commands shown before the
    │                    server answers, decided on the page and converted to the socket's shape, so a run they
    │                    start has no prompt and a fix its focus), selectors.ts (useShinsaSelector, useTask, useRun,
    │                    useGate: render again only when the part read changes), commands.ts
    │                    (sendCommandWithToast, requestWithToast, copyText), http.ts (requestJson: a JSON
    │                    request whose refusal becomes the server's message), attachments.ts (requestAttachmentUpload: a
    │                    file you attach, as base64 to POST /api/attachments, and the files of a paste or drop), code.ts (the Code tab's reads: refs, paths, tree, blob,
    │                    search and diff, cached by commit in a bounded least-recently-used cache, the last answer shown
    │                    while a newer version loads, never read again for an unrelated task event, and requestFileWrite, the one
    │                    write: saving a file you edit), models.ts, worktree.ts (open in editor / Finder), onboarding.ts
    │                    (the onboarding status, folders, suggestions and the setup steps over HTTP),
    │                    projects.ts (/api/repos/local, adding a repository or a folder to a project),
    │                    terminals.ts (useTerminals over the snapshot the socket holds, /api/terminals changes,
    │                    openTerminal and openTaskTerminal, the foreground check, every /api/services read and change),
    │                    accounts.ts (useAccounts over the snapshot the socket holds, /api/accounts/* changes,
    │                    the sign-in dialog state, refreshUsage and watchUsage over one shared usage recheck), health.ts (/api/health on start and after each reconnect,
    │                    the banner's text and its dismissal), engine.ts (the app against the engine: the engine
    │                    banner's view, the automatic restart and requestEngineRestart), extensions.ts (useExtensions over
    │                    /api/extensions, the server check, every /api/extensions/* change and the MCP
    │                    sign-in watch), versions.ts (useVersions over /api/versions, Check for updates, and
    │                    requestUpdate: the update's lines streamed into its toast; http.ts's requestLines reads them)
    ├── command/         ⌘K: registry.ts (useRegisterCommands, menu open state), score.ts, menu.ts (frames,
    │                    rows, the root's blocks and their scores, Recent, the New task action), global.ts, gates.ts (the commands of every open gate), task.ts and
    │                    task-actions.ts (a task's page), process.ts (check-ins, the quiet agent, suggested
    │                    tasks, delegations), accounts.ts (Accounts group, Run on account, usage waits),
    │                    schedules.ts, terminal.ts (the Terminal page's commands), services.ts (the Services group), review.ts (the Review tab's Next and Previous place), editor.ts (the Code tab's Editor group: every editing key), extensions.ts (the Integrations group), versions.ts (Update Claude Code and
    │                    Update Codex), and one file per page that
    │                    registers commands (tasks, home, settings)
    ├── accounts/        account.ts (every account label and toast, plans, Run on account choices, each provider's
    │                    name and icon), usage.ts (usage rows, tones,
    │                    an account's status and header, the glance at the account the server picks next and
    │                    which row it marks), limits.ts (switch thresholds, the Limits settings), providers.ts (a
    │                    provider's sign-in block: its header, state, the fix, the sign-in command), sign-in.ts (resolveSignInProvider: the Sign in gate's provider),
    │                    usage-wait.ts, recheck.ts (createUsageRecheck: one read at a time, on open and every
    │                    60 s while watched and the page is visible)
    ├── chat/            attachment-drafts.ts (the files a composer holds until you send: the 10-file and 25 MB
    │                    limits, what is ready, whether it can send), task-drafts.ts (one draft per task, in memory: the
    │                    text, attachments and their files every tab's composer reads, and the caret a tab click carries), transcript → timeline → turns, tool descriptions and output, run roles and headlines,
    │                    who worked on a task (agents.ts), notice
    │                    rows, the context meter (context.ts), run evidence, delegations (delegations.ts: views, the tree, a parked step's wait),
    │                    the transcript's blocks and the window of them rendered (window.ts), prefetch.ts (a
    │                    task's last transcripts read ahead)
    ├── code/            The Code tab: location.ts (every view position in the URL: mode, file, line, ref, spot,
    │                    search), tree.ts, file-icons.ts (the icon of a file or folder), prefetch.ts (the Code tab's reads ahead of a
    │                    click: the tab, a hovered row, a file's neighbours and folders, the other refs, the review's snippets,
    │                    and a hovered changed file's side-by-side pair handed to the session to build at idle), rank.ts (quick open), search.ts, refs.ts (the ref picker), source.ts, block.ts (a code block's
    │                    lines, its corner, the command it runs and the text it copies), notes.ts
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
    │                    languages, the unified diff with removed lines highlighted in context, note slots, spot-hints.ts
    │                    (the spot marks the editor renders a `Hint` into), the
    │                    comment gutter, find.ts: the find bar's panel, its replace row and match count, commands.ts: VS Code's editing keys as CodeMirror commands, one list for the keymap and ⌘K, collapsed.ts: the cursor
    │                    stepping over folded lines and the gutter width the sticky folds and notes sit beside, first-change.ts:
    │                    where a changed file opens, its first change 3 lines from the top); diff-view.ts (every diff outside the Code tab: sources, a spot's slice of
    │                    the task diff, notes, the 14-line fold), diff-theme.ts (`@pierre/diffs` on the `--code-*`
    │                    tokens), line-changes.ts (an edit's added and removed counts), and highlight.ts (Shiki for
    │                    the chat on a theme of the `--code-*` tokens the editor reads)
    ├── terminal/        Terminals and services (docs/design.md, 37): view.ts (TerminalView: one xterm.js per terminal,
    │                    kept outside React, its socket and reconnect, its WebGL renderer kept for the six shown last,
    │                    fit only when the pane's size changed, find, clear, the font size; resolveTerminalView),
    │                    theme.ts (the xterm.js options and theme on the `--terminal-*` tokens, the Code tab's `--code-*` colours, its find
    │                    colours, and `--font-mono`), scrollbar.ts (xterm.js's scrollbar shown only on its strip and while
    │                    scrolling, as `ScrollArea`'s is; app.css draws its thumb),
    │                    color.ts (OKLCH, rgb and a colour faded to transparent, to hex), keys.ts (a Mac terminal's keys, and the page's ⌘T and ⌘W),
    │                    replies.ts (the questions the engine answers instead), tabs.ts (the project, tabs, places,
    │                    order and words), services.ts (a service's glyph and its filled twin for the tab in front,
    │                    state words, the trigger's label, which projects the menu shows and each one's counts, the
    │                    empty popover's words, the service in front, starting all, the form, its checks and when a field
    │                    shows its problem, the removal words), services-panel.ts (the Services popover's views,
    │                    how they move, which one shows and its height, and ⌘K's request to open it on Add services or Manage), command.ts (a shell block's command for
    │                    Run in terminal)
    ├── review/          The Review tab (report.ts: the report read as chapters in reading order (how it's built with
    │                    how to test and the steps around the merge, key code, judgement calls with the reviewer's
    │                    disagreements, read carefully with the risks, the agent review), the stops of the index and the one in view, the point count,
    │                    the other changed files, the review card's items; selection.ts: the stop in view and the fading mark on a place you jump to, a store each
    │                    point and the index read their own part of, so scrolling and J and K render only what changes; merge-steps.ts: the steps around the merge, the
    │                    merge they hold, "Post-merge · 2 steps left", when a step can be ticked; testing.ts: what a step to try points at
    │                    (a link, a file in Code, a command or plain text); keys.ts: J and K; places.ts:
    │                    the paths into Code and into the Review tab), the Code tab's spot targets (spots, judgement calls, risks, findings), the fallback
    │                    report, the line-comment draft (sides, ranges, kept in localStorage per gate, and your
    │                    Fix / Dismiss verdicts; serializeComments is what `gate.answer` sends as `comments`),
    │                    finding places
    ├── evidence/        The Evidence section: media.ts (image, video, text, file or link from the URL, a shared page's blob address by its kind; the round's
    │                    evidence), runs.ts (a test or check run's commands, outcomes and counts), layout.ts (the round's items grouped by kind, comparisons as one item, a check's pieces as one item, the viewer's images
    │                    numbered item by item with their parts, the count of items by kind, the folder on disk), texts.ts (the bounded text cache; /ui records its samples in it), prefetch.ts (images and texts
    │                    read ahead with the task)
    ├── overview/        Now card titles, progress steps, activity glyphs and check details, waits,
    │                    questions, verdicts, plan versions, plan parameters, the operation gate and its notes
    ├── tasks/           prefetch.ts (the task under the pointer or highlighted in ⌘K, the queue's tasks read at idle),
    │                    checks.ts (the Checks list: the task's checks and the repository's baseline with their latest
    │                    results, which run now, Shinsa's latest output per check, the pull request's CI checks, the
    │                    summaries; the row a linked test or check renders as),
    │                    Rounds (rounds.ts: the handle with its round, chat sections per round and their dividers, earlier and waiting
    │                    rounds, a round's track and pull request, how a round ships), status and tone per task (Resolving conflicts on a conflict fix),
    │                    task groups and chains, bundles (bundles.ts: a bundle's rows and their states, the Stack on another task
    │                    choices core accepts, the now card's wait and note; groups.ts lists a ready task with its root),
    │                    next action, the now line,
    │                    references, tabs, facts, dependencies, task actions, gate replies (gates.ts), what a message does
    │                    at each gate (messages.ts: the composer hint and toast, from core's resolveMessageEffect), the
    │                    queued messages, when they send (describeQueue, describeRoundRelease: after you merge or
    │                    approve when the round waits for you, from core's resolveRoundRelease), Send now (round.send)
    │                    and whether a started round is still delivering (message-queue.ts), the
    │                    messages on their way to the server (outbox.ts, read with hooks/use-outbox.ts), process
    │                    actions (process.ts), suggested tasks, cost (cost.ts: the facts row's cost control and its
    │                    popover, the one place a task's cost shows, and a limit's Allow another), pull request facts, branch and request text,
    │                    kinds of task (shapes.ts: labels, composed steps, the result panel per step, your OK's
    │                    proposal gate, the steps a task takes), why triage decided each fact (triage.ts)
    ├── notifications/   attention.ts (decisions, the tab badge and status), watcher.ts, sounds.ts,
    │                    browser.ts, settings.ts (the Notifications rows), page.ts (the tab title and Floaty's
    │                    meta tags)
    ├── format/          Counts, times, money, labels, tones, the shared minute and second clocks (clock.ts), a small LRU
    │                    cache (cache.ts), the rows in view of a list (rows.ts), a checklist's progress and a Markdown
    │                    task list's items (checklist.ts)
    ├── preferences/     localStorage: theme, layout, rail width, recent tasks, flags, notifications, the
    │                    terminal's font size, disclosure.ts (every collapsible's open state: useDisclosure,
    │                    createDisclosureId, DisclosureScope; docs/design.md 40)
    ├── desktop.ts       The desktop app's bridge (`window.shinsaDesktop`, absent in a browser and Floaty):
    │                    `data-desktop` on <html>, its navigation, the Dock badge, notifications, the page's
    │                    surface and whether it stays quiet (`isPageQuiet`), the app's version and protocol
    │                    (`selectDesktopBuild`) and its own update (`readDesktopUpdate`, `installDesktopUpdate`,
    │                    `answerDesktopDowngrade` for going back from a beta to the latest stable);
    │                    `DesktopChrome` gives a subtree the app's look without the bridge (the site's demos)
    ├── kept-views.ts    Which pages stay mounted: the hub pages (Home, All tasks, Settings and Terminal, each rendered
    │                    ahead at idle) and the last three task pages, by key, with the URL each was left at
    └── errors.ts (a render error's message and details, the reset key, ⌘K's error toast), queue.ts, home.ts, focus.ts, projects.ts (Settings → Projects: rows, the key line, the dialog's copy and
        checks, repository choices, the actions), workspaces.ts (where agents work: worktrees or the main checkout,
        changing a repository's mode), coverage.ts (a repository's test coverage setting, Auto / Custom /
        Off and the Custom dialog's draft, and the changed-line coverage lines the Review tab and the Overview show; what
        Auto finds comes from connection/coverage.ts, useCoverageDetection over GET /api/repos/coverage), settings.ts, settings-tabs.ts, schedules.ts, automations.ts (a watch's page: its facts,
        reads and filed tasks), secrets.ts,
        onboarding.ts, onboarding-projects.ts (the projects step's drafts, what it sends and its labels), baseline.ts (a repository's Always run before review commands: the choice, the dialog's copy and
        checks, saving them), image-view.ts (fit, zoom, pan and pinch), keys.ts, signal.ts, new-task.ts (the composer's project, start, priority and, with two machines or more, machine: Automatic's choice, the policies' answer from POST /api/placement, each machine's load),
        slack.ts (Settings → General → Slack: the status words, a link's line, the linked page's points, result and
        reasons; connection/slack.ts reads /api/slack, again when the window comes back, and
        disconnects), remote-access.ts (Settings → Remote access: the status words, a device's last use and who added it, the copy of
        the invite link's dialog and its QR code as an image, an access request and the short toast accepting it shows; connection/remote-access.ts reads it from the
        socket's `remote` push, which the connection keeps (`selectRemote`), and changes /api/remote),
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
and toasts, `hover.ts` hovers an element, lets `TOOLTIP_DELAY` pass at once and waits for its tooltip's text, `wait.ts` waits for an element to
leave (`waitForGone`: a failing `expect(element).toBeNull()` prints the whole element on every retry, which took
seconds per closing dialog and timed tests out under load), `teardown.ts` undoes what a helper set up after each test
(`addTeardown`, run by `test/setup.ts`; the editor tests' `createView` destroys its view there), `timers.ts`
`restoreRealTimers` (Bun's fake timers leave a pending zero-delay timer in the real queue, where it stops every later
`setTimeout` of the process, so it runs the due timers first; `test/setup.ts` calls it after each test, so a test that
fakes timers never calls `jest.useRealTimers` itself). Prefer these to
`mock.module`: Bun runs every test file in one process, and in no fixed order, so a module mock, a cache, a dialog left
open or a node left in `document.body` leaks into the files after it; a module's own `afterEach` registers only in the
first file that imports it, so a shared helper never registers one.

**Tests never depend on order**, within a file or across files: `bun test --randomize` shuffles both, CI runs every
package that way and prints the order's `--seed=N` (rerun a failure with `bun test --randomize --seed N`). Each test
sets up what it reads. Module state a test can change is reset after every test in `test/setup.ts`: the connection's
state, transcripts, accounts and terminals (`connection.reset()`), toasts, the highlight and evidence text caches, the
agent providers, disclosures, `localStorage` and the URL. A new module-level cache or store gets a reset function
called there.

**Settle React before the next event.** A `findBy*` or `waitFor` returns once the DOM has the element, but when a real
request settled outside `act`, React runs that render's effects later, on its scheduler: a window `blur`/`focus`, a
key or a click sent straight after can reach the page before `useWindowReturn`, an autofocus or a reset `pending`.
Flush first with `await act(async () => {})` (`settle()` and `comeBackToWindow()` in `test/routes/onboarding.test.tsx`)
and check focus with a plain `expect` after it, never a `waitFor` on `document.activeElement`, whose failed tries
print the whole document.

## Rules

- **The server is the source of truth.** Components read `ShinsaState` from `useConnection()` and act through
  `sendCommand` / `sendCommandWithToast`; there are no optimistic writes, and acting never navigates
  (`docs/design.md`, Where Shinsa differs, 9). The one exception is a chat message you send: it shows as delivering
  from the moment you press send (`lib/tasks/outbox.ts`, `useOutbox`) until the state has it in the task's `inbox`,
  and leaves the outbox when the server answers either way; each sent message is matched to one message that
  landed, so a repeated message stays delivering until it lands too. In the inbox it is still delivering, then
  delivered, noted (needs no reply) or not delivered with the reason (`listHumanMessages` in `lib/chat/timeline.ts`,
  `describeMessageStatus` in `lib/tasks/messages.ts`), or, when it asked for new work while a round runs, queued
  above the composer as a waiting round you can send now to the current round, edit or remove (`lib/tasks/message-queue.ts`,
  `components/chat/message-queue.tsx`; `docs/engine.md` → Rounds).
- **Setup is the server's steps.** The steps, their order, what each answer saves, going back, the help task and
  the welcome task all live on the server (`docs/engine.md` → The setup steps); `routes/onboarding.tsx` only renders
  `GET /api/onboarding/flow` and sends what you pick, a folder path you add, Back, a step you open or a request for
  help (`useOnboardingFlow`; how it looks: `docs/design.md`, 24). Install sends a check's id, and Run in terminal a
  command from the help task's reply, to `POST /api/onboarding/install`; the engine decides what runs. Finishing
  opens the welcome task the flow names (`welcome`), or Home on a run started again. Until `GET /api/onboarding` says setup is complete,
  every route replaces itself with `/onboarding`, and `/onboarding` has no way out: its own shell, no Home button
  and no ⌘K. `/onboarding` goes Home when the run it loads is finished. Run setup again (Settings → Setup, ⌘K) is
  `restartOnboarding`: it starts a new run on the server first, so the page opens on its first step; there is no
  URL flag. No folder path is written into the web.
- **URL state is the view state.** The task tab (`?tab=review|code|chat`), the Review tab's place (`?spot=`), the Code
  tab's whole workbench (`lib/code/location.ts`: `?mode=changes|files|search`, `file`, `diff`, `line`, `end`, `ref`,
  `spot`, `q`,
  `regex`, `case`, `word`, `glob`), focused run (`?run=`), the Settings tab (`?tab=agents`, `lib/settings-tabs.ts`) and the All tasks filters
  (`?status=`, `?q=`) live in the URL, read with
  `useSearchParam` and written with `updateSearchParams`. Build task URLs only with `resolveTaskPath`: it uses the
  handle (`/tasks/SW-142`), and the id for a task triage has not given one yet.
- **Logic lives in `lib/`, JSX in `components/` and `routes/`.** A `.tsx` file holds components and the small
  hooks private to them; anything that computes (a label, an order, a section list, a command list) is a `.ts`
  function in `lib/` with a test. A component used by one route still lives in `components/<domain>/` when the
  route file would otherwise grow past a screenful.
- **⌘K is the only shortcut, but for the Code tab, the Review tab and the Terminal page.** Pages add commands with `useRegisterCommands(sections)` while
  mounted (`docs/design.md`, 14). A command or choice option is disabled only with its reason (`disabled: '…'`, a
  string shown in place of the hint); there is no boolean. While the Code tab is open it binds ⌘P, ⇧⌘F, ⌘F and ⌘G (`hooks/use-code-keys.ts`),
  while the Review tab is open J and K (`hooks/use-review-keys.ts`, not while you type), and while the Terminal page is open ⌘T and ⌘W (`hooks/use-terminal-keys.ts`), each also a ⌘K command or a button; `bun lint:conventions` rejects a global key listener anywhere else.
  A focused terminal keeps its own keys through xterm.js's handler on its element (`lib/terminal/keys.ts`): every
  Control key goes to the shell, and of the ⌘ keys the line-editing ones (⌘⌫, ⌘←, ⌘→), ⌘C, ⌘V, ⌘A, ⌘F, ⌘L, the font
  size and scrolling; ⌥ is Meta unless the layout types a character with it; the rest go to Shinsa (`docs/design.md`, 37).
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
- **A render error stays in its region** (`docs/design.md`, 38). The app root, every routed page (keyed by its
  route, so going there again recovers), every task tab's content and every shell widget that reads live state (the
  top bar's menus and status, the rail's sections) sit in an `ErrorBoundary` (`components/errors/boundary.tsx`)
  of the right size: `page` for a route, `inline` for a region, `icon` for a trigger in a bar, `silent` for what
  renders nothing of its own. A new top-level region, or a new widget in the shell that reads live state, gets one.
- **Every collapsible remembers whether it is open** (`docs/design.md`, 40). Its state is `useDisclosure(persistId,
  defaultOpen)` from `lib/preferences/disclosure.ts`, never `useState`; a collapsible primitive (`Panel`,
  `ReviewNote`, `ExpandRow`, …) takes a required `persistId` built with `createDisclosureId` from what it shows
  (`task:<taskId>:overview:panel:<panel>`), never an index, and `DisclosureHeader` takes the hook's `disclosure`. A
  fold that should be forgotten passes `notPersisted('why')`. `bun lint:conventions` rejects the rest
  (`scripts/lint-disclosure.ts`); `test/setup.ts` resets the store between tests.
- **No comments** (lint-enforced). Names, small modules and `docs/` explain.
- `@shinsa/ui` resolves through its package `exports`; there is no path alias to its sources.

## Commands

| Command | Description |
|---|---|
| `bun dev` | Vite on :5181, proxying `/api` and `/ws` to `shinsa engine` on `SHINSA_PORT` (default 5180, the dev engine's; the Mac app's engine is on 7446) |
| `bun test` | Bun with happy-dom and Testing Library; fails below 100% line and function coverage of `src/**/*.ts` (`.tsx` is covered by behaviour tests, not counted) |
| `bun run check-types` | `tsc` over `src`, `test` and `vite.config.ts` |
| `bun run build` | The production bundle in `dist/`, served by `shinsa engine` |
