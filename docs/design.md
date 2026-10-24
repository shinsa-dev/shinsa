# Shinsa design system

Shinsa's UI follows **paywall-next's Application register**; the kit itself (tokens and primitives
in `packages/ui`) is Buzzkit's, which shares paywall-next's rules. The full paywall-next
specification follows below, unchanged; where it names its own files (`components/ui/*.tsx`,
`styles.css`), Shinsa's are `packages/ui/src/components/*.tsx` and
`packages/ui/src/styles/globals.css` (18 below has the layout). `/ui` renders every token and kit
component in both themes, and Shinsa's shared building blocks and feature pieces (5); when this file
and the code disagree, fix one of them in the same change.

## Where Shinsa differs

Only these, and they win over anything below:

1. **Font.** ABC Areal (variable) for everything, ABC Areal Mono for code. Read every mention of
   Manrope as ABC Areal and of Roboto Mono as ABC Areal Mono. The files are in
   `packages/ui/src/styles/fonts` (Dinamo licence).
2. **Accent.** One blue, `--primary-4` (`oklch(0.6 0.215 256)` light, `oklch(0.62 0.2 256)` dark), with
   a white label. Read every mention of teal as this blue. The chart's first series is the accent.
3. **The primary button keeps a highlight.** `Button` `primary` (the default variant) and
   `destructive` draw `shadow-control`: a 1px edge and a white inner highlight on the top edge. It is
   the one shadow in the system; everything else that looks raised is the `bg-3` hairline (the
   `shadow-1…4` and `shadow-md` tokens are that hairline and nothing else).
4. **Both themes ship.** Light: page white, surfaces `bg-2` `L 0.973`, `bg-3` `L 0.955` (the hairline),
   `bg-4` `L 0.928`, text `fg-4` `L 0.21`; popovers sit on the page colour. Dark: page `L 0.174`,
   surfaces `L 0.197 → 0.299`, text `L 0.946`, popovers a step up on `bg-2`.
5. **No Superwall product pieces.** Sections below about campaigns, paywalls, integrations, the
   Superwall sidebar, app icons, superadmin markers and the date-range control describe paywall-next
   and are kept as reference only. Shinsa's own composites live in `apps/web/src/components/<domain>`.
   The shared building blocks (page heading, toolbar, section label, list row, card, panel, step number,
   choice, select field, copy button, options trigger, info popover, status tiles and marks, times, code text,
   the health banner's card, the setup chat's choice buttons and checks, the confirm dialog, Home's composer) are on
   `/ui` under Shinsa composites (smart links are not), and so are the feature pieces, each in
   every state from sample data: accounts (usage bars and figures, the usage menu, account status, the
   percent and sign-in dialogs at each phase, the Run on account choices and the run label's account), the
   overview's now cards on `NowFrame` (setup, sign-in, usage wait, wait, secret, paused for a failure, a cost
   limit and a wait out of checks, a question with choices, an escalated review's verdicts, a revised plan),
   the quiet-agent note, the follow-ups and delegated work panels, the chat's delegation cards and report rows,
   notice rows and context meter, the schedule and notification rows, and the MCP server, plugin and skill
   rows in every state (29). A piece that reads live state has a
   presentational part that takes props (`UsageMenuButton`, `SignInPrompt`, `RunAccountLabel`,
   `AccountChoiceList`, `ContextGauge`, `HealthCard`, `NotificationGroup`, `ScheduleRow`), and every action
   there takes a callback, so `/ui` never opens the connection or sends anything: an action only shows a
   toast. Still checked only in the app, since they need the live state or a transcript: the rail and the
   queue, the work card's live feed, the review and merge cards, the chat's run sections and live card, and ⌘K.
6. **Long panes get an overlay scrollbar.** `ScrollArea` keeps native wheel, trackpad
   and keyboard scrolling and draws a thin thumb (`fg-a1`) that fades in on hover or scroll,
   lingers briefly, widens under the pointer and can be dragged; a press on the bare track centres
   the thumb there. The geometry is `lib/scroll.ts`, shared with `ScrollFade`. The task chat scrolls in one;
   other scrollers keep the hidden-scrollbar rule below.
   **Content fades where it scrolls under something.** There is one fade: the kit's `scroll-fade` mask on the
   scrolling element (`ScrollArea`'s `fade`, on by default, or `ScrollFade`), 24px at whichever edge still hides
   content, never a gradient overlay. Every page whose body scrolls under a header uses `PageScroll`
   (`components/layout/page/page-scroll.tsx`, a `ScrollArea` with the fade): Home, Settings and the task's
   Overview. The task chat and the setup chat keep their own `ScrollArea` with the fade on, so
   their content fades under the header at the top and into the composer at the bottom; the composer draws no
   gradient of its own.
7. **The task chat follows Kanna's transcript.** One centred column the composer's width; every
   item is a row box (`px-3 py-2 mb-1`, 20px from item to item) with the same inset left and
   right. Agent text is full-width `prose-chat` markdown (13px, 1.625 leading, 20/12px paragraph
   margins, highlighted code fences). A run is introduced by one quiet `text-2xs` label with a
   hairline ("Phase 1 of 2: …"), never icons, agent names, models or times; the one addition is the
   account the run used, "· a@b.com", in the same tone (26). It renders the chat protocol
   (`docs/engine.md`), never a provider's tool names.
   - **While a run works** it shows one live card (`rounded-xl`, `bg-card`): the agent's latest
     interim message (13px, four lines at most) over a quiet `text-2xs` line with a pulse, the
     current step ("Running bun test", shimmering), the time and the step count. A new message
     swaps in: the old one slides up and fades, the new one rises in from below, and the card's
     height eases; under reduced motion it simply changes. The line opens the card onto
     everything so far.
   - **When a run ends** the work folds into one quiet row, "Worked for 3m · 14 steps ›", and the
     final reply sits under it as the main content (the last interim text when a run has none).
     Hand-over cards (plan, phase, fix, review, question) and errors stay outside the fold; the
     brief from Shinsa lives inside it. A message from you starts a new turn with its own fold.
   - **The detail** is the full log on a left hairline: interim messages, then tool calls as 20px
     rows, a 16px icon in a 20px slot about 6px from a medium `fg-3` label (`gap-px`, optically),
     the chevron on hover; two or more in a row fold into one row ("Ran 3 commands and read 2
     files"), and an opened row hangs its detail off a hairline rail. Commands, reads, writes and
     edits render highlighted (language from the file extension), edits as a diff, long output
     capped with "Show N more lines"; images from tool results and evidence show as thumbnails
     that open in the image viewer.
   - **The image viewer** (`components/overlays/image-viewer.tsx`, `hooks/use-image-viewer.ts`) opens every image in
     the chat and in evidence: attachments, tool results, evidence. A `black/85` backdrop, the image
     fitted to the window (never upscaled) and morphing out of its thumbnail (a fade under reduced
     motion). Click toggles fit and 100% (2× for small images) around the pointer, and so does a
     double-click; the wheel, a trackpad pinch or a two-finger pinch zooms toward the pointer; drag
     pans while zoomed; `+`, `-` and `0` zoom from the keyboard. Arrows (on screen and the arrow
     keys) step through the images of the same message or tool group. A close button, Esc or a
     click on the backdrop closes it, back into the thumbnail. A pill at the bottom carries the
     caption (attachment name, evidence title or file name), "2 of 5" and the zoom level.
   - The user's own message is just its bubble (`rounded-3xl`, `border border-border`, `bg-muted`, `px-3.5 py-1.5`);
     attachments sit above it as thumbnails, or as file chips when the browser can't load the path.
     `?tab=chat&run=<id>` scrolls to that run and washes it in `primary-a1`.
8. **One queue, two sizes.** `components/queue/queue.tsx` is the only list of tasks by what they
   need: Needs you (every open decision in focus, in `resolveQueue` order, which `docs/engine.md` →
   Scheduling owns: priority, then what it unblocks, then the kind of decision, then age), In progress,
   and Waiting on another task (in chain order, collapsed). Every section holds only the focus project's
   tasks: the focus is the filter, and the way to see other work is to switch it. The last two take their
   title, icon and tone from the All tasks roadmap (`lib/tasks/roadmap.ts`, see 16; the sections are `lib/queue.ts`), so the two never disagree. Home
   renders it `wide` under the composer: a `text-2xs` label over a `rounded-xl` card, each row a
   20px gate or stage tile, title, status line and age. There Needs you becomes Also needs you
   and leaves out the tasks the guide above already names (hidden when none are left).
   **Home's order** reads what needs you, what is moving, what just happened, then the long tail:
   the greeting, the guide and the composer, then Also needs you, In progress, Recently finished
   (merged or done in the last week, five at most), Recent conversations (the latest agent message
   of five tasks, opening their chat) and Waiting on another task. Recently
   finished is closure news, so it follows the work still moving; Recent conversations is how you
   jump back into a chat, a step after the news; Waiting, the section that starts collapsed in the
   compact queue, goes last, where a long list can never push the timely ones off screen
   (`resolveHomeQueue` in `lib/home.ts` splits the queue around it). The rows of Recently finished and
   Recent conversations start with the task's handle like the queue's (`TaskHandlePrefix`,
   `components/task/handle.tsx`). **The focus filters all of Home**: the guide, every section, every
   count and every row (Recently finished and Recent conversations through `isInFocus` in
   `lib/focus.ts`, the rest through `resolveQueue`). Picking a project or All work in the Focus menu (the current focus checked)
   redraws the whole page from the next state push. Nothing on Home or in the queue button's list shows
   work from other projects, and ⌘K's decisions across tasks follow the focus too; only Jump to a task, a
   search of every task, reaches past it. **Every Home section folds** from its `SectionLabel` header (a chevron, `aria-expanded`), is
   open until you fold it, the long tail included, and Home remembers each choice in `localStorage`
   (`shinsa.home-open.<section>`, `useStoredToggle`), apart from the compact queue's, where Waiting
   still starts folded: folding Also needs you on Home never hides a decision in the queue button's
   list. The sections stack in `WideSections` (`components/queue/queue.tsx`) with one `gap-6` between
   them, open or folded alike: a folded section is just its header, and nothing pulls folded neighbours
   together, so the rhythm never changes when you fold one.
   The page scrolls in `PageScroll`, so content fades out as it passes under the top bar.
   **The Home guide** (`components/home/guide.tsx`) sits right under the greeting, above the
   composer, and renders the briefing (`docs/engine.md` → The briefing) as editorial prose, not a
   card: no border, no tint. The greeting is the page's one heading (`text-base` medium `fg-4`);
   every guide line is a step quieter, `text-sm` `fg-3` with `leading-relaxed` and `fg-4` task
   links, 6px apart. Each line names one task and says why in one sentence, nothing else: "Start
   with ‹task›: why." then "Then ‹task›: why.", "After that, …", "Finally, …". No status words,
   repository chips, pull request numbers or separate action links: the task's tile says the
   state, the link opens the place to act and its preview card holds the rest. Two `fg-2` asides
   follow: what agents are doing (a pulse, two named tasks with their verb, the rest as a dotted
   "2 more" that opens an `InfoPopover` of task rows; left out when nothing runs, since In progress
   below says so) and the note behind an info glyph, never about a
   task the lines above already name; the model is given only the focus project's decisions. Every line
   starts on the column's left edge, an aside's marker included. Inline tiles sit `align-middle`
   and 1px up, centred between the text's x-height and cap height; the aside markers centre on the
   same point. Nothing to
   decide reads "Nothing needs you right now." (`fg-4`) and one calm sentence.
   **Smart links** (`components/links/`) are one inline component per entity, shared by the Home
   guide, the chat, every rendered markdown block and the overview's facts. A task link
   (`TaskLink`) is a 16px state tile (gate or stage glyph) and the title, medium `fg-4`,
   underlined on hover; the tile and first word never part at a wrap. It goes where the work is
   (`?tab=code` for a review, `?tab=chat&run=` for a question or a running agent) and, on hover,
   opens a preview card: status in its tone, what is happening now, repository, branch and pull
   request (each with its icon), how long it has waited (`TimeAgo`, exact time on hover) and its
   one action as a button. A pull request link (`PrLink`) is a tile in the pull request's tone
   (green open, red failing, amber running, purple merged) and `#N`; it opens GitHub and its card
   (`PullRequestDetails`, the same body as the overview's pull request fact) shows the task, CI,
   unresolved comments, conflicts and the checks. `RepoChip` and `BranchChip` are a 14px `fg-2`
   icon and the name (the branch in mono); their cards are the overview's repository and branch
   facts. A file link (`FileLink`) is inline code; when the file is in the current task's diff it
   opens it in Code → All files (`?tab=code&view=changes&file=`) with a tooltip naming the path and
   lines, otherwise it stays plain code. Smart anchors carry `data-smart`, so prose link styling
   (blue, underlined) never applies to them.
   `ReferenceText` and the markdown renderer turn text into these pieces from the reference
   syntax (`docs/engine.md` → References): `shinsa://` links, a quoted task title, an exact title
   of 12 characters or more, and a bare `#N` that only one pull request has. An unknown id or a
   malformed reference renders as its plain label, never a broken link. The current task (the
   page's route) is the scope: its own title is not auto-linked, and file links resolve against
   it. One-line previews (`InlineMarkdown`, inside rows and buttons) show references as plain
   medium text instead of nested links. On Home, `GuideText` keeps "pull request #N" written as
   "the pull request" and does not link numbers, since the task card already shows it.
   **The compact queue.** The sidebar and the queue button render the queue `compact`: collapsible `h-6` headers with a 14px icon in a 20px slot, the same rows
   without the age. Every leading icon in the sidebar (nav items, the Focus dot, section icons,
   row tiles) sits in a 20px slot 6px in from the row (`ps-1.5 pe-2.5`), so their centres share
   one vertical axis. Open and closed sections are shared by both through `localStorage`, and a
   section can always be collapsed, the one holding the task on screen included. Until you have
   toggled a section yourself it opens when it holds the task on screen; after that your choice
   wins everywhere (`useStoredToggle` with `resolveSectionDefault` from `lib/queue.ts`).
   - **A proposed change is a decision.** When an answer, an investigation or a report proposes a change, its
     gate (`purpose: 'change'`) sits in Needs you as Change to approve, purple with `IconFileEdit` like a plan, since
     it decides what gets built (`lib/tasks/status.ts`). Investigating, Researching and Running the operation are
     working stages, blue, In progress, with their own tiles (`IconMagnifyingGlass`, `IconBook`, `IconConsole`).
   - **An operation after the merge is a decision.** When a change's operation runs after its merge, the merged task
     waits at the operation gate (`purpose: 'operation'`, stage `awaiting_operation`): Operation to confirm in Needs
     you, purple with `IconConsole`, the reason core's ("The change merged and the operation waits for your OK").
9. **Acting never moves you.** There is no previous/next stepper on the task page; the queue
   button and ⌘K are how you move between tasks. Approving,
   merging, answering, replying or cancelling stays on the task and confirms with a toast.
10. **Two layouts, picked in Settings → Appearance.** On screen they carry names of their own, kept in one
    constant, `LAYOUT_NAMES` (`lib/preferences/layout.ts`: label, a one-line hint and the icon, read by Settings
    → Appearance, where each layout's choice shows its hint as a tooltip, and by ⌘K's Switch layout): **Desk** for
    Cards ("Pages sit centred with nothing at the sides, and a button at the top opens what needs you.") and
    **Shelf** for Sidebar ("A rail at the side lists every task and stays open, so each one is a click away.").
    Desk is the default. Renaming them is that one constant; the code, the `?layout=` param and this file keep
    `cards` and `sidebar`.
    Cards (the default) has no rail: a top
    bar with a "3 need you" button that opens the compact queue, and task pages centred on the
    same axis as Home (see 12). The button sits at the top left, right after the Shinsa logo,
    because that corner is navigation and nothing on the right (Focus) moves when it comes and
    goes; it shows on every task page at every width, and it is the only place Cards lists the
    queue outside Home (there is no queue card beside the page). Sidebar is a permanent rail with
    the queue; it never hides. From
    `md` (768px) up it sits beside the page; below it, it opens as a sheet. The app has one
    keyboard shortcut: ⌘K (Ctrl K elsewhere) opens the command menu (see 14). Nothing else is
    bound to a key, and Enter sends in every input.
11. **No focus states.** Nothing marks keyboard focus: no ring, outline, border recolour or wash
    (Shape & depth → No focus states). Focus rules below are paywall-next reference only.
12. **The task page has one left edge and no details panel.** The heading is a `text-base` medium
    title over the task's request as a `text-xs` `fg-2` description (`gap-px`, two lines at most;
    a long request expands on click), with the task view tabs at the end. The header carries no
    gate action: "Approve" alone never said whether it approved a plan, the changes or a merge.
    The decision lives on the Overview's first card, next to what it decides on. Its
    title, the tab labels and the content (the Overview cards, the chat column) start on the
    same left edge at every width and on every tab, so switching to Code never moves the heading:
    in Sidebar the header and 36px tab row compute their start padding from the centred
    `max-w-3xl` column; in Cards the heading and tab row sit in that column themselves. Shared
    pieces (heading, facts, task menu, the
    code view) live in `components/task/` and `components/code/`; `routes/task/index.tsx` picks the
    Cards or Sidebar frame.
    - **The decision card.** The Overview opens with the task's now card
      (`components/overview/now-card.tsx`), and a gate's actions sit at its top right, each named
      for what it decides: a review gate has Review (outline, opens Code) then **Approve
      changes** (primary; its tooltip says it opens the pull request, and it is disabled while
      line comments are drafted); a merge gate has Review then **Merge #N**; a plan gate has
      **Approve plan** over the plan itself (a change with an operation lists it under its phases, headed
      "First, the operation" or "After the merge, the operation"); an operation after the merge has **Run the
      operation**; a paused task has Retry; a question has its answer
      box. Status labels say what waits on you the same way: Plan to approve, **Changes to
      review** (never the bare "Ready for review"), Ready to merge.
    - **Panels keep their action when collapsed.** An Overview panel's header action ("Review the
      code" on What changed) stays in the header whether the panel is open or closed
      (`components/layout/surface/panel.tsx`).
    - **Task facts.** What a details panel would hold is one quiet wrapped row under the heading on
      every tab (`components/task/facts.tsx`, rendered by `TaskHeader`): state, repository, branch, pull request,
      priority, started (added, for a task that has not started), and, when they apply, the task
      it is stacked on (older tasks only), what it waits on and what it unblocks (or the checks,
      when there is no pull request yet). Waits on reads "Waits on ‹A›, ‹B›" and is a click menu,
      not a popover (`WaitsOnItems`): the tasks it waits on (each opens, with its status), then
      Wait for another task (a submenu of open tasks with a checkmark on each it waits on; the
      ones it waits on sort first, a click ticks or unticks one and the menu stays open) and Stop
      waiting (clears them all). Each item is an `h-6`
      chip, a 14px icon 6px from `text-xs` `fg-3`, `px-1.5` and pulled out by the same amount so
      the first icon sits on the column edge. Items with more to say open an `InfoPopover` on
      hover (see 15), never a tooltip: the pull request shows CI, unresolved comments, mergeable, each
      check with its state and a link to GitHub; the branch its full name and base; the
      repository its path, project and default branch; several related tasks list as links.
      Priority shows its level's mark (bars for low, normal and high, a red square with `!` for urgent, from `components/status/priority-icon.tsx`) and opens the priority menu, whose items carry the same marks; the task menu has no priority.
    - **Cards.** The column is centred on the window, the same centre as Home, with nothing in
      the gutters. The queue is the "3 need you" `sm` secondary button at the top left of the top
      bar (see 10), one step brighter than a secondary button's rest: `fg-3` (secondary), not `fg-2` (muted), opening the compact queue (current task highlighted, every section: Needs you,
      In progress and Waiting on another task, all within the focus project) in a popover.
    - **The handle.** A task's handle (`SW-142`, its project's key and a number) is how people name it: the facts
      row starts with it (a click copies it and toasts "Copied"), roadmap rows, queue rows, ⌘K rows and a task link's preview card show
      it in `tabular-nums` `fg-2`, ⌘K finds a task by it, and the tab reads "SW-142 Fix login · Shinsa" on its page.
      Task URLs use it (`/tasks/SW-142`), built only by `resolveTaskPath`; `/tasks/<id>` and a handle in any case
      still open the task (core's `selectTaskByReference`) and are replaced by the canonical URL. Until triage gives
      a task its handle, its URL and links use the id and nothing shows a handle.
    - **The facts row is one colour.** Every fact under the title (the handle, the status, the kind, the
      repository, the branch, priority, times, cost, account, related tasks) is `text-xs` `fg-2`, the muted
      foreground the handle always had (`FACT` in `components/task/facts.tsx`), turning `fg-4` on hover when it opens
      something. The status keeps its tone on its dot, and a state glyph or a warning note (failing checks, a
      pull request's conflicts, a budget gone over) keeps its own colour; the words around them do not.
    - **The kind of task.** Every task's facts name its kind (`lib/tasks/shapes.ts`, `resolveShapeLabel`: Answer only,
      Investigation, Research, Change, Find and fix, Operation, or for steps the planner composed the work they do in
      the order they do it, "Investigation, then operation", "Change, then operation" for a backfill after the merge,
      "Operation, then change") with the icon of the work it does, right after the status. Its tooltip lists the steps
      in pipeline order ("Change, then operation: plan, build, checks and agent review, your review, pull request,
      merge, then run the operation.", `describeTaskSteps`) over a muted line of why. The kind is Shinsa's and the
      planner's to decide: it is a read-only fact, and no menu, composer select or ⌘K command changes it.
    - **Each fact says why, once.** What triage decided has no line of its own: the facts row shows each value once and
      its tooltip says why (`resolveTriageWhy` in `lib/tasks/triage.ts`): "Shinsa chose this: …" while it is Shinsa's
      pick, "You changed this. Shinsa chose “answer only”: …" once you changed it, and "An agent set these steps: …" once
      the planner composed them. The kind's why is the muted line under its steps; the priority's is its tooltip; when
      the task starts is the Waits on fact's tooltip while it waits (its menu changes it) and the muted line of the
      Started time's tooltip once it runs. Each fact's menu is the override: the priority menu and the Waits on menu.
      No "Auto" label is shown.

13. **Anything you hover that has more to tell has a tooltip**, as in Buzzkit. Four kinds:
    - **Every time** goes through `components/text/time-ago.tsx`: `TimeAgo` ("2h ago", or `compact`
      for the bare "2h" a row ends with, or `text`, a function of now for a phrase around the age such
      as "Started 2h ago", so it ticks with the minute) and `Duration`
      ("Worked for 3m", the live card's running clock). Each renders a `<time>` whose tooltip
      opens after 150ms with the exact moment: the date bright and the clock muted
      ("Wed, Oct 22, 2026 2:14 PM"); a duration shows "2:14 PM to 2:17 PM" ("Since 2:14 PM" while
      it runs) with the day muted. `detail` adds a muted second line naming what the time is
      when the row doesn't say it ("Waiting on you", "Step started", "Finished", "Last message").
      Toasts are the only times without one. A bare `formatAge(…)` or `formatDuration(…)` in JSX
      is a bug, and the lint below rejects it.
    - **Icon-only buttons** name their action in a tooltip through `Hint`
      (`components/overlays/hint.tsx`): copy ("Copy", then "Copied"), the task and project `•••` menus
      ("Task actions", "Project options"), collapse and expand ("Collapse summary"), previous and
      next spot, the image viewer's close, previous and next (with their key, `Esc`, `←`, `→`),
      send, comment on a line, the compact bar's queue and new-task buttons, the sidebar's resize
      handle (following the pointer down the edge). The tooltip repeats the `aria-label`. A `Hint` with a `detail`
      stacks a muted second line under its label, as a time's tooltip does (the kind of task's why, 12).
    - **Every copy says "Copied" in a toast.** Copying anything (the task's handle, a commit, a branch name, a
      command, a code block, a webhook URL) goes through one helper, `copyText` in `lib/connection/commands.ts`:
      it writes the clipboard, toasts "Copied", or "Couldn’t copy to the clipboard" when the browser refuses, and
      reports which. `useCopyText` (`components/controls/copy-button.tsx`) wraps it for a trigger that also swaps
      to its "Copied" state; never call `navigator.clipboard` anywhere else. This replaces the "No success toast"
      of Components → Copy below.
    - **Text from data that can be cut off** is `Truncate` (`@shinsa/ui/components/truncate`):
      task titles in every row, previews, repository names and paths, branch and file paths,
      check names and details, tool targets, run headlines, attachment names, the image
      caption. Its tooltip, with the full text, appears only when the text really is clipped.
      Text that is already a popover or menu trigger (the Focus menu, the repository and branch
      facts) keeps a plain `truncate`, so two overlays never stack.
    - **Small marks that carry meaning without a label** get a short tooltip: queue tiles
      (`GateGlyph`, `WorkingGlyph`: "Changes to review", "Building · Agent working"), the
      finished tiles on Home ("Merged", "Done"), project dots ("Superwall project"), check and to-do
      icons ("Passed", "Failed", "In progress"), the progress track's steps (step, count and
      state, then the plan's phases), the diff counts ("12 lines added · 3 lines removed"), a
      changed file's status letter ("Modified") and risk dot ("High risk" and the reason), its
      comment count, a pull request badge in the pull request's tone ("Pull request #4531 · Checks passing"), a
      repository's GitHub or folder icon. The command menu's search button reads "Search and actions" with
      its `⌘K` key.
    Content follows Buzzkit's scanning rules: the value first in `fg-4`, the qualifier muted in
    `TooltipLabel`, states in their status colour (`*-text`), lists one item per line in the
    foreground, mixed bright and muted text inside one `whitespace-nowrap` span. Never a sentence
    where a value and its label will do.
14. **The command menu (⌘K) reaches the whole app, and knows where you are.** It is Buzzkit's
    menu (`components/command/menu.tsx`, rendered once by `Root` on `CommandDialog` from
    `@shinsa/ui/components/command`), opened by ⌘K / Ctrl K from anywhere (inputs included) or
    by the magnifying-glass button in the sidebar header and the compact bar. Every action goes
    through the same `sendCommand` the buttons use; the menu adds no commands of its own.
    - **Pages contribute what they know.** `useRegisterCommands(sections)`
      (`lib/command/registry.ts`) registers ranked sections while a component is mounted
      and drops them on unmount; the latest closures sit behind a ref and the menu re-renders
      only when the serialised sections change. A command is `run`, `go` (a path), `link`
      (opens a new tab), `page` (a nested list, or a `compose` page whose input becomes a
      message field), `choice` (a value list, current one checked) or `search` (types the query
      into the page's own search). Context sections sort first (`RANK.context`), then the queue
      (`RANK.next`), then the global ones.
    - **On a task page** (`TaskHeader` calls `useTaskPageCommands`, so Sidebar and Cards share
      it) the task leads: its decision first, each named for what it does (Approve the plan /
      Revise the plan, Approve the changes / Review the changes / Request changes, Merge #N or
      Merge the pull request, Answer the question, Retry / Retry with guidance, or Allow another $N for a cost
      limit; Sign in / Retry anyway for a Sign in gate; Give the ‹label› / Don’t give the secret for a secret;
      Resume now and the auto-resume toggle for a usage wait), then View (Overview, Code, Chat, and Guided review / All files on Code), then
      This task (Wait for another task…, a choice that ticks every task it waits on and toggles
      the one you pick, and Stop waiting, Set priority with the priority icons,
      Message the agent, Open the pull request
      on GitHub, Copy branch name, Open in editor, Open a terminal, Show in Finder, Restart the
      current step, Mark as done, Cancel task behind a confirm page), then Next and Previous
      task that needs you (`resolveQueueStep`). Request changes carries the review's draft line
      comments and Approve the changes is disabled while there are any, as on the page.
    - **On Home** it is about getting to tasks: Needs you lists the tasks waiting on a decision
      (the briefing's Now task first, then queue order, up to eight), each row opening its task;
      their decisions stay out of the root and match only while typing. **Settings** offers Jump to (each section,
      with the tab that holds it as its hint, from anywhere: it opens that tab and scrolls the section into view;
      `openSettingsSection` in `lib/command/settings.ts`), Change a setting (every setting's select as a choice; a project's own controls stay on the
      page) and Setup (Run setup again). **All tasks** offers Filter by
      status, Clear filters and "Search all tasks for …"; the filter and search live in the URL
      (`?status=&q=`), and an active status shows as a removable button beside the search.
    - **Global**, in groups: Tasks (New task, which opens Home with the composer focused, as the rail's and the
      compact bar's New task do, and
      Jump to a task, a page of every task), Go to (Home, All tasks, Settings), Focus (Switch
      focus project; keeping it for 2 hours or until tonight is `searchOnly` and appears only while
      typing), Appearance (Switch layout, Change theme), Accounts (Add a Claude account, Agent usage, which opens
      Settings → Agent usage, and Default account once there is an account; 26) and Schedules (Schedules, which opens the section, and each schedule
      by name while typing; only while there is one; 27), and Integrations (Add an MCP server, MCP servers, Plugins
      and Skills, and while typing each server, plugin and skill by name; 29). With an empty query, Recent lists the
      last tasks visited (`shinsa.recent-tasks`) within the focus that no group above already shows.
    - **Typing** matches by word (`lib/command/score.ts`: whole label, label prefix, word prefix, then
      substring; hints and keywords count at 0.7). Groups are ordered by their best match, since
      cmdk's own group sort does not work. Choices flatten into their options ("urgent", "dark",
      "cards"), every task matches by title, repository, branch and status, and the queue's
      decisions match across tasks ("merge" finds Merge #4531 on whichever task it is). At the
      bottom, always: "Create task: …" (starts it straight away) and "Edit it before starting"
      (Home's composer, filled in).
    - Rows: 24px. Icons are plain, never on a tile; a task's is its status icon in the status
      colour, then the title as `Truncate`, the repository as the hint and the status at the
      right edge. The current value of a choice (and the current page or view) carries a 14px
      check in `primary`. There is no footer. Pages show a crumb in the input whose text sits as
      far from the search icon as the query does; Backspace on an empty input goes back and
      re-selects the row that opened the page; a choice page opens on the current value.
      `CommandList` takes the page as `page`: entering scrolls the list to the top, going back
      restores the scroll it had, and the highlight slides from where it was on screen to the
      new row instead of travelling through the list's scroll (cmdk never scrolls a controlled
      value into view, so the list does it). Closing resets the menu to the root. Escape restores
      focus to where it was; a command that runs declines the restore so what it focuses keeps
      it.

15. **Consistency comes from shared pieces, not from care at the call site.** Everything below
    has one owner; a hand-built copy is a bug. Measured in the browser at 900 and 1280, both
    themes.
    - **Info popovers** (`components/overlays/info-popover.tsx`): anything that shows more on hover (task
      facts, smart-link preview cards, "2 more", related tasks) is an `InfoPopover`, built on
      `PreviewCard`. It opens on hover after 80ms, closes 120ms after the pointer leaves, sits
      8px from its trigger (bottom, start), and a click does nothing to it: it never toggles or
      sticks open. Real menus (priority, the task menu, focus, the queue button) stay click
      dropdowns. Inside: `InfoHeader` (title over a `text-2xs` description, `gap-px`,
      `px-3 py-2.5`), `InfoSection` (a hairline above, optional `text-2xs` title) and `InfoRow`
      (a 28px label/value row: icon and label left, value right, 16px minimum between them).
      Task lists inside one are `TaskPopoverRows` (`components/links/task.tsx`): glyph,
      title over status line, `rounded-item` rows in a `p-1` frame.
    - **Label and value pairs** in popovers and tooltips sit apart: label left, value right
      (`justify-between`, `gap-4`), via `InfoRow` or `InfoLine` for tooltips. Never a value run on
      after its label with a space. A status the icon already says is not printed: no "Done",
      "Complete", "Passed" or "Passing" next to a check (the progress track's step tooltips are the exception: every step says its status, "Done" included); "In progress", "Failed", "Running",
      "Waiting on you" stay.
    - **Checkmarks are the accent**, everywhere: check and to-do glyphs, the current value in a
      menu, a select or ⌘K, copy confirmations, done tiles, settled tasks in ⌘K, the "decision"
      activity, toasts, popovers, tooltips, and GFM task-list checkboxes in agent markdown
      (`accent-color`). They come from `components/status/check-mark.tsx` (`CheckMark`, `SelectedMark`, `CHECK_TEXT`,
      `CheckOutcomeIcon` for pass / fail / skipped). The one exception
      is the progress track: its done steps (a 15px check on `green` at 29%) and the line
      between them are green, so done reads apart from the blue pulse of the current step.
    - **Page headings** (`components/layout/page/heading.tsx`): one `PageHeading` for Task, All tasks
      and Settings (Home's greeting uses its `PAGE_TITLE`): a `text-base` medium `fg-4` title on a
      20px line (`leading-tight`), the description or count `text-xs` `fg-2` directly under it
      (`gap-px`), flush with the column's left edge.
    - **Canvas sections** (`components/layout/page/section-label.tsx`): a `SectionLabel` (`h-6`, `text-2xs`
      medium `fg-2`, the count in normal weight, `px-1`) 4px over its card, with an optional action at
      the right. Home's sections and every Settings group use it. The action's buttons sit 2px apart
      (`gap-0.5`, the one 2px gap in the web, which `SectionLabel` owns: Refresh beside Add account or Add
      server), so callers pass them as a fragment. With `onToggle` it folds: the
      label and count become one button with a 14px chevron (`SectionChevron`, turned when closed,
      shared with the compact queue's headers) and `aria-expanded`; every Home section uses that
      (`WideSection`), Settings keeps the plain label.
    - **Settings has tabs** (`lib/settings-tabs.ts`, `SETTINGS_TABS`; `routes/settings.tsx`): General (Appearance,
      Attention, Notifications, Context, Setup), Agents (Agents, Engine), Agent usage (Agent usage, Limits; the tab keeps `?tab=accounts`), Projects (Projects, Repository
      folders), Integrations (Context optimizer, MCP servers, Plugins, Skills; 29) and Automations (Schedules). There is no Advanced
      tab; an old `?tab=advanced` link opens General, which holds its sections. Each is its own pane, not a scroll position: the main use is a
      floating, tablet-sized window, where one long page meant scrolling past everything to reach anything, and a
      scroll-spy table of contents would have kept that page. The tab is in the URL (`?tab=agents`; General is
      the bare `/settings`), and a link to a section (`/settings#limits`, the old `#accounts`, `#usage` and `#codex` too) opens
      its tab and scrolls to it. Where the page is wide enough for a rail beside the centred column (a container
      query, 74rem, so 1280 in Cards), the tabs are a left rail in the left gutter, the sidebar's `NavItem`s
      (`components/layout/nav-item.tsx`) under one `HoverHighlight`, sticky, with the column still on Home's axis,
      the active tab's icon the filled variant of its outline icon (`activeIcon`, `IconSettingsGear1Filled`…, as
      the sidebar rail does); narrower, they are the segmented `Choice` under the heading, the task page's tab
      control. The page heading is the open tab's name ("General", "Agents"), never "Settings".
    - **Settings is titles only**: the group label and each row's title with its control (a 40px
      row). There are no section or row descriptions (`SettingsGroup` and `SettingRow` take none), so a
      title and its options must say what a setting does on their own ("Setup questions" with Run setup again).
      A row may still show data under or beside its name (an account's reset time, a schedule's summary, a
      path); the two layout names keep their hint lines as tooltips on Desk and Shelf (`Choice` items take a
      `hint`). Model selects show
      the display name ("Opus 5.5") from the first paint (`KNOWN_AGENT_MODELS`, refined by the live
      catalog), never the raw alias.
      Section → section is 24px (`gap-6`) on every page.
    - **Settings → Projects** (`components/settings/projects.tsx`): one `SettingsBlock` per project, 6px apart. The
      header holds the colour dot, the name (medium `fg-4`) and the key as a mono `Badge` (its tooltip: "Tasks in this
      project are named SW-1, SW-2…"), then a secondary `xs` Add and the `•••` (Rename…, Change key…, Edit or Add
      description…, Colour, Remove project). The shelf is one list of what the project holds: each repository
      (GitHub or local icon) and each folder (`IconFolders`, the folder's name), all as `PathRow`s (a 14px icon 8px
      from the name, the path after it in `text-2xs fg-2`, a remove ×), and "No repositories or folders yet." when
      empty. Add is a menu of the repositories found on disk ("In your folders", "In other projects") and Folder
      by its path…, which puts a path field with Add folder and Cancel (Escape) at the end of the shelf. The
      description lives only in its dialog.
    - **A project's dot lines up with menu icons**: in any menu or select the dot sits in a 14px box
      (`ProjectDotIcon` in `components/status/project-dot.tsx`), the size of a menu icon, so the label after it
      starts where every other item's label does (the focus menu, the new-task project picker, ⌘K's choices, a
      project's Colour menu).
    - **Cards** (`components/layout/surface/card.ts`): `CARD` (`rounded-xl`, hairline, `bg-card`) is the only
      card surface. A card pads the same on all four sides; the shared `Card` slot carries no
      padding of its own, so nothing doubles up. Settings groups are `p-1.5` (6px on every side,
      measured), rows inside `pl-2 pr-1.5` (`SETTING_ROW`, a 40px minimum with `py-1` only so a wrapped
      line keeps 4px from the row's edge), so text sits 14px from the left edge and a control 12px
      from the right, and an inner surface (a project's repositories) sits 6px from the card on three sides.
      Settings has one grouped pattern, the projects card's (`SettingsBlock` and `SETTINGS_SHELF` in
      `components/settings/group.tsx`): a 32px header row with no fill, then the rows that
      belong to it on one `rounded-item` `bg-bg-a1` shelf with hairlines between them, blocks 6px apart (`gap-1.5`)
      and no hairline between blocks. Projects, accounts and the agent groups' per-role rows use it. A control on the shelf
      has no fill at rest, since the shelf is already the second surface: never a fill on a fill. A button there is the
      kit's `secondary` (its ghost; `CopyButton` is always one), a select `ghost`; the one exception is an MCP server's
      Connect, primary `xs`, the one thing to act on. `CARD_HEADER` is the one card header strip (36px, `bg-bg-a1`, 14px icon 8px
      from a `text-xs` medium `fg-4` title, `px-3`), used by `Panel`, the chat's hand-over cards
      and the live card's row; `CARD_FOOTER` the one footer (`px-3 py-2.5`, `bg-bg-a1`). Every
      card's inset is 12px (`p-3`): the Overview's now card included. Anything nested in a card
      or in the chat column (answer box, code fences, code snippets, tool blocks, images,
      message links) is `rounded-lg`.
    - **Composers**: the task composer, Home's new-task box and the question's answer box share
      `COMPOSER_FIELD` (text 12px in, 10px from the top) and `COMPOSER_FOOTER` (6px around a
      28px `sm` control, no divider).
    - **Title over description is `gap-px`**, with no exceptions: page headings, card eyebrow over
      title, list rows, activity rows, plan and phase steps, check rows, popover headers and
      task rows, review findings, message links. A title next to its description on one line
      (⌘K rows, a section label and its count, "Waits on ‹task›") is 6px (`gap-1.5`).
    - **Numbered steps** are `StepNumber` (`components/layout/surface/step-number.tsx`): a 20px `bg-bg-a2` tile,
      `rounded-control-sm`, in the plan, What changed, the chat's plan card and the review
      walkthrough.
    - **Task actions** have one source, `lib/tasks/actions.ts` (`TASK_ACTION`: label and
      icon). The task page's `•••` menu, the All tasks context menu (`TaskActionItems` in
      `components/task/action-items.tsx`) and ⌘K's
      This task section all read it, so every action carries the same icon everywhere: copy
      branch, open the pull request, open in editor, open a terminal, show in Finder, restart the
      current step, mark as done, and Cancel task in the destructive style.
    - **Dependencies** have one source, `lib/tasks/dependencies.ts`, drawn by
      `components/task/dependency-items.tsx`: `DependencyItems`
      (the Wait for another task submenu and Stop waiting) sits in the task page's `•••` menu, the
      All tasks context menu, the Waits on fact and All tasks' chain arrow (`WaitsOnItems`);
      `listDependencyCommands` (`lib/command/task.ts`) gives ⌘K the same two ("Wait for another task…" as a multi-value
      choice, `value` a list, every current one checked, "Stop waiting"). Several at once is the
      normal case: every list adds or removes one task and never replaces the others. Before building
      starts the label is Wait for another task; once building has started it is Merge after
      another task, because that is all a new dependency can still do.
    - **Status tones** come from `lib/tasks/status.ts` and `lib/format/tone.ts`, nowhere else:
      Needs your answer blue, Paused orange, Changes to review amber, Plan to approve purple,
      Ready to merge green, working stages blue, Waiting on another task neutral; Setup incomplete and Sign in
      needed are orange like Paused, and Waiting to check again, Waiting for the usage limit and Waiting for
      delegated tasks are blue like working. The All tasks section icons,
      the queue's section icons, the gate tiles, ⌘K's task icons and the status labels all read
      them (`resolveTaskGlyph`, `resolveTaskStatus`).
    - **Hover is never the only feedback**: every `hover:` class has the same `active:` value on
      the same line (`group-hover:` pairs with `group-active:`, unless it only reveals something
      from `opacity-0`). The lint checks that an `active:` is there, not that its value matches.

16. **All tasks is the roadmap.** `routes/tasks.tsx` (rows in `components/roadmap/`) lists every task in
    to-do order, grouped by `resolveRoadmapGroup` (`lib/tasks/roadmap.ts`): Ready to merge, Changes to review, Plan to
    approve, Needs your answer, Paused, In progress, Waiting on another task, Done and Cancelled
    (both collapsed). Each section header is a sticky
    `h-8` row: its icon in the section's status tone (see 15), the title, the count, a chevron.
    Inside a section rows sort by priority, then oldest first; Done and Cancelled show the latest
    first. Waiting on another task is drawn as a tree that handles every shape
    (`orderChains`): each task appears once. Its depth is its longest path from a task outside the
    section, and it sits under the parent at the level above that comes last on screen, so in a
    diamond (B and C wait on A, D on B and C) D sits under whichever of B and C is shown second,
    after both. Fan-out siblings sit side by side under their parent. The status column names
    every parent, "Waits on ‹A›, ‹B›", each a link that opens it and truncates on its own, with
    all of them, one per line, in the tooltip ("‹task› was cancelled" when one was). A nested
    row's corner arrow sits under its parent's priority mark (26px per level) and is a 20px
    button: `bg-bg-a2` and `fg-4` on hover and pressed alike, the same while its menu is open,
    "Waits on" and the parents in its tooltip; it opens the Waits on menu. Every row starts with
    its priority mark, and its status column with its kind's icon in `fg-2` (`SHAPE_ICON`, named
    for screen readers) whose tooltip lists the steps the task takes ("Investigation: find the
    repository, investigate, then your OK to change.", composed steps included, `describeTaskSteps` in `lib/tasks/shapes.ts`,
    from core's `resolveTaskProgress` with a plan's phases as one build). Filter by status in
    ⌘K offers the same sections with the same icons.
    - **Change to approve** is its own section between Plan to approve and Needs your answer (`IconFileEdit`,
      purple): a proposed change decides what gets built, like a plan, but it is not a plan yet.
    - **Operation to confirm** follows it (`IconConsole`, purple): a merged change whose operation waits for your
      OK on the merged code.
17. **New tasks can wait.** Home's composer has a When to start select beside priority: Start now,
    or "After ‹task›" for each open task of the project the composer shows. Picking one sends `blockedBy` with `task.create` and the
    button reads Add instead of Start.
    - **Auto is the default.** The composer's selects, in order Project, When to start and Priority, start on what
      Shinsa would pick. Project shows the focus project ("No project" without a focus) with its dot, then every
      project by name and No project; picking one sends `projectId` (`null` for No project), leaving it sends
      nothing, so the task joins its repository's project, else the focus. When to start and Priority start on an
      Auto item ("Auto start" with `IconCalenderSparkle`, "Auto priority" with `IconChart3`), and Auto sends nothing
      for that part, so triage decides it (`createNewTaskCommand` in `lib/new-task.ts`). Picking a value sends it;
      Start now sends `blockedBy: []`. There is no kind select: the placeholder says Shinsa decides what kind of task
      it is, and the button reads Start, or Add for a task that waits.
18. **The kit (`packages/ui`).** Imported as `@shinsa/ui/components/<name>`, `@shinsa/ui/lib/<name>`,
    `@shinsa/ui/hooks/<name>` and `@shinsa/ui/styles/globals.css`:
    - `src/components/` holds every primitive the app renders, one flat file each (`button.tsx`,
      `dialog.tsx`, …); the icon set is the one folder, `components/icon/`. A primitive nothing but `/ui`
      renders is deleted, with its tests, its `/ui` entry and any dependency only it used.
    - `src/lib/` is the logic the components share, pure and unit-tested: `cn` (with the theme's
      corner, shadow and leading tokens taught to tailwind-merge, so `cn('rounded-control',
      'rounded-popup')` keeps only the override), `scroll.ts` (edge fades, the overlay thumb, drag
      and track presses), `truncate.ts` (the middle cut), `pointer-intent.ts` (preview cards
      holding while the pointer heads for them) and `icon-swap.ts`.
    - `src/hooks/`: `useMediaQuery`, `useControllableOpen` (open state for
      `Select` and `DropdownMenu`, controlled or not), `useDialogState` and `useHeldValue` (a
      dialog that closes without a visible change, 26) and `useAnimatedIndicator` (the sliding
      highlight behind menus, lists and tabs).
    - `scripts/generate-icons.ts` is the icon generator (below), with its logic in `scripts/icons.ts`.
      `bun run --cwd packages/ui test` runs `test/` (Bun with happy-dom and Testing Library) and fails
      under 100% line and function coverage of `lib`, `hooks` and `scripts` (the generator's entry point
      excepted); the components that carry behaviour are tested for it (states, roles, names), never for
      class strings.
19. **Icons are Central Icons**, through `<Icon name='Icon…' />` from `@shinsa/ui/components/icon`.
    Read every mention of Lucide, `SIcon` or an owned `icons.tsx` below as this. The paths are
    pre-rendered into `components/icon/paths.ts` from the names the workspace uses: run
    `bun run --cwd packages/ui generate:icons` after using a new name (`--check` fails when the
    file is stale, and the kit's tests check it too). Marks Central lacks (the priority bars, brand
    marks) are drawn into `components/icon/custom.ts`. Chevrons draw square-cornered. **An icon is its text's colour, about 15% quieter.** You read the
    text; the icon is taken in passively, so the two are never equally strong. `Icon` draws in
    `currentColor` at `--icon-alpha` (globals.css): 85% of its text (`--icon-alpha-text`) by default, 90%
    in a menu, select or command row (`--icon-alpha-item`, set by the row's `icon-item`), so a
    row's icon is the row's `fg-3` at 90%, turning `fg-4` with the label when highlighted. Tune the
    strength there, in one place. Contexts that keep the icon equal to its text set `icon-solid`: a
    secondary (ghost) button, whose ink is already the muted `fg-2` and would drop below a readable
    contrast (the usage glance in the top bar is the reference), an icon-only button (the glyph is the
    whole label), a destructive menu row and the error toast (an error may stay at full strength). Everything else follows the rule: a Button's icon is its ink at 85% (white on
    `primary` and `destructive`), a Badge's its text's tone, a muted hint line's glyph the line's `fg-3` at
    85%. Status glyphs are the status text's colour at 85%: `StatusTile` gives its icon `TONE_TEXT[tone]`,
    the same class as the status label. An icon never takes a lighter `fg-*` step than its text, and a call
    site never writes its own fade (`opacity-50`, `[&_svg]:opacity-*`, `icon-tertiary`): a reveal goes
    `opacity-0` → `opacity-(--icon-alpha)`, the icon swap lands on `--icon-alpha`, and a disabled control's
    `opacity-45` is not muting. `bun lint:conventions` rejects a faded or brightened icon, in `packages/ui` too.
    Read every `icon-tertiary`, 80% or 55% icon rule below as this: there is no `icon-tertiary` in the kit.
20. **The kit's control ramp is a step denser than paywall-next's.** Button `xs` 22 / `sm` 24 /
    `default` 26 / `lg` 30 (icon sizes the same squares), `Input` and `SelectTrigger` 26,
    the tab lists 26 (`default` and `ghost`) and 32 (`underline`, no size prop), menu, select and command rows 24, `Badge` 18 / 20, glyphs
    14px in `xs` and `sm` controls and 16px from `default` up. Read the Sizing tables below with these heights.
21. **Invalid** is a 1px `red-4` ring on `Input` and `Textarea`. `FieldError` announces the message
    (`role="alert"`), each distinct message once.
22. **Busy buttons stay themselves.** `Button loading` keeps its colours and width, swaps its icon
    (or, without one, adds a leading spinner), sets `aria-busy` and ignores presses and keys, so a
    busy submit can't fire twice. It is never `disabled`.
23. **The kit's icon-only buttons carry their tooltip**, as 13 requires: the dialog and sheet close
    X ("Close").
24. **Setup is a chat, built from the task chat's pieces.** `/onboarding` (`routes/onboarding.tsx`) is the
    task chat's column: Shinsa's lines are `AgentText`, a problem with your answer is `ErrorLine`, your answers are
    `UserMessage` bubbles, every item a `ROW`, and the `Composer` sits at the bottom. The heading is `PageHeading`
    ("Set up Shinsa", "Question 2 of 6") inset to the rows' text. The options under the latest question are
    `ChoiceButton`s (`controls/choice-buttons.tsx`): `outline` `sm` buttons in a wrapping row (`gap-1.5`), a
    muted detail after the label ("12 repositories"). Selection is colour alone, never a mark: a selected option is
    the same button in the `primary` variant (its detail at 70% opacity), so nothing moves when it changes. No
    option of a one-answer question is selected when it is asked, a saved value included; where several can be
    picked (folders) the folders already chosen start selected, a pick toggles `primary` with `aria-pressed`, and a
    primary `sm` button below sends them. Check results (accounts,
    tools) are one `CARD` list of `CheckOutcomeIcon` rows, label over detail (`gap-px`) and the fix in `fg-3`. An
    optional check that fails (codex and its sign-in: Codex is a second provider, not a requirement) is a skipped
    row, never a fail, and never holds setup back.
    While an answer is read your text shows as a bubble with a shimmering "Reading your answer…" under it.
    Settings → Repository folders lists the chosen folders as `PathRow`s (removable, the `SHINSA_ROOTS`
    ones marked as such), adds one by path and has Find folders (a menu of discovered folders with their repository counts, checked when chosen);
    Settings → Setup and ⌘K's Run setup again restart the chat on the server, then open `/onboarding`; opening
    `/onboarding` while the server's chat is finished (setup done and not restarted) goes Home instead. The top bar
    (and the Sidebar rail) hides the usage glance and Focus on `/onboarding`. No folder path is ever written into
    the UI.

25. **Process states share the now card and the panels.** Every new waiting state is one of the
    Overview's existing pieces, never a new surface (`components/overview/`, built on `NowFrame`
    in `now-frame.tsx`, its actions at the top right, a `FooterNote` for the quiet links):
    - **Paused** (the now card's `PausedCard`): the gate's title, then a link to the agent's last
      message or the gate's body, Retry (primary) at the top right and Cancel task as the footer's quiet
      link. Every failure gate uses it, an agent's wait that ran out ("The agent’s wait ran out", or "The agent’s
      wait ran out of checks") included; a task
      stopped at its usage or cost limit ("Reached its usage limit", "Reached its cost limit") names its Retry
      for what it does, "Allow another 10%" or "Allow another $5.00" (`describeBudgetRetry`), in ⌘K too.
    - **Setup incomplete** (`setup-card.tsx`): status orange in the Paused group with the
      `IconToolbox` tile; the card renders the gate's body (each problem and its fix) as markdown, with Check
      again (primary) and Start without checks (outline, only when checks are all that is missing) at the top
      right, and Cancel task as the footer's quiet link.
    - **A revised plan** (`plan-revision.tsx`): the eyebrow reads "Version 2 · 4 phases"; above the
      plan a `bg-bg-a1` `rounded-lg` block shows "You asked" with your words, then "What changed"
      with the planner's summary and the computed changes as a quiet `·` list. Approve plan sends
      the version on screen.
    - **Questions with choices** (`question-choices.tsx`): `outline` `sm` buttons in a wrapping
      row (`gap-1.5`) above the answer box, the recommended one with a muted "Recommended", the
      same pattern as the setup chat's options. One click answers; the box placeholder becomes
      "Or write your own answer."
    - **Review verdicts** (`finding-verdicts.tsx`): each finding is a row (severity in
      `red-text` or `fg-2`, the file as a mono chip, the message) with a Fix / Dismiss `Choice`
      at the right; blocking findings start on Fix. The primary action follows the verdicts:
      "Fix 2 findings" while any is kept, Approve changes when all are dismissed. An escalated
      review titles the card "The agents could not settle the review", or "The fix changed nothing and
      the same findings came back" when a round left the code as it was, and says why
      (`lib/overview/verdicts.ts`).
    - **A wait** (`wait-card.tsx`): "The agent is waiting on something outside the repository",
      the agent's notes, "Check 2 of 10 · gives up in 3 hours" under them and Check now (outline);
      the eyebrow's `TimeAgo` counts down to the next check. Status "Waiting to check again", blue.
    - **A quiet agent** (`silence-note.tsx`): a `bg-bg-a1` `rounded-lg` strip above the live
      feed, "No output for 23 minutes" (`fg-3`, orange from 15 minutes; the thresholds are
      `docs/engine.md` → Silent runs) with Snooze and Dismiss as quiet links. It never changes the
      task's status.
    - **Held up by another task**: under "Waits on ‹A›" the work card names the stalled leaf of
      the chain with its `TaskLink`: "Held up because ‹C› is waiting on you."
    - **Answer** and **Suggested follow-ups** are `Panel`s right under the now card; a follow-up
      row is title over why (`gap-px`) with, at the right, a ghost `sm` When to start select, then
      Dismiss (secondary) and Add (outline). The select offers Start now and After this task merges
      (Home's When to start words, `lib/tasks/suggestions.ts`), the agent's pick first, preselected and
      marked Suggested; Add sends `waitsOnThis` from what is chosen. An Ask task
      has no Summary panel and no Code tab, and its progress track is Find the repository →
      Answer.
    - **Results.** An investigation's findings, a report and an operation's outcome are a `Panel` under the Answer
      one (`ResultPanel`: Findings, Report, Outcome by `result.step`); a finished one's now card reads "Finished. The
      findings are below." (or report, outcome). A kind of task without a build step (answer, investigation,
      research, operation) has no Summary, What changed or Decisions panels and no Code tab; find and fix gets its
      Code tab once it builds. A finished answer, investigation or report keeps the composer, for a follow-up the
      same agent answers.
    - **The stage strip follows the pipeline** (core `resolveTaskProgress`): Find the repository when it does not
      start with a plan, then each step, Answer, Research, Investigate, Your OK to change (Your OK to run before an
      operation), Plan, Run the operation, Build, Checks and agent review (Checks or Agent review when the task has
      only one), Your review, Pull request, Merge; Your OK is a step of composed steps, and shows after an inquiry while a proposed change waits. A
      strip longer than a change's folds the labels of finished steps below `lg`, and one longer than find and fix
      (research, your OK, then a change) folds them at every width (`resolveLabelFold`), so both fit a 900px window
      and a 1280px one; each folded step keeps its label in its tooltip.
    - **A proposed change** (`ChangeCard` in `now-card.tsx`, on `NowFrame`): the eyebrow names who proposes it ("The
      investigation proposes a fix", "The answer proposes a change", "The report proposes a change"), the title is
      the gate's question, then the why and, on the inner `bg-bg-a1` block, "What it would change" with the request.
      Make it a change (primary) at the top right, and the footer's quiet "Keep it as an investigation" (an answer,
      a report). Both are gate replies in `lib/tasks/gates.ts` (`makeChange`, `keepAsIs`), and ⌘K offers the same two.
      Your OK in composed steps is the same card (`describeChangeGate`): the eyebrow says the result is in ("The
      findings are in", "The report is in", "The answer is in"), the block is "What comes next", and before an
      operation the primary is Plan the operation (`planOperation`, "Approved. Planning the operation now.") with the
      note "An operation gets a plan you approve before anything runs."; keeping it is your veto.
    - **An operation after the merge** (`OperationCard` in `operation-card.tsx`, on `NowFrame`): the title is the
      gate's ("The change merged. Run the operation now?"), then "Merged in ‹PrLink› as ‹commit›", the commit a mono
      chip with the short sha whose click copies the whole one (its tooltip shows it), then the rest of the gate's
      body as markdown: the caution, "Operation" with the numbered steps and "Impact" (`resolveOperationBody` in
      `lib/overview/operation.ts` drops the body's own merge sentence, which the line above already says). **Run the
      operation** (primary) at the top right; a notes box under the body whose outline button **Run with these notes**
      sends the text as the operator's guidance; and the footer's quiet **Finish without it**, behind a
      `ConfirmDialog` since it ends the task ("Finish without running the operation?"). Toasts: "Running the
      operation.", "Running the operation with your notes.", "Finished without running the operation." The replies
      are `runOperation`, `runOperationWithNotes` and `skipOperation` in `lib/tasks/gates.ts`; ⌘K offers Run the
      operation, Run the operation with notes and Finish without it (a confirm page), and a notification reads the
      reason and the merge sentence, without the steps. A message in the task's composer while the gate is open
      becomes notes for the operator and runs nothing (its placeholder says so: "Add notes for the operator. They go
      with the operation once you run it.", toast "Saved as notes for the operator."): the gate asks again with them,
      and the card shows them as "Your notes for the operator" (`text-2xs` `fg-2` label over the markdown, `gap-px`)
      above the notes box, whose placeholder becomes "More notes for the operator, added to yours."; both Run actions
      send them.
    - **What a message does** is the composer's placeholder at every gate and the toast after it, from one place
      (`resolveMessageHint` in `lib/tasks/messages.ts`, over core's `resolveMessageEffect`; `docs/engine.md` → Gates →
      What a message does): the Overview's and the chat's composers and ⌘K's Message the agent all read it, and a task
      that takes no message (finished, not a follow-up) shows no composer.
    - **The plan's parameters** sit under its phases and operation, in the plan card and in the chat's plan card
      (`PlanParameterList` in `plan-parameters.tsx`, `resolvePlanParameters` in `lib/overview/plan-parameters.ts`),
      each only when the plan sets it: **Impact** (markdown), **Evidence** (the kinds the builders must attach, as a
      `·` list: Screenshot, Recording, Test output, Note, Preview link), **Extra checks** (each command a mono chip)
      and, when the planner asked for your approval, the quiet line "The planner asked for your approval."
    - **Cost** is a task fact (`IconCoins`, the icon orange past a limit, the total beside it) whose `InfoPopover`
      breaks it down by step and by phase; its header reads "$1.75 · 12% of the weekly limit" once a step was
      measured against an account's weekly window, or against a limit "12% of the weekly limit, 10% allowed" (the
      usage limit) or "$1.75 of $5.00" (the cost limit). The review card's facts line ends with "$3.56 so far".
      Unknown prices read "Unknown" or "$0.30 + unknown", never $0.
    - ⌘K adds, on the task: Answer "‹choice›" per choice (Recommended as its hint), Check the
      setup again / Start without checks, Check now, Snooze / Dismiss the quiet-agent warning,
      Add the follow-up "‹title›" (a page with the same two starts, the agent's pick first with
      Suggested as its hint) / Dismiss the follow-up "‹title›"; at the bottom while typing, "Ask: ‹text›" next to
      Create task. Settings → Limits has Usage limit per task (and Cost limit per task where it applies, 26);
      Agents has Answering questions. Home's
      composer has no kind select (17).
26. **Agent usage: Claude accounts, Codex and their usage limits** (`lib/accounts/` for the labels, tones and choices, the
    sign-in dialog's own sentences aside; the socket holds the `accounts` snapshot it pushes and every
    POST to `/api/accounts/*` answers, and `lib/connection/accounts.ts` reads it (`useAccounts`) and
    sends the changes; pieces in `components/accounts/`):
    - **Settings → Agent usage** (it was "Accounts", and "Claude usage" in the top bar; one name everywhere now) is
      one section for every login agents run on, whatever the provider (`components/settings/accounts.tsx`; the old
      `#accounts`, `#usage` and `#codex` links land on it). Its header has a secondary icon button "Refresh usage" (it
      refreshes every account) and Add account, a menu when Claude Code or claude-swap logins can be imported,
      otherwise it signs in straight away; with no account the card holds one sentence and that button. Each
      Claude account is a `SettingsBlock` (15, Cards), in order, 6px apart: a 32px header row with the email as a medium
      `Truncate`, the plan (`fg-2`), a `Badge` "Default", and only when something is wrong a status in its tone
      ("Needs sign-in" orange, "Paused" `fg-2`, "Out of usage until 3:40 PM" red through `TimeAgo` as soon as a
      window is at 100%), then at the right "Updated 2m ago" (`text-2xs fg-2`, `TimeAgo`, from `sm` up) and a
      `•••` click menu (`OptionsTrigger`, the one trigger every `•••` menu uses): Set as default, Sign in again,
      Move up / Move down, Leave out of new work / Use for new work, Switch accounts at (a submenu: Use the
      setting (90%), 80/90/95/98%, Other… which opens a dialog for any whole percentage) and Remove behind the
      shared `ConfirmDialog` (Keep it / Remove account; Remove from Shinsa for your own Claude Code login, which
      is never signed out). Under it, on the block's shelf, one 40px row per usage window: label over "Resets in 3h" (`ResetTime`, the
      exact time on hover), a `h-1.5` `rounded-full` `bg-bg-a2` bar filled in the usage tone (`UsageBar`) and the
      `UsagePercent` (`tabular-nums`, amber from 75%, red from 90%); without windows the server's detail is a
      muted line, "No usage reported yet." before the first read. Importing from claude-swap confirms with a
      toast that says to take the login out of claude-swap, since refresh tokens are single-use.
      Every provider with a sign-in of its own (Codex today) follows as a `SettingsBlock` of the same shape
      (`ProviderLoginBlock` in `providers.tsx`): the header row has the provider's name (medium), its state in
      `fg-2` ("Signed in with ChatGPT", "Not signed in", "Not installed", "Too old for Shinsa", "Could not check
      the sign-in") and only when something is wrong a status in its tone ("Needs sign-in" or "Update needed",
      orange), then the version (`text-2xs fg-2 tabular-nums`) and a secondary icon refresh button ("Check the
      Codex sign-in again", the same refresh) where an account has its `•••`. Below it, on its shelf, when there is
      something to do, a row with the fix as inline markdown ("Run `codex login` in a terminal…") and a `CopyButton` for
      its command. A signed-in provider that reports usage (Codex) has the same usage rows as an account ("5-hour
      limit", "Weekly limit", a model's limit). Shinsa runs Codex on its one login, the one in `~/.codex`, and never
      signs Codex in or out itself.
    - **Settings → Agents** groups the roles by what they do (`AGENT_GROUPS` in `lib/settings.ts`), one block per
      group, 6px apart: Doing the work (planner, builder, fixer), Checking the work (reviewer),
      Answering questions (answerer) and Quick jobs (classifier, writer). A block is a `SettingRow` with the group's
      title and two `SelectField`s, so nothing is cut off at 900px: one **model** select that holds every provider's
      models under a label per provider (Claude, then Codex; `SelectField` items take a `group`), each with its
      provider's icon, so picking a model picks its provider too (`listAgentModelItems`, the value
      `provider:model`; `GET /api/providers`, the built-in names until it answers), and one **speed** (Standard,
      `IconSpeedMiddle`, the default, or Fast, `IconSpeedHigh`; `agentFastModes`, `docs/engine.md` → Compaction and
      fast mode) for every role in the group. Every agent select has a fixed width that fits its longest value
      (model `w-40`, speed `w-30`), so values and chevrons line up in columns. Where fast mode needs usage credits
      the provider's accounts do not have (`resolveSpeedAvailability` over core's `resolveFastModeAvailability`),
      the select reads Standard and its Fast option is disabled with a muted "Unavailable: needs usage credits"
      after the label (`SelectField` items take `disabled` and a `hint`), and ⌘K's speed choices offer Standard
      only: the agents run at standard speed whatever was stored, and Fast comes back by itself once credits are
      there. No default model is Haiku: Opus for the working roles, Sonnet for the quick jobs. When the roles
      differ the selects read "Set per role". A group of several roles has a quiet "Per role" disclosure (`text-2xs`
      `fg-2` with the section chevron) right after its title, which opens the group's `SETTINGS_SHELF` straight
      under the row: one row per role, its name and the same two selects, `ghost` (no fill on the shelf's fill)
      and at the same widths. It starts open when the roles differ. The agents stay separate underneath
      (`agentProviders`, `agentModels` and `agentFastModes` per role). ⌘K has the group choices ("Model for doing
      the work", every provider's models in one list, and "Speed for doing the work") and, while typing, the
      per-role ones ("Builder model", "Builder speed").
    - **Settings → Limits** is titles-only rows: Usage limit per task (No limit, the default, or 5, 10, 20, 30 or
      50% of the weekly limit; `docs/engine.md` → Cost; Codex's weekly limit counts too), Cost limit per task (only
      while one is set or when no account reports a weekly window: API keys), Switch accounts at (Other…
      opens the same percentage dialog as an account's), After a usage limit (Resume automatically /
      Wait for me) and, only while that is Wait for me, Ask me what to do (When the limit resets / Right
      away: the task waits as "Paused until the usage limit resets" and its failure gate opens at the
      reset, or the failure gate opens at once; nothing is hidden). ⌘K's Change a setting has the same
      rows, without Other….
    - **The sign-in dialog** (`sign-in-dialog.tsx`, one `Dialog` mounted by `Root`, opened by
      `startSignIn`): Starting sign-in… with a spinner; "Sign in to Claude" with the browser note,
      the sign-in page as a link and a code field, Submit code the form's primary button; Finishing
      sign-in…; "Signed in as a@b.com." with Done; or the failure with Try again. Every dialog that
      takes a typed value (sign-in code, a switch percentage) is one pattern: a left-aligned header,
      the field in a `<form>` (Enter submits), and a right-aligned footer of secondary Cancel and a primary button
      named for what it does. A percentage the dialog can check itself shows as the field's `FieldError`; a code
      the server refuses comes back as an error toast and the code stays in the field. Cancel while a sign-in runs
      cancels it.
    - **A dialog closes without a visible change.** Nothing it shows changes while it animates out;
      every change lands after the exit ends. A dialog a page opens is mounted from `useDialogState`
      (`@shinsa/ui/hooks/use-dialog-state`): `show(value)` opens it, closing only flips `open`, the
      value stays while it fades and is cleared on Base UI's `onOpenChangeComplete`, so the dialog
      unmounts after its exit and opens fresh next time (`{dialog.value === 'remove' && <ConfirmDialog
      control={dialog.control} … />}`). Text that comes from outside the dialog (a store, a server
      push, a prop) goes through `useHeldValue(value, open)`, which keeps what it showed while open:
      the sign-in dialog keeps its step after Cancel instead of falling back to Starting sign-in…,
      `ConfirmDialog` and `PercentDialog` keep their text. A busy button stays busy until the dialog
      is gone, `ConfirmDialog` runs its action once it has closed, and ⌘K resets to the root after it
      has faded, not while.
    - **A dialog's description is `fg-4`**, the title's colour, set once in the kit's `DialogDescription` and
      `AlertDialogDescription`: the title still leads by size and weight, and the sentence under it reads as
      something to act on, not a footnote.
    - **The usage menu, Agent usage** (`usage-menu.tsx`, `aria-label` "Agent usage"): an `sm` secondary button with
      `IconGauge` and the figure of what the next run uses, in the usage tone from 75%: when the builder runs on a
      provider with a reading of its own (Codex) its highest window, otherwise the Claude account picked by the same
      core picker the server leases with (`selectNextAccount` over `pickAccount`, `docs/engine.md` → Accounts and
      usage limits) and its highest window (`resolveUsageGlance`). It reads "Agent usage" without a figure. It sits
      in the Cards top bar before Focus and in the rail header before search, opens an `InfoPopover` on hover, titled
      "Agent usage" over "The next run uses ‹account›", with every Claude account and then every connected provider
      ("Codex · ‹email›", `listProviderGlances`), each with its highest window as a bar and its reset, or its status
      when it is out of usage or signed out, and goes to Settings → Agent usage on click. Hidden without accounts
      or a provider reading.
    - **Sign in needed** (`sign-in-card.tsx`): a `sign_in` gate is orange with `IconUserKey`, in the
      Paused group; the card shows the gate's title and body, Sign in (primary) opens the dialog for
      that account, and Retry anyway / Cancel task are the footer's quiet links. A gate whose account is a provider
      with a sign-in of its own (Codex, `resolveSignInProvider`) has no Sign in: Shinsa never signs Codex in. Its
      primary is "Check the Codex sign-in again" (it refreshes the sign-ins, and one that finds Codex signed in
      answers the gate), and under the body, on a `bg-bg-a1` `rounded-lg` strip, the fix with its `CopyButton`
      ("Run `codex login` in a terminal, then refresh."); ⌘K offers the same check. **Waiting for the
      usage limit** (`usage-wait-card.tsx`): an armed usage wait is blue and In progress, titled
      "Resumes when the usage limit resets" or "Paused until the usage limit resets", the reset in
      the eyebrow, Resume now (outline) and the quiet "Don’t resume automatically" / "Resume at the
      reset".
    - **Run on account**: a bound task has a "Runs on a@b.com" fact whose click menu, the task
      `•••` menu's Run on account submenu and ⌘K's "Run on account…" offer Any account and every
      signed-in account, the current one checked. ⌘K's Accounts group has Add a Claude account,
      Agent usage and Default account.
    - **Run this step again on an account**: the run label in the chat ends with the account the run used
      (`RunAccount` in `account-items.tsx`, its latest attempt's account, else the one it is bound to). On the run
      of the step an agent works on now it is a click menu (hover `fg-4`), "Run this step again on" over every
      signed-in account with the current one checked; picking one restarts the step bound to that account, with
      the toast "Running this step again on a@b.com." ⌘K's This task has the same as "Run this step again on…".
      Earlier runs show the account as plain text.
    - **In the chat** every notice kind (`lib/chat/timeline.ts`, rows from `lib/chat/notices.ts`) does one of
      these. Six are one quiet row ahead of their turn's work (`NoticeLine`: a 14px icon and a `text-2xs`
      `fg-2` line, the detail in its tooltip): `account_switched` (`IconArrowsRepeatRightLeft`, "Account
      switched · a@b.com", the reason), `compaction` (Claude Code's or Codex's: `IconBubbleText`, "Conversation
      compacted", why: the context filled up and the agent summarised it, or idle compaction; eunoe's: `IconMinimize`, "Conversation compacted by Eunoe"
      at the limit, or `IconLayersTwo`, "Finished turns folded" for a fold, the tooltip saying nothing was
      summarised), `proxy` (`IconCloudSimpleDisconnected`, "Eunoe unavailable · Claude Code compacts this run",
      the reason and "Shinsa tries Eunoe again in a minute."), `fast_mode` (`IconSpeedMiddle`, "Fast mode
      unavailable" or "Fast mode paused", why in a sentence, and that the run continues at standard speed; "Fast mode
      needs usage credits on this account, and Shinsa never turns extra usage on." when the account has none),
      `extensions` (`IconBlocks`, what the run loaded at its start, "Loaded 4 MCP servers, 23 skills, 3 plugins ·
      ~38k tokens" without the kinds it had none of, or "Loaded only Shinsa’s tools"; the tooltip lists each group's
      items one per line, biggest first, with their estimates, 8 per group then "and 12 more"; 29) and
      `handoff` (`IconArrowsRepeat`, "Conversation handed over ·
      Codex" for a provider switch, or `IconArrowRotateClockwise`, "Session restored from the transcript";
      the tooltip names from and to and how many entries carried over). `delegation` is the spawn card and
      report row below. `context` is no row: it feeds the context meter in the task chat's composer footer
      (`components/chat/context-meter.tsx`, `lib/chat/context.ts`): a `w-10` `UsageBar` and the
      `UsagePercent` of `maxTokens` used, from the latest top-level run of the task that reported one (none
      after a `handoff`, until the new session reports; none when `maxTokens` is unknown), in the usage
      tones (neutral, amber from 75%, red from 90%), "84k of 200k tokens" over a muted "Context 42% full" in
      its tooltip. `rate_limit`, `account` and `interrupted` stay in the transcript and are not shown: the
      usage menu and the `account_switched` row already say it.
    - **Delegated work** (`components/chat/delegation-card.tsx`, `lib/chat/delegations.ts`) never
      gets a run section of its own: it lives in the turn of the step that delegated it. A
      `delegation` `started` notice is a spawn card (`CARD`, 36px row): a status mark (a pulse
      in the status tone while it works or waits, amber while it waits for an answer; once it ends, the
      shared `CheckOutcomeIcon` for finished, failed or stopped), the role in `fg-2` ("Reviewer"), the
      title in medium `fg-4`, the status in its tone with the running `Duration` ("Waiting to start" neutral,
      Working blue, "Waiting for its delegated tasks" blue while its own delegated work runs, "Asked the agent
      that delegated it" amber while its question is open; `lib/chat/delegations.ts`), a chevron, and a secondary `icon-xs` Stop (×) while it is live, named
      "Stop “‹title›” and what it delegated" in its tooltip and `aria-label` alike. An
      open question sits under the row on a hairline; the chevron opens the delegated agent's own
      conversation inside the card, its own delegated work nested the same way. A `reported`
      notice is a quiet `text-2xs` row, "Reported back: ‹title›" (or its end state, "Failed: ‹title›",
      "Stopped: ‹title›"), whose chevron opens the result.
      A delegated agent's question card reads "Asked the agent that delegated it", never "Asked
      you". A step that ended its turn to wait shows "Waiting for 2 delegated tasks" in its live
      card, without the shimmer.
    - **Delegated work on the Overview** is a `Panel` ("Delegated work", `IconAgents`, "2 working
      · 1 done" in the header) right under the now card: one row per delegated task, children
      indented under the task that delegated them with `IconArrowCornerDownRight`, the same mark,
      role, title, status and Stop; the title opens the chat at its card, opened along with every
      card it sits in. A task whose step waits for its delegated work is "Waiting for delegated
      tasks" (blue) wherever its status shows, and ⌘K offers Stop ‹role› ‹title› per live one.

27. **Schedules, secrets and notifications** (harness plan WS7; `lib/schedules.ts`, `lib/secrets.ts`,
    `lib/notifications/`, `lib/preferences/notifications.ts`, `hooks/use-attention.ts`):
    - **Settings → Automations → Schedules**: one 40px row per schedule, oldest first: the name as `Truncate` over one `text-2xs`
      `fg-2` `Truncate` line of what it does and when ("Starts a new task · every hour", "Asks a new question ·
      …", "Messages “‹task›” · weekdays at 9:00 AM", "… · when its webhook is called"; a daily time on the app's
      clock), then its state: "Next at 4:03 PM"
      through `TimeAgo` (a weekday this week, else the date), "Paused" and "Finished" in `fg-2`, "Last run failed"
      red. A `•••` click menu: Pause / Resume, Copy webhook URL, Open the task (the one it messages, else the last it
      started), then Delete schedule behind the shared `ConfirmDialog` (Keep it / Delete schedule; a webhook's warns
      that its URL stops working). A schedule whose task is gone reads "Its task is gone" in `fg-2`.
      Without schedules the card holds one sentence.
    - **Fast mode** is the speed select of each agent group and role in Settings → Agents (26). **Settings →
      General** holds the **Context** group (`components/settings/context.tsx`):
      **Compaction** (Eunoe compaction, the default, `IconMinimize`; Eunoe always fold, `IconLayersTwo`; Claude
      Code’s compaction, `IconBubbleText`; Off, `IconPause`), then **Compact idle sessions** (Never, the default,
      or 1, 2, 5 or 10 minutes before the cache expires), shown only where a provider summarises itself: Claude
      agents with Claude Code’s compaction, Codex agents with anything but Off (Eunoe sits in front of the
      Anthropic API only). The
      product is "Eunoe" with a capital E in every string on screen; `eunoe` stays for code, commands and paths.
    - **⌘K**: a Schedules group, only while there is a schedule, with Schedules (scrolls to the section); each
      schedule matches while typing, by name with when it runs as the hint ("Every hour") and its icon (hourglass
      once, repeat interval, clock daily, globe webhook), and
      opens a page of the same actions, Delete behind a confirm page. Change a setting adds Play a sound, Sound, Show
      a notification, Compaction, the speed choices and, with Claude Code’s compaction, Compact idle sessions; Jump to
      has Context.
    - **A secret request** (`secret-card.tsx`) replaces the question card for a gate with `secret`: the eyebrow says
      "The agent asked for the ‹label›", the title is the agent's reason, then a password `Input` ("Paste the
      ‹label›") with Save, and the footer's note "It goes to Shinsa’s secret store. The agent and the chat never see
      it." with the quiet link Don’t give it. The value posts to `/api/secrets/‹gate›`, never as a command, and ⌘K
      offers Give the ‹label› (opens the task) and Don’t give the secret instead of a compose page.
    - **Settings → Notifications**, per browser (`localStorage`): Play a sound (Never, When Shinsa is in the
      background, Always; the default is in the background), Sound (Chime, Ping or Pop, with a secondary `sm`
      Test button, `IconPlay`, that plays it and, while notifications are on or the browser already allows them,
      also shows a "Test notification" ("Shinsa shows a decision that needs you like this."; its tooltip says
      which: "Play the sound" or "Play the sound and show a test notification"; a blocked browser gets the same
      toast as below) and Show a notification (Never by default; choosing another asks the browser first and stays off
      with a toast when it is blocked). Sounds are Web Audio oscillators, never an `<audio>` element, so they never
      take the media keys.
    - **What triggers them**: a gate that newly enters Needs you within the focus project. The first snapshot after a
      load never chimes, a gate outside the focus project never does, and neither does one that comes into view when the
      focus changes or lifts. One chime per burst (repeated up to three times for several), one notification per gate
      (notes added to an open operation gate keep the same gate, so they notify nothing): the task's
      title over the pending question (or the gate's reason and body; a secret request only names what it asks for),
      on one line, cut at 180 characters with `…`. Clicking it focuses the window and opens the task.
    - **The tab**: the title is "[n] Shinsa" while n decisions are up (Needs you within the focus project), "Shinsa"
      otherwise, with the task on screen before the name on its page ("[2] SW-142 Fix login · Shinsa"), and `<meta name="floaty:status">` (`failed` while a task is paused, its setup incomplete or a sign-in
      needed, else `waiting` with a decision up, `working` while a task moves, `idle`) and `floaty:badge` (n) tell a floating window what to show.
    - **The health banner** (`components/status/health-banner.tsx`, `lib/connection/health.ts`): `Root` mounts it
      once at the top of the page in both layouts (never on `/ui`, which shows its card, `HealthCard`, with two
      sample problems). It reads `GET /api/health` on start and after
      every reconnect and shows only while `ok` is false: a `CARD` in the page column (`PAGE_COLUMN`, 12px above the
      page), a 14px orange `IconExclamationTriangle`, one `fg-3` sentence ("Shinsa skipped 2 damaged entries in its
      log at start. Everything else loaded."), a quiet "Details" that opens an `InfoPopover` ("Damaged log entries",
      then one `InfoRow` per problem: "Entry 41 · task.staged" over Unreadable or Not applied) and a `secondary`
      `icon-xs` Dismiss (×) with the same tooltip. Dismissing hides it for the session, until the problems change.

28. **The task chat is the one place to talk.** An Answer task is how you just talk (`docs/engine.md` → Agents
    manage Shinsa); nothing in the top bar, the rail or ⌘K opens a conversation of its own.
    - **What an agent did on your behalf** shows wherever activity does: an entry an agent's management tool caused
      reads "‹handle› agent (on your behalf)" (the task’s quoted title until triage gives it a handle), a link to
      the acting task (`resolveActivityActor`), and "Shinsa (on your behalf)" when no task is named.
    - **An agent's Shinsa tools** show in its turn like any tool, as `mcp` rows of Shinsa's own server ("Tasks
      done · Shinsa"), folded with the other Shinsa tools as "Used 2 Shinsa tools".

29. **MCP servers, plugins and skills are visible, and cost what they say.** Settings → Integrations
    (`components/settings/integrations.tsx` reads `GET /api/extensions` through `lib/connection/extensions.ts`, asks
    the server to check every server once and reads the snapshot again whenever the window gets focus; labels,
    groups, places, token text, search, the optimizer's rows and the form are `lib/extensions.ts`) is titles only,
    like the rest of Settings: no section descriptions. Agents load everything turned on here, for Claude and Codex
    alike (plugins for Claude only), and everything the user has configured starts on. Top to bottom:
    - **Search** (full-width `Input type='search'`, "Search servers, plugins and skills", kept in `?q=`): every word
      must appear in a server's name, sources, URL or command, a plugin's name, or a skill's name, description or
      folder. While it holds text the optimizer is hidden, sections without a match are hidden, every group that
      matches opens, and "Nothing matches." stands alone when nothing does.
    - **Context optimizer** (`context-optimizer.tsx`): three rows, "Leave out servers agents haven’t used" (a
      `Switch`; its title's tooltip says an agent loads a left-out server when its task needs one), "Not used for"
      (a `SelectField` of 7, 14, 30, 60 and 90 days, plus the current value when it is another) and "Leave out
      skills too", then a "Not used lately" block (a 32px `SettingsBlock` header, `text-2xs` medium `fg-2`) over a
      shelf of at most five rows, costliest first: each measured server that is on and idle past the window ("maple" ·
      "Not used in 30 days · ~4k tokens" · a secondary `sm` Turn off), and the idle skills as one row ("37 skills" · "Not used in 14 days · ~5k tokens"). While the
      optimizer is on, a row ends in "Loads when needed" instead of Turn off. Before the history is read the shelf
      says "Reading which servers and skills agents used…"; with nothing idle, "Agents used everything turned on
      here."
    - **MCP servers** (`mcp-servers.tsx`): the header has a secondary icon button "Check all servers" and Add server.
      A config Shinsa could not read is a quiet warning row first. Servers are grouped by status, each group a quiet
      folding block (`FoldingBlock` in `group.tsx`: a 32px header with the section chevron, the title and its count)
      over its shelf: Connected, Failing, Needs sign-in, Not checked yet (only while a check is due) and Off (turned
      off, or its plugin is). Connected and Needs sign-in start open; Failing, Not
      checked yet and Off start open only with six servers or fewer. A server is one 40px row, whatever number of
      places define it (`definedIn`): a chevron and the name (medium) as the details toggle, its sources in `fg-2`
      ("Claude Code, Codex"; "Claude Code · ‹path›" for one per-project server; every file in its tooltip), then what
      it costs or plainly why it cannot say (`text-2xs fg-2 tabular-nums`): "~4.2k tokens", "Sign in to measure",
      "Can’t measure while failing", "Checking…", or for one that is off its last estimate or "Not measured while off";
      "Loads when needed · ~4.2k tokens" while the optimizer leaves it out. Then a primary `xs` Connect when it needs
      a sign-in (a Claude Code or plugin server's cost carries the tooltip that Claude runs can still use the sign-in
      made in Claude Code), the `Switch` (tooltip: "Only for Shinsa’s agents. Claude Code and Codex keep their own
      settings."; toast on off: "Turned off ‹name› for Shinsa’s agents. Claude Code and Codex keep their own
      settings.") and the `•••` menu: Connect or Sign in again (web servers), Sign out, Check now, Show details /
      Hide details, Use everywhere, Use in one project ▸, Use in one repository ▸ (radio items, the current place
      checked), Edit… (Shinsa's own) or Copy to Shinsa and edit…, and Remove behind `ConfirmDialog` (Shinsa's own
      only). The details shelf holds the command and its arguments or the URL (mono), a quiet line of notes ("Defined
      in ‹files›", "Only in the ‹name› project", "Only in ‹repo›", "Overridden by Shinsa’s ‹name›", "Its plugin is
      off", "Not used in 30 days"), a failing server's error in red, and its tools, name over description.
    - **The server dialog** (`server-dialog.tsx`) is the dialog that takes a typed value (26): How Shinsa
      reaches it (Command on this machine, HTTP, Server-sent events), Name, then Command, Arguments (one per line) and
      Environment (`NAME=value` lines), or URL and Headers (`Name: value` lines), and Where agents use it
      (Everywhere, one project, one repository). Editing shows the saved keys with empty values and "Leave a value
      empty to keep the saved one."; the web never sees a secret. The primary button says what it does: Add server,
      Save server, Save copy. A wrong field gets its `FieldError`; a refusal is the server's message in a toast.
    - **Signing in** opens a blank tab on the click (so the browser allows it), points it at the server's
      authorisation page, and watches until the server reads as signed in and checked: the callback page posts on
      `BroadcastChannel('shinsa-mcp')` and to `window.opener`, the snapshot is read at once on either, whenever the
      window gets focus or becomes visible, and every 2 seconds for up to 2 minutes; "Signed in to ‹name›." once it
      is.
    - **Plugins** (`plugins.tsx`): one 40px row per plugin, the name (medium; what it brings and its folder in the
      tooltip), the estimate and a `Switch`. A plugin turned off turns off its skills, agents, hooks and servers.
    - **Skills** (`skills.tsx`): one group per source (Claude Code on this machine, each plugin, each repository,
      Codex), each the same `FoldingBlock` "‹source›" · "3 of 12 on · ~4k tokens", starting closed. Shinsa's own skills are
      always on and not listed. An open group renders only the rows in view (`virtual-rows.tsx`: fixed 40px rows,
      positioned in a spacer as tall as the list, measured against the page scroller, eight rows of margin), so a
      group of hundreds stays fast. Each row is the name (medium, its folder in the tooltip), the description
      (`text-2xs fg-2`, `Truncate`), the estimate ("Loads when needed · " before it while the optimizer leaves it out)
      and a `Switch`.
    - **Why rows are windowed and the switch knob is not a layer**: the knob had `will-change: transform`, so every
      switch was a compositor layer. Inside a `Card` (`overflow-hidden` with a `corner-shape: superellipse` corner)
      those layers are clipped with a mask the size of the card, and a card taller than the GPU's largest texture
      (16,384px, about 400 skill rows) loses that mask: past that point rows and switches did not paint (black on a
      GPU, blank headless) after "Show all". The knob no longer asks for a layer (`packages/ui` `Switch`), and the
      lists are windowed, so no card grows that tall.
    - **⌘K**: Jump to has MCP servers, Plugins and Skills; the global Integrations group has Add an MCP server (opens
      Settings → Integrations with the dialog open through `?add=mcp`, dropped from the address once it opens), the
      three sections, and while typing "Connect ‹name›", "Turn on ‹name› for agents" / "Turn off …", "Turn on the
      ‹name› plugin", "Turn on the ‹name› skill" (or off; never one of Shinsa's own) and "Turn on the context
      optimizer" (or off). The chat's `extensions` notice row (26) shows what a run loaded, with "· 2 left out" and a
      "Left out until needed" group when the optimizer left something out.

30. **A task runs in rounds** (`docs/engine.md` → Rounds; `lib/tasks/rounds.ts`, `components/chat/round-header.tsx`,
    `components/overview/rounds-panel.tsx`). Nothing about rounds shows until a task has a second one, so a small task
    looks exactly as before.
    - **The handle names the round.** Once a task has more than one round its handle reads "SW-14 · round 3"
      (`resolveHandleText`) in the facts row (the handle still copies alone; the round is a plain `fg-2` fact beside
      it), roadmap, queue and Home rows, a task link's preview card and ⌘K; the now card's eyebrow adds "· round 3"
      after the status. The handle itself stays per task.
    - **The chat shows each round as a section.** A `RoundHeader` row opens it, on a hairline: "Round 3" (medium `fg-4`)
      and its title (`fg-3`, `Truncate`), its status in its tone (`text-2xs`: In progress blue, On its pull request
      green, Merged purple, Finished green, Waiting to start and Stopped neutral), the section chevron, then at the right its pull
      request (a `PrLink`-style tile and `#N`, its state in the tooltip) and, while the choice is still open, how it
      ships: a ghost `sm` `SelectField` "How round 4 ships" with "Onto #12" and "As a stacked pull request". Under an open
      header sits the round's own small progress track (the current round's live one, an ended round's from what it
      kept: done, or Merge waiting while it sits on its pull request), then the request that started it as your bubble,
      then its runs. The current round and the ones waiting start open, earlier ones folded; `?run=` opens the round
      that holds the run. A task with one round has no headers.
    - **The Overview shows the current round**: every card is the current round's, and a Rounds `Panel` under the now
      card lists the earlier rounds (folded rows, each the same `RoundHeader`; opened, "Asked for", "Goal", "What it
      did" and "What it found" from the round's request and outcome) and the rounds waiting to start with their
      shipping select.
    - **A message can be new work.** The composer's hint still says what feedback does; Shinsa's classifier decides
      whether a message is feedback, the next round or another task's work, so the chat shows a new round's section
      (Waiting to start) as soon as one is queued. A merged task keeps its composer: "Ask for the next piece of work. It
      starts as a new round of this task." A closed task (marked done, cancelled) has none.
    - **A split-off is a follow-up row** in Suggested follow-ups with Make it a task (outline) and Keep it here
      (secondary, in Dismiss's place); keeping it queues the next round ("Kept in this task. It starts as the next
      round."). ⌘K offers "Keep “‹title›” in this task" and, per round whose shipping can change, "Ship round 4 as a
      stacked pull request" or "Ship round 4 onto #12".
    - **On `/ui`** (chat specimens): the round headers of a four-round task in every state and its Rounds panel.

`bun lint:conventions` (`scripts/lint-conventions.ts`) checks the app (`apps/web/src`) for raw `text-[N]` sizes, a
weight other than normal, `font-medium` and `font-semibold`, `gap-0.5` (outside `SectionLabel`), Tailwind's own
shadows (`shadow-2xs` … `shadow-2xl`, `shadow-inner`) and raw `shadow-[…]` or `ring-[…]` (the tokens `shadow-1…4`
and `shadow-control*` are allowed), a `hover:` with no `active:` on its line (a `group-hover:` with no
`group-active:`, unless it reveals from `opacity-0`), a hand-built card (`rounded-xl border border-border bg-card`
instead of `CARD`) and `formatAge(…)` or `formatDuration(…)` rendered in JSX outside `components/text/time-ago.tsx`
(pass the time to `TimeAgo` or `Duration` instead; a time built another way is not caught). In the app and the kit
(`packages/ui/src`) it also rejects raw corners, any `focus:` / `focus-visible:` / `focus-within:` state or
`ring-offset-*`, an icon faded by hand (19) and a checkmark icon in green; the `/ui` catalog pages are checked for
raw corners only. Besides that it bans comments (outside `packages/ui`) and enforces the verb catalog.

---

# Superwall — Application register

Product UI reads as **quiet and engineered**: editorial Manrope on a cool
near-black canvas, structured by one border, with a single teal accent that
earns its rarity. It is flat by intent — no shadows, one restrained 3px corner,
no gradients on UI surfaces. Depth comes from a few small lightness steps, the
border, and type.

The vocabulary is deliberately small. If a need isn't covered here, the answer
is usually an existing token used differently, not a new one.

**How this file stays true.** The design pass runs section by section. Each
signed-off review round updates, together: the code, this file and `/dev/design-system`.
`/dev/design-system` renders every token and component so the file can be
checked against the running system. When the code and this file disagree, fix
one of them in the same change.

---

## Color

### Surfaces — one tinted OKLCH ramp

Every dark neutral is `oklch(L c var(--tint-h))`: one cool hue at low chroma,
so the UI reads as **grey with a hint of blue**, never flat warm grey and never
blue. Lightness is the only thing that steps, and OKLCH lightness is
perceptual, so equal steps read as equal lifts.

| Token         | Utility         | L     | Use                                                                                                                                                                                                     |
| ------------- | --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--bg`        | `bg-background` | 0.16  | Canvas **and** app chrome (sidebar, top bar)                                                                                                                                                            |
| `--surface`   | `bg-card`       | 0.195 | Content panels                                                                                                                                                                                          |
| `--raised`    | `bg-popover`    | 0.215 | Surfaces that float: popovers, menus, dialogs — and the bands that name a group inside a list card (the user timeline's sticky day headers), one step under `muted` so a full-width strip doesn't glare |
| `--muted`     | `bg-muted`      | 0.25  | Code chips, strips, list-row fills, avatar fallbacks — must read on a card                                                                                                                              |
| `--secondary` | `bg-secondary`  | 0.29  | Filled tokens: combobox chips, switch track — not the secondary button (that is border + `bg-card`)                                                                                                     |

- **Two knobs** in `styles.css` retune the whole ramp: `--tint-h` (hue) and
  `--tint-c` (chroma). Canvas, card and popover carry it at 0.7× / 1× /
  1.25× (the raised steps read a touch cooler); the fills that sit on them
  (muted, secondary, the accent wash) run at 0.6×, because at their lightness
  the same chroma reads distinctly blue.
- **Muted and secondary are opaque.** Tailwind opacity modifiers multiply, and
  many call sites write `bg-muted/50`; on an alpha token that compounds to
  nothing.
- **`bg-accent` is not the brand accent.** It is shadcn's interaction wash
  (a light cool grey, L 0.86, at 8% — translucent so it tints whatever it
  lands on): highlighted rows
  in menu / select / combobox / context-menu, ghost and outline button hover,
  toggle hover. (Pressed toggles are `bg-input`, see Toggle.) The brand accent is `primary`.
- Mix with `color-mix(in oklch, …)`, never `in srgb`.
- The canvas hex (`#0c0d0f`) is also written in `index.html` (boot `<style>`
  and `theme-color`) and `public/manifest.json`. Change all three together.
- **Light mode** is defined in every cascade branch but not shipped:
  `index.html` hardcodes `class="dark"`. Don't add `text-white` / `bg-white`;
  use `foreground` / `background` so the light branch works when it turns on.

### Border — one line

`--border`, `--input` and `--sidebar-border` all resolve to `--border-token`:
foreground at `--border-alpha` (10%). A card's edge, the dividers inside it, a
toolbar's underline, the nav's rule, inputs and outline buttons are the **same
line**. Write `border-border` / `divide-border`; never a hardcoded
`border-white/[0.0N]`. Hover and active borders are call-site opacities above
it (e.g. `hover:border-foreground/20`).

### Text — a four-step ladder

| Utility             | Alpha | Use                                                           |
| ------------------- | ----- | ------------------------------------------------------------- |
| `text-foreground`   | 100%  | Titles, values, labels you act on, emphasis                   |
| `text-fg-secondary` | 70%   | Descriptions, body copy, chart captions, field hints          |
| `text-fg-tertiary`  | 55%   | Labels, timestamps, ids — `text-muted-foreground` **is** this |
| `text-fg-muted`     | 45%   | Disabled, placeholders, de-emphasised counts                  |

- Use the named utility, never `text-foreground/70`. There is no separate body,
  caption or metadata step.
- **Don't stack an opacity modifier on a token that is already a tint.**
  `text-muted-foreground/70` compounds 55% × 0.7 = 38% and drops under the
  4.5:1 floor. One layer owns the muting.

### Accent

`--accent-token` is `teal-300` (`#46d7d4`), **fixed in both modes**. It is the
single most important beat on a surface: the primary button fill (with ink
text), the active-tab underline, the active nav row, and text
selection. It is a rail or an edge, never a large fill — the primary button is
the one carve-out. Orange appears in product UI only as a chart hue and as
`destructive`, never as the accent.

**Scrim.** Modal overlays dim the page with `bg-scrim` (`--scrim`, ink at
45%, fixed in both modes) — no blur.

**Selection** is a teal wash at 20% with the selected text itself in teal, set
once on `::selection`. Don't override it per component.

### Status

The closed palette has no red, so `destructive` is `orange-300`. `info`
(`blue-200` dark), `success` (`green-300`), `warning` (`amber-300`). Each
`-foreground` is the ink for that status on the canvas. Badges and status
`IconTile`s use them as an 8% fill (16% dark) with the matching ink. **A status alert speaks in its status:** icon and title
in the status ink, the description in the same ink at 80% — never a coloured
frame around neutral copy. Only the default alert uses the text ladder.

### Charts

`--chart-1..5` in the dashboard's order: teal, lime (`#6ad945`), blue, orange,
amber. Slot 1 matches the accent, so a single-series chart is the same colour
as the app. Import `CHART_COLORS` from `components/charts/chart-colors`; never
hardcode a second copy.

`--chart-6..10` are the same five hues as light tints (the palette's `-100`
shades), in the same order. They are never in the default cycle: a chart
colours its series 1-5 by position, and only a pinned chart's colour picker
offers all ten (`CHART_COLOR_TOKENS`, stored by token name so a choice follows
the theme). Draw any series colour through `seriesColor`, which applies a
pin's picks and otherwise returns the default for the position.

### Brand scale

Eight hue families × five fixed steps (`black`, `cream`, `gray`, `teal`,
`green`, `blue`, `amber`, `orange`; 100 lightest → 500 darkest), identical in
both modes. Product surfaces use the semantic tokens above; reach for a raw hue
only for a categorical decision, through the marker utilities (`text-teal`,
`bg-amber`, `text-ink`, `bg-paper`), never a hex literal.

**Sanctioned hex exceptions:** the Superwall Wednesday share card (rendered by
Satori too, so its colours are literals kept in step across three files — see
`AGENTS.md`), `index.html`'s boot style, and device mockups (the device
frame's chrome and the simulated OS UI drawn inside it keep their own literal
fills and radii).

---

## Typography

- **Manrope Variable** for everything: headings, body, labels, buttons.
- **Roboto Mono Variable** for code only — code blocks, inline `<code>`,
  JSON/log payloads, CLI commands. **Never for data**: ids, SKUs, masked keys,
  prices, numbers and dates are Manrope; numbers that must align or not jitter
  take `tabular-nums`. Upright; no italic anywhere in product UI.
- Secrets and tokens a user copies into code (API keys, signing secrets) are
  mono `text-xs`; identifiers shown as data are Manrope tabular.

### Scale

Sizes come from Tailwind's scale; headings get tracking from the base layer
that tightens with size (`-0.05em` h1 → `-0.005em` h6). Every size in the
product is a **type role** with one spec and one owner — page title, section
heading, card title, label, meta, figures and the rest. The table lives in
**Sizing → Type roles**, next to the control and structure ramps it derives
from. **`tabular-nums` only where digits must line up or hold still:**
right-aligned numeric table columns, and values that tick in place (a live
counter, a countdown). A figure centred alone in its cell or tile — campaign
row figures, a stat value — stays proportional: tabular digits pad a narrow
"1" to the width of a "0", so "11K" reads as monospace.

**`text-xs` is 13px** (18px line), not Tailwind's 12px — at 12 Manrope's small
figures close up on dense tables.

**No eyebrows.** Mono / uppercase / teal labels above headings are not part of
this register. A kicker above a heading is the label role: `text-xs` 500
`text-fg-tertiary`.

### Weight

Three weights, set once in `styles.css` (`--font-weight-medium`,
`--font-weight-semibold`): **400** body, **500** headings / buttons / labels,
**600** inline `strong` and the `StatsCard` value (30px, or `text-2xl` in the
compact tile) — the ceiling. Headings are 500, never 600.
`font-bold` is banned; there are none in web2. More emphasis means a brighter colour or a larger size.

Brand wordmarks are separate from this UI scale: the Superadmin wordmark uses
Manrope 800 with a subtle matching stroke to match the main Superwall logo's visual weight.

**A weight change on state never moves layout.** A label that turns "medium"
when active (tabs, nav rows, section navs) keeps 400 and takes `faux-medium`
under the state variant — `data-[active=true]:faux-medium`. It's a `0.011em`
text-stroke in the text colour, calibrated to read the same as real 500 (within
~2% on ink, stem and bar thickness at 13–15px). Stroke is paint-only, so the
label's width never changes and neighbours never shift. It inherits, so put it
on the row.

- Never toggle `font-medium` on state.
- Don't use a text-shadow for this: any shadow, even at zero offset, re-paints
  the anti-aliased edges and reads 5–8% heavier.
- If the medium weight changes, recalibrate the `0.011em` in the
  `faux-medium` utility (overridable via `--faux-medium-stroke`; `/dev/design-system` →
  Typography has a 1:1 check).

---

## Copy

One voice across the product. When a string disagrees with this section, fix
the string. Product copy is US English ("organization", "canceled", "color").

### Case

- **Sentence case everywhere:** page titles, headings, card titles, buttons,
  tabs, menu and select items, field labels, placeholders, table headers,
  metric names, badges, tooltips, toasts, empty states and dialog titles.
  Capitalize the first word and proper nouns only — "All campaigns", "Main
  events", "Total proceeds", "Add product".
- **Proper nouns keep their casing:** Superwall, App Store, App Store Connect,
  Google Play, Stripe, RevenueCat, Apple Search Ads, Meta, TikTok, iOS, Android,
  Flutter, React Native, Expo, SuperCEL. **Acronyms stay upper:** SDK, API, ID,
  URL, JSON, CSV, SKU. Write "ID", never "Id" or "id", in copy.
- Server-provided labels that the legacy dashboard or public API also use keep
  their casing at the source; web2 maps them for display in
  `lib/display-labels.ts`. Don't sentence-case them per call site.
- **Superwall feature names are ordinary labels:** sentence case, and lower
  case mid-sentence — "Refund protection", "Revenue tracking", "Retention
  messaging", "Demand score", "Web checkout", "Public beta", "Editor agents",
  "Campaign analysis", "Flows", "the new dashboard". Breadcrumbs and document
  titles included.
- **Third-party terms keep their owner's casing:** Apple's "Retention Messaging
  API", "Family Sharing", "Small Business Program", "Non-Consumable",
  "Non-Renewing", "Auto-Renewable Subscription", "App ID", "Subscription
  Group"; Stripe's "Managed Payments"; RevenueCat's "Entitlements" and
  "Offerings"; Google's "Real-time developer notifications". Mock copies of
  Apple's own sheets stay verbatim.
- **"Google Play", never "Play Store".** A stored value keeps its spelling;
  only its label changes.
- **Raw enum values never reach the screen.** An all-caps or snake_case value
  (platform, role, member status, lockout or billing type, Apple message
  state, config type, skip reason, audit-log op) gets a display map in
  `lib/display-labels.ts` ("IOS" → "iOS", "SUPERADMIN" → "Superadmin", "add"
  → "Added"). Helpers that title-case at runtime use `displayLabel` or
  `humanizeKey`, which keep acronyms upper ("API key", not "Api key").
- **Saved and analytics values don't change.** Strings that are also PostHog
  values or saved data stay as they are: onboarding `*_label` values,
  `copy_label` values, default names saved into records ("New Paywall",
  "(Template)"), survey default options, CSV export headers (raw server
  labels). When such a value is shown in title case, add a separate display
  label beside it and leave the value alone.
- **API and legacy paths keep their source's terms.** An API resource or scope
  keeps the API's name ("Applications"); a path through the legacy UI keeps
  the legacy label ("Settings / Public Beta").

### Actions

- **Buttons are an imperative verb + object:** "Add product", "Create
  campaign", "Save changes". Not "New paywall", not a bare noun.
- **One verb per object**, everywhere the action appears (page header, empty
  state, menu, dialog title and its submit button):

  | Verb   | Objects                                                                                                            |
  | ------ | ------------------------------------------------------------------------------------------------------------------ |
  | Create | paywall, campaign, project, app, API key, integration token, webhook, survey, chart                                |
  | Add    | product, entitlement, placement, audience, filter, locale, holdout, script — and a paywall or survey to a campaign |

  "New chat" in the agent panel is the one idiom that keeps "New".

- **Delete** is permanent, **Remove** detaches from a parent (a paywall from a
  campaign, a member from a project), **Archive** is reversible. Name the verb
  by what the action does, not what the old button said: a "Remove" that
  destroys the record is "Delete", a "Delete" that archives is "Archive".
- **A confirmation's button repeats verb + object** ("Delete paywall", "Revoke
  API key", "Reset assignments"), never "OK", "Yes" or the bare verb. A
  confirmation title phrased as a question ends with "?".
- **A bare verb is allowed in two places only:** a row action inside a row
  that already names the object, and a responsive short label ("Create" on a
  narrow header) whose `aria-label` carries the full verb + object. Everywhere
  else — card headers, dialog submits, "Configure", "Update" — name the
  object. A save button is "Save changes".
- **Retry is "Try again"** when it recovers from an error. An action that
  re-runs work names it ("Retry import").
- **A link-button that opens something says "Open …"**: "Open organization",
  "Open in Stripe". Never a bare noun.
- **Menu items don't end in "…"**; the ellipsis is for truncation and
  in-progress labels only.

### Punctuation and characters

- **No trailing period** on a single phrase: labels, tooltips, badges, toast
  titles, and combobox and list empty rows ("No campaigns found"). A toast
  title built from a server message's first sentence drops its period. A
  description that is a full sentence (hints, dialog bodies, toast
  descriptions, empty-state bodies, integration row and section
  descriptions) ends with a period.
- **Failure toasts are "Couldn’t {verb} {object}"** ("Couldn’t save
  paywall"), never "Could not…", "Unable to…" or "Failed to…". Inline error
  prose says "couldn’t" too. Don't repeat "Try again." in prose right above a
  Try again button.
- **"…"**, the single character, for truncation and in-progress labels
  ("Loading…", "Saving…"). Never three dots.
- **"·"** is the inline separator between metadata ("iOS · Production · 3
  days ago"), spaced. Not "•", "|" or " - ". `MetaLine` draws it in JSX and
  `joinMeta` in a string (Components → Meta line); never a hand-typed dot.
- **A date range takes a spaced en dash:** "Sep 1 – Sep 7", never " - ". An arrow
  in a navigation path is "→", never "->".
- **Curly quotes and apostrophes** (’ “ ”) in everything a person reads,
  labels included ("Conv’s", "Don’t"), and in year elision ("Sep ’25").
  Straight quotes and "..." only in what the user copies or types: the agent
  prompt, code samples, a truncated key shown as code.
- **Hyphenate compound adjectives:** "real-time" (never "realtime"),
  "one-time".
- **"—"** stands in for a missing value, never "N/A".

### Numbers and units

"3 days", "7 days", "24 hours" — digits, a space, and a unit that agrees with
the number ("1 day", "1 event", "1 audience"). "%" attaches: "12%". That rule
is for labels and prose; dense meta may use the compact forms — relative
timestamps in table cells and meta ("5m ago", "2d ago", from
`formatRelativeTime`; see Components → Relative time) and unit symbols
("120ms", "~4m").

### Abbreviations

- **Metric names keep the legacy dashboard's short forms**, sentence cased:
  "Conv’s" is a count of conversions, "Conv. rate" a rate, "Proj." projected
  ("Initial conv’s", "Trial conv. rate", "Proj. pending trial conv’s").
  Campaign analysis metrics use them too. Demand-score legends deliberately
  keep the long form.
- **Prose spells words out:** descriptions, tooltips and sentences say
  "conversions" and "conversion rate". Never "Convs", "Conv" or "Conversion
  Rate" as a label.
- **Version labels take a capital V:** "Webhooks V2", "Results V3",
  "App Store Server Notifications V2". A lower-case "v2" in a badge, tab or
  label is wrong. Code, routes and API values keep their own spelling
  (`superwall_v2`, `/webhooks-v2`).
- **Semver numbers keep a lower-case v:** version constraints read "Requires
  SDK v3.3.0 or later."

### Integration descriptions

The integrations page lists each integration as a row (Layout → Integrations
index), which shows the description on one `text-xs` line at desktop widths
and wraps it on a phone. The length rule below predates that: it was written
for the tile grid the rows replaced, where it made every tile in a row the
same height. It no longer buys alignment, but it is still enforced, so the
descriptions stay one length until the rule is retired.

Every integration description — the backend catalog's
(`apps/integration-router` `metadata.ts`) and the ones the dashboard owns
(`components/integrations/tile-copy.ts`) — is **exactly a line and a half** on
a 416px line: set in Manrope 400 at 14px, it fills that first line
and ends its second line at the halfway mark: **208px ± 6**, about one
character. One sentence, a capital first, one period last, no `!` `?` `…`,
curly quotes. The rule is **rendered width, never character count** — Manrope
is proportional, so two sentences of equal length can differ by 40px. The
checker wraps each description the way the browser does (after a space or a
hyphen, greedily) using the font's own advances and kerning, measured in the
browser (`scripts/integration-descriptions/manrope-400-14px.json`; regenerate
it if the font changes). Rewrite a description to fit,
never pad it. A pre-commit hook (`scripts/integration-descriptions/check.ts`,
which shows the second line and how many pixels to add or cut) blocks a
commit that breaks it, and `apps/integration-router`'s test suite fails CI on
it. Section band descriptions are not tile copy and aren't bound by it.

### Terminology

One term per object, in lower case mid-sentence: **paywall, campaign,
placement, audience, product, entitlement, survey, template, asset, user,
event, transaction, organization, project, app.** Users are the people using a
customer's app.

- **"App", never "application"**, in copy. Code, routes and API fields keep
  `application`; so does Android's `Application` class in setup
  instructions.
- "Email", "sign in", "canceled", "locale" (not "localization"). "App ID"
  is Superwall's ID for an app; the store's is "Store app ID".
- Dev-only names (loader variants) and animation frames (the "Thinking" dots)
  are exempt.

---

## Shape & depth

### No shadows

Shinsa draws no shadows. Every surface (card, table, popup, dialog, the
outline button) is separated by its fill step and one 1px hairline in `bg-3`,
drawn as an inset ring in dark mode. The `shadow-1…4` tokens are that ring and
nothing else, and `shadow-control*` the controls' edges; app code uses only
those. `bun lint:conventions` rejects Tailwind's own shadows (`shadow-2xs` …
`shadow-2xl`, `shadow-inner`) and a raw `shadow-[…]` or `ring-[…]` in
`apps/web/src`. The primary and destructive buttons keep their inner top
highlight, the one exception.

A popup (popover, menu, select, combobox, preview card, dialog) draws its edge
with that `shadow-*` ring alone, on the `popover` fill. Never add `border` to
one as well: the ring and the border stack into a 2px edge. Tooltips and
toasts are the inverse, a `border` and no shadow.

### Gaps

A title over its description is `gap-px`. `gap-0.5` is banned in `apps/web/src`
(the lint rejects it): the next step up is `gap-1`. The one 2px gap is between
the buttons of a section header, and `SectionLabel` owns it.

### Corners

**The law: a nested corner is concentric with its parent.** Inner radius =
outer radius − the padding between the two edges. No exceptions, at any depth:
a menu item in a popup, a segment in a tab track, a button flush in a card
footer. When the padding is larger than the outer radius the inner corner is
free again (it no longer reads against the outer one), and takes its own
token.

The radii are tokens derived from each other with `calc()` in `globals.css`
(Corners), so the law holds by construction:

| Token | Value | Use |
| --- | --- | --- |
| `rounded-control-sm` | 6px | xs / sm controls (22 / 24px) |
| `rounded-control` | 7px = control-sm + 1 | default and lg controls, inputs, tab tracks |
| `rounded-item` | 6px | a row inside a popup |
| `rounded-popup` | 10px = item + 4 (`p-1`) | menus, selects, comboboxes, command, popovers |
| `rounded-segment` | 5px = control − 2 (`p-0.5`) | a tab or segment inside a track, and its sliding indicator |

Cards, dialogs and sheets keep the larger `rounded-2xl` / `rounded-3xl`.
`rounded-full` is for circles only (avatars, switches, dots, spinners).

Never write `rounded-[Npx]` or a free `calc()` in a class: `bun lint:conventions`
fails on any raw corner in `packages/ui` and `apps/web`. A new nesting gets a
new derived token in `globals.css`, written as parent − padding.

### No shadows

In Shinsa's kit `shadow-xs…lg` resolve to the same hairline as `shadow-1…4`
(`globals.css`), never to `none`: Tailwind composes shadows and rings into one
`box-shadow`, and a `none` in that list invalidates the whole declaration. App
code writes only `shadow-1…4` and `shadow-control*`; the lint rejects the rest
(above). Depth comes from the surface steps, the hairline and type. **Carve-out:** illustrative artwork (the dashboard-migration
welcome artwork) and the `DotMatrixLoader` glow may use `drop-shadow` as part
of the drawing — never on UI chrome.

### No focus states

Shinsa draws **no focus states**: no `ring-*`, no outline, no border recolour and no
background wash marks focus, on controls, rows, tabs, fields or links. Every interactive element
carries `outline-none`, and the base layer in `globals.css` removes the browser's own `:focus` /
`:focus-visible` outline for anything that doesn't. Keyboard movement inside a floating list
(menu, select, combobox, command) still moves the list's highlight, because that highlight is the
list's selection, not a focus mark. `bun lint:conventions` rejects `focus:`, `focus-visible:`,
`focus-within:` and `ring-offset-*` in `packages/ui` and `apps/web`. Anything below that describes
a focus border, ring, underline or wash is paywall-next reference and does not apply.

- **Selected** states that used to be a ring (a picked card, tile or swatch)
  are a `primary` border — `border-primary`, never `ring-2 ring-primary`.
- **Selected rows in a `divide-y` list** draw their primary edge on `::before`
  (`before:absolute before:inset-0 before:border before:border-primary`), so it
  neither doubles the dividers nor changes the row's height.
- **Knockout edges.** A badge or dot laid over another element (the audit-log
  action chip over an avatar, the point on a confidence-interval bar) is cut
  out by a 2px border in the surface colour (`border-card`, `border-popover`
  on a floating surface), never `ring-2 ring-card`. Grow the box by the border
  so the coloured part keeps its size; a corner badge adds `-m-0.5` so its
  footprint and offset don't move.

### Fill or border

Controls pick one: an outline button borders and has no fill; badges, status
dots and tiles likewise. **Panels keep both** — cards, popovers, menus, dialogs
carry their surface fill and the border, because the fill alone is too faint to
define an edge. **One sanctioned control exception: `secondary`** (Button
`secondary`, SelectTrigger `secondary`) is built like a card — `border-border`

- `bg-card` — so the dashboard's filters and secondary actions read as small
  cards. On a card its fill disappears and it is just its border; that's intended.
  Where regions meet, draw one shared line; never double a border.

---

## Spacing

Spacing is a small closed scale. Each step has one meaning, and every
relationship on a page maps to exactly one step. Control insets (edge → text,
edge → icon, icon ↔ label) are not on this scale: they come from the
Iconography table and live only inside primitives. `/dev/design-system` → Foundations →
Spacing draws the scale and the key rules live.

**How to apply it**

- **The parent owns spacing** (`gap-*`, `space-y-*`). Children carry no outer
  margin. The only sanctioned margins:
  - the state figure's `mb-4`
  - a popover's first text line `-mt-1` (it cancels ~4px of half-leading)
  - icon `-mx-px`
  - border merges `-m-px`
  - affix hangs into a field's padding: `-me-1` / `-me-1.5` / `-me-2`, and
    `-ms-1` for a leading keycap
- **Write visible values.** Where a 1px border sits inside a control, write
  the class 1px under it (`px-[calc(--spacing(3)-1px)]`). Panel insets (card,
  dialog, popover) are measured inside the border and written plainly.
- **No arbitrary `[Npx]` or rem spacing.** The one exception is the sidebar's
  bespoke 18px-grid rows.
- **A row that ends in a boxed control** drops its end padding to that
  control's vertical inset (see Trailing controls).
- **Don't tighten a primitive at the call site.** If its rhythm is wrong, fix
  the primitive.

### Scale

| px  | Class | Meaning                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | —     | Fused: parts share one border (`Group`, a fused toggle group, CardFrame's −1px merge)                                                                                                                                                                                                                                                                       |
| 2   | `0.5` | Inside a framed or gapped set: the frame's padding and the gap between its items (segmented control, toolbar, default tabs, gapped toggles, pagination, sidebar rows). Title → description when the stack is the message or a card's header. Currency prefix → number.                                                                                      |
| 4   | `1`   | Title → description in an overlay's header (dialog, sheet, popover). A rich row's title → its chips. Tight token pairs: badge icon ↔ label, keycaps in a chord, combobox chips. List-popup padding. Floating offset (`sideOffset`). Frame tray padding and the gap between its panels. A unit suffix after a value.                                         |
| 6   | `1.5` | An inline annotation after text: ⓘ, a count pill, a status glyph and its label. List group → group. The vertical floor of a 48px header strip. `xs` icon ↔ label.                                                                                                                                                                                           |
| 8   | `2`   | Icon ↔ label in 28/32px controls and rows. A control ↔ its own label text. Label → control → hint in a field. Controls in one set (a button pair, the filter pickers, the chrome group, alert and toast actions). Paragraph → paragraph in an alert. Label ↔ keycaps.                                                                                       |
| 10  | `2.5` | Row and cell inset: list and menu rows and their separators, group labels, status rows, table cells, a two-line or rich row's block. `sm` controls ↔ every edge of a 48px header strip (the top bar included). `sm` edge → text. `lg`/`xl` icon ↔ label.                                                                                                    |
| 12  | `3`   | Popover, alert and toast inset. Vertical inset of a footer strip, and of a header strip that stacks a description. Card header → body. Field → field in a popover. Option → option in a radio/checkbox group. Stat title → value. List toolbar start ↔ end.                                                                                                 |
| 16  | `4`   | Card/panel inset. Horizontal inset of a strip. Field → field in a form; legend → fields and field → field in a fieldset. A heading → its content (section heading, tab list → panel). Separate commands in a page header. Empty-state figure → title and text → actions. Cards in a grid. Dialog section → section. Minimum gap in a `justify-between` row. |
| 20  | `5`   | Dialog, alert dialog and sheet inset                                                                                                                                                                                                                                                                                                                        |
| 24  | `6`   | Page block → block. Fieldset → fieldset, and section → section inside a form or dialog. Compact state padding. Content gutter from `sm`.                                                                                                                                                                                                                    |
| 32  | `8`   | Toast viewport inset from `sm` (its only use)                                                                                                                                                                                                                                                                                                               |
| 40  | `10`  | Content gutter from `lg`                                                                                                                                                                                                                                                                                                                                    |
| 48  | `12`  | Full-size empty/error state block padding                                                                                                                                                                                                                                                                                                                   |

**Derived control geometry** (only inside primitives):

- Edge → text by control height: 8 / 10 / 12 / 14 / 16. Edge → icon is 1px
  less: 7 / 9 / 11 / 13 / 15. A 26px item in a 32px frame (default tab,
  segment) spaces like a 28px control: 10 / 9.
- Badge edge → text 6 / 8 / 10.
- Field icon → typed text 10 / 10 / 12. A separated affix is 11 inside and 13
  to the text.
- Sidebar rows: 8 to the edge, 18 icon ↔ label (its 18px icon grid). Sub-rows:
  guide line at 16, box from 24, text at 42 — under the parent's label.
- The dialog close ✕ sits 14 in, level with the title.

### Rules

**Inside a control**

| Relationship                                            | Value                 | Where                                                                  |
| ------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| Edge → text, edge → icon, icon ↔ label                  | the Iconography table | `Button`, `Select`, menu rows, `Tabs`, `SegmentedControl`, `GroupText` |
| Checkbox, radio, switch or label icon ↔ label text      | 8                     | `Label`                                                                |
| Framed set: frame padding / item gap / separator margin | 2 / 2 / 4 each side   | `Toolbar`, `SegmentedControl`, `Tabs`, `ToggleGroup`                   |

**Inline pairs**

| Relationship                                                       | Value                                         | Where                                                    |
| ------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------- |
| Annotation after text (ⓘ, count pill, glyph + status label)        | 6                                             | `InfoTooltip`, `StatsCard`, `DataStateView`              |
| A label and its own glyph read as one label (stat title + chevron) | 2                                             | `StatsCard`                                              |
| Badge icon ↔ label                                                 | 4 at `xs` / `sm`, 6 at `default`, 8 at `lg`   | `Badge`                                                  |
| Keycap ↔ keycap / label ↔ keycaps                                  | 4 / 8                                         | `Kbd`, `Tooltip`                                         |
| Value ↔ delta / currency prefix / unit suffix                      | 8 / 2 / 4                                     | `StatsCard`                                              |
| Text ↔ a trailing control in the same row                          | 8                                             | `Select`, `Toast`                                        |
| Left block ↔ a right-pushed item (`justify-between`)               | minimum 16; the list toolbar's compact row 12 | `Accordion`, chart tooltip, `ListToolbar`, `TodoStepper` |
| Breadcrumb items                                                   | 10                                            | `Breadcrumb`                                             |

**Control ↔ control**

| Relationship                                                                                                                                                            | Value  | Where                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Fused — one control                                                                                                                                                     | 0      | `Group`: the overview's refresh + first picker, a date range + its edit button                                               |
| A gapped set of small items                                                                                                                                             | 2      | `ToggleGroup`, `Pagination`                                                                                                  |
| Controls in one set: a footer pair, popover actions, the filter pickers, the chrome group, a card action, list-toolbar end, alert actions, state actions, nested groups | 8      | `DialogFooter`, `DashboardFilters`, `AppChromeActions`, `CardAction`, `ListToolbar`, `AlertAction`, `DataStateView`, `Group` |
| Separate commands in a page header                                                                                                                                      | 16     | `PageHeader`                                                                                                                 |
| Top bar: trigger → separator → breadcrumb                                                                                                                               | 8 → 16 | shell header                                                                                                                 |

A page header can hold both: the overview's filters are one set (refresh
fused to the environment picker, then the date picker, 8 apart); a list
page's "Share" and "New paywall" are separate commands, 16 apart.

**Title → description** — by role, never by type size.

| Relationship                                                                                                                                     | Value | Where                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| A card's header: card, CardFrame, Frame, a collapsible card strip                                                                                | 2     | `CardHeader`, `CardFrameHeader`, `FrameHeader`, `CollapsibleStrip` (and a `CollapsibleRowTrigger size="strip"` column) |
| A header over content inside an overlay: dialog, alert dialog, sheet, popover                                                                    | 4     | `DialogHeader`, `AlertDialogHeader`, `SheetHeader`                                                                     |
| The stack is the whole message: a page or section heading on the canvas, alert, toast, empty / error / 404, an option's label + hint, a todo row | 2     | `PageHeader`, `PageSection`, `Alert`, `Toast`, `Empty`, `DataStateView`, `NotFoundState`, `TodoStepper`                |

**Forms**

| Relationship                                                                    | Value                        | Where                                       |
| ------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------- |
| Label → control → hint or error                                                 | 8                            | `Field`, `NumberField`, `Progress`, `Meter` |
| Field → field in a form or dialog                                               | 16                           | `Form`                                      |
| Legend → fields, and field → field inside a fieldset                            | 16                           | `Fieldset`                                  |
| Fieldset → fieldset; section → section in a form or panel                       | 24                           | the parent's `gap-6`                        |
| Field → field in a popover (= the popover inset); popover content → its actions | 12                           | `DateRangeSelect`                           |
| Two fields side by side                                                         | 8                            | `DateRangeSelect`                           |
| Options: vertical / horizontal / bordered option cards                          | 12 / 16 / 8                  | `RadioGroup`, `CheckboxGroup`, `OptionCard` |
| Hint under a checkbox or radio label                                            | 24 indent (16px control + 8) | —                                           |

**Surface insets**

| Surface                                                               | Inset                                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Card, FramePanel, preview card                                        | 16                                                                      |
| Header → body                                                         | card 12; dialog and sheet 16 (header `pb-3` + panel `pt-1`)             |
| Dialog, alert dialog, sheet                                           | 20; 16 between sections, including a header straight over a bare footer |
| Popover (its first text line takes `-mt-1` at the call site)          | 12                                                                      |
| Alert, toast                                                          | 12 (a leading icon 11, 1px outside the text)                            |
| Tooltip, tooltip-style popover and toast, chart tooltip               | 8 × 4                                                                   |
| List popup padding: menu, select, combobox, autocomplete / command    | 4 / 8                                                                   |
| List row / group label / status row / separator inset / group → group | 10 × 4 / 10 × 6 / 10 × 6 / 10 / 6                                       |
| Table cell / outer column under a card                                | 10 / 16                                                                 |
| Frame tray / gap between panels                                       | 4 / 4                                                                   |
| Code block / accordion row                                            | 12 / 16 × 0                                                             |
| Floating offset / modal viewport / toast viewport / toast stack       | 4 / 16 / 16, 32 from `sm` / 12                                          |

**Header and footer strips** (heights: see Sizing → Structures)

- Every one-line header strip — the top bar, the list toolbar, a bordered
  `CardHeader`, `FrameHeader`, `CardFrameHeader` — is 48px: its `sm` controls
  sit 10px from every edge and its title 16px in. A strip that stacks a
  description pads 12 × 16.
- **A strip that ends in controls ends 10px in** — its end padding equals the
  controls' vertical inset (Trailing controls), while the title keeps its 16px
  start. The primitives own it: `CardHeader className="border-b"` drops to
  `pe-2.5` when it has a `CardAction`; `FrameHeader` and `CardFrameHeader` do
  when a button, group or select trigger is a direct child; `ListToolbar`'s
  end region is inset 10. Never pad a strip's end at the call site.
- Footer strips are 16 × 12 (card) and 20 × 12 (dialog) around `default`
  buttons: 56px.
- **A footer that is one text action is the control itself** —
  `CardFooterAction`, 48px like the header strip, never a ghost button
  padded inside a 56px strip with its hover wash re-routed to the strip.
- The code-block filename strip is 12 × 6 and ends 6px from its copy button.
- The list toolbar: the end region is inset 10, its controls 8 apart; start ↔
  end is 12; search sits 12 from its divider, which spans the full 48; the
  toolbar label sits 16 in.

**Page rhythm**

- Content gutter: 12 / 24 / 40.
- Page blocks are 24 apart — `ListPageShell`'s `space-y-6`. Pages don't
  override it.
- A section heading → its content is 16 (`PageSection`); a tab list → its
  panel is 16 (`Tabs`).
- A header row that wraps puts 16 between its lines.

**Grids**

- Cards in a grid (stat cards, product cards, asset tiles): 16. Gallery
  cells (paywall and template previews) share one hairline instead of a gap.
- Fields laid out in a form grid: 16, the field → field step (never 12).
- Option cards 8. Frame panels 4. CardFrame −1px, merged.

**Empty, error and not-found states**

- Figure → title 16, title → description 2, description → actions 16.
- Actions sit 8 apart; a third action's row sits 16 under the pair.
- Block padding is 48, or 24 when compact. `Empty` pads 24, 48 from `md`.

---

## Sizing

Every size comes from one of the ramps below. A size on no ramp is a bug; a
size on a ramp but used in the wrong context is a bug too. The ramps derive
from each other — type sits in controls, controls sit in strips, strips sit in
cards — and **a control's height matches the line of the heading it sits
beside**:

- Page title: a 32px line, so 32px controls.
- Section heading on the canvas: a 28px line, so 28px controls.
- Card title: a 20px line in a 48px strip, so 28px controls.

**Primitives own their heights.** Pick the size prop; never write `h-*`,
`size-*`, `min-h-*` or a height-changing `py-*` on a control, a strip or a
row at the call site. If a primitive's height is wrong, fix the primitive.
`/dev/design-system` → Foundations → Sizing draws the structure ramp live, with rulers that
read each part's measured height.

### Structures

**One structure scale.** Every one-line header strip in the product is
**48px, the top bar's height**: a 28px `sm` control 10px from every edge, the
title 16px in and centred. A card with tabs and a card with a title have
headers of identical height.

| Structure                                                                                                                    | Height                                                                                                                             | Derivation                                                                                                                                                                                                                                                                                                                                                                                                                                  | Owner                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Top bar                                                                                                                      | 48                                                                                                                                 | 28 flat control + 2 × 10. The sidebar logo block matches.                                                                                                                                                                                                                                                                                                                                                                                   | `APP_TOP_BAR_CLASSNAME`                                                                                                                      |
| Header strip, one line: the list toolbar, a bordered `CardHeader`, `FrameHeader`, `CardFrameHeader`, any card section header | 48                                                                                                                                 | 28 `sm` control + 2 × 10; the 20px title + 2 × 14. Filter tabs make 48 by their own padding (14 above and below the label), so the underline meets the card edge; the search divider spans the full 48. **Ending in controls, the end padding is 10** (= their vertical inset) while the title keeps 16 at the start — automatic from a `CardAction`, or a button / group / select trigger directly in a `FrameHeader` / `CardFrameHeader`. | `ListToolbar`, `CardHeader className="border-b"`, `FrameHeader`, `CardFrameHeader`, `CollapsibleRowTrigger size="strip"`, `CollapsibleStrip` |
| Header strip with a description                                                                                              | 66                                                                                                                                 | 12 + 20 + 2 + 20 + 12                                                                                                                                                                                                                                                                                                                                                                                                                       | same                                                                                                                                         |
| Plain card header (no border)                                                                                                | —                                                                                                                                  | 16 inset; a lone title centres on its action, the action centres on the title block                                                                                                                                                                                                                                                                                                                                                         | `CardHeader`                                                                                                                                 |
| Table header                                                                                                                 | 40 (36 in a Frame)                                                                                                                 | a `text-xs` label, 10px cell padding                                                                                                                                                                                                                                                                                                                                                                                                        | `TableHead`                                                                                                                                  |
| Table body row                                                                                                               | ≈ 40                                                                                                                               | 10 + a `text-sm` line + 10                                                                                                                                                                                                                                                                                                                                                                                                                  | `TableCell`                                                                                                                                  |
| Footer strip (card or dialog)                                                                                                | 56 (+1 border)                                                                                                                     | 32 `default` + 2 × 12                                                                                                                                                                                                                                                                                                                                                                                                                       | `CardFooter className="border-t"`, `DialogFooter`                                                                                            |
| Footer action: a footer that is one text action ("Show 35 more", "Load more", "All campaigns")                               | 48, border included                                                                                                                | the header strip's height; the whole strip is the control                                                                                                                                                                                                                                                                                                                                                                                   | `CardFooterAction`                                                                                                                           |
| Code-block header strip (filename or tabs)                                                                                   | 36                                                                                                                                 | 24 + 2 × 6                                                                                                                                                                                                                                                                                                                                                                                                                                  | `CodeBlock` (`filename` / `tabs`)                                                                                                            |
| Menu / select / combobox row                                                                                                 | 28                                                                                                                                 | —                                                                                                                                                                                                                                                                                                                                                                                                                                           | `MenuItem`, `SelectItem`, `ComboboxItem`                                                                                                     |
| Two-line popup row                                                                                                           | 48                                                                                                                                 | 6 + 20 + 16 + 6                                                                                                                                                                                                                                                                                                                                                                                                                             | `description` on `SelectItem` / `ComboboxItem` / `AutocompleteItem`; Button `list-row-two-line`                                              |
| Command row, sidebar row, `list-row`                                                                                         | 32                                                                                                                                 | the collapsed sidebar row is 40                                                                                                                                                                                                                                                                                                                                                                                                             | —                                                                                                                                            |
| Accordion row                                                                                                                | 52                                                                                                                                 | 16 + 20 + 16                                                                                                                                                                                                                                                                                                                                                                                                                                | `AccordionTrigger`                                                                                                                           |
| Tooltip                                                                                                                      | 28                                                                                                                                 | 18 + 2 × 4 + 2 border                                                                                                                                                                                                                                                                                                                                                                                                                       | `TooltipPopup`                                                                                                                               |
| Segmented control, toolbar, default tabs                                                                                     | 32 (a `sm` tab list 28; `SegmentedControl size="lg"` 36, `size="xl"` 40 — `lg` for wide icon-only segments (the sidebar switcher)) | 1 + 2 + 26 + 2 + 1                                                                                                                                                                                                                                                                                                                                                                                                                          | `SegmentedControl`, `Toolbar`, `TabsList`                                                                                                    |
| Stat card                                                                                                                    | —                                                                                                                                  | 16 inset, label → 12 → 30px value (compact: 24px)                                                                                                                                                                                                                                                                                                                                                                                           | `StatsCard`                                                                                                                                  |
| Notice                                                                                                                       | 72 minimum                                                                                                                         | 16 inset, a 40 tile, 12 to the copy, a card title over body, content centred on the row; a cover image is exactly the copy block's height                                                                                                                                                                                                                                                                                                   | `Notice`                                                                                                                                     |
| Empty state                                                                                                                  | —                                                                                                                                  | 40 chip → 16 → title → 2 → description → 16 → `sm` actions; block padding 48 (24 compact)                                                                                                                                                                                                                                                                                                                                                   | `SectionEmpty`, `Empty`                                                                                                                      |

### Content rows

Rows inside a card are **off the stat-card scale**: a row is never as tall as
a stat tile, and its figures are never a stat value.

| Row               | Height                                         | Build                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dense / table row | ≈ 40                                           | one `text-sm` line, 10px cell padding                                                                                                                                                                                                                                                                                                                                      |
| Collapsible row   | ≈ 40 (56 with a meta line)                     | `CollapsibleRowTrigger`: `py-2.5`, the chevron trailing, focus on `::before`                                                                                                                                                                                                                                                                                               |
| Two-line list row | 56                                             | `py-2.5`; a `text-sm` 500 title over a `text-xs` tertiary meta line — `Item variant="row"` (`ItemTitle` / `ItemDescription`) owns it; `plain` is the same body with no box (a table cell, a header), `card` a bordered tile                                                                                                                                                |
| Rich row          | 80 at `lg` (84 with a title-line notes action) | `py-3` around a 56px block: a `text-sm` 500 title (20px line), **8px**, then a 28px chip line (`PlacementBadge`s 6px apart, or `text-xs` meta on `leading-7`), beside inline figures — each a `text-xl` 400 proportional figure (28px line) over a `text-xs` 500 tertiary label, cells with no vertical padding, centred on the block. `CampaignStatRow` owns the figures. |

- **A stacked second line sits on a 16px line** (`leading-4`): the meta under
  a title, the label under a figure. The pair takes no gap; the line boxes are
  the spacing. That is what makes a two-line row 56.
- **Chips under a title are the exception**: a chip is a box, not a line box,
  so it would sit glued to the title's descenders. A title over chips takes a
  8px gap (the parent's `gap-2`), with 12px above and below the title and
  chips. Placement chips are `PlacementBadge`, the same Badge the campaign
  sidebar shows: `lg` (28px) with 13px type on a 20px line, an 8px side inset, an 8px icon
  gap and a 14px glyph, one step up from the default badge; a link glyph for a hosted placement, a filled bolt for
  an in-app one (struck through once paused). Enabled placements use the
  primary tint; disabled placements use `outline` and dim to tertiary. One
  component draws a placement everywhere, so don't restyle it per surface. `CampaignRow` owns the whole campaign
  row (prioritized bolt, title link, badges, chips, figures) for the campaigns list and
  the overview card alike.
- The 30px 600 figure belongs to `StatsCard` alone; a figure in a row is
  `text-xl`.
- Below `lg` a rich row stacks its figures under the title, still one row of
  four, each metric its own box (hairline border, 3px corner, no fill, figure
  and label left-aligned 12px in, boxes 8px apart), 14px below the title with
  4px under them and no rule between;
  that is the only way it grows (plus a
  title-line notes action). Campaign notes use a ghost `icon-xs` Button with
  `NotebookText` immediately after the title, labelled and named by a tooltip;
  its 24px title line makes that rich row 74px when notes are present.
- Skeletons keep the row's geometry exactly: each placeholder bar sits in a
  box of its line's height — `SkeletonLine` (`xs` 16 / 12 bar, `sm` 20 / 14,
  `base` 24 / 16, `lg` 28 / 20 for a section heading, `2xl` 32 / 24 for a
  page title), never a bare `h-3.5` `Skeleton` that collapses the line.

### Control heights

| px  | Button                        | Field     | Toggle    | Badge     | Also on this step                                                                                                   |
| --- | ----------------------------- | --------- | --------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| 18  | —                             | —         | —         | `xs`      | Kbd                                                                                                                 |
| 20  | —                             | —         | —         | `sm`      | count pills (= Badge `sm`)                                                                                          |
| 24  | `xs`, `icon-xs`               | —         | —         | `default` | toast action, code-block copy (the sort header is `xs` type on a `plain`, unboxed button)                           |
| 28  | `sm`, `icon-sm`               | `sm`      | `sm`      | `lg`      | placement badges (`PlacementBadge`), top-bar controls (flat), menu / select / combobox rows, tooltip, `sm` tab list |
| 32  | `default`, `icon`, `list-row` | `default` | `default` | —         | segmented control, toolbar, default tab list, command rows, sidebar rows                                            |
| 36  | `lg`, `icon-lg`               | `lg`      | `lg`      | —         | framed table header, code-block filename strip, command footer                                                      |
| 40  | `xl`, `icon-xl`               | —         | —         | —         | table header, collapsed sidebar row, icon tile                                                                      |
| 48  | `list-row-two-line`           | —         | —         | —         | the top bar and every one-line header strip; two-line popup rows                                                    |

- **No touch step-up.** Every size above is the size on a phone too: controls,
  fields, rows, badges, type and glyphs keep their desktop values at every
  width. A phone gets room by stacking and dropping, never by growing.
  Touch targets reach 44px through an invisible `pointer-coarse:after` hit
  area on `Button`, never a bigger box. Text fields stay 14px; iOS's
  zoom-into-focused-field is stopped by `maximum-scale=1` in the viewport
  (iOS only — `index.html`), not by 16px type.
- Checkbox, radio and the slider thumb are 16px.

**Size by context.** Every control in one row shares one height.

| Context                                                                                                                                                               | Size                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Page header actions, `DashboardFilters`                                                                                                                               | `default` 32        |
| Canvas section-heading actions (`PageSection`)                                                                                                                        | `sm` 28 / `icon-sm` |
| Top bar (48px)                                                                                                                                                        | flat 28             |
| Header strip in a card: `ListToolbar` `end`, a strip's `CardAction`, freshness in a card (`StatsRefreshButton size="sm"`)                                             | `sm` 28 / `icon-sm` |
| Card body forms, card footers, dialog footers                                                                                                                         | `default` 32        |
| Nested or floating UI: popovers, menu action rows, inline editors, controls inside list or table rows, dialog-row actions, alert actions, state actions inside a card | `sm` 28             |
| Dense inline: toast actions, hover-revealed row actions (sort headers take `xs` on the unboxed `plain` variant)                                                       | `xs` 24             |
| The one primary CTA on an empty page                                                                                                                                  | `lg` 36 / `xl` 40   |

**Actions that don't fit lose their labels, not their buttons.** A set of row
or card actions that has no room for its labels goes icon-only — the same
buttons at the matching icon size (`xs` → `icon-xs`), each named by an
`aria-label` and a tooltip — never an "…" overflow menu. An overflow menu is
for actions that are secondary, not for ones that are merely narrow. The
paywall gallery tile and table row share `PaywallActions`, icon-only in both
(on the preview's corner / at the row's end, revealed on hover or focus,
always shown on touch).

### Type roles

| Role                                                                                                                                                      | Size (px / line)                                                                                          | Weight | Colour                                | Owner                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Page title                                                                                                                                                | `text-2xl` 24/32                                                                                          | 500    | foreground                            | `PageHeader`                                                                                  |
| Page description                                                                                                                                          | `text-base` 16/24 (inherited), on every page — focus pages (onboarding, add app, select organization) too | 400    | fg-secondary                          | `PageHeader`                                                                                  |
| Section heading (canvas)                                                                                                                                  | `text-lg` 18/28                                                                                           | 500    | foreground                            | `PageSection`                                                                                 |
| Dialog / sheet title                                                                                                                                      | `text-lg`                                                                                                 | 500    | foreground                            | `DialogTitle`                                                                                 |
| **Card title**: any title inside a surface — card or strip header, frame, popover, notice, alert, accordion, a group inside a card body, a rich-row title | `text-sm` 14/20                                                                                           | 500    | foreground                            | `CardTitle`, `FrameTitle`, `PopoverTitle`, `ListToolbarLabel`, `AlertTitle`                   |
| Top-bar title                                                                                                                                             | `text-sm`                                                                                                 | 500    | foreground                            | `OrganizationHomeHeader`, `CampaignNavbar`                                                    |
| State title (empty / error / 404)                                                                                                                         | `text-base`                                                                                               | 500    | foreground                            | `SectionEmpty`, `EmptyTitle`, `PageState` (full-page error, `PageState size="lg"`: `text-lg`) |
| Body / description                                                                                                                                        | `text-sm`                                                                                                 | 400    | fg-secondary                          | `CardDescription`                                                                             |
| Control and field label                                                                                                                                   | `text-sm`                                                                                                 | 500    | foreground                            | `Button`, `Label`                                                                             |
| **Label**: table header, stat label, group label, kicker                                                                                                  | `text-xs` 13/18                                                                                           | 500    | fg-tertiary                           | `TableHead`, `StatsCard`, `MenuGroupLabel`                                                    |
| Meta: timestamps, counts, captions                                                                                                                        | `text-xs` (a stacked meta line on a 16px line)                                                            | 400    | fg-tertiary / fg-muted                | `MetaLine`                                                                                    |
| Field hint / error                                                                                                                                        | `text-xs`                                                                                                 | 400    | fg-secondary / destructive-foreground | `FieldDescription`, `FieldError`, `InlineError`                                               |
| Table body                                                                                                                                                | `text-sm` — identifiers too; only code is mono `text-xs`                                                  | 400    | foreground                            | `TableCell`                                                                                   |
| Tooltip                                                                                                                                                   | `text-xs`                                                                                                 | 400    | foreground                            | `TooltipPopup`                                                                                |
| Code                                                                                                                                                      | mono `text-xs`                                                                                            | 400    | foreground                            | `CodeBlock`                                                                                   |
| Stat value                                                                                                                                                | 30px (compact tile: `text-2xl`)                                                                           | 600    | foreground                            | `StatsCard` only                                                                              |
| Secondary figure                                                                                                                                          | `text-base`, proportional                                                                                 | 400    | foreground                            | `CampaignStat`                                                                                |

- Nothing inside a card is larger than its card title, except figures and
  state titles.
- Nothing on the canvas between the page title and a card is anything but
  `text-lg`.
- The only sizes below 13px are Badge `xs` / `sm` and the Kbd legend, all 12px.
- No `text-[Npx]` anywhere, with three sanctioned exceptions: the sidebar's
  15px rows; device mockups (their simulated OS type); and the hosted
  studio's shadow root (`PaywallStudio`'s `text-[0.6875rem]` /
  `text-[0.8125rem]`) — the studio is a vendored library with its own
  register and scale, so don't move it onto these tokens.

### Icon sizes

The Iconography table keys icons by control height; this one keys them by
context.

| Where                                                                                                                                                    | Glyph           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Kbd                                                                                                                                                      | 10              |
| Badge, beside `text-xs` meta, the stat chevron                                                                                                           | 12              |
| Labelled 24–32px controls, menu and list rows, filter tabs, field affixes, beside `text-sm`, `InfoTooltip`                                               | 14              |
| Icon-only buttons (`icon-sm` / `icon` / `icon-lg`), 36px controls, sidebar nav, beside a `text-base` or `text-lg` heading, the top bar's leading control | 16              |
| 40px controls, the 40px `IconTile` glyph (`EmptyMedia`, `SectionEmpty`, notices, integration rows)                                                       | 18 (`size-4.5`) |
| Full-page error chip (`IconTile size={56}`)                                                                                                              | 24              |

- Primitives size un-sized SVGs themselves. A `size` prop on an icon inside
  Button, Badge, tabs, menu or select rows is dead code, so don't write one.
- Use `size-*`, never an `h-N w-N` pair. Even pixel sizes only.
- A hand-built row copies the primitive rule: `size-4 sm:size-3.5`.
- `PlatformIcon` defaults to 16.

### Media

| px  | App icon (`ApplicationIcon`)                 | Avatar (circle) | Tile / chip (`IconTile`)                                                         |
| --- | -------------------------------------------- | --------------- | -------------------------------------------------------------------------------- |
| 16  | inline in a text line, a tab, an input addon | —               | —                                                                                |
| 20  | combobox / menu row                          | —               | —                                                                                |
| 24  | table row, 28px menu row                     | dense rows      | —                                                                                |
| 32  | top-bar identity, two-line row               | default         | —                                                                                |
| 40  | picker card                                  | —               | icon tile (`EmptyMedia`, `SectionEmpty`, notices, integration rows), 18/20 glyph |
| 48  | hero                                         | profile         | —                                                                                |
| 56  | —                                            | —               | full-page error chip (`PageState size="lg"`), 24 glyph                           |

**A figure beside text centres on that text.** An icon tile, app icon or
avatar next to a title + description is `items-center` on the block the two
lines form — never `items-start`, which pins a 40px tile to the top of a
taller header. Anything under the text (an action, a list) sits outside that
row, indented to the text's start, so it doesn't pull the figure down. The
primitives (`Item`, `Notice`, `OptionCard`) already do this; hand-built rows
follow them.

**App icons are `ApplicationIcon`** (`components/application/ApplicationIcon.tsx`)
— never an `<img onError>` by hand. It builds the URL with the one helper
(`lib/application-icon-url.ts`; `buildPublicApplicationIconUrl` is the
share-card mirror of the server's public URL) and sits on
`Avatar shape="app-icon"`, which owns the loading and failed swap. Both
states share an overlaid 1px hairline border and the `rounded-app-icon` corner,
so the artwork keeps the full icon size and nothing moves when the image lands; the fallback fills `bg-muted`. The
fallback is the app's initials (one below 32px, two from 32; `text-xs`,
`text-sm` from 40), its platform glyph (`icon-tertiary`: 12, 16 at 32, 18/20
from 40) where the app is named beside it, a glyph, or blank. `tooltip`
names the app when the icon stands alone in a column.

**People's avatars are `PersonAvatar`** (`ui/avatar.tsx`): the circle at
24 / 32 / 48, the image or initials on a `muted` / `primary` / `info` tint —
never an `Avatar` + `AvatarFallback` sized by hand. A person's name and
email beside it are `PersonIdentity` (Components → Person identity).

**Icon tiles are `IconTile`** (`components/ui/icon-tile.tsx`): 40px (18/20
glyph) or 56 (24 glyph), the 3px corner, and a tone — `muted` (`bg-muted`,
the glyph at `icon-tertiary`, applied at zero specificity so a class on the
glyph still wins), `mark` (the same fill, a brand mark at full strength),
`outline` (card fill + border: a panel, so both), the status tones in Badge's
status fill (8%, 16% dark) with the status ink, `primary` (the selected
tint), and `none` for a surface that brings its own fill. The tile sizes an
un-sized glyph; never hand-build a `size-10 … bg-muted` square.

Dots: a 6px pulse inside a badge · an 8px status dot · a 10px chart legend
swatch (round) or knocked-out dot. **Dots are `StatusDot` and `LegendSwatch`**
(`components/ui/dot.tsx`) — never a hand-built `size-2 rounded-full` span.
`StatusDot` (8, or `size={6}` in a Badge with `tone="current"`) takes a status
tone, `primary`, `muted` (unknown) or `current`; `pulse` breathes it for work
in progress and stops under reduced motion; `knockout` is the 10px knocked-out
dot (6 + a 2px canvas ring) laid over a control's corner. It is decorative
unless `label` names it. `LegendSwatch` is the 10px series key: `color` takes
any CSS colour, `outlineColor` keeps a faint tint's edge; `ChartTooltipContent`'s
`dot` indicator is one. A line chart's legend keys (a 14px stroke sample) are
not swatches.

**Loaders by size.** Inline, `Spinner` takes its holder's icon size; a whole
section with no skeleton is `SectionLoading` (a 20px `icon-tertiary`
`Spinner`); a full page is `FullPageLoader`.

---

## Iconography

- **Outline, not filled.** Every glyph in the app is an outline stroke in
  `currentColor` — Lucide, or an owned glyph drawn the same way. A state is
  said by colour (teal for "on", status ink), never by filling the glyph: the
  prioritize toggle's bolt is the same glyph on and off, teal when on. Filled
  is allowed in exactly four places:
  1. **Brand marks and logos** — Apple, Android, Google Play, Stripe,
     RevenueCat, the Superwall mark, Discord, Meta — drawn as the brand draws
     them.
  2. **The selected twin of a designed pair** — the sidebar's rows (outline at
     rest, filled when current). No other surface has such a pair.
  3. **Shapes that aren't glyphs** — status dots, legend swatches, the device
     frame's chrome, the Superwall Wednesday card (mirrored by Satori).
  4. **The in-app placement bolt** — the owned `PlacementBoltIcon` (and its
     struck-through `PlacementBoltOffIcon` for a paused placement) in
     `components/ui/icons.tsx`, drawn filled on an 18-unit grid, wherever it
     marks a placement: the placement badge, the Placements results table,
     the Filters tab's "Placement params" group and the add-placement dialog.
     It is the placement's symbol, not a state, so it is filled even when the
     badge is outlined. Use it instead of Lucide's `Zap`; filling `Zap` with a
     class doesn't make the same glyph. The hosted placement's link glyph
     stays an outline. Its sibling `PrioritizedBoltIcon` (the bolt with speed
     lines) marks campaign prioritization, on the Placements strip's toggle
     and beside a prioritized campaign's name in lists.
     Otherwise never `fill="currentColor"` on a Lucide icon, never a local filled SVG, and
     never a `filled` option on an icon wrapper.
- **Lucide** (`lucide-react`) for product UI: stroke icons in `currentColor`.
  Pixel-grid icons belong to the Marketing register only.
- **Owned glyphs** live in `components/ui/icons.tsx`, built with Lucide's `createLucideIcon` so props and classes match (the filled placement bolts, above, are plain SVG components instead); import them, never the Lucide original, so each is decided in one place. Today: `PlacementBoltIcon` / `PlacementBoltOffIcon`, `PrioritizedBoltIcon`, and `XIcon` — the one X for close, clear and remove, Lucide's X geometry (it spans 12 of 24 units: 8px at 16px, 7px at 14px — an X is a quiet control). A chip's remove X takes the badge size (12px).
- **Home is `IconHomeRoundDoor`** wherever an icon stands for Home (top bar, sidebar, command
  menu, buttons, empty states), never the door-less house.
- The sidebar's own rows use a bespoke set (`components/sidebar/nav-icons.tsx`),
  drawn on an 18px grid and rendered at 16px, with an outlined unselected and
  a filled selected twin.
- `SIcon` (`components/ui/sicon.tsx`) draws brand marks only; every other
  name renders its **Lucide outline** equivalent (`OUTLINE_BY_TYPE`), so the
  name-keyed maps (chart types, event types, transaction types) stay outline
  too. New code imports Lucide directly; use `SIcon` for a brand mark
  (`SICON_BRAND_TYPES`) or a name looked up at runtime. The monochrome Superwall
  and RevenueCat marks carry `data-brand`: Badge reserves their full SVG width
  with zero horizontal margins, preserving the visible gap for each badge size.
  Unlike outline glyphs, their artwork reaches the edge of the glyph box.
- Decorative icons are `aria-hidden`; meaningful ones get `role="img"` and an
  `aria-label`.
- **A glyph beside text is flex-centred on the text's line box** — no
  optical nudges. A 1px `translate-y-px` on a row's trailing chevron was
  tried and read as too low; plain centring is right.

### Inline info — `InfoTooltip`

Every "more about this" ⓘ is `InfoTooltip` (`components/ui/info-tooltip.tsx`):
a 14px `icon-tertiary` glyph, brightening on hover and focus, its explanation
in a tooltip. **It sits 6px after the text it annotates** — directly after it
in a `gap-1.5` row; it carries no margin of its own. It annotates a _label_
(a title, a column header, a legend's name), so it follows that label, not
the end of whatever row the label is in. `revealOnHover` hides it until its
`group` is hovered (the stat card). Never hand-roll one from `InfoIcon` +
`Tooltip`, and never box it as an icon button.

### Icon colour — the text's own, a step quieter

An icon takes the colour of the text it sits with and draws it at
`--icon-alpha`: 85% of the text, 90% in a menu row (Where Shinsa differs, 19).
`opacity` applies to the whole SVG as one layer, so a multi-path icon shows
no doubled joints.

- **Quieter, never a different step.** A muted line's icon is the line's
  colour at 85% (`fg-3` text, `fg-3` icon); an icon never takes a lighter
  step than its label. Where the icon and its label are separate elements,
  give the icon the label's classes, hover included (the chat rows share
  `ROW_INK`).
- Semantic colours (primary, destructive, success, warning) are plain text
  colours, on the icon and its text alike; the icon keeps its 85%.
- **Equal strength is a context, not a call site.** `icon-solid` on a
  container (or the icon) sets `--icon-alpha: 1` for everything inside: the
  secondary button, icon-only buttons, `DESTRUCTIVE_ITEM` (`menu-icon.tsx`,
  for `DropdownMenuItem` and `CommandItem` `variant='destructive'`, whose
  highlight turns `red-a2`), the error toast and the checkbox's check.
  `icon-item` sets the 90% of menu, select, command and combobox rows.
- `opacity-*` on an icon is a reveal (`opacity-0` → `group-hover:opacity-(--icon-alpha)`)
  or disabled styling on its control, never a way to mute it.
- A glyph with no text (a status glyph, a tile's mark, a field affix such as
  ⌘K's search glyph, which matches the placeholder) keeps the colour its
  meaning gives it, at the same 85%.

### Sizes — one table, keyed by control height

An icon's size and spacing come from **the height of the control it sits in**,
not from the component. A 32px field and a 32px button hold their icons
identically, so a row of mixed controls lines up. Primitives size un-sized SVG
children themselves; pass a `size-*` only to override.

| Control height (desktop) | Button size | Field size | Icon    | Edge → icon | Icon ↔ label | Edge → text |
| ------------------------ | ----------- | ---------- | ------- | ----------- | ------------ | ----------- |
| 24px                     | `xs`        | —          | 14 / 16 | 7           | 6            | 8           |
| 28px                     | `sm`        | `sm`       | 14 / 16 | 9           | 8            | 10          |
| 32px                     | `default`   | `default`  | 14 / 16 | 11          | 8            | 12          |
| 36px                     | `lg`        | `lg`       | 16 / 16 | 13          | 10           | 14          |
| 40px                     | `xl`        | —          | 18 / 20 | 15          | 10           | 16          |

- **Edge → icon is 1px less than edge → text**: a glyph's box carries empty
  space, so an icon at the text's inset reads indented.
- **Icon-only buttons** (`icon-sm`, `icon`, `icon-lg`) keep a 16px glyph,
  centred in the box — with no label, the glyph is the whole control;
  `icon-xs` takes 14/16px and `icon-xl` 18/20px (see Buttons).
- **Icons centre 0.5px above the label's cap-height middle** (see Buttons).
- Field affixes (`InputGroupAddon` inline icons) follow the row for the field's
  size for icon and edge → icon, but the **icon → text gap is 2px larger**
  (10 / 10 / 12 for sm / default / lg): a field's text is typed content, not
  a label, and wants the room. A separated affix is text, so it uses the
  edge → text value; the input text sits 13px after its dividing border.
- Badges: 12px, 1px outside the text inset like buttons.

NumberField steppers, `Label` icons, toast icons, the Select trigger, menu and
select items, tabs, segments and `GroupText` are on the table. Still off it:
Toggle (see Toggle) and `Input`'s own text inset (see Open issues).

---

## Layout

- **App chrome owns layout.** A sidebar and a top bar define the box; both sit
  on the canvas and are split from content by the border alone. Page content
  uses `PageContainer`, or `ListPageShell` for list surfaces, with a named
  `width` rather than a page-specific max-width class. Containers are centred,
  fill the available width below their cap, and inherit gutters from the shell.

  | Width             | Cap    | Use                                                                                                                                                                             |
  | ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | XS (`xs`)         | 768px  | Organization home and organization picker                                                                                                                                       |
  | S (`sm`)          | 1024px | Settings, the integrations index and focused forms, including Share metrics                                                                                                     |
  | M (`md`, default) | 1440px | Campaigns, integration detail pages, Overview, Quickstart, surveys, users, assets, access, audit log, Demand score, paywalls, templates, products and admin Superwall Wednesday |
  | L (`lg`)          | 1800px | Charts workspace only                                                                                                                                                           |

  Use the same width for loading, error and populated states. Public share screens keep their focused layouts. Semantic main elements
  and campaign editor strips use the same caps from `PAGE_WIDTHS`.

- **Top bar.** Every top bar — the shell header, the org home header, the
  fullscreen navbar, the onboarding header and the admin shell — is one frame,
  `APP_TOP_BAR_CLASSNAME`: 48px (`h-12`), `px-2.5`, `bg-background`, a bottom
  `border-border`. Its controls are a **flat 28px at every width** (`h-7` /
  `size-7` overrides), so each
  sits 10px from the top, bottom and sides. The sidebar's logo block is the
  same 48px so the two rules run as one line, and `--sw-content-sticky-top` is
  banner + 3rem. The leading control — sidebar trigger or back button — is a
  28px ghost icon button with a 16px glyph, 10px from the edge; in the shell
  header a 16px-tall vertical `Separator` follows the trigger (8px after it,
  16px before the breadcrumb). The chrome group is all 28px, 8px apart: the
  search field, then Feedback + Beta as one fused, outlined control — one
  hand-built button whose 1px frame is shared, with the Beta badge's start
  border as the seam between face and badge. Hover (and an open popover)
  lifts frame and seam together to `foreground/20`, washes the face
  `bg-accent` and steps the badge to `primary/15`; focus turns the frame
  primary. The search field (from `lg`, 240px wide): icon 9px from the edge,
  10px to the placeholder (`text-fg-muted`, 400), the 18px keycaps 5px from
  the top, bottom and end. **Below `lg` (shell)** search is a bare 28px icon
  button with a "Search ⌘K" tooltip and Feedback is icon-only (26px face).
  From `xl` the fullscreen identity block stops 80px short of the centre so a
  title never runs under the wordmark.
- **Content gutter.** The shell pads page content 12 / 24 / 40px
  (`p-3 sm:p-6 lg:p-10`). `ListPageShell` puts 24px between page blocks
  (header, filters, cards); a page never overrides it.
- **Page header.** Title (`text-2xl` 500) and description (`text-fg-secondary`,
  inheriting the 16px base size — centred focus pages too) 2px below it on the left; the action row
  (default 32px controls: separate commands 16px apart, one set of controls —
  the filter pickers, a fused group, a button pair — 8px apart) on the right,
  **vertically centred on the
  title + description block**, never pinned to its top. The row wraps
  (`flex-wrap gap-4`) when narrow: the title block is sized by its content,
  so a title that doesn't fit beside the actions drops them under it rather
  than being squeezed to a few words. **One component, `PageHeader`**
  (`ui/page-header.tsx`; `ListPageHeader` is its deprecated alias), for list,
  detail, admin and focus pages — never a hand-built `h1`:
  - `back`: the leading back control is a 28px ghost `icon-sm` chevron, 8px
    before the title and centred on its 32px line; from `lg` it hangs into
    the 40px gutter so the title keeps the column edge the cards start at.
    One back control — not a 32px arrow, not a text link beside the title.
  - `titleAddon`: badges or an edit button inline after the title, 12px on,
    wrapping under it on a phone (never a badge row under the description).
  - `leading`: a figure before the block (a 40px `IconTile`), 12px from it.
  - `titleClamp={2}` clamps a long record name; otherwise titles wrap.
  - `align="center"`: the focus-page register (add app, select organization),
    the figure 16px above the title, no actions.
  - `actionsFill`: a search in the actions fills the row once it wraps.
  - `heading` replaces the `h1` for a title that isn't text (the editable
    team name renders `PageHeaderTitle` itself).
  - `PageHeaderSkeleton` holds the 32px title line (and 24px description
    line) and 32px action placeholders while loading.
- **Where actions go.** An action sits on the thing it acts on. Creating,
  adding, uploading or importing an item of a list ("Add product", "Upload
  assets", "Create survey") acts on the list, so on a page with a list card or
  table it sits at the **end of the list's toolbar** (`sm`, last, after sort
  and view controls) at every width — never in the page header (see List
  toolbar below). A list card with no toolbar gets one. The page header holds
  filters and page-level controls only (the date and environment pickers,
  Share). An action on one section of a multi-section page is `PageSection`
  `actions` (`sm`); on one card among several, the card's `CardAction`
  (`sm`); on one item, its row or tile menu. When the list is truly empty
  (not filtered to nothing), the empty state holds the create action as its
  `primary` and the toolbar drops it, so the action never appears twice.
- **Onboarding is one focus panel.** `/onboarding` draws each step like a
  dialog on the canvas: the shared 48px top bar, then from `sm` a card
  (20px inset, `PageHeader` title, the step, then a 56px footer strip with
  `default` Back / Skip / Continue); on a phone the panel is the page. Its
  choices are `OptionCard`s — an answer that advances on tap is an action card
  with `selected` for the saved answer (a radio group would advance on every
  arrow key); a multi-select takes a `Checkbox`. Instructions are an
  `InsetList`, code is `CodeBlock`, links out are `OptionCard`s with the
  trailing arrow. Nothing in `components/onboarding` hand-builds a card.
- **Back is bottom-left.** A wizard dialog's step back is `DialogBackButton`
  (ghost, arrow, "Back"): the footer's first child, split from the forward
  actions to the far left (`justify-between`), and the last row when the
  footer stacks on a phone. Never beside the primary on the right. The first
  step has no Back; its way out is Cancel, beside the forward action.
- **A short flow is an overlay, not a page.** A task of a few fields or a
  few steps that starts from somewhere in the dashboard opens over it and
  returns the user there: a `Dialog` for a form or a wizard (creating an app,
  duplicating a paywall, inviting a member), a `Sheet` for a long form the
  user reads beside the page (an API key's scopes). A route of its own is
  for a surface people land on, bookmark or share (a paywall, a campaign),
  never for a detour. An old route to a flow that became an overlay stays as a
  redirect that opens the overlay (`/$orgId/add/new` → the org home with
  `?createApp=1`; `/paywalls/$id/duplicate` → the list with `?duplicate=`),
  and a page nothing reaches any more is deleted, not kept "just in case".
- **A `…` menu beside a call to action is one split button** with it,
  anywhere — a page header, a toolbar, a card: the CTA, a `GroupSeparator`,
  then the `icon` (or `icon-sm`) menu trigger in the CTA's own variant, inside
  a `Group`. A primary CTA takes `GroupSeparator tone="primary"`. Survey edit
  ("Save changes ⋯"), survey stats ("Edit survey ⋯"), webhook detail ("Rotate
  secret ⋯"), Assets ("Upload assets ⋯"). A lone `…` with no CTA beside it
  (a row's menu) stays a `ghost` icon button.
- **List toolbar.** The card's header row is a header strip: 48px, the top
  bar's height (see Sizing). Filter tabs make 48 by their own padding; search
  sits 12px in from its divider (which spans the full 48) with the tab icons'
  14px glyph and 8px gap, turning teal while the input has focus; the `end`
  controls are `sm` (28px) 10px from every edge, 8px apart; `start` and `end` sit 12px apart and the search is
  `min-w-40 flex-1`. An icon-only Sort control is `icon-sm` outline with the
  outline toggle's resting fill (`bg-foreground/3`), so it reads as one set
  with the view toggle beside it; a labelled sort is a `SelectTrigger
size="sm" variant="secondary"`. `ListToolbarLabel` is a 14px medium title on the same row.
  **Calls to action never sit in the page header on a page with a list card
  or table.** Create, add, upload and import act on the list, so they sit at
  its toolbar's `end` (`sm`, last, after sort and view controls) at every
  width — on phones, at the end of the strip that holds search. The page
  header keeps filters and page-level controls only (the date and
  environment pickers, Share). An action with an overflow menu is one split
  button: the primary `Button`, a `GroupSeparator`, and an `icon-sm` primary
  menu trigger in a `Group` (Assets' "Upload assets ⋯").
  **Tabs that grow with the data** (template categories) get a strip of their
  own at every width, and search + sort share a second strip under it, so a
  new tab never pushes the search off the edge. A short, fixed tab set
  (paywall status) keeps one row and folds into a select below `lg`.
- **Breakpoints follow the shell, not the window.** `sm`…`2xl` read
  `data-shell-bp` on `<html>`. Use
  `useShellBreakpoint()` in JS; don't add arbitrary `min-[…]` breakpoints.
- **Scrollbars are hidden** app-wide, except tables that overflow horizontally may show a thin horizontal scrollbar so every column is reachable with a mouse, and long panes that scroll in a `ScrollArea` (the task chat), which draw its overlay thumb.
- **A mouse wheel scrolls a sideways row.** With scrollbars hidden and no
  Shift held, a wheel over an overflowing tab strip, toolbar or chip row would
  do nothing, so one document listener (`lib/wheel-scroll-x.ts`) turns a
  vertical wheel into sideways movement over any horizontal scroller no taller
  than 96px, and hands the wheel back to the page at the row's end. Tall wide
  content (tables, code blocks) is left alone — the page scrolls past it.
  `data-wheel-scroll-x="off"` opts a row out.
- **Anything that scrolls inside a component fades at its edges** — shadcn's
  `scroll-fade` (vertical) / `scroll-fade-x` (horizontal) from
  `src/scroll-fade.css` (vendored verbatim from shadcn 4.21): the edge you can scroll toward fades out, driven by a
  scroll timeline. It's on menus, select and context-menu lists, popovers,
  `ScrollArea` (and so dialog/sheet panels, sidebar, combobox, autocomplete),
  tables, code blocks, list toolbars, the segmented control, tab strips and JSON
  / markdown blocks. Page-level scrolling doesn't fade.
  - **A fade is a mask, so it never goes on a bordered element** — it would
    fade the border and fill too. Put the border and background on a frame and
    the overflow + fade on an inner element.
  - **Every fixed-height scroller nested in a page fades** — a capped
    textarea (the fade is on the textarea itself, so the border stays
    solid), a scrolling panel in a card, a log or JSON viewer, a list with
    `max-h-*`. If it scrolls and isn't the page, it fades.
  - A table inside a bordered card needs no wrapper scroller: `Table` scrolls
    and fades sideways on its own; the card frame only clips
    (`overflow-hidden`). A capped table is frame (`overflow-hidden`, border,
    fill) → scroller (`max-h-*`, `overflow-y-auto`, `scroll-fade`) → `Table`.
  - A scroller fades the axis its content actually overflows (a `wrap="off"`
    textarea is `scroll-fade-x`).
  - Markdown / rendered-HTML code blocks wrap rather than scroll — their
    `<pre>` can't be split into frame + scroller.
  - A `max-h-*` on `Textarea` caps the frame; the textarea inherits it and
    scrolls and fades inside.
  - Dialogs scroll through `DialogPanel` (a fading `ScrollArea`), never
    `overflow-y-auto` on `DialogContent`, which scrolls the popup's own border
    and header.

### Integrations index

The index is built like a settings page, at the settings width: `PageSection`
headings (title over description) each over one card of rows
(`components/integrations/IntegrationRow.tsx`), in one column. Never a tile
grid: status has to sit on one edge to be scanned, and a grid leaves orphan
cells.

- **Revenue tracking is the first section.** Most integrations need revenue tracking,
  so it leads, and while it is missing its heading carries the page's one
  primary button ("Set up revenue tracking"). That is the whole prompt: an
  unfinished step is not an error, so there is no alert. Its rows are the
  providers an app in the project can use, this app's first, then a row
  for each provider the project has no app for, with a button that creates
  that app ("Create Android app").
- **A row** is `Item variant="row"`: the logo in a 40px `IconTile` (`mark`),
  the name over what it does, then status Badges and a chevron. The whole row
  is the target. A row whose only action is a button (Request access) is
  inert and shows the button at rest, never on hover.
- **Gated rows fade** (`opacity-50`, inert). A section where every row is
  gated says "Needs revenue tracking" once, as the heading's `titleAddon`;
  a section where only some are says it on those rows.
- **One filter row** sits under Revenue tracking: the framed `TabsList` (All /
  Connected) and a `SearchInput`. Neither narrows Revenue tracking. Integrations that
  can't be connected yet close the page in a "Coming soon" section.

### Integration detail pages

Every page one level below Integrations — a catalog integration, Web2App,
Webhooks, Stripe, Revenue tracking, Refund protection, Retention messaging,
Apple Search Ads, Meta — is the same page. Built-in or catalog, a user moving
between them sees one layout.

- **Frame.** The route renders `IntegrationDetailPage`
  (`components/integrations/IntegrationDetailHeader.tsx`): the integrations
  index's own shell (`ListPageShell` at default M, 1440px), so
  the index and every page share one frame and one side padding, with 24px
  between blocks. A page never sets its own width or outer gap.
- **Header.** `IntegrationDetailHeader`. **No back link** — the sidebar and the
  breadcrumb already lead back. The description is the integration's tile
  description (`tile-copy.ts` or the catalog's), so every header is the same
  length (Copy → Integration descriptions). Status is a `success` badge
  ("Enabled", "Connected") or `warning` ("Paused") in `badges`; a
  Documentation link (outline, `ExternalLinkIcon`) and page-level filters go
  in `actions`.
- **Blocks.** Every block is a card with a bordered header strip:
  `Card` → `CardHeader className="border-b"` (`CardTitle`, `CardDescription`,
  `CardAction`) → `CardPanel`. A table or divided list is a `ListCard` with the
  same strip. No hand-rolled `h3`/`p` titles inside a panel, no headerless
  cards except a lone status line, and no card title that repeats the page
  title.
- **Contents.** Toggles are `SettingRow`, value fields in a settings form `TextRowField` / `SelectRowField`, other fields `Field`, read-only facts
  `DescriptionList`, copyable values `CopyField`, lists `DataTable`.
- **Saving.** A form's save button sits in its card's footer:
  `CardFooter className="justify-end border-t"`, primary last. A control that
  saves on change (a select, a switch) has no button. Never a save row outside
  the cards.
- **States.** Loading is `IntegrationDetailSkeleton` (the real header when the
  title is known); a failed or gated page keeps the header and puts a
  `SectionErrorState` in a card. Project-scoped pages resolve the project
  through `ProjectGate`.

### Campaign editor

The campaign detail route is a workspace: a fullscreen top bar, a resizable
sidebar of the campaign's placements and audiences, and the selected
audience as a page beside it. Every part is built from the page and card
patterns above, so it reads like the rest of the dashboard.

- **Top bar and app identity.** The sidebar column opens with a 48px strip:
  an `icon-sm` back-to-campaigns chevron at its leading 10px, then the current
  app's compact sidebar identity: a 24px `ApplicationIcon` and `text-sm` · 500
  name and a muted 14px platform glyph, without the organization line or picker chevrons.
  Its icon, name and platform glyph sit 12px apart, a compact version of the
  standard sidebar's 18px identity spacing. The button and hover wash fit the
  identity, using the column's available width as their only maximum; the name
  stays on one line and truncates only when it exceeds that space. The menu is
  16rem wide, matching the standard expanded sidebar's inner width (17rem minus
  its two 8px insets), independently of the trigger and within the viewport cap.
  Its wash appears only while hovered.
  Clicking this identity opens the project menu, with the current project’s platform
  switcher embedded at the top, above other projects and organization actions.
  The fullscreen shell shares the dashboard bootstrap cache with its identity and
  editor panes; a cold load shows
  a compact skeleton rather than an app-id label. Bootstrap projects stay visible while the complete paginated list hydrates after
  the shell is ready, without waiting for the menu to open.
  The selected platform keeps the teal treatment, including menu focus, and its
  indicator appears at the measured width without an opening resize animation.
  The name truncates as the sidebar narrows and a tooltip shows it in full.
  This identity strip is hidden below `md`; phones use the top bar’s back control,
  and `CampaignNavbar` is the shell header over the pane — `APP_TOP_BAR_CLASSNAME`,
  the sidebar toggle (⌘B), a divider, and the “Campaigns › {campaign}” breadcrumb,
  with the chrome group on the right. The campaign name is a foreground · 600
  button with a trailing ellipsis and details tooltip, aligned to the original
  breadcrumb text position. A notebook icon appears when notes are present. Its dialog edits the
  name and notes and offers archive/restore; archive is disabled while any
  placement remains, with an explanation. Status badges follow the name.
  The audience header carries the environment picker; an empty audience
  workspace keeps it in the top bar. On phones the toggle is a back button
  and the trail is the campaign's name.
- **Sidebar.** On the canvas behind the border. Each group (Placements,
  Audiences, Paused) opens with a 48px header strip (`CardHeader
className="border-b"`; Audiences carries its "Evaluated top to bottom"
  description, 66, and the rules behind an `InfoTooltip`) with its `icon-sm`
  ghost actions — two in a strip sit 2px apart, and every strip's last
  action ends 10px in, so the +s line up down the column. Each strip title
  leads with a tertiary 14px icon (a pin for Placements, people for
  Audiences, pause for Paused).
  Every leading glyph down the column (those icons, a placement badge's bolt
  or link, an audience's count badge, the tab guide line under a selected
  audience) centres on one line 24px in: the centre of the identity strip's
  back chevron, which can't move. Each row or strip reaches it with its own
  start inset (`ms-px` on the heading icons, `ps-1.25` on placement rows, a
  9px inset on audience rows), so text no longer shares a single edge.
  Rows are 32px, 2px
  apart, their text 16px in, level with the strip title (`SidebarList`). An
  audience row is the sidebar-nav register: the main sidebar's `foreground/5`
  wash on hover (selected rows too), and selected is teal `faux-medium` with
  no fill; its
  variant-count Badge `sm` leads (`secondary`, turning `default` with a
  `primary/30` border on the selected row, so the whole row reads current
  and the badge keeps its outline), the grip ends it, the whole row drags with
  a mouse (touch and the keyboard use the grip) and its text doesn't select.
  The grip has no separate hover fill.
  The Audiences strip's view menu (a `ListFilter` icon button) globally
  remembers whether paused audiences get their own Paused group, the default,
  or sit inline in campaign rank order in one list. Inline reordering
  preserves live/paused status.
  A placement row shows the event name in an accent Badge with a leading
  filled lightning bolt (link glyph for hosted placements), outlined once paused,
  and `xs` icon actions floating
  over the row's end on hover or focus, always shown on touch. Up to five placements show in full; longer lists show four and a fifth
  `list-row` “+ N more” that expands the rest inline, with Show less to return. An empty group is `SectionEmpty size="compact"` holding the add
  action, and the strip drops it.
- **Audience pane.** The editable audience title and its actions sit above a
  full-width 48px tab strip (`FilterTabsList`). Its tabs drop their side
  padding, so the first tab's icon starts on the page column's edge, level
  with the title, and each underline spans just its label; the list's 22px
  gap (plus each tab's two 1px focus borders) keeps labels 24px apart. The tab’s body uses the shell’s content gutter
  (`AUDIENCE_PANE_CLASSNAME`, 12 / 24 / 40, shared M 1440px max), with page blocks 24
  apart; tab bodies never pad themselves.
- **Layout under review.** `?layout=` (remembered in localStorage,
  `campaigns/editor-layout.ts`) swaps how the pane places its tabs while one
  is chosen, all three sharing `useAudienceTabs`:
  - `strip` (default): the editable audience title above the tab strip,
    with the environment picker immediately before the Pause / Set live
    split button. The title pencil appears on hover or focus (always on
    touch), and Rename is also in the menu. The Users tab says “N users · 24h”.
    The title row has no bottom padding before the tab strip.
    Pause / Set live goes icon-only below `lg`, the title and actions wrap
    when necessary, and the tabs scroll.
  - `sidebar`: the tabs are sub-rows under the selected audience, opening and
    closing on a `duration-move` height transition. Their guide line runs down
    the centre of the row's variant-count badge, the rows sit 8px off it, and
    each row's 16px icon starts at the audience name. The pane is the audience's page header (renamed in place,
    the matched count its description); phones keep the strip.
  - `band`: the page header and underline tabs in one bordered band — parity
    with the legacy editor.
    The top bar keeps search compact until `xl`, and drops the trail's "Campaigns ›" below `lg` (the sidebar's
    back chevron stays).
- **Audiences +.** Its menu is end-aligned, the one exception to the
  list-popup rule: the + is at the sidebar's far edge, and a start-aligned
  menu would hang out over the pane.
- **Audience row menu.** Right-click (the `…` on touch) holds Pause / Set
  live, Rename, Duplicate, Reset assignments and Delete — the pane's actions,
  reachable without selecting the audience.
- **Tab bodies.** Filters, Entitlements and Limit are cards with header
  strips and leading title icons (Integration detail pages → Blocks); Debug
  leads with the superadmin marker. a card with unsaved edits gets
  a footer strip — the state on the left, Discard and its save on the right.
  Paywalls is a `ListCard` whose toolbar holds the split controls (Autopilot,
  Edit split) and the add actions last, over a `Gallery` of the variants —
  each caption the paywall's name over a subtitle: assigned count left,
  editable percentage right (including holdouts), with a count skeleton
  while loading. Subtitles follow their own title immediately. The share is
  the way into the split. The split is edited in one dialog, never in the
  tiles: an `InsetList` of the paywalls with compact `sm` percentage fields
  (text inputs with a decimal keypad, no spinners), the holdout's derived
  share, and for a live audience an `OptionCard` choice of keeping or
  re-assigning existing users.
  Results and Analysis are `PageSection`s over cards and tables; Users is two
  collapsible table cards on `CollapsibleStrip`.
- **Phones.** The sidebar is the whole first screen; choosing an audience
  opens its pane full-screen, with back in the top bar.

### Charts

The charts page is a list beside a page (`routes/…/charts/index.tsx`, 1800px
max, in the shell's gutter).

- **Chart list.** A sticky `Card` with a "Chart types" header strip; groups
  are disclosures, rows the sidebar-nav register (32px, 2px apart, the main sidebar's
  `foreground/5` wash, the current chart teal `faux-medium` with no fill).
  The current row's icon is teal at full strength with its label. Below `lg`
  the list is one `ChartTypePicker` over the cards.
- **Chart card.** A `ListCard` titled by its own strip — the chart's icon and
  name (the page's `h1`) over its description, 66px — then one 48px
  `ListToolbar` of ghost pickers, 2px apart at content width (`w-auto min-w-0`): what the
  chart measures at the start (Filter, Breakdown, Mode, Window), when and how
  it's drawn at the end (interval, date range, visualization). It scrolls
  sideways, never wraps. The plot is 320px on a phone, 500 from `md`.
- **Data card.** A `ListCard` with a "Data" strip (Export CSV its `sm`
  action) over the table, edge to edge with 16px outer columns; headers sort
  through `SortableHeaderButton`; it opens scrolled to the newest columns.
- **Developers.** A collapsible strip (title over description) whose panel
  holds the request's facts as a `DescriptionList`, the key controls, and
  one `CodeBlock` with Request / Response tabs in its header.

### Environment

**The selected data environment is shown in the chrome, never in per-page
alerts.** Sandbox data changes what every number means, so it is flagged once,
in the same place on every environment-scoped page (overview, campaigns list,
campaign editor, users, charts), rather than by a banner each page has to
remember.

- **Sandbox:** the top bar puts a warning `Badge` ("Sandbox", with the
  flask glyph) directly after its breadcrumb or identity block, and its bottom
  border turns `warning`. The explanation lives in the badge's tooltip (the
  badge takes focus, so the tooltip is reachable from the keyboard).
  The current page in the breadcrumb turns `text-warning-foreground` too, so
  the one teal beat in the trail reads as the environment: teal is
  production, amber is sandbox (`APP_TOP_BAR_CLASSNAME` does it for every
  top bar).
  **Production shows nothing** — it is the default and needs no marker.
- **One source.** The bar reads the environment back from the page's URL
  (`useSelectedEnvironment` in `components/environment-indicator.tsx`: the
  `environment`, `env` or `e` search param), the same state the page's
  `EnvironmentSelect` / `DashboardFilters` picker writes, so the two can never
  disagree. The pickers stay where they are.
- Every top bar applies it the same way: `topBarEnvironmentProps` on the
  `APP_TOP_BAR_CLASSNAME` frame (`data-environment="sandbox"` recolours the
  border) and `EnvironmentBadge` after the identity block — except the
  campaign editor's bar, which holds the environment picker itself, so the
  picker is the flag and a badge beside it would say it twice. The fullscreen
  navbar's badge is its glyph alone below `md`, where the identity block is
  already full.
- `/dev/design-system` → App chrome draws the bar in both states.

---

## Components

These mirror `apps/web2/src/components/ui`; `/dev/design-system` shows each in every state.

**Buttons.** **Size by context** (the full table is in Sizing): `default`
(32px) on main pages — page headers, the 32px control strip — and inside cards
for **card body forms and footers only**. **Header strips and nested UI use
`sm` (28px)**: list toolbar `end` controls, a strip's `CardAction`, canvas
section-heading actions, popovers, menus' action rows, dialog-row actions,
inline editors, anything floating or tucked inside another control. The top bar is its own flat 28px (see Layout). `lg`/`xl` are for the
rare primary call-to-action on an empty page. Onboarding's footer is a dialog
footer strip, so its Continue is `default`.

Variants (Shinsa has exactly five):

- `primary` — the blue fill, white text. The one filled accent; at most one per
  group of actions.
- `secondary` — no fill at rest, `text-fg-2`; hover lays a faint wash and
  brightens the text. **The only variant that sits beside a primary** (Cancel,
  Back, Request changes next to Approve).
- `outline` — a raised surface with a hairline ring. For a standalone action
  or a trigger (a picker, a menu button) with no primary near it. **Never
  next to a primary button.**
- `destructive` — red fill, white text, for the confirming action of
  something irreversible. Its companion is `secondary`, never `outline`.
- `link` — inline text in `primary-text`, no box; the label itself takes the
  press.

Visible horizontal spacing steps 2px per size — outer edge → text: `xs` 8 · `sm` 10 · `default` 12 · `lg` 14 · `xl` 16 (written `--spacing(n) - 1px` for the border). An icon sits **1px outside** the text inset (a glyph's own box carries empty space, so at the text's inset it reads indented): 7 / 9 / 11 / 13 / 15. Icon ↔ label gap: 6 / 8 / 8 / 10 / 10. The `-mx-px` icon margin eats 1px of each `gap-*`, so the classes are written 1px above these. **Icons sit 0.5px above the label's cap-height middle** — one device pixel at 2x. Centred exactly on the caps, a symmetric glyph like `+` reads low next to mostly-lowercase labels. Flex centring alone lands anywhere from 0 to 0.25px off that target depending on text size and line height, so each size corrects by its measured value. Icon-only sizes have no label and stay box-centred. Sizes are one value at every width: `xs` 24 · `sm` 28 · `default` 32 · `lg` 36 · `xl` 40. Type: `xs` 13px, `sm`/`default`/`lg` 14px, `xl`
16px. A Button's SVGs draw in its ink at `--icon-alpha`, leading and
trailing alike (Iconography → Icon colour): a trailing chevron or a
"view all" arrow is the label's colour at 85%. A secondary button and an
icon-only button are `icon-solid`: on a secondary button icon and label both
rest `fg-2` and turn `fg-4` together on hover. Icons in a Button never take a
size, colour, opacity or stroke override (a 16px glyph beside a `text-lg`
label is the one sized case).
Icon sizes are square: `icon-xs` 24px (14/16px glyph), `icon-sm` 28px,
`icon` 32px at every width, `icon-lg` 36px (16px glyph), `icon-xl` 40px
(18px glyph), each at every width. `list-row` is a
full-width, left-aligned, `font-normal`, **single 32px line** — its label goes in `Truncate`
so a long one ends in an ellipsis with the full text in a tooltip. A row that
genuinely needs two lines is `list-row-two-line` (48px: the label over a
`text-xs` tertiary meta line on a 16px line) — never `h-auto py-*` on
`list-row`.
Colour-only `duration-hover` transitions, no press transform (a secondary
button's wash is a gradient on `from-*`/`to-*` stops so it eases with the
border). Focus recolours the border
(see Focus); coarse pointers get an invisible 44px hit area.
**Pending** is one state, `loading` (with `loadingLabel` for the pending copy):
while the action it started runs, the button disables — so it can't be
clicked or submitted twice — but it does **not** fade: a pending button is
working, not unavailable, so it stays at full strength and the spinner is the
signal (`disabled:not-data-loading:opacity-50`). It sets
`aria-busy`, and leads with a `Spinner` at its icon size. The spinner stands in
for a leading icon rather than sitting beside it, so an icon button or an
icon + label keeps its width. `loadingLabel` replaces the children with the
in-progress verb ("Saving…", "Deleting…", single-character ellipsis); omit it
when the label doesn't change. `AlertDialogAction` (which also drops its Enter
shortcut while pending), `SubmitButton` and `CardFooterAction` take the same
props. Never
hand-write `{pending ? <Spinner /> : …}` or a pending label without the
spinner — every pending button shows the same feedback.

**Button groups.** `Group` fuses adjacent buttons, inputs and `GroupText` into
one control by removing the shared border and inner corners.

- Between buttons, `GroupSeparator` is the plain border colour; next to a
  hovered or pressed button it lifts to the same `foreground/20` the outline
  button's border takes, on the **same** `transition-colors duration-hover`, so
  seam and border move in lockstep. (On teal primary groups the seam is
  invisible against the fill either way.)
- `GroupText` is a static prefix or suffix: `bg-muted`, tertiary text, icons
  14px `icon-tertiary`.
- **A group holding an input reads as one filled field.** The input and any
  fused button take `GroupText`'s `bg-muted`; a fused button steps up to
  `bg-secondary` on hover (the translucent `bg-accent` wash would read darker
  than the fill it replaces). Its icon is an affix: 14px `icon-tertiary`,
  brightening to foreground on hover. The seams are each part's **own start
  border** drawn over its fill — no `GroupSeparator` here, because a 1px line
  over the canvas composites to the same colour as the fill and vanishes.

**Filter tabs.** Height is padding, not a box: 14px above and below the 20px
label makes the 48px header strip, so the label centres on the strip's line
and the 2px underline meets the card edge; 16px sides, `text-sm` at every
width. The label
rests `text-fg-tertiary` and hovers to foreground; icons are 14px,
`icon-tertiary`, 8px to the label, taking the label's colour on hover or when
selected. Selected is `text-primary` + `faux-medium` with no hover; the 2px
indicator slides on `duration-move` `ease-out` (reduced motion honoured). Focus turns
the trigger's own border primary. Inside a `ListToolbar` the tabs set the 48px
row; the `end` controls fit it at every width.

**Breadcrumb.** Links are `text-fg-tertiary`, brightening on hover; the
current page (`BreadcrumbPage`) is `text-primary` — the one teal beat in the
trail — and doesn't react to hover. `text-sm` at every width; items 10px apart;
separators are 14px `ChevronRight`
in `icon-tertiary`. Link focus is a teal underline. The top bar shows a
breadcrumb only for a nested page — one with a parent to walk back to (a
sub-page, a user's event, a survey's stats). A top-level page's own header
already names it, so its bar has no title and no separator after the sidebar
trigger; the sandbox badge still shows when it applies.

**Tabs.** The default list is the segmented control's 32px frame around 26px
tabs; `TabsList size="sm"` is a 28px frame around 22px tabs, for
a row of `sm` controls (a canvas section heading). `TabsTab size="icon"` makes
an icon-only tab square — pair it with an `aria-label`; never hand-set its
width. The underline list is 32px tabs (28 at `sm`).
**Underline tabs only sit on a rule.** The underline list belongs where its
underline meets a line under it — a card's header strip (filter tabs), a
bordered frame's top edge. A switcher floating in content (a step's
SPM / CocoaPods, a card body's Skill / MCP) is the default framed list, its
scroll fade on a wrapper, never on the frame.

**Segmented control.** Same height as a default button: a 32px frame (1px
border, 2px padding) around 26px segments, 2px apart. The segments and the
sliding indicator take the 3px corner; the frame's is concentric with them —
outer = inner + the 3px between the edges (border + padding) = 6px — so the
gap around the selected segment stays even round the corner. The frame carries the
border (no fill); an inner scroller carries the overflow and `scroll-fade-x`
(`trackClassName` styles it). The indicator is `bg-primary/10`, sliding
`left`/`width` on `duration-move` `ease-out`; the selected segment's text is
`text-primary`, the rest `text-fg-tertiary` hovering to foreground with no
hover fill. Segments are 400 `text-sm`, 10px edge → text, like a default tab
(a 26px item spaces like a 28px control). It's a
`role="group"` of `aria-pressed` buttons; equal widths use `basis-0 grow`.

**Toolbar.** The same geometry: a 32px bar (1px border, 2px padding, 3px
corner) around 26px buttons (inputs 24px), 2px apart, so a toolbar sits in any
control strip. Unlike the segmented control the bar is card-filled (`bg-card`

- border).
  The bar sizes its own items — each carries `data-slot="toolbar-button"` /
  `"toolbar-input"` whatever it renders as, and items with an `aria-label` are
  icon-only and go square (26×26). Inputs in a toolbar are ghost: no edge and no fill at rest or on hover, and the primary border only while focused. A separator gets 4px on each side (the 2px item gap plus a 2px margin), so it doesn't crowd the items beside it, and is inset 6px top and bottom.

**Toggle.** Variants `default` (transparent border; hover `bg-accent`;
pressed `bg-input/64`) and `outline` (`border-input` over a `bg-foreground/3`
resting fill; hover `bg-accent`; pressed `bg-input`). A pressed toggle never
hovers (`not-data-pressed:hover`). Sizes: `default` 32px at every width with
8px sides, `sm` 28px with 6px sides, `lg` 36px with 10px
sides; `min-w` equals the height. Text 500 foreground; glyphs 16px in the text's colour. Disabled is `opacity-50`. Inside a `ToggleGroup` the
group's variant and size override the item's; the gapped `default` group sits
2px apart. `tile` is a card that toggles — the card fill and the one border,
16px inset, its content setting the height — with the option card's states:
hover lifts the border to `foreground/20` under a 3% wash, pressed is a
primary edge (no fill) that no longer hovers. A `tile` group fuses nothing;
the caller lays the tiles out (a grid, `gap-4`). Its content is a `StatsCard`
rendered into the item (Stat card → Slots).

**Toggle groups.** The fused outline group wraps every run of pressed items in
the active edge (`foreground/20`, the same edge an outline button takes on
hover), with no line between two pressed neighbours — pressed B and U in
B/I/U/S get two outlines; pressed B, I and U get one. A pressed item's own
border goes transparent and the outline is a `::before` on the item's own edge
pixels, so every side composites over the same pressed fill and reads as one
colour, and pressing never changes an item's width. `ToggleGroupSeparator` is
for the default (gapped) variant; fused groups share edges and need none.

**Grouped edges stay in sync.** Every element that draws an edge inside a
grouped control — button, input, `GroupText`, group and toggle separators, the
toggle outline — transitions with the same `transition-colors duration-hover`,
so a seam never lags or leads the border beside it. And a translucent edge
only matches another if both composite over the same background: draw a seam
as the part's own border over its own fill, or reproduce the fill under it
(see the button-group separator), never as a bare line over the canvas.

**Truncate.** One line by default, or up to two with `lines={2}` for gallery
names and paywall results. It ends in an ellipsis and, only when it's actually
clipped, shows the full text in a tooltip after 150ms
(`components/ui/truncate.tsx`, ported from buzzkit). Use it instead of a bare
`truncate` span wherever text comes from data or a label can meet a narrow
container; `middle` cuts in the centre for ids (plain-string children only).
One-line text renders `display:block`; two-line text uses a line clamp and
wraps unbroken identifiers. The tooltip wraps at 288px. The parent must bound
the width (`min-w-0`). It follows resizes with a `ResizeObserver`; where there
is none (jsdom in tests) it measures once. A heading keeps its element and
wraps the text (`<h2 className="min-w-0"><Truncate>…</Truncate></h2>`).
Inside a **stretched link** (a title whose `::after` covers its row or tile)
the overlay paints over the text, so the tooltip would never see the
pointer: lift the text above it with `<Truncate className="relative z-1">` —
it stays inside the link, so a click still opens it.
**Two places keep a plain `truncate` clip:** text that is already a tooltip
or preview-card trigger (a second tooltip would stack on the first), and rows
inside a chart tooltip, which follows the pointer and can't be hovered.

**Relative time.** One formatter and one component. `formatRelativeTime`
(`lib/formatters.ts`) is the only "… ago": under 45 seconds is "just now",
then units round and switch at legacy moment's thresholds (45s, 45m, 22h, 26d,
11mo), so a paywall edited 3h57m ago reads "4h ago", as the old dashboard
wrote it. `style: "short"` is the compact meta form ("5m ago", "6d ago", "5mo
ago") for table cells, row meta and freshness lines; `"long"` spells the unit
out with digits ("5 minutes ago", "1 hour ago" — never "an hour") for prose,
sentences and tooltips (Copy → Numbers and units). Future times read "in 2h".
`RelativeTime` (`components/ui/relative-time.tsx`) renders it in a `<time>`
with tabular figures and the exact date and time in a tooltip, re-rendering
on one shared 30s tick; `timeZone="utc"` writes the tooltip in UTC (delivery
logs), `tooltip={false}` drops it beside an absolute time or inside another
trigger. Zone-less UTC strings go through their input adapter first
(`parseClickHouseUtc`, the users `parseDate`). Use the component for a
timestamp that stands alone; call the formatter only where a string is needed.
Calendar phrasing ("earlier today", "yesterday" — the dashboard-version line)
is a different thing and stays separate.

**Badges.** `rounded-sm`, `font-medium`. Heights sit on the control ramp, one
step apart: `sm` 20 · `default` 24 (= Button `xs`) · `lg` 28 (= Button `sm`) —
a badge beside a button of the matching size shares its height. (The chrome's
Beta is `lg` fused into the Feedback frame as its second part — `h-auto`, its
start border the seam.) `sm` badges set 12px type — one of
the two sanctioned exceptions to `text-xs` 13px (the Kbd legend is the other),
since 13px crowds a 20px pill. Edge → text steps 2px per size like
Button's (6 / 8 / 10); icons sit 1px outside it (12px, 4px
to the label at `xs` / `sm`, 6px at `default`, 8px at `lg`); `min-w` equals the height so a one-character count
is never narrower than tall. Variants `default` (primary tint), `secondary`
(the one border **and** `bg-card`, like Button `secondary`), `outline`,
`muted`, `destructive` (solid orange, ink text), `error` / `info` / `success` /
`warning` (8% fill, 16% dark, matching ink). Labels are sentence case —
"Beta", never "BETA". `Badge` owns the geometry — don't restate it in a
wrapper.

**Inputs.** `Input`, `InputGroup` and `Textarea` share one treatment: border,
transparent fill (browser autofill tints it `bg-foreground/4`). `Input` is
`sm` 28 / `default` 32 / `lg` 36px at every width; a
default `SelectTrigger` stays 32px at every width, like Button. **Focus is the border turning
`primary`** — no ring: the field already has an edge, so recolouring it is the
whole signal. Invalid is a `destructive/36` border, full `destructive` while
focused. Inside a `Group` the next part's start border recolours with the
input (primary on focus, destructive when invalid), so the outline is whole.

- **A file field is `FileInput`**, never `Input type="file"`: a secondary
  "Choose file" button, then the file's name (tertiary placeholder until one
  is picked). The browser's own file control can't be sized or aligned, so it
  sits visually hidden underneath as the labelled form control.
- **Text sits on a normal line box.** Height comes from the box, not from a
  line-height equal to it — a text input centres its line on its own, and the
  line box is what selection paints, so a full-height line-height turned a
  selection into a 30px slab.
- **Textarea sizes.** `default` and `lg` are multi-line boxes (70 / 74px
  minimum, 12 / 14px edge → text). `sm` is **one line**, an `sm` Input's 28px
  at the 10px `sm` inset, not resizable, growing only with
  newlines — the editor for a table row or any row of `sm` controls. A
  `wrap="off"` textarea scrolls and fades sideways (`scroll-fade-x`); the
  primitive switches the axis, so the call site never does.
- **Placeholder** is `text-fg-muted`; on an invalid field (a required field
  left empty) it turns a muted destructive (`destructive-foreground/60`).
  **Exception: inside an `InputGroup` it stays muted** — the red outline
  already says it, and a red placeholder beside a neutral affix reads as a
  second error.
- **InputGroup fill is set on the group** (`InputGroup variant`): `outline`
  (default) has no fill anywhere, borders only; `secondary` puts one `bg-muted`
  fill across the input and every affix. An affix never has a fill of its own,
  so an input and its prefix always match.
- **InputGroup affixes come in two kinds** (`InputGroupAddon variant`):
  `inline` (default) sits inside the field with the text — an icon, a unit, a
  keycap — 10px from the input text (12px at `lg`); `separated` is its own
  segment split from the input by the one border — a fixed prefix/suffix the
  user never types (`https://`, `.superwall.app`) — with 11px inside the affix
  and 13px to the input text. Focus
  recolours the field's outer edge only; **invalid recolours every line** —
  the outline and the affix's dividing border go `destructive/36`, full
  `destructive` while focused.
- **InputGroup addons:** adjacent buttons in one addon sit 1px apart
  (`gap-px` — they're ghost, so each hover wash is its own edge); a `Kbd`
  hangs 4px into the end (or start) padding, a trailing button 8px, a trailing
  Badge 6px. A separated affix's text is `text-fg-tertiary`.
- **Search is one component, `SearchInput`** (`ui/search-input.tsx`): the
  search glyph as the leading inline affix, swapped for a `Spinner` while
  results load (`pending`), `type="search"` with the native clear hidden, at
  the context's size (`sm` beside a canvas section heading, `default` in a
  page header or card body). `debounceMs` keeps typing local and reports
  after the idle (source the value from the URL); without it the field is
  controlled. `variant="toolbar"` is the list toolbar's borderless search —
  `ListSearch` is that preset. Never hand-build an `InputGroup` + `SearchIcon`.
  A popup's own search row stays `ComboboxInput` / `CommandInput`; a lookup
  field that submits (Users → "Search users by ID", its trailing search
  button) is a form field, not a search.

**Filter picker.** `SelectTrigger variant="secondary"` is the dashboard filter
(environment, date range): the secondary Button's look — border + card fill,
medium weight, left-aligned — with the same hover/open wash; focus turns it
primary and invalid keeps its destructive border under hover. `surface` is its
old name and still resolves to it. `DateRangeSelect` fuses its custom-range
edit button to the trigger in a `Group` (one control, a `GroupSeparator`
seam), and the button takes the trigger's look: secondary beside a secondary
trigger, outline otherwise. `DashboardFilters` lays the pickers out as one set
of header controls: content width (`w-auto min-w-0`, overriding the trigger's
144px `min-w-36`), 8px apart, on the right, centred on the leading block. `SelectTrigger variant="ghost"` (no fill or edge,
`text-fg-secondary`, `bg-accent` on hover/open) is for chart toolbars — the
chart header's pickers and its `DateRangeSelect` (`triggerVariant="ghost"`,
with a ghost edit button) use it; never rebuild it from classes.

**Which trigger variant.** A select that **filters, sorts or switches what's
on screen** — the environment and date pickers, a card strip's "Main events",
a results table's column group, a canvas section's series or environment
picker, a list or grid's labelled sort, a page header's week or range — is
`secondary`, at the size of its context (`default` in a page header, `sm` in a
strip or section heading). `default` is a **form field**: a value the user
sets and saves, in a form, dialog or popover. Like `Input`, a field has no
hover wash; its focus border is the whole signal. So a picker that should hover
and doesn't is on the wrong variant, not missing a hover rule.

**Combobox rows without a check.** `ComboboxItem indicator={false}` drops the
trailing check column for rows that show their own state; never hide the check
with a CSS override.

**List popups (select, combobox, autocomplete).** A `bg-popover` frame with
the border and `scroll-fade` on the inner list. Every list pads its rows 4px
(`p-1`), like the menu; separators inset 10px (`mx-2.5`) and status rows sit
at the group label's 10 × 6, so every line starts at the rows' text inset.
Rows are 28px, the label at the row's 10px text inset so
**every row is flush-left** — the selected check sits in a **trailing**
column, 8px after the label and 9px from the row's end, never a leading
gutter. The check is 2px above the icon grid (16px; the
glyph itself is slight) and `text-primary`, the one accent in the popup. Menu
checkbox and radio items follow the same trailing layout. Autocomplete rows
have no check column — a suggestion has no selected state. The row highlight
is not transitioned in any list popup, menus included, and neither is the
icon under it (it follows the keyboard). **Two-line rows** pass a `description` to `SelectItem`,
`ComboboxItem` or `AutocompleteItem`: the label line over a `text-xs` tertiary
meta line on a 16px line, 6px above and below — 48px — with the
check centred on the label line and the trigger showing the label only. Never
pad a row taller at the call site.

**List-popup width — one rule for select, combobox, autocomplete and menu**
(`listPopupWidthClassName` in `ui/select.tsx`):

- **Rows fit the trigger → exactly the trigger's width.** `min-w` is the
  anchor's width, so the popup's edges coincide with the trigger's and
  alignment doesn't matter (floors: a select 144px, a menu 128px — an icon
  trigger or context-menu point has next to no width; a submenu and a context
  menu take the 128px floor alone, since their anchor is a parent row or a
  point).
- **Rows wider than the trigger → grows to fit its widest row instead of
  wrapping it** (`w-max`). Rows are one line.
- **Caps at `min(available width, 24rem)`** — 384px on a desktop. Every list
  popup keeps 12px from the viewport edge (`collisionPadding`, the phone
  gutter), so on a phone the cap is the viewport minus 12 on each side.
- **Past the cap, labels truncate** with `Truncate` (full text in a tooltip on
  hover). A two-line row's description truncates on its own line too. The
  primitives do this for a text label; a row with rich children owns its own
  truncation.
- A caller with a **deliberate fixed width** — a search-in-popup picker
  (`w-[min(calc(100vw-3rem),28rem)]`), the date-range custom popover — passes
  its own `w-*`, and `max-w-(--available-width)` if it is wider than the cap.
  **Never pass a `min-w-*`** — tailwind-merge lets it replace the anchor
  floor, and the popup opens narrower than its trigger (the sidebar's app
  picker did, with `min-w-56` under a 255px trigger). Don't force
  `w-(--anchor-width)` either — rows that fit already get the trigger's width,
  and forcing it wraps rows that don't.
- **Aligns toward the middle of the viewport** (`useListPopupPlacement` in
  `ui/select.tsx`; popovers too). A popup wider than its trigger is
  **start-aligned under a trigger in the left half and end-aligned under one
  in the right half** — the "Main events" picker at a card's right edge opens
  flush with the trigger's right edge. It never overhangs the edge its trigger
  sits near. The primitives measure the anchor (the trigger, a combobox's
  bordered field, a menu's explicit `anchor`) each time the popup opens,
  before paint. This is the default when a caller passes no `align`; an
  explicit `align` wins — pass one only when the placement is deliberate (a
  sidebar menu opening to the right, a context menu at the pointer, the
  date-range popover pinned to its field's end). A kebab or a picker never
  passes `align` just because it happens to sit at a right edge. Submenus keep
  `start` against their parent row; a tooltip-style popover centres.
- **Stays lined up with its trigger at the viewport edge.** The 12px gutter
  applies on the popup's cross axis only as far as the trigger itself allows:
  a trigger 8px from the edge (the sidebar's app picker) lowers that side's
  collision padding to match. Otherwise Base UI reads the lined-up popup as
  colliding and flips a start-aligned popup to end, or shifts a trigger-width
  one off both edges.

The popup sits 4px from its field. Select's popup always drops below — it
never aligns the selected item over the trigger. Combobox and autocomplete
popups anchor to the **bordered field**, not the `<input>` inside it: they
line up with its edge (by the alignment rule above), cap their height at `min(available height, 23rem)`,
and pad their list's end 12px when it overflows. A combobox whose search input
lives inside the popup anchors to its trigger.

**Number field.** Input's treatment on `NumberFieldGroup`: transparent fill,
the one border, 32 / 28 / 36px (`default` / `sm` / `lg`),
text on a normal line box, placeholder `text-fg-muted`. Focus is the border
turning `primary` (`focus-within`); invalid `destructive/36`, full
`destructive` while focused. The steppers are the field's icon affixes, not
icon buttons: 14px glyphs (16px at `lg`), `icon-tertiary`, edge →
icon 9 / 11 / 13, brightening to foreground over a `bg-accent` wash on hover.
Each stepper is split from the input by its **own border** over its own fill;
focus recolours the outer edge only, invalid recolours every line. At a bound
only the glyph fades, so the seam stays whole; a disabled field fades whole.
The scrub cursor is a foreground arrow outlined in the canvas colour. The
value is centred and `tabular-nums`.

**Slider.** A 4px `bg-muted` track; the filled range is `bg-primary`; both take
the 3px corner. The thumb is a `bg-foreground` disc (16px)
with a transparent 1px border — a teal thumb would vanish into the range.
Focus turns that border `primary`: no ring, no glow, and dragging never scales
it. `Slider` defaults to `thumbAlignment="edge"`, keeping the thumb inside
the track so it lines up with fields above and below; the muted track is inset
2px at each end. Minimum width 176px. `SliderValue` is foreground
`tabular-nums`.

**Labels and fields.** `Label`, `FieldLabel` and `FieldsetLegend` share one
treatment: `text-foreground`, 500, `text-base sm:text-sm` on `leading-normal`.
A `Label` wrapping a checkbox, radio or switch is the control's hit target:
pointer cursor, and the control centres on the label's **first line**
(`mt-[calc((1lh-size)/2)]`, `items-start`), so it sits level with the title
whether the label is one line, wraps, or stacks a title over a description
(option cards).
A direct-child icon takes the 32px row (14px, 8px to the
text), `icon-tertiary`, 0.5px above the cap-height middle; nested SVGs (a
checkbox's indicator) are left alone. `FieldDescription` is a hint:
`text-fg-secondary text-xs`. `FieldError` is `text-destructive-foreground
text-xs` — never `text-destructive`, which is the fill. An error with no
`Field` root to drive it (a hand-validated input, a checkbox group, a
form-level "Select at least one event.") is `InlineError`: the same type,
`role="alert"`, rendered only while there is an error, its `id` on the
control's `aria-describedby` — never a hand-styled
`<p className="text-xs text-destructive-foreground">`. A section that failed
to load is `SectionErrorState` / `SectionError` (Empty, error and not-found
states), never error text. `Field` stacks label,
control and hint 8px apart; `RadioGroup` items sit 12px apart. `Fieldset`
fills its container (`w-full`, no max-width — the caller constrains it) and
stacks its children 16px apart — legend → fields and field → field, like
`Form`; fieldsets stack 24px apart in their parent. An invalid checkbox or radio shows its
destructive border only while unchecked; a switch in both states.

**Form submit.** `SubmitButton` (TanStack) subscribes to `isSubmitting` and
disables itself while submitting; its children may be a function of that
state. It doesn't gate on `canSubmit`: a submit click is what surfaces
`onSubmit` validator errors.

**Tables.** `Table` and `DataTable` share one row (`TableRow`). `DataTable`
insets its outer columns 16px by default (`inset={false}` opts out) — header,
body and skeleton — so cell text lines up with a card header. Rows divide
with the one border. Header cells are the label role — 40px, 10px padding,
`text-xs` 500 `text-fg-tertiary` at every width; body cells `text-sm`,
`p-2.5 leading-tight` (a ≈40px row). **Only an interactive
row reacts to the pointer** — one with an `onClick` or a link/button role gets
the pointer cursor and the hover wash; a static row gets neither, because
hover promises a click. DataTable gives a row with an href `role="link"`, one
with only `onRowClick` `role="button"`, plus `tabIndex=0` and Enter/Space
activation; a row whose `getRowHref` returns null stays inert. The same goes
for `FramePanel`. **A row that opens something is one line and the whole
row opens it:** the title is the row's link (`rowLink` on DataTable, the
title marked `data-row-link`, so row and title can't open different places),
secondary facts share a line ("$50/yr · $8/mo" through `MetaLine`), and row
actions sit in a trailing column, icon-only, revealed on hover or focus
(always shown on touch) — never a second line held open under the title,
which doubles every row for controls that are invisible. A Badge in a cell
takes `py-0` so it doesn't grow the row. `DataTableSkeleton` renders the real
header labels and each bar in a text-line box, so loading never shifts
the table. **Sort:** a sortable header is a `plain` `xs` Button set in
the header's own label role (`text-xs` 500 at every width, so a sortable and a
plain column read as one row). It has no padding, so its label starts exactly
where the column's cell text does — no hang, no negative margin (a ghost
button's padding set it 5px in). `text-fg-tertiary` brightening to foreground; the sorted column
is `text-primary` (label and arrow), stays teal on hover, and is the only one
showing an arrow. It is `SortableHeaderButton` (`ui/data-table.tsx`): DataTable
renders it, and a hand-built `Table` puts it in its own `TableHead` (which
carries `aria-sort`) rather than copying its classes.
In a Frame the cells carry the card fill, so the identical wash is laid over
them as a background image (never a clear-to-transparent hover, which shows
the darker tray) — a framed table hovers in exactly DataTable's colour. A
framed table is `border-separate`: a 36px header row with no divider, body
cells carrying `bg-card`, the outer border and the 3px corner on the four
corner cells, first/last cells at 9px padding to absorb that border.
Row washes stay quiet and step by a point: hover `foreground/3`, selected (`data-state="selected"`)
`foreground/4` with no hover of its own, keyboard focus `foreground/5` — never
`bg-accent` (8%), which reads as a solid bar. The totals footer has no fill:
the border above it (none inside a Frame) and 500 weight set it apart.
Numbers right-align with `tabular-nums` — the caller sets the column's
`align: "right"` and `tabular-nums` in `cellClassName`; the table doesn't.
**An empty table body** is one full-width cell holding a compact state:
`<TableCell colSpan={n} className="p-0"><SectionEmpty size="compact" … /></TableCell>`
— never a hand-set line of muted text in a padded cell. The header row stays,
so the columns still say what the table would hold.

**Cards & panels.** `border border-border bg-card`. `CardTitle` is the
card-title role (`text-sm` 500 foreground), `CardDescription` the secondary
text step; a `CardAction` centres on the title block, and a lone title centres
on its action. A header drawn as a strip (`border-b`) is a 48px header strip
for one line (see Sizing: `sm` actions 10px from every edge, the title 16px
in); one that stacks a description pads 12 × 16. The strip's padding keys on the
`border-b` class, so **a header strip that collapses keeps `border-b` and
turns it transparent while closed** (`border-b-transparent`) — dropping the
class turns a 66px strip into a 74px plain header, and the card jumps. A footer strip (`border-t`)
is 16 × 12 around `default` buttons, 56px. A footer that is **one text
action** — "Show 35 more", "Load more", the phone "All campaigns" link — is
`CardFooterAction`: the whole 48px strip is the control (a `<button>`, or a
link through `render`), its border-top the divider and its other edges
transparent so focus recolours all four. The label is `text-fg-secondary`,
brightening to foreground under the table row's `foreground/3` wash; a
trailing `data-icon="end"` arrow is `icon-tertiary` until hovered; disabled
(loading the next page, with a `Spinner`) fades to 50%. Spacing is buzzkit's: a
**16px inset** on every section (header, panel, footer), 4px between title
and description. A plain header directly over a `CardPanel` closes to 12px
(header `pb-3`, panel `pt-0`), and so does a panel over a plain footer; a strip
header keeps the panel's full 16px top, and a header with no `CardPanel` under
it (a table straight below) keeps its 16px bottom. `CardFrame` stacks `Card`s
with a -1px margin so their borders merge; its header is the same 48px strip
and its footer 16 × 12, 4px between title and description like every surface
header. 24px
read as a page, not a card. Cards in a grid sit 16px apart.
**Frame** (`ui/frame.tsx`) is a tray on the canvas colour — `bg-background`

- the border, 4px padding — holding panels raised to the card surface
  (`bg-card` + border, 16px inside), 4px apart, so they read as cards laid in
  the tray; tables in a frame put their rows on the card surface too.
  `FrameHeader` / `FrameFooter` sit on the tray itself, no border: the header
  is the 48px strip, the footer 16 × 12; the header's title and description are
  4px apart. `FrameHeader` cancels the tray's 4px padding, so its band runs from
  the Frame's outer border to the first panel and measures exactly a Card header
  strip (47 + the panel's 1px top border = 48). A table sitting directly in the
  tray is its own panel; a table inside a `FramePanel` renders plain, so it
  never draws a second border (the `in-frame` variant).
  **Page sections are Cards, not Frames** (decided 2026-09-24, after a live
  comparison on the overview, paywalls and campaigns): the tray's extra border
  and inset add chrome without information. Reach for `Frame` only to group
  several separate panels into one unit.
  **Never hand-build a card surface** (`rounded-* border border-border
bg-card` on a raw element): every copy is one of four shapes, and each has
  its primitive.

* A padded block is `Card` + `CardPanel` (its 16px inset — not `p-3`,
  `px-4 py-3` or `p-6`), with a `CardHeader` / `CardTitle` /
  `CardDescription` when it has a title; `render={<section />}` or
  `render={<form />}` for the element.
* Content that runs to the card's edges and needs its corners clipped — a
  table, a divided list of rows, a collapsible card — is `ListCard` (the
  card with `overflow-hidden`). A `CardHeader className="border-b"` sits in
  it as usual; a `Collapsible` or `Accordion` becomes the card with
  `render={<ListCard />}` (or `render={<Card />}` when it keeps an inset).
* A state that stands in for the card's content is `<Card>` around
  `SectionEmpty` / `SectionErrorState` / `SectionLoading` — no padding of
  its own.
* A card the user clicks is `OptionCard` (a choice or an action) or `Item
variant="card"`; a repeated product tile (an asset) is `Card` plus the
  tile's own body, and its skeleton renders the same `Card`.
* A paywall or template preview is a `GalleryTile` in a `Gallery` inside a
  `ListCard` (Gallery, below) — never a card of its own.
  `CardFrame` is different: one card
  surface throughout. Floating surfaces
  (popover, dialog, menu, select popup) use `bg-popover` with the same border.
  Headers and rows inside share the one line via `border-border` /
  `divide-border`.

**Device frame** (`ui/device-frame.tsx`). Every device anywhere — paywall
and template previews, survey and retention-messaging previews, and their
loading placeholders — is `DeviceFrame`, drawn like the `superwall` studio's
canvas. Never a bezel of your own. (A screenshot in a grid — the paywall
library, templates, a campaign's variants — is a `GalleryPreview` well, not a
device.)

- **No bezel.** The device is its screen: a 1px `foreground/20` hairline in
  the device's own corner radius over `bg-background` — an empty screen is
  the page colour, whatever the surface. No thick body, no shadow, no
  notch cut into a frame. A device without a radius (desktop) takes the 3px
  corner.
- **The studio's devices.** `device` is a studio device id (`iphone-17` by
  default, `pixel-10`, `ipad-mini`, `desktop`, …) read from
  `@superwall/studio`'s own list, so the dashboard and the studio agree on
  every size.
- **Chrome** is the studio's, drawn in device pixels over the content and
  `pointer-events-none`: the 9:41 status bar, the Dynamic Island or
  punch-hole, the home indicator, Android's navigation bar. `theme` sets its
  ink (`dark`, the default, is light ink); `chrome={false}` drops it.
- **Scale.** A live document (`scaleContent`, the default) renders at the
  device's logical size — the viewport the paywall expects — and scales to
  `width` (or the container's width). A screenshot, a skeleton or dashboard
  text passes `scaleContent={false}` and fills the frame at its real size, so
  a small frame's "No preview" stays readable.
- **Widths** come from the surface: 300 for the preview modal, the template
  dialog and the duplicate page (one size, so a placeholder never moves), 306
  in a survey's preview column. Loading is `DeviceFrameSkeleton` at the same
  width.

**Gallery** (`ui/gallery.tsx`). Paywall screenshots in a grid of cells that
share one hairline, inside a `ListCard` under its `ListToolbar`. The paywall
library's gallery view, the template gallery and a campaign audience's
variants (the editor's Paywalls tab) are this one component, so a paywall
reads as the same object wherever it's shown. A thumbnail of one (the
sidebar's variant preview, a results section) is the same `GalleryPreview`
well at its own width.

- **Grid:** 2 columns on phones, then 3 / 4 / 5 at `md` / `lg` / `2xl`
  (shell breakpoints). Each cell draws its right and bottom edge; the grid
  hangs 1px past the card, which clips it, so the outer edges are the card's.
- **Tile:** a 16px inset. **The caption above the preview**, 12px apart:
  `GalleryCaption` owns this placement for the library, templates and campaign
  variants. Render the caption before the preview in JSX so keyboard and
  reading order match the visible layout. It composes `ItemTitle` (the card-title role) over
  `ItemDescription` (meta). Titles use the full width and wrap up to two lines,
  including unbroken identifiers. A row only grows when one of its titles
  wraps. Each subtitle sits immediately below its own title, top-aligned;
  previews still align within the row.
  Library edit time sits left and status right beneath the title, vertically
  centered together. Campaign assigned counts sit left (a skeleton while
  loading), with editable traffic percentage right, including holdouts.
  The `/dev/design-system` Paywalls section renders all three real tile
  compositions and the shared preview-dialog shell.
- **Preview:** `GalleryPreview` accepts children for a live visual (such as a scaled retention phone preview) using the same well and proportions as screenshots. `shape="content"` remains available for natural-height text. `GalleryPreview` is a well in the card's own fill (`bg-card`,
  so an empty one sits back as a frame rather than a lighter panel) with the
  one border and the 3px corner: `portrait` 9:19 (a phone paywall) or
  `landscape` 16:9 (web), the image cropped to its top. Text-only previews can use `content`, sized to their text with a 16px inset.
  Retention campaign messages use the scaled phone preview in the children slot,
  with the same gallery columns, caption, and corner actions as paywall variants. No image, or a broken
  one, keeps the box and shows a `text-xs` tertiary note, so nothing moves.
  A screenshot the server hasn't captured yet is `pending`: a 16px tertiary
  `Spinner` (the `text-xs` label's icon step up, not a section loader) over
  "Generating preview", drawn in code — never legacy's
  hourglass stand-in PNG, which `isScreenshotPending`
  (`components/paywalls/preview-screenshot.ts`) reads as pending.
- **States:** a tile that is one button or link is `interactive` and takes the
  divided-row states — a `foreground/3` wash on hover and focus as a primary
  edge on `::before` — so the lines never double and the cell never moves.
  Loading is `GalleryTileSkeleton`, the same cell. Empty, error and no-results
  states replace the `Gallery` inside the `ListCard`.
- **A tile with its own controls** (the paywall library's: an "N active"
  menu, actions) can't be one button. Its title is the link, stretched over
  the tile (`data-row-link`, `after:absolute after:inset-0`), and the
  controls sit above it (`relative z-10`) without adding a row: the status
  is a Badge `sm` on the right, vertically centered with the edit time on
  the left immediately beneath that tile's full-width title. The
  actions are an icon-only
  raised toolbar (`bg-popover`, the one border) on the preview's top-end
  corner, revealed on hover or focus and always shown on touch. `interactive` draws the
  focus edge while that link has keyboard focus.

**Setting rows** (`ui/setting-row.tsx`). One setting in a card: what it is
on the left — a `text-sm` 500 title over a `text-fg-secondary` description,
2px apart (the stack is the whole message) — and its control or status on the
right, the card's 16px inset on every side. Rows in one card divide with the
one border (`divide-y divide-border` on the card). Every "setting, then its
control" line is this row: public beta switches, the danger zone, a key or
domain to copy, a hand-off to the legacy dashboard, project transfer, the
survey editor's toggles — never a hand-built flex with a title `<p>`.

- `htmlFor` makes the title the control's `Label`, so tapping the text flips
  a switch on a phone.
- `stack` is for controls that need room (a value to copy, a button pair):
  below `sm` they drop under the text, left-aligned. A switch stays on the
  right at every width.
- Information never hides in a tooltip on a disabled control ("Coming soon"):
  it goes in the description, where touch can read it.
- **Row fields** (`TextRowField` / `SelectRowField` on `useAppForm`) are the
  setting row for an editable value: the whole row is the field. The row is
  the control's label, the input or select is borderless and flush with the
  row's right padding (right-aligned text from `sm`, under the text below).
  A trailing icon at `icon-tertiary` says the value is editable: a pencil on
  text rows, which fades out on focus, and the select's chevrons on select
  rows. Hover washes the row `foreground/3` and lifts that icon. Focus
  outlines the whole row in primary (destructive when invalid), drawn over
  the dividers so they don't double, and the wash drops while it shows. A
  settings form whose fields are values (General, platform configuration)
  uses them in a `divide-y` card with the save in the footer; a multi-line
  value keeps a stacked `Textarea` in a row of its own.
- A danger zone is titled "Danger zone"; its rows can take
  `tone="destructive"`.

**Option cards** (`ui/option-card.tsx`). A bordered card the user clicks to
choose a path or a value — "Start from scratch", a project to add a platform
to, an import mode. One primitive, `OptionCard`; never
a hand-built bordered button or `Label`.

- **Two kinds, one look.** An _action_ is a `<button>` (or a link through
  `render`) with a trailing `ChevronRight` (`trailing="chevron"`; `"arrow"`
  for a link that leaves the dashboard). A _pick-one_ choice (a plan, a
  platform, a destination) passes `selected` and says it with the primary
  border alone — **no radio circle**: radio circles are rare in the app,
  kept for a radio column in a table and dense form groups with no cards. The
  revenue provider is one of those: a setting that starts _unanswered_ and
  whose options each bring their own setup. Each option is a bordered box
  in the card (8px apart, like bordered option cards): the logo leads, the
  name over its description, and a `Radio indicator="check"` ends the row,
  which is the radio's label. Empty checks (and a "None selected" badge on
  the card) say nothing is chosen yet. The chosen box takes the primary
  border and opens, on the move clock, to hold what that provider still
  needs, so the setup is physically inside the choice it belongs to. Status
  in there is a Badge, never a round mark, which would read as one more
  thing to choose. A
  _multi-select_ card passes its `Checkbox` as `control`, and the whole card
  becomes the checkbox's `Label`, the box leading, centred on the title's
  line (Labels and fields).
- **Geometry** is the card's: `bg-card` + the one border, the 3px corner, a
  16px inset. A figure — a 40px `IconTile` (`icon`, `iconTone`; `mark` for a
  brand logo; a selected card keeps its figure muted, the primary border says selected) or any self-sized `media` — sits
  12px from the text. The title is the card-title role, truncating; under it,
  2px apart, a `description` (`text-sm` secondary, a sentence) and/or `meta`
  (`text-xs` tertiary on a 16px line). A badge follows the title
  (`titleAddon`) and wraps under it when there's no room. Cards in a set sit
  8px apart. `layout="tile"` stacks the card centred from `sm` (a row on
  phones, its trailing glyph shown there only) for a grid of two or three
  peers.
- **One hover:** the border lifts to `foreground/20` and a 3% wash eases in
  over the fill as a gradient on stops, with the trailing glyph's
  `icon-tertiary` fade lifting. (The copies it replaced had three: a
  `bg-accent` slab, a flat `foreground/3` swap and a border-only lift.)
- **Selected** (a checked `control`, or `selected`) is a `primary` border
  and no hover. **Focus** turns the card's own border primary (foreground on
  a selected card); a `control` card shows focus on the control. **Disabled**
  is `opacity-50` with no pointer.
- `children` add a full-width body under the row (a rule preview) — action
  cards only, since a label holds phrasing content only.

**Notices** (`ui/notice.tsx`). A dismissible, linked card that points
somewhere else — an SDK that's behind, a blog post, a setup step, a
promotion. Every overview notice and the Superwall Wednesday promo are this
one primitive; never hand-build a banner. One row, `items-center`, 16px inset
on every side: a 40px `bg-muted` tile (18 / 20 glyph) → 12 → the copy → the
action → the dismiss, so it is 72 minimum and the content is centred, never
top-pinned with a heavier bottom inset.

- **Copy** is a card title (`text-sm` 500) over a `text-sm` secondary
  description, 2px apart, each clamped to two lines, so editorial copy of any
  length can't grow the card. A status `Badge sm` or an `InfoTooltip` follows
  the title.
- **The title is the link**, stretched over the card, so the whole card is one
  target without nesting the tooltip or the dismiss in an anchor. Hover is a
  3% wash plus the action's underline; focus turns the card's border primary.
- **The action** is a `link` Button (`sm`, primary ink) with the standard
  `ArrowRightIcon` suffix, sized by the Button — never a hand-sized arrow.
  Below `md` it drops under the copy.
- **Dismiss** is a ghost `icon-sm` Button with `XIcon`, at the row's end.
- **Media** (an optional illustration) replaces the tile from `md` up, 16:9, and is
  **measured to exactly the copy block's height** so cover and text read as
  one band; phones keep the tile. Blog notices use the book tile at every width,
  without cover or OG images.
- `variant="promo"` is the fixed teal Superwall Wednesday surface: its own ink
  ladder from the `--superwall-wednesday-*` tokens and a `backdrop` slot. The
  action label, arrow and underline use black `ink`, including on hover.
- `size="compact"` is one 48px row for a notice whose fix is small enough to
  make where it is read (the Overview's missing bundle ID): a 16px
  `icon-tertiary` glyph instead of the tile, the problem in one line as the
  title (no description, no badge), the notice's own `sm` controls, and the
  dismiss. It has no link, so nothing is stretched over it. Its only second
  line is the controls' own (a warning, or a failed save), under them and
  end-aligned from `md`; below `md` the controls take a row of their own.
  Use it for nothing else: a notice that points away keeps the full anatomy.
- A notice points away from the page; state the user must act on while on the
  page is an `Alert`. The environment is never a notice (see Layout →
  Environment).

**Page section** (`ui/page-section.tsx`). The titled block on the canvas
between a page header and its cards — settings sections, the user and event
detail sections, integration groups, the campaign results' readouts. One
component, `PageSection`, never a hand-built `h2 text-lg` + `p`:

- The title is the canvas section-heading role (`text-lg` 500, a 28px line);
  `description` sits 2px under it in `text-fg-secondary`.
- `actions` are `sm` (28px) controls on the right, **vertically centred on
  the title block** (heading and description together), like `PageHeader`'s
  — pinned to the heading's line they read as hanging off the section's top. The row wraps with 16px between its
  lines: with a description the title block takes the free width (a long
  description wraps beside the actions); without one it keeps its own width,
  so a short heading and its button stay on one row. A search that should
  fill a phone's row passes `w-full sm:w-56`.
- `titleAddon` follows the title 12px on (badges, a freshness control, an
  id), like `PageHeader`'s; a one-line title passes `<Truncate>`.
- Heading → content is **16** for every section — the user detail page's
  sections were 8, the results readouts 12; both moved to 16.
- `id` lands on the `<section>` and names it by its heading
  (`${id}-heading`); `headingLevel={3}` for a section nested under another.
- `PageSectionSkeleton` holds the 28px title line (`SkeletonLine size="lg"`)
  and, with `description`, the 20px line under it.
  A heading **inside** a card is a card title, never a `PageSection`.

**Text links** (`ui/text-link.tsx`). **One link look, everywhere.** Every
link that reads as text — in a sentence, a hint, a card, a standalone "Learn
more", a docs or back link — is `TextLink` with no props: foreground text over
the teal `decoration-primary` underline (3px offset), always drawn, the text
turning teal on hover; keyboard focus thickens the underline to 2px (never a
ring or box). `Button variant="link"` (an action set among controls) renders
exactly the same. There are no colour or underline variants to pick: a teal
link here, a white one there and a hover-only one elsewhere is what this rule
replaced.

- **The one exception is `tone="title"`**: a name that _is_ its row's or
  card's title and opens it (a paywall name, a campaign title). It keeps the
  title's own ink and weight and underlines only on hover and focus — it reads
  as the title, not as a link inside it. `textLinkVariants({ tone: "title" })`
  for a wrapper that forwards `className` (`PaywallOpenLink`).
- `external` opens a new tab (`rel="noopener noreferrer"`); `render` takes a
  router `Link`.
- Never hand-style a link (`text-primary hover:underline`, a bare `<a>` with
  colour classes) and never override a `TextLink`'s colour at a call site.

**Meta line** (`ui/meta-line.tsx`). Facts joined by "·" are `MetaLine`:
`items` drops falsy entries (so a missing fact never leaves a doubled or
dangling dot); the separator is `text-fg-muted`, 6px either side
(`gap-x-1.5`), `aria-hidden`. `size`: `xs` (default, the meta role —
`text-xs` `text-fg-tertiary`), `sm` (the same colour at `text-sm`), `inherit`
(inside `ItemDescription` or a line that sets its own ink). It wraps between
facts; `wrap={false}` holds one line and `truncate` names the one fact that
clips (`last` by default, `first` for a leading identifier) while the rest stay
whole — never child-selector overrides at the call site. It renders a `span`
(valid inside a row rendered as a button); `render={<p />}` where it stands
alone. The string form — tooltips, page-header descriptions, select values,
command-palette hints — is `joinMeta(parts)` from `lib/formatters`.

**Description list** (`ui/description-list.tsx`). Key/value facts are
`DescriptionList` + `DescriptionItem` — a `dl` of `dt`/`dd` pairs, never a
local `…Row` / `MetaItem` / read-only `Input` standing in for a value.

- **`inline`** (default): label left, value right, centred on one grid row.
  **One label column everywhere**: a third of the row, never under 8.5rem
  (the longest users-detail label holds on a phone) and never over 12rem
  (a wide card doesn't strand its values) — 7–10rem at `sm`. The label is
  400 `text-fg-tertiary` at the value's size. `divided` (default) is the list
  that fills a card edge to edge: `divide-y`, rows `px-4 py-2.5` (the ≈40px
  dense row). `divided={false}` is facts inside padded content (a sheet
  section, a popover): no padding, rows 6px apart.
- **`stacked`**: the label role (`text-xs` 500 tertiary) on a 16px line over
  the value, no gap; a badge value takes the 4px a chip under a title does.
  Up to five `columns`, 16px apart (the form-grid step), one notch fewer on
  phones (4 → 2, 3 → 2, 2 → 1).
- **`size="sm"`**: `text-xs` label and value, for facts nested in a row or a
  popover; its stacked grid keeps its column count at every width.
- The value is foreground and `tabular-nums` (identifiers are data). Text
  clips through `Truncate`; `truncate={false}` wraps (`wrap-anywhere`). An
  empty value is `—` in `text-fg-muted` (`empty` renames it: "Not
  configured"). `copyValue` makes the value the `CopyableText`; `hint` puts
  an explanation in a tooltip behind a dotted `fg-muted` underline;
  `fullValue` shows a shortened value whole; `tone` is the value's ink
  (`muted` for a zero reading, a status for a verdict); `icon` leads it 8px
  before, `icon-tertiary`. A loading row is the same `DescriptionItem` with a
  `SkeletonLine` value.

**Inset list** (`ui/inset-list.tsx`). A bordered, divided list **inside**
a form, dialog or card body (project assignments, the changes a dialog
applies, Google Cloud topics) is `InsetList` + `InsetListItem`; a list that
_is_ the card is `Item variant="row"` in a `divide-y` card. The frame is the
one border, 3px corner, `overflow-hidden`; rows are `Item variant="inset"`
at the small-panel inset, 12 × 10 (a title over a meta line is 56, one line
≈40), so `ItemContent` / `ItemTitle` / `ItemDescription` compose inside.
`interactive` (a `label` round a checkbox, a clickable row) washes
`foreground/3`; `selected` is the primary `::before` edge with no hover;
`trailingControl` drops the end padding to a boxed control's vertical inset
(6 around a 28px button, the row 40); `align="start"` pins media to the first
line; `tone` tints a pending add (`success/5`) or remove (`destructive/5`);
`maxHeight` (`sm` 224 / `md` 256) caps the list — the frame keeps the
border, the list scrolls inside with `scroll-fade`.

**Person identity** (`ui/person-identity.tsx`). A person is `PersonIdentity`:
an optional `PersonAvatar` 12px before the name (card-title role) over the
email (meta role) — the `Item` body. The title is the name, else the email,
else `fallback` ("Unnamed user", "Pending member"); the email line shows only
under a name, so an address is never printed twice. `meta` replaces that line
(`null` drops it for a table with its own email column), `nameRender` routes
the name through a link, `actions` trail, `children` add a chip line 4px
under the text, and `variant` / `interactive` / `render` pass to `Item` for a
divided-list row. `PersonAvatar` (`ui/avatar.tsx`) is the avatar column of
the Media ramp — 24 dense, 32 default, 48 profile — with initials (one below
32, two from 32) on a `muted`, `primary` (a dashboard user) or `info` (a
machine actor) tint. The sidebar's account block keeps its sanctioned 15px
name.

**Overlays.** Dialog, alert dialog, sheet, popover, preview card, tooltip,
menu and toast share one surface: `bg-popover` with the one border
(`border-border`), 3px corners, no shadow. The fill runs under the border (no
`bg-clip-padding`), so the translucent edge composites over the popover fill
and reads the same over any page. Modal overlays dim the page with `bg-scrim`,
never blur; the scrim only fades. Dialogs enter and exit at scale 0.98 +
opacity over 200ms; popovers, tooltips and preview cards over 150ms (see
Motion); sheets slide 32px over 250ms on the drawer curve; list popups and
the command palette appear instantly. Floating popups sit 4px from their
anchor (`sideOffset` 4).

- **Dialog / alert dialog / sheet.** One 20px outer inset (buzzkit's
  density), 16px between sections: header `p-5` (bottom `pb-3` when a panel
  or a bare footer follows; `pb-4` below `sm`), panel `p-5` (top `pt-1` under a header, bottom
  `pb-1` above a bare footer), 4px between title and description. Title
  `text-lg` · 500 · foreground; description `text-sm` · `text-fg-secondary`.
  The default footer is a strip: `px-5`, `border-t border-border` over the
  **card surface** (`bg-card`, between the canvas and the popover — the canvas
  colour read too dark), 12px above and below the 32px button row;
  `variant="bare"` drops the strip: `pb-5`, with `pt-3` after a panel and
  `pt-1` straight under a header, so the gap above it is 16px either way.
  Panels scroll through `DialogPanel` / `SheetPanel`. The close ✕ is
  a ghost `icon` button (32px, `XIcon`) 14px in from the top-right corner,
  level with the title; the dialog's carries a "Close" tooltip with an `esc`
  keycap, the sheet's none. Dialogs are `max-w-lg`, placed 1fr/3fr from the
  top. **Below `sm` dialogs and alert dialogs become bottom sheets** (full
  width, no corners, no side or bottom border), the footer stacks
  `flex-col-reverse`, and the alert header centres. A side sheet draws only
  the edge facing the page; `inset` draws all four from `sm` up.
- **Destructive action on the left.** When a dialog's footer carries a
  destructive action beside the confirm pair (delete from an edit dialog), the
  destructive button goes first and the pair is one group on the right:
  `DialogFooter className="sm:justify-between"` holding the destructive
  `Button` and a `div className="flex flex-col-reverse gap-2 sm:flex-row"`
  for cancel + confirm. Below `sm` the footer's own `flex-col-reverse` stacks
  it under the pair.
- **Confirmations are `ConfirmDialog`** (`ui/confirm-dialog.tsx`), never a
  hand-built `AlertDialog`: title, a description of what will happen,
  Cancel and an action that repeats verb + object (Copy → Actions). `tone` is
  `destructive` unless the action builds something back up (restore, enable:
  `default`). It runs `onConfirm` itself — the action shows its spinner and
  pending verb, Cancel disables — and closes when it settles, unless it
  returns `false` or throws (the caller showed its failure toast; the dialog
  stays open). A body (a type-to-confirm field, a summary, a list) is its
  `children`, laid in `AlertDialogPanel` (20px inset, 16 under the header,
  scrolling with the fade); `confirmDisabled` gates the action on it. A
  blocked action omits `confirmLabel` and closes with "Close"; `alternative`
  swaps Cancel for a softer action ("Pause instead"). Enter confirms and Esc
  cancels; an unsaved-changes guard that opens on its own passes
  `confirmOnEnter={false}`. Build on `AlertDialog` directly only for a dialog
  that isn't a confirmation.
- **Popover.** A 12px inset on every side; the viewport scrolls with
  `scroll-fade`. When the first line is text (a label, a title) the **caller**
  adds `-mt-1` — `PopoverTitle` doesn't: its line box carries ~4px of
  half-leading above the caps, which would read as a heavier top than the
  sides and bottom. `PopoverTitle` is a card title (`text-sm` · 500 ·
  foreground), `PopoverDescription` is `text-fg-secondary`. `tooltipStyle`
  popovers take the tooltip's 8×4 padding and `text-xs`, for a short line of
  text only. Popovers animate in only (no exit transition).
- **A list of destinations is a menu, not a popover.** Rows the user picks to
  go somewhere (a paywall's "N active" campaigns, docs links) are a `Menu` of
  `MenuLinkItem`s — real `<a>`s (`render={<Link …/>}` in-app), so ⌘-click and
  copy-link work, with the list popup's 4px padding and keyboard navigation.
  Menu rows styled by hand inside a `tooltipStyle` popover read wrong: its 8×4
  padding is wider than it is tall. An external link row ends with a 14px
  `ExternalLinkIcon` (`ms-auto`).
- **Preview card.** 16px inset, 256px wide (`w-64`), `text-sm`.
- **Tooltip.** A label, not content: `text-xs` · 400 · foreground, 8×4px
  padding, 28px tall. Keys go through the `shortcut` prop (`shortcutLabel`
  gives glyph or icon keys a spoken name); the keycaps end the tooltip, so the
  end padding drops to 4px — the same inset they have above and below — with
  8px between label and keys. A tooltip names the action; a keys-only tooltip
  is rare, and when it happens both sides are 4px. On its own a tooltip opens
  instantly; inside a `TooltipProvider` the provider's `delay` applies (Base
  UI's 600ms if unset) and neighbours open instantly while one is showing; an
  explicit `delay` on the trigger wins over both.
- **Toast.** Neutral surface; the type sets only the icon. Content `p-3`,
  `text-sm`, 2px between title and description, 8px to the action. Icons
  follow the 32px row (14px, 8px to the text, 11px from
  the edge). `Alert` shares the 12px inset and the 2px title → description.
  A status alert's buttons speak in its status: an outline or secondary
  button takes the hue's 8% fill (14% hover) and a 32% border (48% hover)
  with the status ink; a ghost button the ink and an 8% hover wash. `Alert`
  applies it, so an action never styles itself; focus stays primary, and a
  solid button or a neutral alert's buttons are unchanged.
  Status icons are `text-destructive` / `text-info` / `text-success` /
  `text-warning`; the loading spinner is `icon-tertiary`. Title foreground
  500, description `text-fg-secondary`, action button `xs`. The viewport is
  top-centre in Shinsa (`Toaster` in `packages/ui`, 12px from the top, over the empty middle of the top bar),
  max 360px wide; the stack gaps and
  peeks 12px; toasts enter and exit over 500ms `cubic-bezier(.22,1,.36,1)`.
  Anchored `tooltipStyle` toasts match the tooltip exactly.

**Command palette.** Modelled on buzzkit's: one `bg-popover` frame with the
border and no inner panels, `max-w-xl`; the app palette is centred and fixed
at `min(85vh, 600px)` tall. The search row (no field edge of its own; the
placeholder starts at the rows' 40px label column) is split from the results
by the one border. Under it, on the root page only, a **compact filter strip**:
a borderless `SegmentedControl`, 36px (`px-2.5 py-1.5`) with 24px pills
(`h-6 px-2 text-xs`, 4px apart), `tabIndex=-1` — Tab / Shift+Tab from the
input cycles the filters, and the choice is sticky. The list pads 8px; groups
sit 6px apart under `text-xs` 500 `text-fg-tertiary` labels (the app palette
uses no separators; `CommandSeparator` runs full-bleed where one is used).
Rows are 32px at every width, `px-2.5`, a 20px icon box (14px glyph)
10px from the label, the icon `icon-tertiary` until highlighted; a
hint is `text-xs text-fg-muted`, and a `→` marks rows that open a sub-page.
Sub-pages show a breadcrumb row with a ghost `xs` Back button. The footer is a
compact 36px hint row (12px sides, 500 text) under its own `border-t`.

**Context menu.** Opens like a native one: its top-left corner at the pointer
(`side="bottom" align="start"`, no offsets), growing down and right;
collision handling flips it at the viewport edges. It reuses Menu's row and
popup classes.

**Menus.** Popup `min-w-32`, scroller `p-1` + `scroll-fade`. Rows are 28px
at the 10px text inset, 14px `icon-tertiary`
icons 8px from the label, highlight `bg-accent`, untransitioned (it follows
the arrow keys). The
`destructive` item is `text-destructive-foreground` and its icon keeps that
colour. Group labels `text-xs` 500 `text-fg-tertiary`; separators inset 10px
(`mx-2.5`), not full-bleed; a sub-menu trigger stays highlighted while its
sub-menu is open; `MenuShortcut` ends a row. A boolean in a menu is a
**checkbox item — a trailing teal check — never a switch**. The row is the
control; a switch drawn inside it reads as a second thing to click. On/off,
active/inactive: check or no check.

**A picker with actions is a menu, not a select.** A `Select` popup is a
listbox and holds only options. When a choice also needs a way out of the
list ("Enter manually") or an action that isn't a value ("Copy prompt"), it
is a `Menu`: the choices a `MenuRadioGroup` (`menuitemradio`, checked
trailing teal), then a separator and the actions as plain `MenuItem`s. Its
trigger borrows `selectTriggerClassName`, so it is still the select control
to the eye. An action never changes the value; a copy action stays open long
enough for its `CopyIcon` check to land, then closes. A control never shows a
dropdown and a text field at once: "Enter manually" swaps the trigger for a
field of the same size, with one trailing button back to the list. The
bundle ID picker (`components/application/bundle-id/BundleIdPicker.tsx`) is
the reference.

**Sidebar** (as `SidebarNav` renders it). On the canvas behind the border.
Overview is always available. For a native app whose setup is unfinished,
Quickstart sits above Overview; an Overview setup notice links back to the
checklist. The entry and notice disappear once setup is complete.
Rows are 32px with an 8px inset (7px padding inside a 1px border), 2px apart, 15px `text-fg-tertiary` labels, with
icons from the bespoke set — drawn on an 18px grid, rendered at 16px,
`icon-tertiary`, 18px to the label; hover washes `foreground/5` (the sidebar's
rows are the one place a row washes at 5%, not 3%). The active row turns teal
with `faux-medium`, swaps to the icon's filled twin at full strength, and has
no fill at rest. **Exception to "selected items have no hover":** an active
row that is still under the pointer keeps the hover wash (only its text and
icon hold teal). The row you click becomes active under the cursor, and
dropping the wash at that instant read as the click having broken something.
`SidebarMenuButton` and `SidebarMenuSubButton` own it
(`data-[active=true]:hover:bg-foreground/5`); nothing else takes it.

A **section row** (Paywalls, Analytics, Settings) is a disclosure: pressing
it — or Enter / Space — opens or closes the section (a `CollapsibleTrigger`
button with `aria-expanded`). Opening a section you are not inside also goes
to its first page, so the first child is the section's home; reopening one you
are inside stays put, and closing never navigates. It ends in the shared
`DisclosureChevron`, 14px, a step under the 16px icon, turning on
`transition-disclosure` and teal when the row is. A closed section over the
current page highlights its header; an open one leaves the highlight to its
sub-row. A section is open exactly when it holds the current page, so leaving
it for a page outside closes it. A hand toggle holds only until the next
navigation.

**Sub-rows** hang off a **guide line** (after buzzkit): 1px `sidebar-border`
at 16px — the middle of the parent's icon (8px inset + 8) — starting 2px under
the parent row. Each sub-row's box starts at 24px, where the parent's icon
ends, and its text at **42px, exactly under the parent's label** (1px border +
17px: the parent's 18px icon → label gap). Sub-rows have no icon: 32px, 15px,
2px apart, inactive tertiary; the active sub-row is teal `faux-medium` with no
fill. The list opens on `CollapsiblePanel`'s height and fades with it
(`duration-move`, opacity 0 → 1 on the panel's starting and ending style).
`SidebarMenuSub` owns the line and inset, `SidebarMenuSubButton` the row.

`SidebarGroupLabel` is 32px, `text-xs` 500 `text-fg-tertiary`, 7px sides,
14px `icon-tertiary` icons. Focus is the row's own border turning primary.
Collapsed (the desktop icon rail), rows are 40px squares with a tooltip on the
right, and a section opens its pages in a right-side Menu off its icon — every
page stays one click away, where "navigate to the first child" would hide the
rest; the icon is highlighted while you are on any of them. A section down to
one available page flattens to a plain row everywhere. On mobile the sidebar
is a `Sheet` at the full expanded width, so sections disclose inline there.

**Project switcher** (top of the sidebar). Trigger: app icon, project name,
org name, `ChevronsUpDown`; under it the platform `SegmentedControl`
(expanded) or a platform menu (collapsed rail) — existing apps first, then
empty "add" slots. The switcher is `SegmentedControl size="lg"` — 36px (30px
segments): its segments are wide icon-only thirds (~80px); at the standard 26px
they read as slivers, and at `xl` (40) the control outweighed the app picker.
Its glyphs are **16px**, the icon-only size (Sizing → Icon sizes). The rail's platform
tile (32px) takes the same 16px glyph. Its menu lists the other projects
first, then a separator, then New Project (teal +), View organization and
Switch Organization.

**Empty, error and not-found states** share one rhythm: 16px from the
figure (icon chip, 404 numeral) to the title, **2px** from the title to the
description, 16px from the description to the actions. Title `text-base`
500 foreground (`RouteErrorState`, a full page, is `text-lg` with a 56px
chip and 24px glyph), description `text-sm text-fg-secondary`. A docs or help
link in the actions is a `link` Button, never an inline hand-styled anchor.
Figures are `IconTile`s: `SectionEmpty` the `muted` tile (`bg-muted`, no
border, `icon-tertiary` glyph); `SectionErrorState` the `destructive` tile;
`EmptyMedia variant="icon"` the `outline` tile over two rotated ghost copies
of itself; `RouteErrorState` the 56px `destructive` tile; `NotFoundState` a `text-4xl` 500
`text-fg-muted` numeral. **Actions are placed by role, never by hand**
(`StateActions`, `ui/state-actions.tsx`): the `primary` — the one call to
action — is always the right-most button; a `secondary` ("Learn more",
"Import", "Back to …") sits on its left, **on the same row**; a `tertiary`
(usually a docs link) drops to its own row 16px under the pair. Two actions
always share a row — a docs link and a create button are never stacked. The
rows centre under the text and wrap on a phone. `SectionEmpty` and
`PageState` take these slots as `actions={{ primary, secondary, tertiary }}`;
inside `Empty` the buttons are `<StateActions … />`, never `EmptyContent`
around hand-ordered buttons. `SectionErrorState` takes
`onRetry` / `retryLabel` and renders a `secondary sm` Retry button. Both take
`size="compact"` (24px block padding instead of 48px) for narrow cards and
sidebar columns. `Empty` uses the same rhythm at `p-6 md:p-12`. The inline
`SectionError` is a 16px retry glyph + `text-xs` destructive label.

**No results.** A search or filter that matched nothing is `SearchEmpty`
(`ui/data-state-view.tsx`): a `SectionEmpty` with the `SearchIcon` figure and
the copy owned in one place — "No {noun} match “{query}”" with **Clear
search**, or, with no query, "No {noun} match your filters" with **Clear
filters** — a `secondary sm` button like the error state's Try again. `title`
replaces the sentence where the noun won't take "match" ("No activity matches
these filters"), `clearLabel` the button where one control clears both search
and filters; omit `onClear` only where nothing on the page can clear it. On a
page of sections (integrations) it sits in a `Card`, like any in-card state; in
a list card (templates, a gallery) it replaces the list body. Never a hand-composed `Empty` with a search glyph.

**Page states.** A whole page with nothing else to show — an error, an empty
or not-found page, a progress screen — is `PageState` (`ui/page-state.tsx`),
never a hand-built centred column. `size="lg"` is the full-page error (56px
chip, `text-lg` title); `default` a 40px chip over a `text-base` title. The
figure is `icon` + `tone` (an `IconTile`), `pending` (a 20px `icon-tertiary`
Spinner — progress shares the rhythm) or `figure` (the 404 numeral). `fill`
is `viewport` (a screen with no chrome, on the canvas, less any pinned banner
or dev bar), `shell` (60svh of the content area) or `none` (inside a flow
step); `card` holds it in a bordered card (16px sides, 32px block) for a
failure standing in for a whole app. Actions sit in one row 16px under the
text; `children` add detail 16px under them (an error message, setup
guidance); `corner` pins a control top-right (a chrome-less page's feedback).
`role` / `aria-live` land on the state block — the card when `card`.
`RouteErrorState`, `AuthErrorState`, `ApplicationLoadFailure` and
`NotFoundState` compose it; inside a card, a state is `SectionEmpty` /
`SectionErrorState`.

**Stat card.** Title `text-xs` 500 `text-fg-tertiary` + a 12px chevron; a
hover-revealed 14px info icon (tooltip, no delay) when it has a `description`
— a counter whose label is the whole explanation passes none and has no ⓘ; an
interactive card lifts its border to `foreground/15` on hover, and a readout
tile (`interactive={false}`) has neither chevron nor lift. **Value:** a value that doesn't fit
abbreviates before it shrinks. The fit measures the whole row at scale 1 —
value at 30px 600 plus prefix, a 22px suffix, an 8px gap and the 13px delta —
and the most precise compact form that fits wins (`134,612,000` → `134.6M`;
a `$` prefix stays: `$1.21M`), trying 2, then 1, then 0 fraction digits,
never fewer integer digits. Only when the shortest form is still too wide
does the whole row scale down together. An abbreviated value shows the exact
figure in a Tooltip; an exact one has none. Only plain numbers ≥ 1,000
without a suffix abbreviate. **`size="compact"`** is the dense tile for a grid
of secondary counters (an import readout, a panel inside a card): the same
label, inset and 12px label → value gap, with a `text-2xl` (24px) 600 value and
an 18px suffix; `StatsCardSkeleton` takes the same `size`. Use it instead of
hand-building a compact tile. The 30px value is
the only figure that size in the product — a figure in a list row is the
row's `text-base` secondary figure (Sizing → Content rows). **Slots**, for a
tile that says more than one figure (never a hand-built copy of its type
roles): `labelLeading` leads the label 6px before it (a `LegendSwatch` keying
the tile to its chart line); `meta` is a `text-xs` tertiary line 4px under the
value (counts, a p95); `detail` a `text-sm` secondary sentence 12px under that;
`tone` (`success` / `warning` / `destructive`) makes a status tile that speaks
in its status like a status alert — the panel tint (border at 32%, a 4%
fill), the label in the status ink, `detail` in that ink at 80%, the figure
still foreground; `render` swaps the card's element — a `ToggleGroupItem`
inside `ToggleGroup variant="tile"` makes tiles that switch their chart.
`StatsCardSkeleton` takes `meta` / `detail` to reserve those lines.

**Freshness.** A page whose numbers come from a cached snapshot (the
overview) shows freshness as a **control, not a caption**: `StatsRefreshButton`,
a 32px icon button leading the header's action row, **fused into a `Group`
with the first filter picker** (one outer edge, a `GroupSeparator` seam).
Its variant is `auto` by default: it reads its grouped neighbour's
`data-variant` (Button and SelectTrigger expose it) and matches — beside the
`secondary` pickers it is secondary, beside an outline control it is outline
— so it always reads as part of the set it joins. Its glyph is 14px, matching the pickers' leading icons, not the 16px icon-only default.
Fused, its status dot sits on the group's **outer** corner, never on the seam. The age lives in its tooltip ("Updated 2
minutes ago · click to refresh"); refreshing swaps the glyph for a `Spinner`
without disabling the button (that would fade it and swallow the tooltip). A
snapshot is **fresh under 15 minutes**; past that the server revalidates in the
background and the control re-reads the ordinary cached query until the new
snapshot arrives, on page load or in an open tab, showing only the spinner.
The response’s `revalidating` state shows the spinner immediately, including between polling requests. The forced recompute remains click-only. It turns **stale at 60 minutes**
(`STATS_STALE_WARNING_MS`): a healthy page never gets there, so reaching it
means several refreshes were missed. A stale snapshot, or a
failed refresh with a snapshot on screen, turns the glyph `warning` with a
knocked-out warning dot centred on the button's top-right corner; a failed
load with nothing to show turns glyph and dot `destructive`. The page's filters (environment, date range) are header
actions too — never a separate row under the title. It is the one
freshness control everywhere a snapshot is shown — page headers at 32px
(fused with the first filter picker), section and card headers at `sm` 28px
— pass `size="sm"` to `StatsRefreshButton` (and to `CampaignStatsFreshness`,
which wraps it) — fused with the header's neighbouring button: "All
campaigns", "Chart"; it stands alone only where there is no neighbouring
control. The old
"Updated Xm ago" text line (`StatsFreshness`) is no longer used in product UI.

**Sparkline placement.** `floor` (default) runs the trend full-bleed along
the bottom edge and makes the tile taller. `inline` keeps the plain tile's
exact height and pins a smooth sparkline to the card's right edge. It is
absolutely positioned and the lowest layer in the card, so the text keeps the
plain tile's layout and the trend can never change the tile's height or make
the value abbreviate. It keeps the card's top inset and **bleeds off the
right and bottom edges**, like the floor sparkline. **Width:** a tile's free
room is the distance from the right edge of its value row (figure + percent
change) to the card's right edge, less a 16px gap. The trend is that wide,
with no maximum. **Under 72px it moves under the value** instead: full-bleed
along the bottom with no gap under the value, 44px tall (not the floor
sparkline's 64), the tile growing by that less the 12px gap. It moves back beside the value only once the room clears 96px (24px
of hysteresis), and the value column is the same box in both layouts, so a
tile on the threshold doesn't flip back and forth. The room is measured
against the **exact** value, not an abbreviated one. The overview also keeps
its trends under the values below `md`, where its grid drops to two columns
(`StatsCardGroup allowInline`): wider tiles there would otherwise pull the
trends back beside the values. So as the page narrows the layout changes
once, and a narrow tile still shows its trend. **The trend's width is never
state:** its slot is positioned in CSS, from a gap after the widest value to
the card's edge, so the browser sizes it with the card; React re-renders only
when the widest value or the beside/under decision changes, and the sparkline
commits its redraw before paint (`flushSync` in its resize observer). A width
held in state lagged the card by a frame and jittered during a resize. **It starts and ends on an
edge:** it ends on the right border, and (`startAtFloor`) rises out of the
bottom border over the first 14% of its width into the first bucket, rather
than starting mid-air inside the card. **Loading:** the inline skeleton draws
its own placeholder — the same smooth sparkline, rising from the floor and
bleeding off the edges, in the skeleton tint (`foreground` at 12%) — so the
placeholder is the shape it replaces; callers pass no sparkline for it. A
tile that failed to load (a dash for its value) shows no trend. Inline tiles and plain tiles
line up in one grid. **A trend's colour is what the metric means**
(`lib/metric-meaning.ts`), fixed, never by grid position and never by how the
period went — a 4% dip in revenue is still a green line; only the delta says
it's down. Families: revenue **green** (proceeds, MRR, LTV), growth **teal**
(conversions, subscriptions, trials), audience **blue** (users, installs,
opens), rate **amber** (conversion rates, paywall rate — a ratio reads apart
from the counts it divides), loss **orange** (refunds, cancellations, churn,
billing issues; a loss rate stays a loss). The same family sets the delta's
polarity: for a loss metric a rise is the negative (orange) delta. A grid gives every tile the
same room, 16px apart (the overview is 2 across, 3×2 from `md`), and a
`StatsCardGroup` gives every trend the **smallest** tile's free room, so the
trends are always one width, and under 72px they all move to the floor
together.

**Sparkline.** Laid out in measured pixels, never a stretched viewBox (dots
stay circles). 64px tall by default, 1.25px stroke, an area gradient from 22%
to 0; needs at least two points. The bottom inset is `dot radius + ½ stroke`,
the top `max(that, 12% of height)`; end dots are clamped inside the width.
For non-negative data the floor is `max(0, min − 35% of span)`, so the minimum
sits above the floor unless it's near zero; a flat series sits on the floor
when all-zero, mid-height otherwise. **Missing buckets are bridged** — the
line runs on to the next bucket with data, keeping its x, never through a
fabricated zero; a gap in a glance-sized trend reads as a bug. **Series longer
than 32 buckets average down** to 32 (a group is missing only if all of it
is, incomplete if any is), so a year of daily data is one smooth shape; the
full chart is a click away. A lone bucket is a dot of 3px radius (a hollow
ring while still reporting); the reporting tail is dashed `3 2`. **Curve:** `linear` joins
buckets straight (floor sparklines); `smooth` (inline) is a monotone cubic
(Fritsch–Carlson) — it never overshoots a bucket, so smoothing can't invent a
peak or a dip, and the dashed tail shares the settled line's tangents so the
two join without a kink.

**Skeletons.** Read **lighter** than their container: the `Skeleton`
primitive (`bg-foreground/6` with a 6% sweep), or `bg-foreground/6` by hand;
a static (non-animated) placeholder is `bg-foreground/4`. Never a surface
token, never `animate-pulse`. A text placeholder is `SkeletonLine`: the bar
inside its line's box, `width` on the bar, `className` on the box.

**Loaders.** `DotMatrixLoader` (5×5 grid) for full-page states, only through
`AppLoadingMark` / `FullPageLoader`; `Spinner` inline (buttons — through
Button's `loading`, never by hand — rows, refresh),
because the grid is illegible under ~24px — never a raw `Loader2Icon`. A whole
section with no skeleton is `SectionLoading` (a 20px `icon-tertiary` Spinner in
the state block's padding) — never a hand-sized spinner. The
app boot is one loading state: `FullPageLoader` takes over from `index.html`'s
`#boot-loader` and resumes its animation phase (`--dmx-phase`).

**Keycaps (`Kbd`).** 18px tall, `bg-muted` + the border (a chip with both,
like Badge `secondary`), 12px `font-medium font-sans` legend in
`text-fg-secondary` — `font-sans` overrides the base `kbd` mono rule — a
keycap annotates a label, so it stays smaller and quieter than the line it
sits on. A single glyph — letter, `⌘`, `⇧`, `↵`, a 10px icon — is a fixed
18px square, so every key in a row is the same size regardless of the glyph's
width; only word keys (`esc`, `Tab`) grow, with 4px sides. In a field's
trailing addon the keycap hangs 4px into the end padding so it sits 7px from
the edge on all sides. A chord is one `Kbd` per key inside a `KbdGroup` (4px
apart), never `⌘K` in one cap. The legend is **optically centred**, not just
flex-centred: `↵` and the arrow keys are drawn as Lucide icons (a font's `↵`
sits ~1px high in its advance), and lowercase word keys (`esc`) get 2px of
bottom padding to lift their x-height 1px. `Kbd` does both itself — pass the
plain character.

**Disclosures.** One chevron and four triggers (`components/ui/collapsible.tsx`).
`DisclosureChevron` is the only turning chevron: `down` turns 180°, `right`
turns 90°, on `transition-disclosure`, `icon-tertiary` at 14. Inside a trigger it follows the trigger's `data-panel-open` itself;
elsewhere it takes `open`. `CollapsibleRowTrigger` is a whole row that opens
a panel, chevron trailing: `size="row"` is the dense row (16px sides, 10px
above and below a line — ≈40, 56 with a `leading-4` meta line), `size="strip"`
a card's collapsible header strip (48; 66 with a description in a `gap-0.5`
column). It washes `foreground/3` on hover, brightens its chevron with it,
and draws focus on `::before` so a divided list's lines never double and the
row never grows. `CollapsibleStrip` is that header strip when it also
carries actions (a table card's Export and refresh): `CollapsibleRowTrigger`
is itself the button and can't hold other controls, so here the trigger is
stretched over the strip (`::after`) with the `sm` actions above it, the
chevron trailing the title block just before them, the end padding at the
actions' 10px. Open, its bottom border is the divider over the panel; closed,
the border stays but goes transparent, so the strip never changes height.
`DisclosureTrigger` is the inline text variant — a `text-sm`
secondary label led by the chevron, 6px apart — for "show more" inside a form
or card body. A trigger rendered as a Button takes `DisclosureChevron` as its
icon. The accordion keeps its own indicator.

**Trailing controls.** When a row ends in a button, keycap or other boxed
control, the end padding drops to the control's vertical inset (the space
above and below it), not the text's inset — the control should sit equally
far from the top, bottom and end. A collapsible header with a Show/Hide button
is `ps-3 pe-2 py-2`; a code block's filename strip ending in its copy button
is `ps-3 pe-1.5 py-1.5`; a tooltip ending in keys is 4px at the end.

**Todo stepper.** A row can carry a `status` (a non-interactive badge inside
the trigger, 6px before the chevron); `action` sits outside the trigger.

**Copy.** One interaction everywhere: `CopyButton` (a ghost icon button), or
`CopyIcon` + `useCopy` for a custom trigger (`components/ui/copy-button.tsx`)
— the trigger carries `group/copy` for hover-revealed copies. **The copy
glyph takes the trigger's own ink** (`currentColor`): a ghost button's
secondary text brightening to foreground on hover, an outline or link
trigger's text. **The check is the success confirmation, in
`success-foreground` (green)** everywhere — an icon button, a labelled "Copy
data", a key field's addon — with one exception: inside a filled primary
button (the teal "Copy prompt") green on teal has no contrast, so the check
keeps the button's `primary-foreground`. `CopyIcon` does both itself; never
recolour it at a call site. The copy glyph
swaps to the check with the icon swap (`lib/icon-swap.ts`, from buzzkit):
`duration-move` on the strong ease-out, the outgoing glyph to 0.65 scale, 0
opacity and a 2px blur, the incoming one back from the same; the check holds
1.5s. No success toast; a blocked clipboard raises a "Couldn’t copy" error
toast (the Clipboard API falls back to `execCommand` first). Both glyphs share
one grid cell.

Three shapes, all in `copy-button.tsx` — never a local copy wrapper:

- **`CopyButton`**: icon-only by default (`icon-xs` in a code block's corner
  or a field's addon, `icon-sm` in nested UI; `label` is its name), labelled
  with `children` ("Copy", "Copy data") at a text size, `tooltip` to show the
  label on hover, `reveal` for a hover-revealed row action (hidden until its
  `group` / `group/row` is hovered or it takes focus, always shown on touch,
  its 24px box hung over the 20px line). Its click never reaches the row or
  link it sits in; `onCopied(ok)` reports the outcome for analytics.
- **`CopyableText`**: the value itself is the control — foreground text (teal
  is the accent, not a copy affordance), a hover-revealed glyph, focus
  underlines it. `sm` (a 14px glyph) beside body text, `xs` (12px) in meta.
- **A hover-revealed glyph is always the last thing on its line.** It keeps
  its box while hidden (revealing it never shifts the row), so anything after
  it would sit a hidden glyph's width away. Content that follows a copyable
  value — a "Current" badge, a count — goes in `CopyableText`'s `addon`,
  between the value and the glyph; a `CopyButton reveal`, an `InfoTooltip
revealOnHover` and a row's hover actions end their row too.
- **`CopyField`**: a value the user takes elsewhere. `field` is a one-line
  read-only `InputGroup` with the copy in its trailing addon; `block` is the
  whole value wrapping on a `bg-muted` fill, the copy 6px from the top and
  end (a token that must be seen whole). `mono` only for what's pasted into
  code (API keys, signing secrets, a snippet — Typography); URLs, ids and
  third-party tokens stay Manrope. `secret` masks it behind an eye toggle 1px
  from the copy.

`CopyIcon` + `useCopy` remain for a trigger that is none of these (a menu row,
a badge).

**Code in prose.** A chip: `bg-muted`, the border, `rounded-xs`, Roboto Mono
13px, `1px 4px` padding, foreground. It is `InlineCode`
(`components/ui/inline-code.tsx`) — `window.location.origin` in a description,
a masked token in a table — and the `.demand-score-markdown code` rule draws
the same chip for rendered markdown. Never hand-write the classes.

**Motion.** One scale, as tokens in `styles.css` (`@theme static`), so a
component names a role, never a number:

| Role           | Token / utility                       | Value | Used by                                                                                                                   |
| -------------- | ------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| State feedback | `duration-hover` (Tailwind's default) | 150ms | hover, press, focus, open — fill, border, text, icon colour and filter, seams                                             |
| Movement       | `duration-move`                       | 200ms | tab / segmented / filter-tab indicators, chevron turns, accordion and collapsible height, sidebar collapse, the icon swap |
| Popup          | `duration-popup`                      | 150ms | popover, tooltip, preview card (enter at scale 0.98 + opacity)                                                            |
| Dialog         | `duration-dialog`                     | 200ms | dialog, alert dialog and their scrims                                                                                     |
| Sheet          | `duration-sheet` + `ease-drawer`      | 250ms | sheets and their scrim                                                                                                    |
| Toast          | literal                               | 500ms | stacking toasts (unchanged)                                                                                               |

Easing: `ease-out` is the strong ease-out `cubic-bezier(0.23, 1, 0.32, 1)`
and is the default for every transition — 80% of a 150ms change lands in
~40ms, so feedback reads as instant yet still eases in. `ease-in-out` is
`cubic-bezier(0.77, 0, 0.175, 1)`; `ease-drawer` is
`cubic-bezier(0.32, 0.72, 0, 1)` for anything that slides like a drawer.
Never `ease-in` and never `ease-linear` on UI (a progress bar may be linear).

Rules:

- **Never `transition-all`.** Name the properties.
- **One clock per state change.** Every property that changes when a control
  changes state — fill, border, text, the icon's colour, a group seam, a
  hover-revealed overlay — transitions together on
  `duration-hover`. Nothing may snap beside something that eases.
- **Children don't keep their own clock.** An icon that inherits its colour
  is _not_ re-transitioned — a child easing an inherited colour re-eases
  every frame of its parent's transition and trails it. An icon that also
  turns uses `transition-disclosure` (turn on the move clock, colour on the
  hover clock), never `transition-transform` alone. A
  disclosure chevron is `DisclosureChevron`, never a hand-rotated icon.
- **Washes over a fill ease too.** A hover wash laid over a fill (secondary
  button and picker, framed-table cells, interactive tiles) is a gradient on
  Tailwind's registered `from-*`/`to-*` stops, transparent at rest — a
  `bg-[image:…]` swap can't interpolate and snapped while the border eased.
- **Keyboard-driven surfaces don't animate.** List-popup rows (select,
  combobox, autocomplete, menu, command) highlight instantly, icons included,
  because the highlight follows the arrow keys; the command palette (⌘K)
  opens and closes with no transition. List popups themselves open instantly.
- **Hover is colour, not motion.** No press transform, no hover scale or
  translate.
- **Tooltips:** 150ms in, and instant (`data-instant`, no transition) when
  moving between adjacent triggers.
- **Reduced motion** is global: under `prefers-reduced-motion: reduce` every
  element keeps only colour, fill, opacity and filter transitions, so overlays
  fade instead of scaling or sliding and indicators jump. Looping movement
  opts out with `motion-reduce:animate-none` (skeleton, progress shimmer).

Skeleton sweep 2s, shimmer 1.5s. The one attention effect is `variant-flash`:
a 6.5% foreground wash held for the first ~480ms, then eased out over the
rest of 1.6s; it paints under the content (the host needs
`position: relative`; it uses `isolation` and a `::before` at z-index −1).

---

## Component checklist

Apply every line to any component you build or touch. It condenses the rules
above; when a line and a section disagree, the section wins and this list gets
fixed.

**Tokens**

- Surfaces: `bg-background` / `bg-card` / `bg-popover` / `bg-muted` /
  `bg-secondary`; hover and highlight wash `bg-accent`; overlays dim with
  `bg-scrim`. Text: `text-foreground` / `text-fg-secondary` / `text-fg-tertiary`
  (= `text-muted-foreground`) / `text-fg-muted`. Edges: `border-border` (=
  `border-input`). Muted icons: `icon-tertiary`.
- No hex, no `white`/`black` utilities, no palette utilities (`text-emerald-400`,
  `text-orange-300`) — status colours are `destructive` / `success` / `warning`
  / `info` and their `-foreground`; chart colours come from `CHART_COLORS`.
- Never stack an opacity modifier on a token that is already a tint
  (`text-muted-foreground/72` → `text-fg-muted`; `bg-input/32` → a real token).

**Geometry**

- 3px corners from the scale (`rounded-sm`…`rounded-2xl`); never
  `rounded-[Npx]` or `rounded-none` on a control. Circles `rounded-full`; app
  icons `rounded-app-icon`.
- Fill **or** border on controls; fill **and** border on panels.
- No `shadow-*`, no `ring-*`, no `backdrop-blur-*`.

**Size** — heights are the button ramp: 24 / 28 / **32** / 36 / 40px, and the
control fits its context (Sizing → Size by context). A default control is
32px; a header strip is 48, a table row ≈ 40, a footer strip 56. Never hand-set
a height on a control, strip or row — the primitive owns it. A frame holding items (segmented control, toolbar,
default tab list) is 32px: 1px border + 2px padding + 26px items, 2px apart,
3px corners on frame and items; a separator inside gets 4px each side.

**Icons & spacing** — from the table in Iconography, keyed by control height:
icon size, edge → icon (1px less than edge → text), icon ↔ label. Icons sit
0.5px above the label's cap-height middle. Lucide only; redrawn glyphs from
`components/ui/icons.tsx`.

**Spacing** — one step of the closed scale per relationship (see Spacing),
owned by the parent's `gap-*` / `space-y-*`, never a child's margin; no
`[Npx]`, no call-site tightening of a primitive. Title → description 2px when
the stack is the message or heads a card, 4px heading an overlay. Controls 0 fused,
8 in one set, 16 as separate commands. Label → control → hint 8; fields 16
apart, fieldsets 24; page blocks 24; cards in a grid 16.

**Type** — every size is a role from Sizing → Type roles (a card title is
`text-sm` 500 wherever it sits); `text-xs` is 13px; weights 400 / 500 / 600 only; a label that turns
medium on state uses `faux-medium`, never `font-medium`; no eyebrows, no
italic; clipped single lines use `Truncate`.

**State**

- Hover only on things that respond to a click — a static row, panel or card
  never washes on hover — and every clickable thing has the pointer cursor.
- Hover: a colour wash, never motion — `bg-accent` on controls,
  `bg-foreground/3` on rows; text/icon brightening pairs `text-foreground` with
  `filter-none` on `icon-tertiary` icons.
- Focus: the border turns `primary` (see Focus). No rings.
- Selected / active: `text-primary` with a `bg-primary/10` tint or a `primary`
  edge — never a ring.
- Invalid: `destructive/36` border (full `destructive` while focused), the
  placeholder `destructive-foreground/60`, and every internal separator
  follows the outline. **Invalid cascades to every child**: chevrons, affix
  and stepper icons take `text-destructive-foreground` under their
  `icon-tertiary` fade (the placeholder's muted red); affix text goes
  `destructive-foreground/60`; a label wrapping an invalid checkbox, radio or
  switch — and a Field label on an invalid field — turns
  `text-destructive-foreground`; an unchecked invalid switch's thumb goes
  `destructive-foreground/60`. **The one exception** is the InputGroup
  placeholder, which stays muted.
- Selected / active items have **no hover state** — a selected filter tab,
  pressed toggle, checked option card or current breadcrumb doesn't react to
  the pointer (`not-data-active:hover:…`, `not-data-pressed:hover:…`,
  `not-has-data-checked:hover:…`). Hovering what's already chosen changes
  nothing, so it mustn't look like it would. **One exception:** the sidebar's
  nav rows keep their hover wash while active (Components → Sidebar) — you
  click a nav row and it becomes active under the cursor.
- Everything clickable shows the pointer cursor. A base rule in `styles.css`
  (wrapped in `:where()`, so any utility overrides it) covers `button`,
  `select`, `summary`, `label[for]`, labels wrapping a checkbox / radio /
  switch, checkbox / radio / file inputs, and the roles `button`, `tab`,
  `menuitem(checkbox|radio)`, `option`, `switch`, `checkbox`, `radio`,
  `link`, `treeitem`; `<a href>` gets it from the browser. It skips
  `:disabled`, `[aria-disabled=true]` and `[data-disabled]`, which get
  `not-allowed` instead (a pending button: `progress`); `Label` itself sets
  `cursor-not-allowed` around a disabled control. Never write
  `cursor-default` on something that responds to a click.
- Disabled: `opacity-50` and the `not-allowed` cursor, no separate colours. A disabled control keeps its pointer events — so the cursor shows and a tooltip can explain it — and never reacts: the app's `hover:` variant excludes `:disabled`, `[aria-disabled=true]` and `[data-disabled]`, and a base rule in `styles.css` sets the cursor. Never `pointer-events-none` or `cursor-default` for disabled.
- Every colour change — fill, text, border, separator, icon fade, overlay —
  is `transition-colors duration-hover` (icons get the filter from the base
  rule), identical across all parts of a control so nothing lags or leads
  (see Motion).
- A translucent edge only matches another if both sit over the same fill: draw
  seams as a part's own border over its own fill.

**Scroll** — anything that scrolls inside a component gets `scroll-fade` /
`scroll-fade-x`, on an element **without** a border (frame outside, scroller
inside).

**Overlays** — floating surfaces are `bg-popover` + border, no shadow; modal
scrims are `bg-scrim`, no blur; dialogs and sheets scroll through
`DialogPanel` / `SheetPanel`.

**Documentation** — every primitive has a `/dev/design-system` section showing its full state
matrix (the coverage test enforces presence). Change this file in the same
change as the code.

---

## How the design pass works

The pass runs one section of `/dev/design-system` at a time. For each section: the reviewer
comments; the components, this file and `/dev/design-system` are updated together; when the
section is signed off, this file's `version` date is bumped. Fixes found
along the way that aren't design (behavioural bugs) are fixed in the same pass
and listed in the round. superwall.com's published `design.md` is replaced from
this file once, at the end.

---

## Do's and don'ts

1. **No shadows, no rings, no blur.** Depth from surface steps, the border
   and type. Focus and selection recolour a border. Shadow scales pin to
   `0 0 #0000`, never `none`.
2. **One 3px corner.** Carve-outs round fully or use a source ratio. No third
   radius.
3. **One border.** `border-border` everywhere; no second control edge, no
   hardcoded white borders, never doubled.
4. **Fill or border for controls; both for panels.**
5. **Tokens, not values.** No hex, no hand-picked greys, no raw opacities for
   text (`text-fg-*`); an icon takes its text's colour at `--icon-alpha`, never an opacity of its own.
6. **One accent.** Teal for the single most important beat. `bg-accent` is a
   hover wash, not the brand. One per view, not one per page: the same action
   repeated (a header button and a closing call to action on a long page)
   keeps the same look everywhere — never demote a copy to grey.
7. **Three weights, and state never changes width.** 400 / 500 / 600;
   `faux-medium` for active labels.
8. **No eyebrows, no italic.**
9. **Hover is colour, not motion.** Rows wash `foreground/3` (sidebar rows
   5%), controls `bg-accent`, secondary controls lay `foreground/3` over their
   card fill; `duration-hover`, every part on the one clock; no scale or
   translate.
10. **Every mode branch or it didn't happen.** A token that differs by mode is
    defined in every cascade branch (`:root`, `.dark, :root.dark`, the
    `prefers-color-scheme` fallback).
11. **Accessibility is part of the look.** 4.5:1 body, 3:1 large text; icon-only
    buttons carry an `aria-label`; decorative SVGs are `aria-hidden`.
12. **Mobile is a first-class target, not a fallback.** Design every surface
    for a phone and for touch at the same time as for desktop, and check it
    at a phone width before calling it done. Three questions every time:
    - **What does touch do with no hover?** Anything revealed on hover
      (row actions, a tile's toolbar, copy buttons, info icons) is always
      shown on touch (`pointer-coarse:opacity-100`), never hover-only. A
      tooltip is never the only way to reach information.
    - **What gives way when it doesn't fit?** Labels drop to icons, columns
      drop (`useShellBreakpoint`), rows stack, controls take a strip of their
      own — actions never vanish behind hover, never move into the page
      header, and never fold into an "…" menu just for being narrow.
    - **Can a thumb hit it?** Nothing grows on touch — sizes are the desktop
      sizes. Targets reach 44px through `Button`'s invisible
      `pointer-coarse:after` hit area; keep targets apart, and keep whole rows
      and tiles tappable (`rowLink`, stretched title links).

---

## Open issues

Places where the code still breaks a rule above. The rule is right; the code
is what changes. Last audited 2026-09-24.

**Primitives**

- `Input`'s text inset is 8 / 10 / 10px (`sm` / `default` / `lg`), not the
  table's 10 / 12 / 14 that Select, NumberField and Textarea follow.
- Combobox and autocomplete leading icons sit 8px from the text; field
  affixes are 10px.
- InputGroup's invalid border keys on `[aria-invalid]` (present) while its
  cascade keys on `[aria-invalid=true]`, so `aria-invalid="false"` still reads
  red.
- A framed table's keyboard focus is invisible: the row's `foreground/5` sits
  under the cells' opaque `bg-card` (hover and selected are drawn on the
  cells; focus isn't).
- `Slider` has no pointer cursor (no `role="slider"` in the base rule).
- The menu popup has `not-dark:bg-clip-padding` (light mode only).
- Rings survive in `SidebarMenuAction` / `SidebarGroupAction`
  (`focus-visible:ring-2`) and the `/dev/design-system` Foundations
  specimen that still shows `ring-2 ring-ring` as the focus treatment.
- `sidebar.tsx` keeps a dead `md:peer-data-[variant=inset]:shadow-sm/5`, and
  its `setOpen` calls `await localStorage.set(...)`, which doesn't exist, so
  every toggle throws after updating state and the open state is never saved.
- Toggle isn't on the icon table (16/18px glyphs at 32px, `-mx-0.5`).
- The item-level `variant` / `size` on a `ToggleGroup` item is ignored (the
  group's context always wins).
- The sheet's close ✕ has no tooltip; the dialog's has "Close · esc".
- The slider thumb's 1px primary focus border is faint where it meets the teal
  range; if review finds it too weak, it needs a 2px thumb exception.
- Code in prose has no primitive — only `.demand-score-markdown code`.
- Combobox and autocomplete empty rows pad 8 × 8 (`p-2`), not the list row's
  10 × 4 (the text is centred, so only the height shows).
- The sidebar has no size for a row whose label wraps to a second line; its
  rows are a fixed one-line 32px.

**Motion**

- Meter and progress fills animate `width` over a literal 500ms.

**Call sites**

- Off the Sizing ramps (audited 2026-09-24; phase 1 fixed the primitives,
  the overview, the campaigns list, top-bar titles and canvas section
  actions): ≈15 `text-base`/`text-lg`
  card titles, ≈30 `text-xs` table cells, hand-set
  control heights and 16px glyphs beside `text-sm` across admin, integrations,
  users, settings, paywalls, products and charts. (The campaign editor was
  moved onto the ramps on 2026-09-25.)
- Two header strips are still hand-built. `StoreImportCard` is a disclosure
  plus trailing actions and wants `CollapsibleStrip`, as the campaign
  editor's Users tables now use. The event detail's attempts header isn't a
  card strip: it is a column header on a grid of collapsible rows (a
  `<tbody>` can't hold them).
- Command palette sub-pages draw two stacked 1px lines (the input's `border-b`
  and the empty filter strip's `border-t`).
- ≈15 `text-foreground/NN` call sites still stack opacity on a text tint
  instead of taking a step of the text ladder.
- The welcome artwork (`NewDashboardWelcomeArtwork`) keeps `text-foreground/70`
  and `text-[Npx]` sizes: it is a miniature captured to PNG, not live chrome.
- `SIcon` has 68 names with no art (incl. `logo-full`).
