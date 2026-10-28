# Shinsa design system

Shinsa's UI follows **paywall-next's Application register**; the kit itself (tokens and primitives
in `packages/ui`) is Buzzkit's, which shares paywall-next's rules. The full paywall-next
specification follows below, unchanged; where it names its own files (`components/ui/*.tsx`,
`styles.css`), Shinsa's are `packages/ui/src/components/*.tsx` and
`packages/ui/src/styles/globals.css` (18 below has the layout). `/ui` renders every token and kit
component in both themes, and Shinsa's shared building blocks and feature pieces (5); when this file
and the code disagree, fix one of them in the same change. `docs/design-system.md` restates this system as one
self-contained file for agents outside the repo (published as `shinsa.dev/design.md`, its token, icon and lint tables
generated from the source); a change here changes it too.

## Where Shinsa differs

Only these, and they win over anything below:

1. **Font.** ABC Areal (variable) for everything, ABC Areal Mono for code. Read every mention of
   Manrope as ABC Areal and of Roboto Mono as ABC Areal Mono. The files are in
   `packages/ui/src/styles/fonts` (Dinamo licence). ABC Areal Mono has no box-drawing glyphs and draws its
   triangles two cells wide, so the family takes those two blocks (U+2500–257F, U+25A0–25FF) from Menlo, or DejaVu
   Sans Mono, scaled to its 0.61em cell (`size-adjust` in `globals.css`): a text diagram keeps every column.
   Until the files load, "ABC Areal Fallback" and "ABC Areal Mono Fallback" (Arial and Menlo with Areal's
   width and vertical metrics) hold the lines where Areal will set them, so nothing moves when it swaps in.
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
   the health banner's card, the choice buttons, the confirm dialog, Home's composer) are on
   `/ui` under Shinsa composites (smart links are not), and so are the feature pieces, each in
   every state from sample data: the setup steps and the finished page (`routes/ui/onboarding.tsx`, 24), accounts (usage bars and figures, the usage menu, account status, the
   percent and sign-in dialogs at each phase, the Run on account choices and the run label's account), the
   overview's now cards on `NowFrame` (setup, sign-in, usage wait, wait, secret, paused for a failure, a cost
   limit and a wait out of checks, a question with choices, an escalated review's verdicts, a revised plan),
   the quiet-agent note, the suggested tasks and delegations panels, the chat's delegation cards and report rows,
   notice rows and context meter, the schedule and notification rows, the MCP, plugin and skill
   rows in every state (29), and the Code tab's pieces (`routes/ui/code.tsx`: the `--code-*` tokens, one snippet as a
   chat fence beside the editor, a diff side by side with its new side editable, the same diff unified with a spot,
   a blocking finding, a suggestion finding and a comment inline, and Go to file on `QuickOpenDialog`, 32), and the
   Checks list in each state (`routes/ui/checks.tsx`, on `routes/ui/sample-checks.ts`: running, all passed,
   failing, passed when re-run alone, already failing on main, an agent's check, the repository's baseline, CI after the
   pull request, a linked test, the plan's Checks, check activity and Always run before review), the
   Review tab's Evidence panel (`routes/ui/evidence.tsx`: `EvidencePanel` with a before and after pair, a recording,
   a test the agent linked (read as its check), a check Shinsa ran and a markdown note with a table, and a second panel
   after a revision: a shot marked "Updated after your review" with the replaced shot and a removed note under Earlier
   versions, on sample files in `apps/web/public/samples/evidence` that
   `scripts/seed-media/generate.ts` renders, 34), and the error fallbacks in their three sizes (`routes/ui/errors.tsx`,
   38). A piece that reads live state has a
   presentational part that takes props (`UsageMenuButton`, `SignInPrompt`, `RunAccountLabel`,
   `AccountChoiceList`, `ContextGauge`, `HealthCard`, `NotificationGroup`, `ScheduleRow`, `EvidencePanel`), and every action
   there takes a callback, so `/ui` never opens the connection or sends anything: an action only shows a
   toast. Still checked only in the app, since they need the live state or a transcript: the rail and the
   queue, the work card's live feed, the review and merge cards, the chat's run sections and live card, and ⌘K.
6. **Long panes get an overlay scrollbar.** `ScrollArea` keeps native wheel, trackpad
   and keyboard scrolling and draws a thin thumb (`fg-a1`) that fades in on hover or scroll,
   lingers briefly, widens under the pointer and can be dragged; a press on the bare track centres
   the thumb there. The geometry is `lib/scroll.ts`, shared with `ScrollFade`. The task chat scrolls in one;
   other scrollers keep the hidden-scrollbar rule below.
   **Content fades where it scrolls under something.** There is one fade: the kit's `scroll-fade` mask
   (`ScrollArea`'s `fade`, on by default, or `ScrollFade`), 24px at whichever edge still hides content, never a
   gradient overlay, so it needs no colour and works on every surface. Every page whose body scrolls under a header
   uses `PageScroll` (`components/layout/page/page-scroll.tsx`, a `ScrollArea` with the fade): Home, Settings and
   the task's Overview. The task chat keeps its own `ScrollArea` with the fade on, so its
   content fades under the header at the top and into the composer at the bottom; the composer draws no gradient of
   its own. **Scrolling never repaints the fade.** The mask sits on a still box around the scroller
   (`data-fade-scope`), not on the scroller, so it is painted once and the content scrolls under it on the
   compositor; a mask on the scrolling element made the browser repaint the whole chat on every scroll frame
   (`docs/performance.md` → Chat, overview, review and lists). **A fade is right on the first painted frame.** The
   scroll position drives it through a scroll timeline (globals.css → Scroll edge fades): the scroller inside
   (`scroll-fade-source`) names its timelines, the box scopes them (`timeline-scope`), and each edge's fade grows
   over the first 24px of travel toward it, decided by style alone, never by a measure, an observer or a transition
   after the content renders. The names are unique per `ScrollArea` and `ScrollFade` (`resolveFadeTimelines`,
   `lib/scroll.ts`), so a scroller inside another never answers for it. `ScrollFade` renders the box in its markup,
   or masks a `targetRef` itself in a layout effect (render it after its target); a bare `scroll-fade` reads its
   own element's timelines, which is right for a clipping element that does not scroll (`CardAction`). A browser
   without scroll timelines, and that clipping element, fall back to the `data-overflow-*` attributes `ScrollArea`
   and `ScrollFade` set on the masked box.
7. **The task chat follows Kanna's transcript.** One centred column the composer's width; every
   item is a row box (`py-2 mb-1`, 20px from item to item) on the column's left edge. Agent text is full-width
   `prose-chat` markdown (13px, 1.625 leading, 20/12px paragraph margins, highlighted code fences in the Code tab's
   `--code-*` colours, 32).
   - **One line anatomy.** Every one-line row in a run is the same chat line (`components/chat/chat-line.tsx`):
     a 20px row (`h-5`), a 20px icon slot (`IconSlot`, `components/layout/surface/icon-slot.tsx`) holding a `sm`
     (14px) icon in its text's ink, 8px from the glyph to the label (the slot's 3px plus `me-1` and `gap-px`), the
     label in `text-xs` medium `fg-3`, then the meta in the same `text-xs`, `fg-2`, after " · ", truncating first
     (a string meta ends in an ellipsis; the role header's run headline is a `Truncate`, so a headline cut short shows in
     full in its tooltip). Rows that open (`ExpandRow`) show the chevron on hover and hang their detail off a
     hairline rail (`DetailRail`) centred under the icon slot, the detail starting on the label's 8px line; a fold
     (`FoldLine`: a group of tool calls, the worked-for row) puts its chevron in the icon slot. The role header,
     every notice, the worked-for row, the brief, tool rows, delegation report rows and the round divider are all
     this line, so they share height, text size, text colour step, icon box and the 8px gap. Measured in the app
     (1280px and 900px, both themes): 20px high, 13px text, label `fg-3`, meta `fg-2`, icon 14px in a 20px slot,
     8px from glyph to label. Rows are 8px, not the 4px they had, so their labels start on the same line as the
     card titles between them (38px into the column); at 4px the labels sat 4px left of every card title and the
     icon-to-text step changed from row to card.
   - **One icon column.** Every icon in the chat sits in one column: the 20px slot 13px into the column, which
     is a card's 1px border plus its 12px inset, so a chat line's icon and the icon of the card header under it
     share their centre (23px into the column, measured). The column sets `--chat-inset` (`CHAT_COLUMN`) and
     everything that is not a card takes it: chat lines, errors and the round divider as `ps-(--chat-inset)`
     (`CHAT_INSET`), the agent's text as `px-(--chat-inset)`, so it starts on the card body's text (13px). Cards
     and your bubble stay on the column's edges. Inside an opened delegation card the conversation's inset is the
     card's 12px alone (`CHAT_NESTED`).
   - **Card headers** (hand-over cards: Asked you, Set the steps, Proposed the plan…) are one `CardLine`: a 36px
     band on `bg-bg-a1`, `ps-3 pe-3`, the 20px slot and 14px icon on the card's 12px inset, the title 8px after the
     glyph (`gap-1.25`) in `text-xs` medium `fg-4`, the meta in `text-xs` `fg-2` at the right. The Overview's
     `Panel` header (`CARD_HEADER`) is the same band, slot and 8px. A delegation's spawn card and the live card's
     row use the same band and slot. Inside a card, an icon that leads a row sits in the same 20px slot on the
     same 12px inset (an alternative in a review card, a delegation's question, the live feed), and a 20px tile (`StatusTile`
     `md`, `StepNumber`) is that slot: so the header's icon and every row icon under it share one centre.
   - **The role header** introduces a run as a chat line: the role's icon and its name in plain words as the
     label (from `RUN_ROLE` in `lib/chat/run-role.ts`: Agent `IconAgent`, Reviewer `IconShieldCheck`, Answerer
     `IconBubbleText`, Investigator `IconMagnifyingGlass`, Researcher `IconBook`, and for delegated helpers Planner
     `IconMap` and Builder `IconHammer`), then as its meta what it did ("Phase 1 of 2: …", "Answered your
     question") and the account the run used, "· a@b.com" (26). A round has one agent, so the chat reads as that
     agent working through it: every run of the round is headed "Agent", once per run, and its meta says what that
     run did from its `purpose` (`resolveRunHeadline`): "Planning the work" / "Planned 3 phases", "Phase 2 of 3: …"
     (`phaseIndex`), a fix named by the first words of its instruction after the house rules ("Fixing the failing
     checks", "Making your changes"…), "Running the operation" / "Reported the outcome". Elsewhere (the now card, a message link, a
     delegation) the role shows as `RoleMark`. No hairline and no model or time: runs are set apart by space
     alone. When your message started the run, your bubble sits above its header, so you speak, then the agent
     answers. A delegated agent never gets a header of its own: it is a card inside the turn of the agent that
     delegated it, with the same role mark (26). The chat renders the chat protocol (`docs/engine.md`), never a
     provider's tool names. A message you send after a run ended belongs to the run that answers it
     (`resolveRunMessages`); one no agent answers (noted as needing no reply, or not delivered) stays under the run
     before it, and a finished run's summary is never repeated under a message the next run has not
     picked up yet (`resolveClosing`).
   - **While a run works** it shows one live card (`rounded-xl`, `bg-card`): the agent's latest
     interim message (13px, four lines at most) over a quiet `text-2xs` line with a pulse, the
     latest step in the words its tool row uses ("Running bun test", "Reading app.tsx",
     shimmering), the time and the step count. The step stays named after it finished until the
     next one starts, so the line never flickers between steps; it says "Thinking" only once the
     agent wrote after its last step (no provider sends a thinking signal), "Starting" before
     anything happened. Shimmering text sets `leading-normal` on its truncating box
     (`SHIMMER_LINE`): the kit's `leading-none` would clip descenders. A new message
     swaps in: the old one slides up and fades, the new one rises in from below, and the card's
     height eases; under reduced motion it simply changes. The line opens the card onto
     everything so far. Opened, the newest folded group keeps one row under it for its latest
     call, running or just finished, and each new call takes that row's place, so a step never
     grows and then shrinks the card.
   - **When a run ends** the work folds into one chat line, the chevron then "Worked for 3m" and the meta
     "14 steps", and the
     final reply sits under it as the main content (the last interim text when a run has none).
     Hand-over cards (plan, phase, fix, review, question) and errors stay outside the fold; the
     brief from Shinsa lives inside it. A turn that ends in a hand-over (a plan, phase, fix, review,
     answer, diagnosis, report, outcome or new set of steps: core's `isHandOverTool`) shows that card
     as its reply and nothing under it: any text the agent wrote around the hand-over (a "Done." or
     "My answer is above") folds into the work, so the same reply never shows twice
     (`resolveTurns` in `lib/chat/timeline.ts`). A question or suggested tasks are not the step's
     hand-over and keep the reply under them. A message from you starts a new turn with its own fold.
   - **The detail** is the full log on a hairline rail under the worked-for row's chevron: interim messages,
     then tool calls as chat lines, the chevron on hover; two or more in a row fold into one row ("Ran 3
     commands and read 2 files"), and an opened row hangs its detail off a hairline rail.
   - **A hand-over Shinsa hands back is quiet.** When Shinsa rejects a hand-over for its rules (a field over its
     length limit) and the agent calls the tool again, the rejected call folds into the work as an ordinary tool
     row with the meta "Retried" ("Retrying" while the run works and has not called it again), its icon its
     own; opened, the reasons show under "Handed back" in the normal ink (`foldRejectedHandovers` in
     `lib/chat/timeline.ts`). Only a failure nobody recovered from is red: the row's icon, "Failed" and the
     reasons under it. A question is never folded.
   - **Your answer** under an answered question is the answer alone ("Your answer  Shinsa’s projects"): the
     words the agent reads around it ("The human answered: ") come off with core's `readAnsweredReply`, the
     reader of `resolveAnsweredReply`, which writes them. Commands, reads, writes and
     edits render highlighted (language from the file extension), an edit and a write as a diff (`CodeDiff`, 33),
     long output capped with "Show N more lines"; images from tool results and evidence show as thumbnails
     that open in the image viewer.
   - **The image viewer** (`components/overlays/image-viewer.tsx`, `hooks/use-image-viewer.ts`) opens every image in
     the chat and in evidence: attachments, tool results, evidence, and an evidence recording, which plays only there
     (`controls`, autoplay; no zoom or pan). A `black/85` backdrop, the image fitted to the window (never upscaled)
     and morphing out of its thumbnail. A recording never morphs: it mounts at its fitted size, from the thumbnail's
     own `videoWidth` or a hidden probe's metadata, with that width and height set on the element, so Chromium lays out
     its controls once at the right width; scaling a video while it opens leaves its controls at the size they started.
     Click toggles fit and 100% (2× for small images) around the pointer, and so does a double-click; the wheel, a
     trackpad pinch or a two-finger pinch zooms toward the pointer; drag pans while zoomed; `+`, `-` and `0` zoom from
     the keyboard. Arrows (on screen and the arrow keys) step through the images of the same message or tool group,
     or, in evidence, item by item. **Stepping is a cross-fade, never the open run again**: the incoming image or
     recording appears at its own fitted size from the first frame (its size read from its thumbnail, or held back
     until it has loaded while the outgoing one stays put, so the stage never goes empty and nothing morphs from the
     last image's size), and fades in over the outgoing one, which fades out as it was (zoom and pan included); a step
     moves both 10px in the direction of travel over 200ms on `cubic-bezier(0.23, 1, 0.32, 1)`, and zoom and pan reset
     to fit at once. Switching parts of one comparison (the bar's `Choice`, or an arrow that lands on the next part)
     is the same view, so it does not slide: the incoming part fades in over 150ms on top of the outgoing one, which
     stays opaque under it when the two share a rect, so the stage never dims. Under reduced motion every swap is the
     150ms fade with no slide. A press during a swap takes over from where the images are (`commitStyles`, no queued
     or stacked animation), the decisions are `resolveSwap`, `resolveSwapMotion` and `isLeavingHeld` in
     `lib/image-view.ts`, and the bar keeps one width while there is more than one image (`w-xl`, the caption
     truncating in the space left), so the counter, zoom and parts swap their text without moving it. A close button, Esc or a click on the backdrop closes it. **Everything moves
     together, and the close is the open run backwards**: the backdrop and the chrome (buttons, the bar) fade over 240ms
     on `cubic-bezier(0.22, 1, 0.36, 1)` while the image, opaque the whole way, flies between its thumbnail and the
     window on the same curve and duration. The flight (`resolveLanding` in `lib/image-view.ts`) is one transform that
     keeps the image's aspect (a translate and a single scale, never a stretch) onto the image the thumbnail draws (its
     `object-fit` box), and a `clip-path` inset to the part of it the thumbnail shows (a cover crop, a scrolled or
     clipped parent, the window), with each corner rounded like the thumbnail's or the clipping card's corner it sits
     on. Closing starts from where the image is on screen, zoom and pan included, and lands on the thumbnail of the
     image open now, measured at that moment (after stepping or scrolling, it is not the one you opened); the
     thumbnail stays hidden until the image lands on it and shows in that frame, so nothing flashes or doubles. With
     no thumbnail in view (scrolled away, gone), the image fades out while it shrinks to 96% where it is, and opens
     the same way. The open waits for the portal to mount before it animates, so it never falls through to the next
     render. A recording, and anything under reduced motion, only fades. The viewer is laid
     out under `.dark`, so its chrome reads the same on the black in both themes (a `.dark` region reads dark aliases too:
     `globals.css` declares every alias, `foreground`, `popover-foreground`, `muted-foreground`, `primary-*`, `code-*`,
     on `:root, .dark`, so it resolves against the region's tokens): Close, Previous and Next are the
     kit's `Button` (`outline`, `icon`, 26px with a 16px glyph), and the bar at the bottom is a `rounded-popup`
     `bg-popover` `shadow-3` strip (`h-8`, `text-xs`, `popover-foreground`; never a pill) with the caption (attachment name, evidence
     title and facts, or file name), "2 of 5" (items, not files), the zoom level and, on a comparison, a `Choice` of its
     parts (Before, After, or each state's label) that switches the image in place.
   - The user's own message is just its bubble (`rounded-3xl`, `border border-border`, `bg-muted`, `px-3.5 py-1.5`);
     attachments sit above it as thumbnails, or as file chips when the browser can't load the path.
     `?tab=chat&run=<id>` scrolls to that run and washes it in `primary-a1`, with a 2px `primary-a1` outline
     outside its box so the wash wraps the full-width content instead of sitting flush with it; a delegation card
     opened from a link takes the same wash (`SELECTED_WASH` in `chat-line.tsx`). It fades with the wash. The run's
     box hugs its content: its first row's top spacing and its last row's bottom spacing sit outside it, as the
     section's own margin (`SECTION_EDGES` in `run-section.tsx`), so the wash is the same 2px on all four sides of
     the message and its cards, never a deep band under the last card.
   - **A task in rounds stays one chat**: a quiet divider with a hairline marks where each round starts
     (`RoundDivider`, 30); nothing folds, so a run of any round is always on the page.
8. **One queue, two sizes.** `components/queue/queue.tsx` is the only list of tasks by what they
   need: Needs you (every open decision in focus, in `resolveQueue` order, which `docs/engine.md` →
   Scheduling owns: priority, then what it unblocks, then the kind of decision, then age), In progress,
   and Waiting on another task (in chain order, collapsed). Every section holds only the focus project's
   tasks: the focus is the filter, and the way to see other work is to switch it. The last two take their
   title, icon and tone from the All tasks roadmap (`lib/tasks/roadmap.ts`, see 16; the sections are `lib/queue.ts`), so the two never disagree. Home
   renders it `wide` under the composer: a `text-2xs` label over a `rounded-xl` card, each row a
   20px gate or stage tile, title, status line and age. The guide above is a short summary of
   these sections, never a replacement: a task the guide names is still listed in its section below.
   **Home's order** reads what needs you, what is moving, what just happened, then the long tail:
   the greeting, the guide and the composer, then Needs you, In progress, Recently finished
   (merged or done in the last 24 hours, five at most), Recent conversations (the latest agent message
   of five tasks, opening their chat) and Waiting on another task. Recently
   finished is closure news, so it follows the work still moving; Recent conversations is how you
   jump back into a chat, a step after the news; Waiting, the section that starts collapsed in the
   compact queue, goes last, where a long list can never push the timely ones off screen
   (`resolveHomeSections` in `lib/home.ts` splits the queue around it). **A task shows in one section only**:
   the queue's sections own their tasks, Recently finished leaves those out, and Recent conversations shows
   only tasks no other section holds (its five are picked after that), so a finished task is in Recently
   finished and never again under Recent conversations. What the guide names plays no part in this:
   every section lists its tasks whether or not the guide leads with them, links or quotes them.
   The rows of Recently finished and
   Recent conversations start with the task's handle like the queue's (`TaskHandlePrefix`,
   `components/task/handle.tsx`). **The focus filters all of Home**: the guide, every section, every
   count and every row (Recently finished and Recent conversations through `isInFocus` in
   `lib/focus.ts`, the rest through `resolveQueue`). Picking a project or All work in the Focus menu (the current focus checked)
   redraws the whole page from the next state push. Nothing on Home or in the queue button's list shows
   work from other projects, and ⌘K's decisions across tasks follow the focus too; only Jump to a task, a
   search of every task, reaches past it. **Every Home section folds** from its `SectionLabel` header (a chevron, `aria-expanded`), is
   open until you fold it, the long tail included, and Home remembers each choice like every collapsible
   (`home:section:<section>`, `resolveHomeSectionId`, 40), apart from the compact queue's, where Waiting
   still starts folded: folding Needs you on Home never hides a decision in the queue button's
   list. The sections stack in `WideSections` (`components/queue/queue.tsx`) with one `gap-6` between
   them, and the visible gap is the same open or folded: a folded section is just its header, whose
   title (a 16px line, `leading-4`, in the 24px header) keeps 4px under it, so an open section
   (`WideSection`) adds the same 4px under its card (`pb-1`). From a folded title or an open card to the
   next title is 32px in every combination (measured at 900 and 1280), so the rhythm never changes
   when you fold one.
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
   (`?tab=review` for a review, `?tab=chat&run=` for a question or a running agent) and, on hover,
   opens a preview card: status in its tone, what is happening now, repository (its mark in its project's
   colour), branch and pull request (each with its icon), how long it has waited (`TimeAgo`, exact time on hover) and its
   one action as a button. A pull request link (`PrLink`) is a tile in the pull request's tone
   (green open, red failing, amber running, purple merged) and `#N`; it opens GitHub and its card
   (`PullRequestDetails`, the same body as the overview's pull request fact) shows the task, CI,
   unresolved comments, conflicts and the checks. `RepoChip` and `BranchChip` are a 14px `fg-2`
   icon and the name (the branch in mono; the repository's GitHub or folder mark in its project's colour); their
   cards are the overview's repository and branch facts. A file link (`FileLink`) is inline code; on a task with a repository it opens the file in the
   Code tab at its lines (a diff tab in Changes once the task has changes, `?tab=code&mode=changes&file=&diff=1&line=`,
   the file in Files before that), with a tooltip naming the path and lines; elsewhere it stays plain code. Smart anchors carry `data-smart`, so prose link styling
   (blue, underlined) never applies to them.
   `ReferenceText` and the markdown renderer turn text into these pieces from the reference
   syntax (`docs/engine.md` → References): `shinsa://` links, a quoted task title, an exact title
   of 12 characters or more, and a bare `#N` that only one pull request has. An unknown id or a
   malformed reference renders as its plain label, never a broken link. The current task (the
   page's route) is the scope: its own title is not auto-linked, and file links resolve against
   it. One-line previews (`InlineMarkdown`, inside rows and buttons) show references as plain
   medium text instead of nested links. On Home, `GuideText` keeps "pull request #N" written as
   "the pull request" and does not link numbers, since the task card already shows it.
   **The compact queue.** The sidebar and the queue button render the queue `compact`: collapsible `h-6` headers (the whole header folds; its chevron, shown on hover, 5px from the top and bottom and right after the count, 6px from it, never at the header's end: the chevron belongs to what it folds, and the end is where a section's action goes) with a 14px icon in a 20px slot, the same rows
   without the age. Every leading icon in the sidebar (nav items, the Focus dot, section icons,
   row tiles) sits in a 20px slot 6px in from the row (`ps-1.5`), so their centres share
   one vertical axis. Open and closed sections are shared by both through `localStorage`, and a
   section can always be collapsed, the one holding the task on screen included. Until you have
   toggled a section yourself it opens when it holds the task on screen; after that your choice
   wins everywhere (`queue:section:<section>`, `resolveSectionId` with `resolveSectionDefault` from `lib/queue.ts`, 40). A section is
   `CompactSection` (`components/layout/compact-section.tsx`), the one the Services popover draws its projects with
   (37), and the queue popover is `COMPACT_POPOVER` (320px, as tall as its content up to the room under the button,
   then it scrolls) with its list inset 6px more at the top (`COMPACT_POPOVER_INSET`), so the first header's icon
   sits as far from the popover's top as from its side; the sidebar keeps its own spacing.
   - **A proposed change is a decision.** When an answer, an investigation or a report proposes a change, its
     gate (your OK, gate type `proposal`) sits in Needs you as Change to approve, purple with `IconFileEdit` like a plan, since
     it decides what gets built (`lib/tasks/status.ts`). Investigating, Researching and Running the operation are
     working stages, blue, In progress, with their own tiles (`IconMagnifyingGlass`, `IconBook`, `IconConsole`).
   - **An operation after the merge is a decision.** When a change's operation runs after its merge, the merged task
     waits at the operation gate (gate type `operation`, stage `awaiting_operation`): Operation to confirm in Needs
     you, purple with `IconConsole`, the reason core's ("The change merged and the operation waits for your OK").
9. **Acting never moves you.** There is no previous/next stepper on the task page; the queue
   button and ⌘K are how you move between tasks. Approving,
   merging, answering, replying or cancelling stays on the task and confirms with a toast. A chat message you
   send shows as your bubble at once. **Delivering and queued are two states, each tied to the engine.**
   - **Delivering** (`UserMessage`'s `status` `delivering`, `isDelivering` in `lib/tasks/messages.ts`): from the
     moment you press send (the outbox) through the server's acceptance and the classifier's pass over the task's
     `inbox`, until it is routed into the task (steered into the running turn, a fix, a follow-up, a revised plan),
     and for a round that started from the queue until the round's first run starts (`isRoundDelivering` in
     `lib/tasks/message-queue.ts`). No text: the bubble stays at full opacity, and a blue light
     travels around its border (`DeliveryEdge`, the `message-delivery` classes in `app.css`): a 1px ring masked over
     the border, a conic gradient of the accent (`primary-4`, in
     both themes) with a soft tail, turning once every 2.4s on `transform` alone, linear like a spinner since it
     loops. It fades in. Once the message is delivered the light fades out over 400ms (`useSettling`, `SETTLE_MS`) on the strong
     ease-out, so only opacity and transform ever animate. Under reduced motion the ring is a still `primary-4`
     border. "Sending" is in an `sr-only` span.
     The queue docked above the composer keeps its own look.
   - **Queued** (`MessageQueue`, `components/chat/message-queue.tsx`, over `listQueuedMessages`): a message the
     classifier read as new work while a round is in flight is the next round, which waits (`round.queued`, status
     `waiting`) until the current round rests or reaches the merge gate (`docs/engine.md` → Rounds). It is not a
     bubble in the chat: the queue docks above the composer on the Chat and Overview tabs (`Composer`'s `dock`), a
     `CARD` `mb-1.5` with a 32px `text-2xs` header (an hourglass, "Queued" in `fg-3`, then "· Sends once round 2 is
     finished." or "· Sends once round 2 is finished, one round at a time." in `fg-2`, `describeQueue`) over one
     row per waiting round: its text `text-xs fg-3`, three lines at most, then Edit message (`IconPencil`) and Remove
     from the queue (`IconCrossSmall`), `secondary` `icon-xs` buttons 1px apart. The list scrolls past 176px
     (`ScrollArea`). Edit turns the row into the kit's `Textarea` with Cancel and Save (Enter saves, Escape cancels,
     `round.update`); Remove sends `round.remove` and dims the row while it goes. Both are optimistic. When the round
     starts, its message joins the chat under its round's divider as your bubble, delivering, then settles. Several
     messages routed together are one round, so one row, delivered together.
   Every message ends in a state you can see: delivered (no line), "Noted. It needs no reply." in `text-fg-2` for
   one the classifier read as needing nothing (no agent runs for it), or "Not delivered. ‹reason›" in
   `text-red-text` for one the task could no longer take, which stays in the chat (`describeMessageStatus`).
   Several messages sent while one is read reach the agent together, as one message (`docs/engine.md` → Rounds,
   Queued messages).
10. **Two layouts, picked in Settings → Appearance.** On screen they carry names of their own, kept in one
    constant, `LAYOUT_NAMES` (`lib/preferences/layout.ts`: label, a one-line hint and the icon, read by Settings
    → Appearance, where each layout's choice shows its hint as a tooltip, and by ⌘K's Switch layout): **Desk** for
    Cards ("Pages sit centred with nothing at the sides, and a button at the top opens what needs you.") and
    **Shelf** for Sidebar ("A rail at the side lists every task and stays open, so each one is a click away.").
    Desk is the default. Renaming them is that one constant; the code, the `?layout=` param and this file keep
    `cards` and `sidebar`. Both are one frame, `AppFrame` (`components/layout/frame.tsx`), around one `main`:
    switching adds or drops the top bar and the rail and never remounts the pages inside.
    Cards (the default) has no rail: a top
    bar with the navigation on the left (the Shinsa logo, the Home button in the Mac app, 31; Tasks; Services, 37;
    and a "3 need you" button that opens the compact queue) and Update, Settings, Agent usage and Focus on the right,
    and task pages centred on the same axis as Home (see 12). Tasks (`NavButton` in `components/layout/nav-button.tsx`,
    secondary `sm`, `IconListBullets` and the word Tasks, the look of the Home button) opens All tasks; Settings is the
    same button with the cog alone (`icon-sm`, `IconSettingsGear4`, the tooltip "Settings"), right before Agent usage,
    its gear drawn as tall as the usage gauge beside it. **The bar's icons draw at one size**, the Agent usage
    gauge's: `MATCHED_SCALE` in `packages/ui/scripts/icons.ts` scales an icon about its centre and divides its
    stroke by the same, keeping every icon's weight, until its ink (stroke included) is as tall as the gauge's, 20 of
    the 24 units, unless that would bring its ink within half a unit of the box's sides, where the svg clips it; then
    it is as large as that allows; Home and Tasks are set by eye a little under that, since at the gauge's height the
    house read a pixel too large and the bulleted list, wide and dotted, far too large. A filled twin takes its outline's scale, so a button keeps its icon's size on its
    own page. Measured in the browser at 14px, the ink box, width × height (before → after):
    Home `IconHomeRoundDoor` 10.50 × 10.53 → 10.76 × 10.79 (1.025); Tasks `IconListBullets` 10.50 × 8.75 → 12.08 ×
    10.06 (1.15); Services `IconServer` 11.67 × 9.33 → 13.24 × 10.56 (1.15, its width
    at the box's edge); Settings `IconSettingsGear4` 12.86 × 11.67 (1.1132, unchanged); Agent usage `IconGauge`
    11.67 × 11.67 (the reference, unscaled). The queue button's `IconInboxEmpty` (12.83 × 9.33) and Focus's project
    dot (8 × 8) are not part of the matched set: the queue button is a labelled count, Focus a colour, not a place.
    The scale applies wherever the icon draws (the rail's rows, the Overview tab's house), never per call site;
    each shows its filled icon in `fg-4` with `aria-current="page"` on its own page (19), and Home has no buttons of
    its own for them. The queue button sits after Services, because that corner is navigation and nothing on the right (Focus) moves when it comes and
    goes; it shows on every page but Home, All tasks and setup (`isQueueButtonShown`), at every width: a task, Settings,
    the Terminal page, /ui. It is the only place Cards lists the
    queue outside Home (there is no queue card beside the page). Sidebar is a permanent rail with
    the queue; it never hides. Its nav names the same places as Desk's bar, in the same words: New task (Home), Tasks,
    Services and Settings, each filled on its own page. From
    `md` (768px) up it sits beside the page; below it, it opens as a sheet. The app has one
    keyboard shortcut: ⌘K (Ctrl K elsewhere) opens the command menu (see 14). Nothing else is
    bound to a key, except the Code tab's ⌘P, ⇧⌘F, ⌘F and ⌘G while it is open (32), the Review tab's J and K while it is
    open (34), the Terminal page's ⌘T and ⌘W while it is open and a focused terminal's own keys (37), Enter sends in every input, and a setup step's option list takes the arrows, Home, End, Enter and
    Space while it has focus, as any list box does (24). The Mac app's menu adds Go → Back ⌘[, Forward ⌘] and Home
    ⇧⌘H (31); those are the app's, not the page's.
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
      for what it decides: a review gate has Review (outline, opens the Review tab, 34) then **Approve
      changes** (primary; its tooltip says it opens the pull request, and it is disabled while line comments are
      drafted, with why in its tooltip, 13; **Fix N findings** in its place sends the drafted comments with the
      findings you kept and clears them); a merge gate has Review then **Merge #N**, and under its facts the
      pre-merge steps as a checklist (**Pre-merge steps**, below), with Merge #N disabled and its
      tooltip saying why ("Tick the 2 pre-merge steps first") until each is ticked; a plan gate has
      **Approve plan** over the plan itself (a change with an operation lists it under its phases, headed
      "First, the operation" or "After the merge, the operation"); an operation after the merge has **Run the
      operation**; a paused task has Retry; a question has its answer
      box. Status labels say what waits on you the same way: Plan to approve, **Changes to
      review** (never the bare "Ready for review"), Ready to merge, and a merged task with post-merge steps left
      **Post-merge · 2 steps left** in amber (`IconChecklist`) until each is ticked: that is its open Post-merge
      gate, so Home, the rail and the roadmap read it like any other gate.
    - **Steps around the merge** (`components/review/merge-steps.tsx`, `lib/review/merge-steps.ts`; `docs/engine.md` →
      Steps around the merge, since 2026-10-26). What the agent left for you that needs a person or production access
      (a variable or secret to set, a migration or deploy to run, a flag to flip) is a checklist, never prose: each
      step a row with a small checkbox on its title line, the title (`text-xs` medium, `fg-3` once ticked), its kind
      beside it in `text-2xs fg-2` with its icon (Environment variable `IconKey1`, Secret `IconLock`, Migration
      `IconDatabase`, Deploy `IconRocket`, Config `IconSettingsSliderHor`, Step `IconChecklist`), the detail as
      markdown in `fg-3`, and its command as a shell code block with **Run in terminal** in its corner beside Copy,
      which opens a terminal in the task's folder (the repository once merged) and runs the command, as any fence marked
      `run` in a task does; nothing runs on its own. A list opens with its title (Pre-merge steps, Post-merge steps) and how far it is ("1 of 2 done",
      "All done") at the right. A tick is `merge_step.tick`; the box waits for the server and a refusal is a toast. A
      post-merge step cannot be ticked before the pull request merged: its box is disabled and its tooltip
      says so. The merge gate's now card lists Pre-merge steps; a merged task with steps left opens on its Post-merge
      gate, a now card titled "Merged. 2 steps left to do." that lists Post-merge steps
      (`components/overview/merge-steps-card.tsx`, the gate's card in `now-card.tsx`); while a later round works, the
      steps an earlier round left show in a Post-merge steps panel under the now card (`routes/task/overview.tsx`).
      ⌘K's Merge #N is disabled with the same reason, and the Post-merge gate offers **Tick “…”** for each open
      step. **They are steps of the progress track** too: Pre-merge sits between Pull request and Merge and
      Post-merge last, each with its count ("Post-merge 1/2") and "1 of 2 done" under it, waiting on you (amber) while one is open and done once
      each is ticked. In Needs you the merge gate says "2 pre-merge steps for you" while one is open, and the
      Post-merge gate ("Merged, with steps left for you to do") sorts below the decision gates.
      Both lists render through the checklist (**Checklists**, below): the steps are `ChecklistItem`s, their kind is
      the row's `meta`, and their command the checklist's shell code block, Run in terminal in its corner.
    - **Checklists** (kit `@shinsa/ui/components/checklist`, app `components/controls/checklist.tsx`, since
      2026-10-26). Anything that is a list of things to do, ticked or only shown, is one checklist look, never a
      hand-built list of checkboxes. The kit draws it: `Checklist` (the `ul`, rows `gap-3`), `ChecklistHeader`
      (`title` `text-xs` medium `fg-4` left, `progress` `text-2xs fg-2` tabular right), `ChecklistItem` (`done`,
      `check`: the check in a 20px column so it sits on the title's first line, the content in a `gap-1` column),
      `ChecklistTitle` (`text-xs` medium `fg-4`, `fg-3` once done, with `meta` beside it in `text-2xs fg-2`, wrapping
      under it when narrow), `ChecklistDetail` (`text-xs fg-3`), `ChecklistActions` (what the row offers under it,
      `gap-1.5`) and `ChecklistMark` (a read-only check: the compact checkbox's box without a control, the accent
      with a white check once done, named "Done" or "Not done"). The app draws data: `ItemChecklist` and
      `ChecklistBlock` (the same with its header, nothing when empty) take `items` (`ChecklistItem` from
      `@shinsa/core`: `key`, `title`, `detail`, `command`, `done`) and render the title as inline markdown, the
      detail as markdown and the command as a shell `CodeFence` (copy on hover); `onTick(item, done)` makes each
      check a 14px `Checkbox` that waits for the promise, without it the rows are `ChecklistMark`s;
      `describeBlock(item)` disables a box with the reason as its tooltip; `meta(item)` and `actions(item)` fill the
      row's kind and any buttons under it (a command's Run in terminal is the code block's own, in its corner). The progress is `describeChecklistProgress` ("1 of 2 done",
      "All done"; `lib/format/checklist.ts`, on core's `resolveChecklistProgress`). A GFM task list in any
      `Markdown` (agent prose, notes, the plan, report text) renders as the same rows, read-only: each `- [ ]` /
      `- [x]` item a `ChecklistItem` with a `ChecklistMark` lined up with its first line (`1lh`, so it fits
      `prose-shinsa` and `prose-chat`), its text and nested lists kept, rows `gap-1`. Nothing in markdown ticks.
      `/ui` → Checklist shows it ticking, with commands and a disabled row, read-only, the kit parts and a task list.
    - **Panels keep their action when collapsed.** An Overview panel's header action ("Read the
      review" on What changed, which opens the Review tab) stays in the header whether the panel is open or closed
      (`components/layout/surface/panel.tsx`); a panel can start collapsed (`defaultOpen`), as the Review tab's
      Everything else does, and remembers what you leave it at (`persistId`, 40). A passive figure beside the title (the Delegations count) is the panel's `meta`, not
      its action, so a click on it folds the panel like the rest of the header; a plain count is its `count`, in `fg-2`
      right after the title (the Review tab's risks and agent review), never pushed to the middle of the band.
    - **The whole header is the trigger** (`DisclosureHeader`, `components/layout/surface/disclosure-header.tsx`,
      since 2026-10-25). Every collapsible header folds from a click anywhere on it: Overview and Review panels,
      change snippets, the live card's row, a delegation's spawn card, a round's row, Home's sections, the compact
      queue's sections, the roadmap's groups and Settings' folding blocks. A header with nothing interactive in it
      is one `<button>` with `aria-expanded` (inside its `h2` or `figcaption` when it has one). A header that holds
      its own controls (a link, Stop, a select) takes the click on the header element itself, its controls sit in
      `DisclosureAction`, which stops the click from reaching the header, and the chevron is the one focusable
      trigger, a `<button>` with `aria-expanded` and "Expand ‹label›" / "Collapse ‹label›"; no button is ever
      nested in another. **A trailing chevron's end inset equals its vertical inset**, so it wraps the header's
      corner evenly: end padding = (header height − chevron box) ÷ 2. The header names its height (`strip`: `line`
      24, `strip` 28, `block` 32, `band` 36) and the chevron its box (`chevron`: `box`, the kit's own `Button`,
      `secondary` `icon-xs` (22px), on card bands and snippets; `glyph`, the bare 14px chevron, on section and
      group headers). The box is a real kit `Button` so it looks and presses like every other one: its wash shows
      only while the pointer is on the chevron itself (hovering the rest of the header leaves it bare), pressing it
      deflates its fill by the kit's press inset, and its colours change in the frame, with no transition. In a
      header that is one `<button>` it renders as an `aria-hidden` `<span>` out of the tab order
      (`nativeButton={false}`), so no button is nested; in a header with its own controls it is the `<button>`
      that takes the keyboard. `resolveDisclosureStrip` (`components/layout/surface/disclosure.ts`) writes both as CSS
      variables and derives the end padding and the chevron box from them: band 7px, snippet 3px, block 9px,
      line 5px. The chevron is always last, after the header's controls (a delegation's Stop comes before it).
      Home's section labels and a round's row keep the chevron right after the label and have no trailing inset.
      `disclosure-header.test.tsx` fails when a header is built by hand (`aria-expanded` outside the primitive
      and the listed row disclosures: chat lines, tree items, Show more, the request under a title, Per role, an
      MCP's details row), when a header ends in a chevron without a strip, or when a box chevron is not the kit
      `Button` (or takes a header-wide hover, press or colour transition).
    - **Activity reads newest first.** The Overview's Activity panel lists the newest entry at the top and older
      ones below it (`listActivityNewestFirst`; entries of the same moment keep the log's order, reversed). Every
      place that lists a task's activity uses it.
    - **Task facts.** What a details panel would hold is one quiet wrapped row under the heading on
      every tab (`components/task/facts.tsx`, rendered by `TaskHeader`): state, repository, branch, pull request,
      priority, started (added, for a task that has not started), and, when they apply, what it
      waits on and what it unblocks (or the checks, when there is no pull request yet: the Checks list's summary
      with its glyph, "All 4 checks passed", "Running 2 checks", and the list in its popover), and the coverage of the change once the checks measured it
      (`IconShieldCheck`, "86% of changed lines covered" or "All changed lines covered", a link to Review → How to
      test whose delayed tooltip is the full summary; nothing when coverage is off or could not be measured). Waits on reads "Waits on ‹A›, ‹B›" and is a click menu,
      not a popover (`WaitsOnItems`): the tasks it waits on (each opens, with its status), then
      Wait for another task (a submenu of open tasks with a checkmark on each it waits on; the
      ones it waits on sort first, a click ticks or unticks one and the menu stays open) and Stop
      waiting (clears them all). Each item is an `h-6`
      chip, a 14px icon 6px from `text-xs` `fg-3`, `px-1.5` and pulled out by the same amount so
      the first icon sits on the column edge. Items with more to say open an `InfoPopover` on
      hover (see 15), never a tooltip: the pull request shows unresolved comments, mergeable, the Checks list in
      both stages (Building, then CI) and a link to GitHub; the branch its full name and base; the
      repository (its folder, the place the agent works, in its project's colour) its path, project and default
      branch; several related tasks list as links. A task with no
      repository (a greeting, a general question) has no repository fact at all, and no branch; nothing in the web
      assumes `task.repoId` is set (the roadmap row's hint reads "No repository").
      Priority shows its level's mark (bars for low, normal and high, a red square with `!` for urgent, from `components/status/priority-icon.tsx`) and opens the priority menu, whose items carry the same marks; the task menu has no priority.
    - **The Checks list** (`components/checks/checks-list.tsx`, built by `resolveChecksView` in
      `lib/tasks/checks.ts`, since 2026-10-27) is one list in two stages, a bonus that shows what was checked and never
      a wall. **Building** (before the pull request) holds the task's checks: the plan's ("From the plan · phases 1 to
      3"), the ones the agent added ("Added by the agent · phase 3") and the repository's Always run before review
      commands ("Repository · before review"), each with its label (`text-xs fg-4`), who added it beside it
      (`text-2xs fg-2`), its command (mono `text-2xs fg-3`, selectable) and its latest result: Passed (the accent
      `IconCheckCircle2Filled`), Failed (red, with what failed under the command in `red-text`), Not run yet
      (`IconCircleDotted`), Running (the kit's `Spinner` in the accent, while the stage is `checking` and the check is
      in the current run, as core records it in `Task.runningChecks`), Passed with "Passed when re-run alone"
      under it, or "Already failing on main, so it does not block" (a grey `IconCircleXFilled`, "Not blocking").
      **CI** (after the pull request) holds the pull request's checks, each named and linked to its run, "Required"
      or "Optional" beside it. Each stage's header is its title and summary ("All 4 passed", "1 of 4 failed", "Running
      2 checks", "2 passed, 2 not run yet", in the accent, red or blue); the rows sit in one `INSET` with hairlines
      between them, the state's word at the end, and Show the output (`OutputToggle`) when Shinsa kept the check's
      output: the latest piece Shinsa attached for it, read in a capped code block. It shows on the Overview's review
      card and, while the checks run, on the now card (whose title is then the stage reason, "Running the checks for
      phase 1 of 3", never the next phase), in Review → How to test, and, compact (`ChecksSections`: an
      `InfoSection` per stage, no output), in the checks fact's and the pull request's popovers.
    - **Who worked on this.** Once an agent has run, the facts row ends with `IconAgents` and "3 agents"; its
      `InfoPopover` is a small tree headed "Who worked on this" (`listTaskAgents` in `lib/chat/agents.ts`): each
      role once, in the order it first worked, with its `RoleMark` icon, its name and "2 runs" ("· working now" with
      a pulse while one runs), and under it, indented with `IconArrowCornerDownRight`, every agent it delegated to
      (its role, the delegation's title, Working now, Finished, Failed or Stopped), nested as deep as they go. A row
      opens the chat at that run. The same role names lead each run in the chat and the work card's eyebrow
      ("Agent · started 2m ago"), so you always know who is speaking. The tree's top level is the round's agent
      (every planning, phase, fix and operation run counted under it, with what it delegated nested below), the
      reviewers, and the answerer, investigator or researcher of an inquiry; Planner and Builder appear only as
      delegated helpers.
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
    - **The facts row is one colour.** Every fact under the title (the handle, the status, the repository, the
      branch, priority, times, the cost icon, account, related tasks) is `text-xs` `fg-2`, the muted
      foreground the handle always had (`FACT` in `components/task/facts.tsx`), turning `fg-4` on hover when it opens
      something. A state glyph or a warning note (the status's icon, failing checks, a pull request's conflicts, a
      budget gone over) keeps its own colour; the words around them do not.
    - **The status has its own icon.** The status fact is one icon per status (`resolveTaskStatusIcon` in
      `lib/tasks/status.ts`, beside `resolveTaskStatus`, with the same branches): a gate's status takes the gate's
      glyph (Changes to review the eye, Plan to approve the page…), each wait its own (waiting to check in again
      `IconClockSnooze`, the usage limit `IconGauge`, delegations `IconAgents`, another task `IconHourglass`), and
      every stage one of `STAGE_STATUS_ICON` (Building the hammer, Agent review `IconEyeSparkle`, Done
      `IconCheckCircle2`…; an `awaiting_*` stage the icon of its gate). The icon is the status's tone
      (`TONE_TEXT`) at 70%; the label stays `fg-2`, and a working agent adds the pulse after it.
    - **No kind of task in the facts.** The task itself shows what kind it is (its steps, its Overview, the
      composer's hint), so the facts row does not name it. The kind is still Shinsa's and the agent's to decide:
      no menu, composer select or ⌘K command changes it, and the roadmap row keeps its label and steps.
    - **Each fact says why, once.** What triage decided has no line of its own: the facts row shows each value once and
      its tooltip says why (`resolveTriageWhy` in `lib/tasks/triage.ts`): "Shinsa chose this: …" while it is Shinsa's
      pick and "You changed this. Shinsa chose “normal priority”: …" once you changed it. The priority's why is its
      tooltip; when the task starts is the Waits on fact's tooltip while it waits (its menu changes it) and the muted line of the
      Started time's tooltip once it runs. Each fact's menu is the override: the priority menu and the Waits on menu.
      No "Auto" label is shown.

13. **A tooltip must add information the screen doesn't show, and every tooltip is delayed.** Whether something
    you hover gets one depends only on that: a tooltip that says something new stays, one that repeats what is
    already visible goes. Everything you can hover falls under one of these:
    - **No tooltip** when it would only repeat the screen. A control whose tooltip would restate its own label
      ("Copy" on a button reading Copy, "Review" on Review, a labelled menu item, a `Choice` option or tab whose
      name says it all) has none. Self-evident numbers have none: the diff counts ("+12 −3"), counts in a row whose
      label sits beside them. A generic menu trigger (the `•••` of a task, a project, an account, a schedule:
      `OptionsTrigger`) has none, since its menu is one click away and names every action. The corner X of a
      dialog or sheet says close by itself. Each keeps its `aria-label` when it has no visible text.
    - **A labelled control keeps a tooltip that says what its label can't**: what pressing it leads to or
      covers. Approve changes ("Opens the pull request"), Fix N findings ("Sends the findings you kept and your
      line comments to the agent"), Update ("Shinsa 0.7.0 is ready. The app restarts for a moment and agents keep
      working."), Settings → Notifications' Test ("Play the sound", or "Play the sound and show a test
      notification" once notifications are allowed), Desk and Shelf in Settings → Appearance (each layout's hint line, a `Choice`
      item's `hint`) and a **disabled** control whose reason is not on screen (Approve changes while line comments
      are drafted: "Send your line comments to the agent or remove them first").
    - **A delayed tooltip** wherever else hovering has more to tell:
      - **Icon-only buttons** whose meaning isn't plain from the glyph, through `Hint`
        (`components/overlays/hint.tsx`): copy ("Copy", then "Copied"), Run in terminal (the folder it runs in as
        its detail, `~` for your home folder), collapse and expand ("Collapse summary"),
        previous and next spot, send, comment on a line, remove ("Remove folder"), dismiss, stop a delegated task,
        the compact bar's queue and new-task buttons, the sidebar's resize handle (following the pointer down the
        edge), the error button. The tooltip repeats the `aria-label`. A `Hint` with a `detail` stacks a muted
        second line under its label, as a time's tooltip does (a task's round, 12).
      - **Keyboard-shortcut hints**: a `Hint` with a `shortcut` ("Home ⇧⌘H", "Search and actions ⌘K", "Search in
        files ⇧⌘F", the image viewer's close, previous and next with `Esc`, `←`, `→`), even on a labelled button,
        since the key is not on screen.
      - **Copy feedback**: a copy trigger names what it copies ("Copy the task’s handle", "Copy the full commit"
        with the sha as its detail) and flips to "Copied" in place while it is open. **Every copy says "Copied"
        in a toast** too. Copying anything (the task's handle, a commit, a branch name, a command, a code block, a
        webhook URL) goes through one helper, `copyText` in `lib/connection/commands.ts`: it writes the clipboard,
        toasts "Copied", or "Couldn’t copy to the clipboard" when the browser refuses, and reports which.
        `useCopyText` (`components/controls/copy-button.tsx`) wraps it for a trigger that also swaps to its
        "Copied" state; never call `navigator.clipboard` anywhere else. This replaces the "No success toast" of
        Components → Copy below.
      - **Small marks that carry meaning without a label**: queue tiles (`GateGlyph`, `WorkingGlyph`: "Changes to
        review", "Building · Agent working"), the finished tiles on Home ("Merged", "Done"), project dots
        ("Superwall project"), check and to-do icons ("Passed", "Failed", "In progress"), the progress track's
        steps (step, count and state, then the plan's phases), a changed file's risk dot ("High risk" and the
        reason), a changed file's status letter ("Added") and comment count ("2 comments from you"), a pull request badge in the pull request's tone ("Pull request #4531 · Checks passing"), the
        context meter, a repository's GitHub or folder icon, a project's key badge, the reconnecting pulse.
      - **Text that hides more than it shows**: a fact Shinsa chose for you ("Shinsa chose this: …", 12), the round
        fact and divider, the Waits on list, a smart link's target ("Open in Code ‹path› · lines 4–9"), a
        setting's or MCP's one-line explanation, a plugin's or skill's origin.
      - **Every time** goes through `components/text/time-ago.tsx`: `TimeAgo` ("2h ago", or `compact` for the bare
        "2h" a row ends with, or `text`, a function of now for a phrase around the age such as "Started 2h ago",
        so it ticks with the minute) and `Duration` ("Worked for 3m", the live card's running clock). Each
        renders a `<time>` whose tooltip shows the exact moment: the date bright and the clock muted ("Wed, Oct
        22, 2026 2:14 PM"); a duration shows "2:14 PM to 2:17 PM" ("Since 2:14 PM" while it runs) with the day
        muted. `detail` adds a muted second line naming what the time is when the row doesn't say it ("Waiting
        on you", "Step started", "Finished", "Last message"). Toasts are the only times without one. A bare
        `formatAge(…)` or `formatDuration(…)` in JSX is a bug, and the lint below rejects it.
      - **Text from data that can be cut off** is `Truncate` (`@shinsa/ui/components/truncate`): task titles in
        every row, previews, repository names and paths, branch and file paths, check names and details, tool
        targets, run headlines, attachment names, the image caption. Its tooltip, with the full text, appears
        only when the text really is clipped. Text that is already a popover or menu trigger (the Focus menu, the
        repository and branch facts) keeps a plain `truncate`, so two overlays never stack.
    - **Instant: nothing.** No tooltip opens the moment the pointer arrives. Keyboard focus is not hover: a
      tooltip opens on a keyboard focus at once, and on a tap where there is no hover.

    **One delay, in the kit.** `TOOLTIP_DELAY` (600ms) is how long the pointer rests on a trigger before its
    tooltip opens; `TOOLTIP_SKIP_DELAY` (400ms) is how long after one closes the next still opens at once, with no
    entrance (`data-instant`), so running along a row of hints reads as one tooltip moving. Both are constants in
    `@shinsa/ui/components/tooltip`, and nothing else sets a delay: `Tooltip`, `TooltipProvider`, `Hint` and
    `useTooltipTrigger` take none. A press or Escape cools the group, so the next tooltip waits again. `bun
    lint:conventions` rejects a `delay` on any tooltip part and a tooltip that repeats the text of the control
    it sits on (a `Hint` whose `label` is the trigger's one text or value, or a `TooltipContent` equal to its
    `TooltipTrigger`'s text; a `Hint` with a `shortcut` or a `detail` adds something and passes).

    - **A tooltip opens over its text, never over the row it sits in.** The element a `Hint` or
      `TooltipTrigger` wraps is the text and its icon only: inline, or `w-fit` (`max-w-full` so it still
      truncates), never a block that stretches across a full-width row. Hovering the empty right of a round
      divider or a live-feed line opens nothing. `Truncate` is the one block trigger:
      its tooltip opens only while the text is clipped, so the text fills its box. `bun lint:conventions`
      rejects a `Hint` or `TooltipTrigger` around a block element (a `div`, `p`, `li`… or a `flex`, `grid`
      or `block` class) with no `w-fit`, `inline-*`, `size-*` or fixed width; `test/support/triggers.ts`
      checks the rendered chat the same way.
    - **One tooltip serves the page.** The `TooltipProvider` in `root.tsx` mounts the only Base UI tooltip; a
      `Hint`, a time, a clipped `Truncate` or a `TooltipTrigger` is just its own element, registered by a ref and
      marked `data-tooltip-trigger` (`useTooltipTrigger` in `@shinsa/ui/components/tooltip`). The provider opens
      the tooltip on hover after `TOOLTIP_DELAY` (at once within `TOOLTIP_SKIP_DELAY` of the last one), on
      keyboard focus, and on a tap where there is no hover; it closes it when the pointer leaves, on a press of the
      trigger, on Escape and when focus leaves. A tooltip closed by a press or Escape stays closed until the pointer
      leaves its trigger. What it shows is built when it opens, so a time's exact moment is formatted only then.
      While it is open the trigger carries `aria-describedby` (the tooltip) and `data-popup-open`. A trigger costs
      no component, state or listener of its own, so a page full of hints stays cheap to keep and to show again
      (35). Tests open one with `findTooltipText` (`test/support/hover.ts`), which lets the delay pass at once.
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
    - **Disabled always says why.** A command or a choice's option is disabled only with a reason:
      `disabled` is that reason as a string (`CommandBase.disabled`, `ChoiceOption.disabled`; there is no
      boolean). The row is greyed, cannot be run or picked by click or Enter, keyboard navigation skips it, and
      the reason replaces its hint (a flattened option's heading too) while it is disabled. Typing never ranks a
      group by a disabled match, the first highlighted row is the first enabled one, and a choice page opens on
      the current value only when it is enabled (`isDisabled`, `resolveFirstValue` in `lib/command/menu.ts`).
      The reasons are plain sentences: "Send or clear your comments first" on Approve the changes, "Updating…"
      on an update that runs, "Unavailable: needs usage credits" on Fast, why GitButler is not set up yet on
      Where agents work, and "Kept until it merges or is cancelled" on the task a task is stacked on.
    - **On a task page** (`TaskHeader` calls `useTaskPageCommands`, so Sidebar and Cards share
      it) the task leads: its decision first, each named for what it does (Approve the plan /
      Revise the plan, Approve the changes / Review the changes / Request changes, Merge #N or
      Merge the pull request, Answer the question, Retry / Retry with guidance, or Allow another $N for a cost
      limit; Sign in / Retry anyway for a Sign in gate; Give the ‹label› / Don’t give the secret for a secret;
      Resume now and the auto-resume toggle for a usage wait), then View (Overview, Review, Code, Chat), then Review while the
      Review tab is open (Next point and Previous point, J and K; 34), then Code while the Code tab is open (Changes, Files, Go to file…,
      Search in files, Hide viewed files or Show viewed files while the task has changes, Find in this file, Go to
      line and the diff layout, each with its key; 32), then
      This task (Wait for another task…, a choice that ticks every task it waits on and toggles
      the one you pick, and Stop waiting, Set priority with the priority icons,
      Message the agent, Open the pull request
      on GitHub, Copy branch name, Open in editor, Open a terminal, Show in Finder, Restart the
      current step, Mark as done, Cancel task behind a confirm page), then Next and Previous
      task that needs you (`resolveQueueStep`). Request changes and Fix N findings carry the review's
      draft line comments and Approve the changes is disabled while there are any, as on the page.
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
      Jump to a task, a page of every task), Go to (Home, All tasks, Terminal, Settings), Focus (Switch
      focus project; keeping it for 2 hours or until tonight is `searchOnly` and appears only while
      typing), Appearance (Switch layout, Change theme), Accounts (Add a Claude account, Agent usage, which opens
      Settings → Agent usage → Accounts, and Default account once there is an account; 26) and Schedules (Schedules, which opens the section, and each schedule
      by name while typing; only while there is one; 27), and Integrations (Add an MCP, MCPs, Plugins
      and Skills, and while typing each MCP, plugin and skill by name; 29), and Versions (Update Claude Code and
      Update Codex; 26). With an empty query, Recent lists the
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
      activity, toasts, popovers, tooltips, and GFM task lists in agent markdown (drawn as checklist rows,
      `ChecklistMark`, below). They come from `components/status/check-mark.tsx` (`CheckMark`, `SelectedMark`, `CHECK_TEXT`,
      `CheckOutcomeIcon` for pass / fail / skipped). The one exception
      is the progress track: its done steps (a 15px check on `green` at 29%) and the line
      between them are green, so done reads apart from the blue pulse of the current step.
    - **Page headings** (`components/layout/page/heading.tsx`): one `PageHeading` for Task, All tasks
      and Settings (Home's greeting uses its `PAGE_TITLE`): a `text-base` medium `fg-4` title on a
      20px line (`leading-tight`), the description or count `text-xs` `fg-2` directly under it
      (`gap-px`), flush with the column's left edge.
    - **Canvas sections** (`components/layout/page/section-label.tsx`): a `SectionLabel` (`h-6`, `text-2xs`
      medium `fg-2` on a 16px line, the count in normal weight, `px-1`) 4px over its card, with an optional action at
      the right. Home's sections and every Settings group use it. The action's buttons sit 2px apart
      (`gap-0.5`, the one 2px gap in the web, which `SectionLabel` owns: Refresh beside Add account or Add
      server), so callers pass them as a fragment. With `onToggle` it folds: the
      whole header becomes one button with the label, the count and a 14px chevron right after them (turned when
      closed) and `aria-expanded` (`DisclosureHeader`, so the empty rest of the row folds it too); every Home section uses that
      (`WideSection`), Settings keeps the plain label.
    - **Settings has tabs** (`lib/settings-tabs.ts`, `SETTINGS_TABS`; `routes/settings.tsx`): General (Appearance,
      Attention, Notifications, Context, Updates, Setup), Agents (Models, Engine, Versions), Agent usage (Accounts, Limits; the tab keeps `?tab=accounts`), Projects (Repository
      folders, then Projects: triage looks for repositories in those folders, so they come first), Integrations (Context optimizer, MCPs, Plugins, Skills; 29) and Automations (Schedules). There is no Advanced
      tab; an old `?tab=advanced` link opens General, which holds its sections. Each is its own pane, not a scroll position: the main use is a
      floating, tablet-sized window, where one long page meant scrolling past everything to reach anything, and a
      scroll-spy table of contents would have kept that page. The tab is in the URL (`?tab=agents`; General is
      the bare `/settings`), and a link to a section (`/settings#limits`, the old `#agent-usage`, `#usage`, `#codex`
      and `#agents` too) opens its tab and scrolls to it. A card never repeats its page's name: the Agents tab's
      model card is Models and Agent usage's account card is Accounts; Projects keeps its Projects card, the
      list of projects themselves. The tabs are the segmented `Choice` under the heading, the task page's tab
      control, at every width: there is no rail of tabs beside the column, however wide the window (Layout, No
      sidebars). The column stays on Home's axis (`PAGE_COLUMN`) and the bar scrolls with the page; switching tabs
      keeps the heading and the bar where they are and swaps only the pane under them. The page heading is the open tab's name ("General", "Agents"), never "Settings".
    - **Settings is titles only**: the group label and each row's title with its control (a 40px
      row). There are no section or row descriptions (`SettingsGroup` and `SettingRow` take none), so a
      title and its options must say what a setting does on their own ("Setup steps" with Run setup again).
      The one exception is Agents → Models, whose agent groups and roles each carry a one-sentence line, since
      "Task agents" or "Researcher" cannot say on its own which work it covers (26).
      A row may still show data under or beside its name (an account's reset time, a schedule's summary, a
      path); the two layout names keep their hint lines as tooltips on Desk and Shelf (`Choice` items take a
      `hint`, 13; ⌘K's Switch layout shows the same line). Model selects show
      the display name ("Opus 5.5") from the first paint (`KNOWN_AGENT_MODELS`, refined by the live
      catalog), never the raw alias.
      Section → section is 24px (`gap-6`) on every page.
    - **Settings → Projects** (`components/settings/projects.tsx`), under Repository folders: one `SettingsBlock` per
      project, 6px apart. The header holds the colour dot, the name (medium `fg-4`) and the key as a mono `Badge` (its tooltip: "Tasks in this
      project are named SW-1, SW-2…"), then a secondary `xs` Add and the `•••` (Rename…, Change key…, Edit or Add
      description…, Colour, Remove project). The shelf is one list of what the project holds: each repository
      (GitHub or local icon) and each folder (`IconFolders`, the folder's name), all as `PathRow`s (a 14px icon 8px
      from the name, the path after it in `text-2xs fg-2`, a ghost `sm` select of what always runs before review
      (Nothing before review, the default: only the checks the agent chose run; or "2 commands before review", which
      opens the Always run before review dialog, one command per line, with a pencil button beside the select to edit
      them again; `components/settings/baseline-select.tsx`, `lib/baseline.ts`; the commands join every task's
      Building checks as the repository's baseline, 12), a ghost `sm` select of its test coverage (Auto coverage,
      Custom coverage, Coverage off, `components/settings/coverage-select.tsx`: Auto's hint says what the server
      found, "Measures with Vitest." or "Found no coverage tool here, so nothing is measured.", from GET
      /api/repos/coverage; choosing Custom opens the Custom test coverage dialog with the command, the report's path
      inside the repository and its format, Infer from the path until the path says nothing, and a pencil button
      beside the select edits it again; `lib/coverage.ts`), a ghost `sm` select of where agents work (Worktrees,
      GitButler, Main checkout, each with its one-line hint; GitButler is disabled with the reason until `but` is
      installed and the repository is a GitButler workspace, `components/settings/workspace-select.tsx`), a remove ×;
      repositories without a project have the three selects alone), and "No repositories or folders yet." when
      empty. Add is a menu of the repositories found on disk ("In your folders", "In other projects") and Folder
      by its path…, which puts a path field with Add folder and Cancel (Escape) at the end of the shelf. The
      description lives only in its dialog.
    - **A project's dot lines up with menu icons**: in any menu or select the dot sits in a 14px box
      (`ProjectDotIcon` in `components/status/project-dot.tsx`), the size of a menu icon, so the label after it
      starts where every other item's label does (the focus menu, the new-task project picker, ⌘K's choices, a
      project's Colour menu). Every place you pick a project shows the dot before each name, in the trigger and in
      every option, through one renderer, `ProjectOption`: the Focus menu and the Terminal page's picker
      (`ProjectRadioItems`), the new-task composer, any `SelectField` whose items carry a `dot` (the Services popover’s
      Add services, an MCP server's Where agents use it), the MCP menu's Use in a project and ⌘K's choices (an option's
      `dot`; All work is grey, as in the Focus menu). `test/components/status/project-option.test.tsx` and ⌘K's
      focus choice in `test/components/command/menu.test.tsx` fail when one renders a project without it.
    - **A project and a repository are two things, kept apart.** A project is its dot and its name; a repository is
      its own name after its mark, never the project's name. The mark is tinted in its project's colour so you see
      which project it belongs to (`RepoIcon` in `components/links/repo.tsx`, `resolveProjectInk` in
      `lib/projects.ts`, the same ink as the dot), plain `fg-2` when the repository has no project. Where the
      repository is a place it is `IconGithub` with a remote and `IconFolder1` without (`resolveRepoIcon`): a task
      link's hover card, the roadmap's Repository column (its tooltip names the project, "Superwall project") and a
      repository link (`RepoChip`). Where it is a folder something works in, it is always `IconFolder1`: the task's
      facts row, an MCP server's "Only in ‹repo›" choice and the Terminal page's Repositories (a menu row's icon takes
      the ink through `resolveProjectMark`).
    - **Cards** (`components/layout/surface/card.ts`): `CARD` (`rounded-xl`, hairline, `bg-card`) is the only
      card surface. A card pads the same on all four sides; the shared `Card` slot carries no
      padding of its own, so nothing doubles up. Settings groups are `p-1.5` (`SettingsCard`, which setup's cards use too; 6px on every side,
      measured), rows inside `pl-2 pr-1.5` (`SETTING_ROW`'s `ROW_INSET`, a 40px minimum with `py-1` only so a wrapped
      line keeps 4px from the row's edge), so text sits 14px from the left edge and a control 12px
      from the right, and an inner surface (a project's repositories) sits 6px from the card on three sides.
      Settings has one grouped pattern, the projects card's (`SettingsBlock` and `SETTINGS_SHELF` in
      `components/settings/group.tsx`): a 32px header row with no fill, then the rows that
      belong to it on one shelf, an inset (`INSET`, `bg-bg-a1`) with hairlines between the rows, blocks 6px apart
      (`gap-1.5`) and no hairline between blocks. The shelf's 1px edge sits 6px from the card on three sides, like any inner
      surface, and its rows give that pixel back (`--shelf-edge`, which `ROW_INSET` subtracts), so a row's text
      still sits 14px from the card and 8px inside the edge, in line with the header's, and its control 12px from
      the card's right, measured. Projects, accounts and the agent groups' per-role rows use it. A control on the shelf
      has no fill at rest, since the shelf is already the second surface: never a fill on a fill. A button there is the
      kit's `secondary` (its ghost; `CopyButton` is always one), a select `ghost`; the one exception is an MCP's
      Connect, primary `xs`, the one thing to act on. `CARD_HEADER` is the one card header strip (36px, `bg-bg-a1`, `ps-3 pe-3`, the end padding taken over by the 7px trailing inset when it folds, a 14px icon in a
      20px `IconSlot` on the 12px inset, 8px from the glyph to a `text-xs` medium `fg-4` title), used by `Panel`;
      the chat's hand-over cards (`CardLine`), the delegation card and the live card's row are the same band. A row
      icon in the card's body sits in the same slot on the same inset, so header and rows share one icon column
      (7, One icon column); `CARD_FOOTER` the one footer (`px-3 py-2.5`, `bg-bg-a1`). Every
      card's inset is 12px (`p-3`): the Overview's now card included. A list card (Home's sections, `WideSection`)
      is `p-1` around `ListRow`s (`px-1.5 pt-1.5 pb-1`, `px-2.5` without a leading tile) and its empty line is
      `p-2.5`, so what you see (the tile, the time at the right, the last line's text) sits 10px from the card
      on all four sides, measured: the row keeps 2px less under its text because a line already carries about
      3px below its baseline. Anything nested in a card
      or in the chat column (answer box, code fences, code snippets, tool blocks, images,
      message links, a suggested fix, a disagreement, a plan revision, a request, a sign-in fix, the quiet-agent note,
      evidence, inline notes, an error's details) is an **inset**: `INSET` (`components/layout/surface/card.ts`:
      `rounded-lg` and the card's own hairline, `border border-border`) with its fill on top, so every nested box has
      the same edge in both themes and none is a fill alone. The fill says what it holds: `bg-bg-a1` for a note
      (`InsetNote` in `components/text/inset-note.tsx`: a `text-2xs` label, with an icon or without, over the text; its
      `tone` prop takes any status tone; `SuggestedFix` is the one suggested fix), `bg-bg-2` for code and
      images, `bg-card` for a message link, and Settings' shelf of rows (`SETTINGS_SHELF`) is one too. Not an inset,
      and so no edge: rows in a list, highlights and hover washes, controls (fields, segmented controls, buttons) and
      tiles (a `StepNumber`, an avatar). **A toned box takes its tone's edge.** A box filled in a tone (the
      review's orange "The agent review disagrees", a checked choice card, any warning, error, info or success
      note) is edged in the same hue at its `-a3` step, never the grey hairline: `TONE_INSET[tone]`
      (`card.ts`) is the inset's shape on `TONE_EDGE` and `TONE_WASH` (`lib/format/tone.ts`), the tone's `-a2` fill
      on its `-a3` border (`primary-a1` on `primary-a3` for the kit's checked choice card), the same tokens in both
      themes; neutral stays `bg-bg-a1` on `border-border`. A tile or badge in a tone (`TONE_SURFACE`) has no border, so
      it has no edge to tint. `bun lint:conventions` rejects a `rounded-lg` box with a fill and no `border`, a
      hand-built `rounded-lg border border-border`, and a tone fill on a line that draws the grey edge (`INSET`,
      `border`, `border-border`, `border-bg-N`) with no toned border (`scripts/lint-tone-edge.ts`, tested).
    - **Composers**: the task composer, Home's new-task box and the question's answer box share
      `COMPOSER_FIELD` (text 12px in, 10px from the top) and `COMPOSER_FOOTER` (6px around a
      28px `sm` control, no divider).
    - **Title over description is `gap-px`**, with no exceptions: page headings, card eyebrow over
      title, list rows, activity rows, plan and phase steps, check rows, popover headers and
      task rows, review findings, message links. A title next to its description on one line
      (⌘K rows, a section label and its count, "Waits on ‹task›") is 6px (`gap-1.5`).
    - **Numbered steps** are `StepNumber` (`components/layout/surface/step-number.tsx`): a 20px `bg-bg-a2` tile,
      `rounded-control-sm`, in the plan, What changed and the chat's plan card.
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
      another task, because that is all a new dependency can still do. The task a GitButler task is stacked on
      shows ticked and disabled as "Stacked on “‹title›”"; Stop waiting keeps it, and is not offered when it is the
      only one (core refuses removing it while the stack stands, `docs/engine.md` → Where agents work).
    - **Status tones** come from `lib/tasks/status.ts` and `lib/format/tone.ts`, nowhere else:
      Needs your answer blue, Paused orange, Changes to review amber, Plan to approve purple,
      Ready to merge green, working stages blue, Waiting on another task neutral; Setup incomplete and Sign in
      needed are orange like Paused, and Waiting to check in again, Waiting for the usage limit and Waiting for
      delegations are blue like working. The All tasks section icons,
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
    its priority mark, and its status column with its kind's icon in the status's tone (`SHAPE_ICON`, named
    for screen readers) whose tooltip lists the steps the task takes ("Investigation: find the
    repository, investigate, then your OK to change.", composed steps included, `describeTaskSteps` in `lib/tasks/shapes.ts`,
    from core's `resolveTaskProgress` with a plan's phases as one build). Filter by status in
    ⌘K offers the same sections with the same icons.
    - **The pull request badge** (`PullRequestBadge`, the Pull request column) is the pull request's number on its
      tone's soft surface (`TONE_SURFACE`, one step stronger on hover), the same tint as a status tile.
    - **Change to approve** is its own section between Plan to approve and Needs your answer (`IconFileEdit`,
      purple): a proposed change decides what gets built, like a plan, but it is not a plan yet.
    - **Operation to confirm** follows it (`IconConsole`, purple): a merged change whose operation waits for your
      OK on the merged code.
17. **New tasks can wait.** Home's composer has a When to start select beside priority: Start now,
    or "After ‹task›" for each open task of the project the composer shows. Picking one sends `waitsOn` with `task.create` and the
    button reads Add instead of Start.
    - **Auto is the default.** The composer's selects, in order Project, When to start and Priority, start on what
      Shinsa would pick. Project shows the focus project ("No project" without a focus) with its dot, then every
      project by name and No project; picking one sends `projectId` (`null` for No project), leaving it sends
      nothing, so the task joins its repository's project, else the focus. When to start and Priority start on an
      Auto item ("Auto start" with `IconCalenderSparkle`, "Auto priority" with `IconChart3`), and Auto sends nothing
      for that part, so triage decides it (`createNewTaskCommand` in `lib/new-task.ts`). Picking a value sends it;
      Start now sends `waitsOn: []`. There is no kind select: the placeholder says Shinsa decides what kind of task
      it is, and the button reads Start, or Add for a task that waits.
18. **The kit (`packages/ui`).** Imported as `@shinsa/ui/components/<name>`, `@shinsa/ui/lib/<name>`,
    `@shinsa/ui/hooks/<name>` and `@shinsa/ui/styles/globals.css`:
    - `src/components/` holds every primitive the app renders, one flat file each (`button.tsx`,
      `dialog.tsx`, `checklist.tsx`, …); the icon set is the one folder, `components/icon/`. A primitive nothing but `/ui`
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
    marks, the search toggles, the Python, Go, Docker and database marks) are drawn into `components/icon/custom.ts`;
    `TONED_ICON_SOURCES` there names the file and folder marks the Code tab draws in a pastel file tint (32). Chevrons draw square-cornered and all at one size: `Icon` always
    draws a chevron in a 14px box, and the generator scales `IconChevron…Small` 1.4× and `…Medium` 0.9333× so every
    chevron is 6.5px long, dividing the stroke by the scale so the weight matches. Crosses are the same kind of
    glyph and draw at the same size: `Icon` draws `IconCrossSmall` and `IconCrossMedium` in the same 14px box, scaled
    1.4× and 1.0182× so the X is 6.5px on both axes, its ink box (7.7px) as wide and tall as a chevron's long side
    (Iconography → Icon sizes). `Icon`,
    `Spinner` and `Logo` are the only things that draw an svg. `Logo` draws in its text's colour, not the icon ink: the brand mark beside "Shinsa" is as strong as the word.
    **An icon draws in a solid icon ink, one step quieter than its text, and never at an opacity.**
    You read the text; the icon is taken in passively. Each grey text step has its ink in
    globals.css: `icon-1`…`icon-4` beside `fg-1`…`fg-4` (Iconography → Icon colour has the values
    and the pairing table). The pairing is automatic: every `text-*` colour utility also sets
    `--icon-color` (`text-fg-3` sets `icon-3`, `text-foreground` `icon-4`, `text-muted-foreground`
    `icon-2`), it inherits, and `Icon` and `Spinner` draw in it. So a menu row's icon is `icon-3`
    and turns `icon-4` with its label when highlighted, a secondary button's is `icon-2` and turns
    `icon-4` on hover, a tool row's is `icon-3`, and a class on the icon itself (`text-fg-3`, a
    hover step) changes its ink, never its strength. **A tone keeps its tone**: beside
    `text-red-text`, `text-primary-text`, a Badge's tone or the white ink of a filled button the
    icon is the same colour as its text (`StatusTile` gives its glyph `TONE_TEXT[tone]`, the status
    fact the status's tone). The tone ramps are already tuned for meaning and contrast, a lighter
    step of nine hues in two themes would muddy them, and the icon is often what carries the tone.
    **Three sizes, set in one place**: `size='sm'` 14, `'md'` 16, `'lg'` 20 (`--icon-size-*`,
    Iconography → Sizes). A primitive sets the size for the glyphs inside it (`--icon-size`), so an
    icon in a Button, Badge, tab, select, menu or command row passes nothing; anywhere else the call
    site passes `size`. **One row, one size and one ink**: every icon in a row (the chat's run
    header, notice, tool and brief rows, the facts row, a toolbar, a menu row) is the same size and
    pairs with the same text. Where an icon and its label are separate elements, the icon sits inside
    the label's colour (`RoleMark`), or takes the label's class. A call site never sets an icon's
    strength or size by hand: no `opacity-*` but a reveal (`opacity-0` → `opacity-100`), no
    `size-*`/`w-*`/`h-*` on an icon, no `[&_svg]:` colour, size or opacity, no `[--icon-color:…]` or
    `[--icon-size:…]` in apps/web, and no icon ink brighter than its text. `bun lint:conventions`
    rejects each of these and a hand-drawn `<svg>`, in `packages/ui` too.
    Read every `icon-tertiary`, 80%, 70% or 55% icon rule, and every icon size other than 14, 16
    and 20, below as this: the kit has no `icon-tertiary` and no icon opacity.
    **Where you are shows filled.** A tab or navigation item that carries an icon swaps it for Central's filled twin
    (the same name with `Filled`) while it is the current one, and only then: the rail's rows (`NavItem` takes
    `icon` and `activeIcon`, both required, so a new row cannot leave it out: New task `IconPlusMediumFilled`, All
    tasks `IconListBulletsFilled`, Settings `IconSettingsGear4Filled`), the Cards top bar's buttons (`NavButton`,
    the same two names required: Home in the Mac app `IconHomeRoundDoorFilled`, Tasks `IconListBulletsFilled`,
    Settings `IconSettingsGear4Filled`), Services while you are on the Terminal page (`IconServerFilled`) and the
    terminal tab in front: a shell's `IconConsoleFilled`, and a service's state glyph filled in its tone
    (`SERVICE_GLYPHS`' `activeIcon`: `IconPlayFilled`, `IconHourglassFilled`, `IconExclamationCircleFilled`,
    `IconCircleDashedFilled`), so the tab in front reads the same whether it holds a shell or a service. A glyph that
    says a state anywhere else keeps its outline (a service row's tile, a status tile), and filled never means on or
    off. Both names are written out at the call
    site, since the generator reads icon names from source. This replaces Iconography → Outline, not filled, for
    those places.
20. **The kit's control ramp is a step denser than paywall-next's.** Button `xs` 22 / `sm` 24 /
    `default` 26 / `lg` 30 (icon sizes the same squares, plus `icon-2xs` 18, only for a close mark inside a 24px
    row such as a terminal tab), `Input` and `SelectTrigger` 26,
    the tab lists 26 (`default` and `ghost`) and 32 (`underline`, no size prop), menu, select and command rows 24, `Badge` 18 / 20, glyphs
    `sm` (14px) in `xs` and `sm` controls, rows and badges and `md` (16px) from `default` up. Read the Sizing tables below with these heights.
21. **Invalid** is a 1px `red-4` ring on `Input` and `Textarea`. `FieldError` announces the message
    (`role="alert"`), each distinct message once. A field (`Input`, `Textarea`, a default `SelectTrigger`) is filled,
    never bordered, and fills with the `--input` token (`bg-input`, its hover `--input-hover`): `bg-2`, a step above
    the page, a card and a dialog. A dark popover is itself `bg-2`, so inside one (`.dark
    [data-slot="popover-content"]` in `globals.css`) a field fills `bg-3` and hovers `bg-4`; without that it drew as
    bare text (the Services popover's form, measured: popover and field both `oklch(0.228 …)`, now the field
    `oklch(0.257 …)`). A Settings shelf (`SETTINGS_SHELF`, a card's rows on `bg-a1`) lands on the field's own fill too, so
    it sets the same `--input` step in both themes for every form inside it (Memory's rule editor, a folder you add). Never a
    border or a call-site fill to make a field show.
    `Checkbox` is `filled` (the default: the page's fill at rest, an accent fill and a white check once ticked) or
    `outline` (no fill at rest, only its edge; ticked it fills like `filled`), the second for a list of boxes inside a popover (the Services
    popover's Manage and Add services). `Button` `bare` is an icon-only action with no wash at all, only its glyph
    going `fg-2` to `fg-4` under the pointer and while pressed, for a quiet action in a row that washes on its own
    (Manage's edit pencil); everywhere else an icon button is `secondary`.
22. **Busy buttons stay themselves.** `Button loading` keeps its colours and width, swaps its icon
    (or, without one, adds a leading spinner), sets `aria-busy` and ignores presses and keys, so a
    busy submit can't fire twice. It is never `disabled`.
23. **The kit's dialog and sheet close X has no tooltip** (13): the corner X says it, and its `aria-label` is
    "Close".
24. **Setup is one calm step at a time, in the language of Settings.** `/onboarding` (`routes/onboarding.tsx`, the
    pieces in `components/onboarding/`) shows the server's setup steps (`docs/engine.md` → The setup steps) one at a
    time in one column (`ONBOARDING_COLUMN`: `max-w-xl`, `px-6`, `PAGE_TOP` and 48px from the top from `md` up, the
    steps, the step and its footer 24px apart), and everything in it starts on the column's left edge. It is built
    from the pieces Settings and Home already use, with no style of its own: the steps are the segmented `Choice`
    (Settings' tabs in a narrow window, the task page's tabs), the heading is `PageHeading`, a list to pick from is a
    list card (`Card` around a `HighlightList` of `ListRow`-styled rows, `LIST_ROW*` in `layout/list-row.tsx`), and a
    list of facts is the Settings card (`SettingsCard`, `PathRow`, `SettingRow`, `SETTING_ROW`). It is a focus page in
    its own shell (`OnboardingShell`): a 44px drag bar with the logo in a browser and the traffic lights in the app,
    the connection status and the Update button, and nothing that leads elsewhere: no Home button or logo link, no
    rail, no queue, no usage glance, no Focus, and ⌘K is not mounted (the menu is closed on the way in). While
    `GET /api/onboarding` says setup is not complete, every route but `/onboarding` replaces itself with `/onboarding`
    (`resolveOnboardingRedirect`, in `root.tsx`), so a link, the address bar, the back button or the app's menu all
    land on setup. A run you started again from Settings (Settings → Setup, ⌘K's Run setup again, `restartOnboarding`)
    is not locked: setup is already complete, and each step's footer has Close setup beside its button, which goes to
    Settings.
    - **The steps along the top** (`OnboardingStepper`, items from `listStepperItems`): one 26px segmented `Choice`
      with each step's label, no numbers and no circles. The step you are on is the selected segment, and the pill
      slides to the next one as you move (the stepper sits outside the step, so it is not remounted); a step you
      answered has the accent checkmark before its label (`Choice` items take `checked`) and its answer as the
      tooltip ("Opus 5.5"); a step you reached but have not answered again (after going back) is a plain segment;
      both open their step. A step not reached yet is disabled. A click while an answer is saving does nothing.
      Below `sm` the segments give way to one `PAGE_DESCRIPTION` line in the same 26px slot ("Step 2 of 6: Model",
      `describeStepHeading`). The finished page keeps the slot empty, so the title never moves: it sits at the same
      height on every step and on the finished page.
    - **Each step** (`OnboardingSection`, shared with the finished page) is the `PageHeading` (the question itself as
      the `text-base` title, "How should pull requests be merged?", its one line of description in `text-xs` `fg-2`
      under it), 16px to the body, a refused answer's reason as an `ErrorLine`, and 24px to the footer: Back
      (`secondary`, the arrow left) on the left; on the right Close setup on a run again, the step's own secondary
      action (Add account, Check again) and the primary button with the step's label ("Continue", "Skip for now",
      "Finish setup", "Finish anyway") and the arrow at its end, all `default` size, 6px apart, with no hairline above.
      It enters with a 0.5rem slide and a fade (220ms, the strong ease-out; from the left when you went back), only a
      fade under reduced motion; nothing leaves, so two steps never overlap.
    - **Options** are one list card (`OptionList`, a `listbox`): a `Card` with a `HighlightList` inside, rows built
      like Home's `ListRow` (28px for a label alone, label over its meaning `gap-px` when it has one, `text-xs` `fg-4`
      over `text-2xs` `fg-2`), the recommended one with a quiet `sm` "Recommended" badge after its label, your answer
      marked with the accent `SelectedMark` at the row's end, as a select or menu marks the current value. The hover
      and the keyboard highlight are the menus' one surface, which slides to the row on the movement clock. Clicking a
      one-answer option answers it at once and moves on, a spinner in the mark's slot while it saves; nothing starts
      chosen on a step you have not answered, so there is no Continue until you go back to one you have, where your
      answer is marked and Continue keeps it. The list takes focus when the step opens: the arrows, Home and End move
      the highlight (`aria-activedescendant`) and Enter or Space picks, so setup runs from the keyboard alone; these
      keys belong to the list, not the page (10).
    - **Folders** pick several: the found folders with their repository counts, each with a `sm` `Checkbox` in the
      row's icon slot, the folders you chose already checked (the one with the most repositories on a first run), and
      as the card's last row a `sm` path field with a secondary Add folder (Settings → Repository folders' row), which
      adds the folder to the list checked. Continue is off with nothing checked.
    - **Accounts** are already imported when the step opens (the server does it, never a question): one Settings
      card of your Claude accounts from the socket, each a `PathRow` (the Claude mark, the email, where it came from
      and its plan in `text-2xs` `fg-2`: "Your Claude Code login · Max plan", "From claude-swap"), "Added" on the ones
      this setup imported, Sign in again on a signed-out one, and a remove × (`ConfirmDialog` with `describeRemoval`'s
      words). Until the socket has the accounts the card holds one row with a delayed `LoadingLine`, never "no login
      found". Add account (Sign in to Claude with none) is in the footer and opens the sign-in dialog. An import that
      failed is an amber line under the card.
    - **Tools** are one Settings card of checks (`OnboardingChecks`): `SETTING_ROW`s with the `CheckOutcomeIcon` in
      the 14px icon slot, the tool's name in `text-xs` `fg-4` with the fix under it in `text-2xs` `fg-3`, and its
      version or state at the right in `TOKEN_TEXT`. Check again is in the footer. An optional check that fails (codex
      and its sign-in) is a skipped row, never a fail, and never holds setup back.
    - **Finished** (`OnboardingFinished`) is "Shinsa is ready" with its line, what you set up as `SettingRow`s in a
      Settings card (Folders, Model, Merging, Plans, Accounts, the answer at the right in `fg-3`) and Go to Home.
      Opening `/onboarding` once the server's run is finished (setup done and not started again) goes Home instead.
    Settings → Repository folders lists the chosen folders as `PathRow`s (removable, the `SHINSA_ROOTS` ones marked
    as such), adds one by path and has Find folders (a menu of discovered folders with their repository counts,
    checked when chosen). No folder path is ever written into the code; the ones on screen come from the server.

25. **Process states share the now card and the panels.** Every new waiting state is one of the
    Overview's existing pieces, never a new surface (`components/overview/`, built on `NowFrame`
    in `now-frame.tsx`, its actions at the top right, a `FooterNote` for the quiet links):
    - **Paused** (the now card's `PausedCard`): the gate's title, then a link to the agent's last
      message or the gate's body, Retry (primary) at the top right and Cancel task as the footer's quiet
      link. Every failure gate uses it, an agent's wait that ran out ("The agent’s wait ran out", or "The agent’s
      wait ran out of checks") included; a task
      stopped at its usage or cost limit ("Reached its usage limit", "Reached its cost limit") names its Retry
      for what it does, "Allow another 10%" or "Allow another $5.00" (`describeBudgetRetry`), in ⌘K too; its body
      names the limit it reached ("This task reached its $5.00 cost limit, so the next step did not start."), never
      what the task spent.
      A pre-push hook that rejected the push again with the same failures ("The pre-push hook failed again") names
      its Retry "Send to the agent again" (`resolveRetryLabel`, toast "Sent to the agent again."), in ⌘K too; its body
      lists the failures and shows the hook's last lines in a code block, and nothing on the card or in ⌘K pushes
      without the hook.
    - **A push in progress** has no card of its own: the now card's title is the stage reason, which says each step
      as it happens: "Updating the branch onto main", "Pushing the branch (the repository’s pre-push hook is
      running)" ("Pushing the changes (…)" to an open pull request), "Opening the pull request", and on a retry
      "Pushing again in 30s, attempt 2 of 5: Could not resolve host: github.com". Each retry is also one activity
      entry ("Pushing failed on attempt 1 of 5, trying again in 30s", the error as its detail), and a hook fix run is
      headed "Fixing what the pre-push hook found".
    - **Setup incomplete** (`setup-card.tsx`): status orange in the Paused group with the
      `IconToolbox` tile; the card renders the gate's body (each problem and its fix) as markdown, with Verify
      again (primary, `approve`) at the top right, and Cancel task as the footer's quiet link. A repository without
      check commands is not a problem: nothing extra runs.
    - **A revised plan** (`plan-revision.tsx`): the eyebrow reads "Version 2 · 4 phases"; above the
      plan an inset (`bg-bg-a1` on `INSET`, `PlanFeedback`) holds only "You asked" and your words, and
      none at all when the revision came without a message. In the plan itself "What changed" with the
      agent's summary sits right before the goal (`PlanChangeSummary`), and each phase the revision added
      or reworked carries a quiet `Badge` `sm` beside its title, "New" or "Changed" (`PlanPhaseTitle`,
      core's `resolvePhaseChange`); a dropped phase is not listed and a changed goal or approach gets no
      mark, the summary says it. The chat's Revised the plan card renders the same three pieces, so the
      two never disagree. Approve plan sends the version on screen.
    - **Questions with choices** (`question-choices.tsx`): `outline` `sm` buttons in a wrapping
      row (`gap-1.5`) above the answer box, the recommended one with a muted "Recommended", the
      same pattern as `ChoiceButtons` everywhere. One click answers; the box placeholder becomes
      "Or write your own answer."
    - **Review verdicts** (`finding-verdicts.tsx`): each finding opens on `NoteHead` (34, The review card): a
      full-width row with the severity in `red-text` or `fg-2` (the file as a mono chip when there is no snippet) over
      the title on the left and the Fix / Dismiss `Choice` on the right, then the message, the file row and the
      suggested fix full width below; blocking findings start on Fix. The primary action follows the verdicts:
      "Fix 2 findings" while any is kept (it also sends your drafted line comments, and its tooltip says so, 13),
      Approve changes when all are dismissed. The activity lists the comments a decision
      sent under it, each with its place (`activity-row.tsx`). An escalated
      review titles the card "The agents could not settle the review", or "The fix changed nothing and
      the same findings came back" when a round left the code as it was, and says why
      (`lib/overview/verdicts.ts`).
    - **A wait** (`wait-card.tsx`): "The agent is waiting on something outside the repository",
      the agent's notes, "Check-in 2 of 10 · gives up in 3 hours" under them and Check in now (outline);
      the eyebrow's `TimeAgo` counts down to the next check-in. Status "Waiting to check in again", blue.
    - **The live feed** (`live-feed.tsx`, `listFeedLines`): the run's last four messages and tool
      calls as 24px `text-2xs` rows, so the card holds its height once four have arrived and a new
      step swaps in at the bottom. The newest row carries the pulse and names its step in the
      words the chat's live line uses ("Reading app.tsx"), shimmering like that line (`ShimmeringText`,
      `SHIMMER_LINE`) while the run is live; the earlier ones stay still, in the past tense with the verb in medium.
      "Starting" before the agent has done anything shimmers too. A parked run (waiting for its delegations, or
      on an answer from the agent that delegated it) holds still, as the chat's live card does.
    - **A quiet agent** (`silence-note.tsx`): a `bg-bg-a1` `rounded-lg` strip above the live
      feed, "No output for 23 minutes" (`fg-3`, orange from 15 minutes; the thresholds are
      `docs/engine.md` → Silent runs) with Snooze and Dismiss as quiet links. It never changes the
      task's status. While a tool call is still running it says so instead: "A command has been
      running for 23 minutes" followed by the command's first line in mono (`fg-2`, `Truncate`, so a cut
      line shows whole in its tooltip), or "A tool has been running for 23 minutes" for any other tool.
    - **Held up by another task**: under "Waits on ‹A›" the work card names the stalled leaf of
      the chain with its `TaskLink`: "Held up because ‹C› is waiting on you."
    - **Suggested tasks** is a `Panel` right under the now card; a suggested task's
      row is title over why (`gap-px`) with, at the right, a ghost `sm` When to start select, then
      Dismiss (secondary) and Add (outline). The select offers Start now and After this task merges
      (Home's When to start words, `lib/tasks/suggestions.ts`), the agent's pick first, preselected and
      marked Suggested; Add sends `waitsOnThis` from what is chosen. An Ask task
      has no Summary panel, its Code tab browses the repository at its default branch (Files only, 32), and its progress track is Find the repository →
      Answer, or only Answer when it has no repository.
    - **Results live in the now card**, the way a plan and a review do (`ResultCard` in `now-card.tsx`, on
      `NowFrame`; `resolveNowKind` in `lib/overview/now.ts` picks the card): a finished answer, report, diagnosis or
      outcome is the card's body as markdown, under the eyebrow (status, round, when it arrived) and a title in the
      agent's words ("Answered your question", "Wrote the report", "Reported the diagnosis", "Reported the
      outcome", `RESULT_TITLE`), with a footer note saying who takes a follow-up ("Ask a follow-up in the chat and
      the answerer answers in the same conversation.") and the quiet Open the chat. A proposed change (your OK)
      shows the result inside its card too, above the why. There is never a second card for the same result:
      `ResultPanel` (`RESULT_PANEL` in `lib/tasks/shapes.ts`: Answer, Diagnosis, Report, Outcome) shows only while
      the now card shows other work, such as a find and fix's diagnosis kept under its build
      (`resolveResultPlace`: `now_card`, `panel` or `hidden`). A result belongs to the round that produced it and
      shows only while it is that round's latest word. While a later round works, core has cleared it when the round
      started (`round.started`), and it lives in that round's summary in the Rounds panel, never as a card of its
      own. While the round's own step runs again (a follow-up that re-runs the answer, research, investigation or
      operation, so the task is answering, researching, investigating or operating), the next hand-over replaces the
      result, so it shows nowhere on the Overview until then; the chat still has it, right above the follow-up. Only
      the round carrying on to its next step (the diagnosis while the fix builds) keeps it as a `ResultPanel`. A kind of task without a build step (answer, investigation,
      research, operation) has no Summary or What changed panel, and its Code tab is Files alone (the
      repository at its default branch, 32); find and fix gets Review and Changes once it builds. A finished answer, investigation or report keeps the composer, for a follow-up the
      same agent answers.
    - **No strip until the steps are settled.** While triage has not chosen the kind of task, or the agent of a
      task Shinsa shaped can still change its steps (core `resolveShapeState`: `triage` or `agent`), the card's
      footer is one neutral line, a `Spinner` and "Working out the steps", with why in its tooltip
      (`TaskTrack` in `progress-track.tsx`), and the facts row names no kind yet (the roadmap row shows the dotted
      circle, "Kind not chosen yet"). A task that becomes a plain answer never flashes the plan-to-merge strip.
    - **The stage strip follows the pipeline** (core `resolveTaskProgress`): Find the repository when it does not
      start with a plan and the task has a repository or its steps need one (an answer or research with no
      repository has no such step, and no copy about finding one), then each step, Answer, Research, Investigate, Your OK to change (Your OK to run before an
      operation), Plan, Run the operation, Build, Checks and agent review (Checks or Agent review when the task has
      only one), Your review, Pull request, Merge; Your OK is a step of composed steps, and shows after an inquiry while a proposed change waits. A
      strip longer than a change's folds the labels of finished steps below `lg`, and one longer than find and fix
      (research, your OK, then a change) folds them at every width (`resolveLabelFold`), so both fit a 900px window
      and a 1280px one; each folded step keeps its label in its tooltip.
    - **A proposed change** (`ChangeCard` in `now-card.tsx`, on `NowFrame`): the eyebrow names who proposes it ("The
      investigation proposes a fix", "The answer proposes a change", "The report proposes a change"), the title is
      the gate's question, then the why and, on an inset note, "What it would change" with the request.
      Make it a change (primary) at the top right, and the footer's quiet "Keep it as an investigation" (an answer,
      a report). Both are gate replies in `lib/tasks/gates.ts` (`makeChange`, `keepAsIs`), and ⌘K offers the same two.
      Your OK in composed steps is the same card (`describeChangeGate`): the eyebrow says the result is in ("The
      diagnosis is in", "The report is in", "The answer is in"), the block is "What comes next", and before an
      operation the primary is Plan the operation (`planOperation`, "Approved. Planning the operation now.") with the
      note "An operation gets a plan you approve before anything runs."; keeping it is your veto.
    - **An operation after the merge** (`OperationCard` in `operation-card.tsx`, on `NowFrame`): the title is the
      gate's ("The change merged. Run the operation now?"), then "Merged in ‹PrLink› as ‹commit›", the commit a mono
      chip with the short sha whose click copies the whole one (its tooltip shows it), then the rest of the gate's
      body as markdown: the caution, "Operation" with the numbered steps and "Impact" (`resolveOperationBody` in
      `lib/overview/operation.ts` drops the body's own merge sentence, which the line above already says). **Run the
      operation** (primary) at the top right; under the body one editable notes box ("Notes for the agent"), filled
      with the notes saved on the gate (`Gate.notes`, the only place they live); and the footer's quiet **Finish
      without it**, behind a `ConfirmDialog` since it ends the task ("Finish without running the operation?"). Run
      sends `approve` when the box still holds the saved notes, else `reply` with the text, which replaces them (an
      empty box clears them; `resolveOperationRun` in `lib/overview/operation.ts`); there is no separate "Run with
      these notes" button. Toasts: "Running the operation.", "Running the operation with your notes.", "Running the
      operation without notes.", "Finished without running the operation." (`GATE_REPLY` in `lib/tasks/gates.ts`);
      ⌘K offers Run the operation and Finish without it (a confirm page), and a notification reads the reason and the
      merge sentence, without the steps. A message in the task's composer while the gate is open replaces the notes
      and runs nothing (its placeholder says so: "Write the notes for the agent. They replace the saved notes and
      go with the operation.", toast "Notes saved."), so the box shows them.
    - **What a message does** is the composer's placeholder at every gate and the toast after it, from one place
      (`resolveMessageHint` in `lib/tasks/messages.ts`, over core's `resolveMessageEffect`; `docs/engine.md` → Gates →
      What a message does): the Overview's and the chat's composers and ⌘K's Message the agent all read it, and a task
      that takes no message (finished, not a follow-up) shows no composer.
    - **The plan's parameters** sit under its phases and operation, in the plan card and in the chat's plan card
      (`PlanParameterList` in `plan-parameters.tsx`, `resolvePlanParameters` in `lib/overview/plan-parameters.ts`),
      each only when the plan sets it: **Impact** (markdown), **Evidence** (the kinds the agent must attach, as a
      `·` list: Screenshot, Recording, Linked test, Note, Preview link), **Checks** (the plan's `verification`: each
      label in `fg-3`, its phases beside it in `text-2xs fg-2`, "Phases 1 to 3", and its command a mono chip)
      and, when the agent asked for your approval, the quiet line "The agent asked for your approval."
    - **Cost shows in one place: the facts row's cost control, icon and value.** A task's cost, its share of the
      weekly limit and its tokens appear nowhere else: not on the now card, a run or round divider, a row of All
      tasks, Home or the rail, an activity entry, the Review tab, a preview card or ⌘K. The control is the unit's
      icon and the amount ("$18.55", or "1.8%" of the weekly limit on a subscription), and hovering it opens the
      popover with the heading, the tokens and the split by step and by phase. The
      account's usage (the top bar's usage menu, Settings → Agent usage) is not a task's cost and stays where it is;
      the limits (Settings → Limits, the paused card and its Allow another) keep working and name the limit, never
      what the task spent.
    - **Cost** is in one unit, the task's (`resolveCostUnit`, `docs/engine.md` → Cost): a task that ran
      on a subscription shows its share of the weekly window (`IconGauge`, "1.8% of the weekly limit"), and a task on an
      API key, or on a provider with no weekly window, its dollars (`IconCoins`, "$1.75"). The two are never shown
      side by side as rival totals: the popover's header is the primary one ("1.8% of the weekly limit", or
      "$1.75"), the line under it carries the other ("$4.31 and 8.2M tokens, as estimated by the agent provider.")
      and, for a share, what it was learned from ("The share is learned from 12 tasks on this account."), and its rows
      by step and by phase use the task's unit. While the account's rate is still being learned the task shows
      dollars, and the line ends "The share of the weekly limit shows once a few more tasks have run on this
      account."; nothing else marks a share as an estimate. A share follows the account's current rate, so it can
      move a little as the rate improves. Shares show a tenth below 10% ("0.4%", "<0.1%") and
      whole percentages above. The icon turns orange past a limit; against a limit the header reads "12% of the
      weekly limit, 10% allowed" (the usage limit) or "$1.75 of $5.00" (the cost limit): a limit already passed
      always shows, otherwise only the limit in the task's unit (a learning task that passed its usage limit on an
      early estimate shows that header over its dollars; the gate says it is an estimate). Unknown prices read "Unknown" or "$0.30 + unknown", never $0. Tasks
      from before weekly readings were kept (`docs/engine.md` → Cost) get their share from their cost once the
      account's rate is learned.
    - ⌘K adds, on the task: Answer "‹choice›" per choice (Recommended as its hint), Verify the
      setup again, Check in now, Snooze / Dismiss the quiet-agent warning,
      Add the suggested task “‹title›” (a page with the same two starts, the agent's pick first with
      Suggested as its hint) / Dismiss the suggested task “‹title›”; at the bottom while typing, "Ask: ‹text›" next to
      Create task. Settings → Limits has Usage limit per task (and Cost limit per task where it applies, 26);
      Agents → Models sets the answerer under Task agents. Home's
      composer has no kind select (17).
26. **Agent usage: Claude accounts, Codex and their usage limits** (`lib/accounts/` for the labels, tones and choices, the
    sign-in dialog's own sentences aside; the socket holds the `accounts` snapshot it pushes and every
    POST to `/api/accounts/*` answers, and `lib/connection/accounts.ts` reads it (`useAccounts`) and
    sends the changes; pieces in `components/accounts/`):
    - **Settings → Agent usage → Accounts** (the tab is Agent usage, as in the top bar; its first card is Accounts,
      so the card does not repeat the page's name, `ACCOUNT_LABEL.section`) is one section for every login agents
      run on, whatever the provider (`components/settings/accounts.tsx`; the old `#agent-usage`, `#usage` and
      `#codex` links land on it). Its header has a secondary icon button "Refresh usage" (it
      refreshes every account) and Add account, a menu when Claude Code or claude-swap logins can be imported,
      otherwise it signs in straight away; with no account the card holds one sentence and that button. Each
      Claude account is a `UsageAccountBlock` (`usage-account.tsx`, a `SettingsBlock`: 15, Cards), in order, 6px
      apart: a 32px header row with the account
      named with its provider (`AccountName`, medium: "Claude · a@b.com"), the plan (`fg-2`), a `Badge` "Default", and only when something is wrong a status in its tone
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
      toast that says to take the login out of claude-swap, since refresh tokens are single-use. A login in your
      accounts twice shows once; after the accounts, a muted `SettingsEmpty` row says which copy Shinsa runs it from
      (`describeDuplicate`: "Your Claude Code login is now ‹email›, which is also one of your accounts. …").
      Every provider with a sign-in of its own (Codex today) follows in the same `UsageAccountBlock`
      (`ProviderLoginBlock` in `providers.tsx`; the header from `resolveProviderHeader`, Claude's from
      `resolveAccountHeader`), so its row reads like an account's: the provider and its account (`AccountName`,
      medium), its plan in `fg-2` ("Plus", "Pro") or, without one, its state ("Signed in with ChatGPT", "Not signed
      in", "Not installed", "Too old for Shinsa", "Could not check the sign-in"), only when something is wrong a
      status in its tone ("Needs sign-in" or "Update needed" orange, "Out of usage until 3:40 PM" red), then
      "Updated 2m ago" from its usage read and the same `•••`, with what makes sense for a login Shinsa never signs
      in or out: Copy the sign-in command (`codex login`, while it is signed in) and Check the Codex sign-in again
      (the same refresh). No CLI version is shown. Below it, on its shelf, when there is something to do, a row
      with the fix as inline markdown ("Run `codex login` in a terminal…") and a `CopyButton` for its command. A
      signed-in provider that reports usage (Codex) has the same usage rows as an account ("5-hour limit",
      "Weekly limit", a model's limit). Shinsa runs Codex on its one login, the one in `~/.codex`, and never signs
      Codex in or out itself.
    - **Settings → Agents → Models** (`components/settings/agents.tsx`, `ModelsGroup`; the card is Models so it does
      not repeat the tab's name, and the old `#agents` link lands on it) has two groups (`AGENT_GROUPS` in
      `lib/settings.ts`), 6px apart, by the rule of thumb Opus for anything that needs real reasoning and Sonnet for
      quick one-shot jobs: **Task agents** (the agent, reviewer and answerer, and through the answerer the investigator and
      researcher; Opus by default), "They plan, build, review and fix the work, answer
      questions, investigate problems, do research and run operations.", and **Quick jobs** (the classifier and the
      writer; Sonnet by default), "They sort new tasks and your messages, and write the guide on Home." A group's
      row has its title (`fg-4`) with a quiet "Per role" disclosure (`text-2xs` `fg-2` with the section chevron)
      right after it, the sentence under them in `text-2xs` `fg-2` (it wraps rather than truncate), and two
      `SelectField`s, so nothing is cut off at 900px: one **model** select that holds every provider's
      models under a label per provider (Claude, then Codex; `SelectField` items take a `group`), each with its
      provider's icon, so picking a model picks its provider too (`listAgentModelItems`, the value
      `provider:model`; `GET /api/providers`, the built-in names until it answers), and one **speed** (Standard,
      `IconSpeedMiddle`, the default, or Fast, `IconSpeedHigh`; `agentFastModes`, `docs/engine.md` → Compaction and
      fast mode) for every role in the group. Every agent select has a fixed width that fits its longest value
      (model `w-40`, speed `w-30`), so values and chevrons line up in columns. Where fast mode needs usage credits
      the provider's accounts do not have (`resolveSpeedAvailability` over core's `resolveFastModeAvailability`),
      the select reads Standard and its Fast option is disabled with a muted "Unavailable: needs usage credits"
      after the label (`SelectField` items take `disabled`, the reason it shows in place of the `hint`), and
      ⌘K's speed choices show Fast disabled with the same reason: the agents run at standard speed whatever was stored, and Fast comes back by itself once credits are
      there. No default model is Haiku. When the roles differ the selects read "Set per role". Per role is
      secondary and starts folded, unless the roles differ; it opens the group's `SETTINGS_SHELF` straight under
      the row, one row per role core's `AGENT_ROLES` has (Agent, "Plans, builds and fixes each round in one
      conversation, and runs its operation."; Reviewer; Answerer; and Classifier and Writer under Quick jobs), its
      name over one sentence of what it does, with the same two selects, `ghost` (no fill on the shelf's fill) and
      at the same widths. There is no Planner, Builder or Fixer row: one round is one session, on one provider and
      one model, and a delegated planner or builder runs on the agent's settings. The investigator and researcher
      have no settings of their own (core's `RUN_AGENT_ROLE`): they are listed last, each with its sentence and, in
      place of the selects, "Follows the answerer" in `fg-2` (`describeFollowedRole`). The agents stay separate underneath (`agentProviders`, `agentModels` and
      `agentFastModes` per role). ⌘K has the group choices ("Model for task agents", every provider's models in
      one list, and "Speed for task agents") and, while typing, the per-role ones ("Agent model", "Agent
      speed", "Reviewer model"…). /ui shows the card folded on the defaults and opened with the roles set apart.
    - **Settings → Agents → Versions** (`components/settings/versions.tsx`, `lib/versions.ts` for the rows and
      labels, `lib/connection/versions.ts` reads `GET /api/versions` while the tab is open and runs the updates;
      `docs/engine.md` → Versions and updates) is the last group of the Agents tab. Its header has a secondary icon
      refresh button, "Check for updates", which looks up the latest versions again. One row per agent program and
      one for the Claude Agent SDK, in that order: Claude Code, the SDK it pairs with right under it, then Codex
      (`listVersionEntries`), each two lines in the 40px row: the name
      (`fg-4`), the installed version (`TOKEN_TEXT`) and, only when there is something to say, a status in its tone
      ("Update available" blue, "Update needed" orange when it is older than Shinsa needs, "Not installed", "Set by
      CLAUDE_EXECUTABLE", "Couldn’t read the version" or, for the SDK, "Newer version published", all `fg-2`), and
      under it a `text-2xs fg-2` line: "Latest 2.1.310 · Shinsa needs 2.1.280 or newer" ("Latest 0.3.310 · Pairs
      with Claude Code 2.1.280" for the SDK). A program that is behind or too old has a secondary `sm` Update button
      (`IconArrowDown`) at the right, busy while its update runs. Update opens a loading toast "Updating Claude
      Code" whose description is "Running claude update." and then each line the updater prints, as it prints it;
      it settles into the outcome ("Updated Claude Code to 2.1.310.", or the failure in red). The SDK row has no
      button: Shinsa takes a newer SDK by bumping its own dependency, never at runtime. Before the first read the
      card holds "Checking the versions…", or why it could not read them. ⌘K has Update Claude Code and Update
      Codex (Versions; the hint "2.1.287 → 2.1.310", "Up to date" or "Updating…", disabled while it runs), each
      only for a program that is installed and not set by an override; Update Claude Code is there before the
      versions are read.
    - **Settings → Limits** is titles-only rows: Usage limit per task (No limit, the default, or 5, 10, 20, 30 or
      50% of the weekly limit, counted against the task's share of it; `docs/engine.md` → Cost; Codex's weekly limit
      counts too), Cost limit per task (only
      while one is set, when no account reports a weekly window (API keys), or while an account that reports one is
      still learning its rate, when it is the limit that holds), with only the usage limit set while an account is
      learning, a muted `SettingsEmpty` row under it ("While Shinsa learns an account's rate, the usage limit counts
      an early estimate, and nothing before the first measured step. A cost limit holds from the start."), Switch
      accounts at (Other…
      opens the same percentage dialog as an account's), After a usage limit (Resume automatically /
      Wait for me) and, only while that is Wait for me, Ask me what to do (When the limit resets / Right
      away: the task waits as "Waiting for usage: pauses for you at 3:40 PM" and its failure gate opens at the
      reset, or the failure gate opens at once; nothing is hidden). ⌘K's Change a setting has the same
      rows, without Other….
    - **Settings → Agents → Engine** is titles-only rows: Approve plans, Automatic fix rounds, Delegations at once
      (No limit, the default, or 2, 4, 8 or 16 at once, a stored number not in the list added in order, and
      Custom…, which opens a dialog for any whole number of 1 or more; `delegationLimit`, `docs/engine.md` →
      Delegation) and Merge with. ⌘K's Change a setting has the same rows, without Custom….
    - **Settings → Agents → Memory** (`components/settings/memory.tsx`, `lib/memory.ts`; `docs/engine.md` → Memory)
      sits between Engine and Versions: the rules agents proposed first (each with its project and why, Keep, Edit and
      Dismiss), then Every project, then a block per project that has rules, each headed by its count of 20 ("3 of
      20"), each rule with Edit and Remove. New rule and Edit open the rule in place: a field on a line of its own that
      grows with the text (Enter saves, Shift Enter breaks, Escape cancels), and under it the scope, the length out of
      240, Cancel and the primary Add rule, Save or, for a proposal, Keep, which keeps it with your words. Errors stay in the row ("Keep it to 240 characters. It
      has 251."). A `remember` call in the chat is a card with the rule, the agent's why and "In Settings → Memory".
    - **The sign-in dialog** (`sign-in-dialog.tsx`, one `Dialog` mounted by `Root`, opened by
      `startSignIn`): Starting sign-in… with a spinner; "Sign in to Claude" with the browser note,
      the sign-in page as a link and a code field, Submit code the form's primary button; Finishing
      sign-in…; "Signed in as a@b.com." with Done; or the failure with Try again. Every dialog that
      takes a typed value (sign-in code, a switch percentage, a delegation limit) is one pattern: a left-aligned header,
      the field in a `<form>` (Enter submits), and a right-aligned footer of secondary Cancel and a primary button
      named for what it does. A percentage or a count the dialog can check itself shows as the field's `FieldError`; a code
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
    - **A dialog's description is `fg-2`**, two steps under the `fg-4` title, set once in the kit's
      `DialogDescription` and `AlertDialogDescription` (and `SheetDescription`, already `fg-2`), so every dialog,
      confirm dialog and sheet follows: the title and the fields lead, and the sentence under the title is the
      quiet context. A link inside it turns `fg-4` on hover.
    - **The usage menu, Agent usage** (`usage-menu.tsx`, `aria-label` "Agent usage"): an `sm` secondary button with
      `IconGauge` and the figure of what the next run uses, in the usage tone from 75%: when the agent runs on a
      provider with a reading of its own (Codex) its glance window, otherwise the Claude account picked by the same
      core picker the server leases with (`selectNextAccount` over `pickAccount`, `docs/engine.md` → Accounts and
      usage limits) and its glance window (`resolveUsageGlance`, `selectGlanceRow`). The glance window is the one
      closest to running out: the fullest of the windows that apply to the agent's model (the same rule as core's
      `resolveUsedPercent`), the 5-hour one when two are as full once rounded. So an empty 5-hour window never hides
      a nearly spent weekly one, and the row's label says which limit binds; every window stays in Settings → Agent
      usage.
      Claude's and Codex's 5-hour window are both labelled "5-hour limit", everywhere. It reads "Agent usage" without a figure. It sits
      in the Cards top bar before Focus and in the rail header before search, opens an `InfoPopover` on hover, titled
      just "Agent usage" (no description), with every Claude account and then every connected provider
      (`listProviderGlances`) in one shared row (`GlanceRow`), each named the same way (`AccountName`), with its
      glance window (the same pick) as a bar and its reset, or its status when it is out of usage or signed out. The account the
      next turn uses (`isNextAccount`, `isNextProvider` over the glance) carries a 6px blue dot (`TONE_FILL.blue`)
      right after its name, "Used for the next turn" in its tooltip and `aria-label`. A click goes to Settings →
      Agent usage → Accounts. Hidden without accounts or a provider reading.
    - **Usage re-checks itself while you look at it** (`lib/accounts/recheck.ts`, `useUsageRecheck`). Settings →
      Agent usage and the usage menu's popover each read the accounts again when they open (unless a read finished
      in the last 5 seconds) and then every 60 seconds while they stay open, and stop when they close or the page is
      hidden; a hidden page that comes back reads again when the last read is a minute old. Every read, Refresh usage
      and the Sign in card's check included, goes through one request: a read already on its way is shared, never
      sent twice. A failed automatic read says nothing; Refresh usage shows its toast. A run that finds an account out
      of usage or signed out changes the account the moment it fails, without any read (`docs/engine.md` → A run's
      failure shows on its account at once).
    - **Every account names its provider.** Wherever an account is listed with its usage (Settings → Agent usage, the
      usage popover) it reads "Claude · a@b.com" or "Codex · a@b.com" ("Codex" alone without an email) after the
      provider's icon (`IconClaudeai`, `IconOpenaiCodex`; `IconRobot` for one Shinsa does not know): one helper,
      `resolveAccountProvider` in `lib/accounts/account.ts` (on core's `resolveProviderLabel` and the
      `resolveProviderIcon` Settings → Agents uses for its model groups), rendered by `AccountName`
      (`components/accounts/account-name.tsx`: the icon at `size='sm'`, then the label as a `Truncate`).
    - **Sign in needed** (`sign-in-card.tsx`): a `sign_in` gate is orange with `IconUserKey`, in the
      Paused group; the card shows the gate's title ("Paused: a@b.com needs signing in", the one status for that
      cause) and body, Sign in (primary) opens the dialog for
      that account, and Retry anyway / Cancel task are the footer's quiet links. For a login Claude could not
      refresh the body names the account, the others that need signing in too, and what to run, from where the login
      comes from ("…or sign in to Claude Code as a@b.com and run `cswap add`: Shinsa takes the new login from
      claude-swap.", "…or run `claude auth login` in a terminal."), and the gate closes by itself once that login
      works again (`docs/engine.md` → A login Claude could not refresh). The card reads the gate's provider
      (`resolveSignInProvider(gate)` over `gate.provider`: `claude` is a Claude account, anything else a provider with a
      sign-in of its own). A gate for such a provider (Codex) has no Sign in: Shinsa never signs Codex in. Its
      primary is "Check the Codex sign-in again" (it refreshes the sign-ins, and one that finds Codex signed in
      answers the gate), and under the body, on a `bg-bg-a1` `rounded-lg` strip, the fix with its `CopyButton`
      ("Run `codex login` in a terminal, then refresh."); ⌘K offers the same check. **Waiting for the
      usage limit** (`usage-wait-card.tsx`): an armed usage wait is blue and In progress, titled in one
      line with when and where it carries on, "Waiting for usage: continues at 3:40 PM on a@b.com" or, with automatic
      resume off, "Waiting for usage: pauses for you at 3:40 PM on a@b.com" (`formatMoment`: a weekday or date
      before the time when it is not today; no account when the wait names none), the reset in
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
      these. Seven are a chat line ahead of their turn's work (`NoticeLine`, the line anatomy of 7: the label what
      happened, the meta the value, and opening it shows the reason): `retrying` (`IconArrowRotateClockwise`, "Claude
      was busy, trying again" · "1 of 3", the provider's message and "Shinsa tries the same step again by itself at
      3:41 PM."; an overloaded provider is never shown as an error), `account_switched`
      (`IconArrowsRepeatRightLeft`, "Account switched" · "a@b.com", the reason; after a sign-out it names both
      accounts: "Claude account a@b.com needed signing in again; continued on c@d.com."), `compaction` (Claude Code's or Codex's: `IconBubbleText`, "Conversation
      compacted", why: the context filled up and the agent summarised it, or idle compaction; eunoe's: `IconMinimize`, "Conversation compacted by Eunoe"
      at the limit, or `IconLayersTwo`, "Finished turns folded" for a fold, the tooltip saying nothing was
      summarised), `proxy` (`IconCloudSimpleDisconnected`, "Eunoe unavailable · Claude Code compacts this run",
      the reason and "Shinsa tries Eunoe again in a minute."), `fast_mode` (`IconSpeedMiddle`, "Fast mode
      unavailable" or "Fast mode paused", why in a sentence, and that the run continues at standard speed; "Fast mode
      needs usage credits on this account, and Shinsa never turns extra usage on." when the account has none),
      `extensions` (`IconBlocks`, what the run loaded at its start, "Loaded 4 MCPs, 23 skills, 3 plugins ·
      ~38k tokens" (the label "Loaded 4 MCPs, 23 skills, 3 plugins", the meta the tokens) without the kinds it had
      none of, or "Loaded only Shinsa’s tools"; opened, it lists each group's items one per line, biggest first,
      with their estimates, 8 per group then "and 12 more"; 29) and
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
      A turn's errors (`ErrorLine`: `IconExclamationCircle`, `red-text`) are one line per message: the same message
      said again in a turn collapses into its first line, which ends in a `fg-2` "3 times" (`collapseErrors` in
      `lib/chat/timeline.ts`), so a cause shows once however many attempts hit it. The task's state is the Overview's
      one card for it (Sign in needed, Waiting for the usage limit), never a stack of errors.
    - **Delegations** (`components/chat/delegation-card.tsx`, `lib/chat/delegations.ts`) never
      gets a run section of its own: it lives in the turn of the step that delegated it. A
      `delegation` `started` notice is a spawn card (`CARD`, 36px row): a status mark (a pulse
      in the status tone while it works or waits, amber while it waits for an answer; once it ends, the
      shared `CheckOutcomeIcon` for finished, failed or stopped), the role in `fg-2` ("Reviewer"), the
      title in medium `fg-4`, the status in its tone with the running `Duration` ("Waiting to start" neutral,
      Working blue, "Waiting for its delegations" blue while its own delegations run, "Asked the agent
      that delegated it" amber while its question is open; `lib/chat/delegations.ts`), a secondary `icon-xs` Stop (×) while it is live, then the chevron box last on the 7px trailing inset (the whole row folds it), Stop named
      "Stop “‹title›” and what it delegated" in its tooltip and `aria-label` alike. An
      open question sits under the row on a hairline; the chevron opens the delegated agent's own
      conversation inside the card, its own delegations nested the same way. A `reported`
      notice is a chat line (7), its mark in the icon slot and "Reported back: ‹title›" (or its end state,
      "Failed: ‹title›", "Stopped: ‹title›"), that opens the result when there is one.
      A delegated agent's question card reads "Asked the agent that delegated it", never "Asked
      you". A step that ended its turn to wait shows "Waiting for 2 delegations" in its live
      card, without the shimmer.
    - **Delegations on the Overview** is a `Panel` ("Delegations", `IconAgents`, "2 working
      · 1 done" in the header) right under the now card: one row per delegation, children
      indented under the task that delegated them with `IconArrowCornerDownRight`, the same mark,
      role, title, status and Stop; the title opens the chat at its card, opened along with every
      card it sits in. A task whose step waits for its delegations is "Waiting for delegations" (blue)
      wherever its status shows, and ⌘K offers Stop ‹role› ‹title› per live one.

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
      which: "Play the sound" or "Play the sound and show a test notification", 13; a blocked browser gets the same
      toast as below) and Show a notification (Never by default; choosing another asks the browser first and stays off
      with a toast when it is blocked). Sounds are Web Audio oscillators, never an `<audio>` element, so they never
      take the media keys.
    - **What triggers them**: a gate that newly enters Needs you within the focus project. The first snapshot after a
      load never chimes, a gate outside the focus project never does, and neither does one that comes into view when the
      focus changes or lifts. One chime per burst (repeated up to three times for several), one notification per gate
      (notes replaced on an open operation gate keep the same gate, so they notify nothing): the task's
      title over the pending question (or the gate's reason and body; a secret request only names what it asks for),
      on one line, cut at 180 characters with `…`. Clicking it focuses the window and opens the task.
    - **The tab**: the title is "[n] Shinsa" while n decisions are up (Needs you within the focus project), "Shinsa"
      otherwise, with the task on screen before the name on its page ("[2] SW-142 Fix login · Shinsa"), and `<meta name="floaty:status">` (`failed` while a task is paused, its setup incomplete or a sign-in
      needed, else `waiting` with a decision up, `working` while a task moves, `idle`) and `floaty:badge` (n) tell a floating window what to show.
      While the desktop app is connected, a browser page drops the count and the decision states and stays quiet (31).
    - **The health banner** (`components/status/health-banner.tsx`, `lib/connection/health.ts`): `Root` mounts it
      once at the top of the page in both layouts (never on `/ui`, which shows its card, `HealthCard`, with two
      sample problems). It reads `GET /api/health` on start and after
      every reconnect and shows only while `ok` is false: a `CARD` in the page column (`PAGE_COLUMN`, 12px above the
      page), a 14px orange `IconExclamationTriangle`, one `fg-3` sentence ("Shinsa skipped 2 damaged entries in its
      log at start. Everything else loaded."), a quiet "Details" that opens an `InfoPopover` ("Damaged log entries",
      then one `InfoRow` per problem: "Entry 41 · task.staged" over Unreadable or Not applied) and a `secondary`
      `icon-xs` Dismiss (×) with the same tooltip. Dismissing hides it for the session, until the problems change.
    - **The engine banner** (`components/status/engine-banner.tsx`, `lib/connection/engine.ts`): under the health
      banner, the same `CARD` row, shown only in the desktop app while its version and the engine's differ
      (`docs/plans/app-plan.md` → Versions and updates). An `fg-2` `IconArrowsRepeat` while it waits or restarts
      ("The engine restarts into Shinsa 0.5.0 once agents are idle."), the orange triangle when you must act ("Shinsa
      0.5.0 needs its engine restarted."), and `sm` buttons at the end, the last `primary` as macOS orders them: one
      alone (Restart now, Update Shinsa) is `primary`; of two, Restart now is `secondary` and When agents are idle
      `primary`. No dismiss: it goes when
      the versions match. `/ui` shows `EngineCard` in its three states.
    - **The Update button** (`components/status/update-button.tsx`): once the desktop app has downloaded an update, a
      `primary` `sm` "Update" in the header's trailing group, before the usage menu, in both layouts; it fades and
      scales in (`fade-in-0 zoom-in-95`, 200 ms), its tooltip names the version and says the app restarts for a
      moment and agents keep working (13), and a click installs and relaunches the app. Nothing shows in a browser or
      while the update downloads.
    - **Settings → General → Updates** (`components/settings/updates.tsx`, `lib/updates.ts`; the app's updater is
      `apps/desktop`'s, `docs/release.md` → Channels and updates) is the last group of General. In the app: a
      secondary icon refresh button "Check for updates" in its header (the app's own check, which answers in a macOS
      dialog), then 40px rows of two lines each. Shinsa (Shinsa Canary in that app): the app's version (`TOKEN_TEXT`)
      and, once the updater has something to say, its status ("Checking for updates…", "Up to date", "Downloading
      1.3.1… 42%", "Preparing 1.3.1…" while macOS's installer unpacks and verifies it, the failure in orange,
      "Restarting to install 1.3.1…" after the click, or "1.3.1 is ready" in blue with a secondary `sm` Restart to
      update, offered only once nothing is left to wait for,
      `IconArrowRotateClockwise`; a beta on Stable that is newer than the latest stable reads "Go back to 1.2.0
      (stable)?" in blue with two secondary `sm` buttons, Stay on this beta, then Download and install with
      `IconArrowDown`), over "Beta channel · Updates install when you quit Shinsa". Update channel: in Shinsa a select
      of Stable (`IconShieldCheck`) and Beta (`IconTestTube`) over what the chosen one gets: "Releases only. Coming
      from a beta, you can go back to the latest stable." or "New versions first, as pre-releases, and every stable
      release once it is newer than yours." Switching checks again at once. Under it a third row, Shinsa Canary: "A
      separate app beside Shinsa with every change merged into main, and its own data and engine." and a secondary
      `sm` Download Shinsa Canary (`IconArrowUpRight` at the end), a link to `https://shinsa.dev/download/canary` that
      opens in the browser. Shinsa Canary is its own app (its own bundle id, data, engine and port), so its bridge
      always reports `channel: 'canary'` and the web reads that as a fixed channel (`isChannelFixed`): the row shows
      Canary (`IconFeather`) as text, no select, over "Shinsa Canary is built from every change merged into main and
      updates only to the next canary.", the version row reads "Canary channel · Updates install when you quit Shinsa
      Canary", and there is no download row. ⌘K's Change a setting has Update channel (Stable and Beta) in Shinsa
      only, and Setup has Download Shinsa Canary there too; Shinsa Canary has neither. `/ui` → Settings shows Stable
      up to date, Beta with an update ready, a beta switched to Stable offered the latest stable, Shinsa Canary
      downloading the next canary, a downloaded beta being prepared, and a beta restarting to install.
      In a browser or Floaty the card holds one line: "Shinsa for Mac updates itself. Its version and update channel
      are in its own Settings."

28. **The task chat is the one place to talk.** An Answer task is how you just talk (`docs/engine.md` → Agents
    manage Shinsa); nothing in the top bar, the rail or ⌘K opens a conversation of its own.
    - **What an agent did on your behalf** shows wherever activity does: an entry an agent's management tool caused
      reads "‹handle› agent (on your behalf)" (the task’s quoted title until triage gives it a handle), a link to
      the acting task (`resolveActivityActor`), and "Shinsa (on your behalf)" when no task is named.
    - **An agent's Shinsa tools** show in its turn like any tool, as `mcp` rows of Shinsa's own server ("Tasks
      done · Shinsa"), folded with the other Shinsa tools as "Used 2 Shinsa tools".

29. **MCPs, plugins and skills are visible, and cost what they say.** On screen an MCP server is an
    **MCP** ("MCPs", "Add MCP", "No MCPs yet."): it is what people call them; the code keeps `server`. Settings →
    Integrations (`components/settings/integrations.tsx` reads `GET /api/extensions` through
    `lib/connection/extensions.ts`, asks the server to check every MCP at most once a minute (`requestServerCheck`,
    `CHECK_INTERVAL_MS`, one check at a time; in between it reads the snapshot twice, the second time to get what
    the server rebuilt behind its first answer) and reads the snapshot again whenever the window gets focus; a
    snapshot identical to the one shown does not render again; labels,
    groups, places, token text, search, the optimizer's rows and the form are `lib/extensions.ts`) is titles only,
    like the rest of Settings: no section descriptions. It opens at once: Settings reads the snapshot as soon as it
    opens on any tab (`useExtensions()` in `routes/settings.tsx`; ⌘K reads it when it opens too), the web keeps the
    last one for the session, and the server answers `GET /api/extensions` from the snapshot it last built and builds
    it again in the background (engine.md → MCP servers, plugins and skills). Agents load everything turned on
    here, for Claude and Codex alike (plugins for Claude only), and everything the user has configured starts on. Top to bottom:
    - **Search** (full-width `Input type='search'`, "Search MCPs, plugins and skills", kept in `?q=`): every word
      must appear in an MCP's name, sources, URL or command, a plugin's name, or a skill's name, description or
      folder. While it holds text the optimizer is hidden, sections without a match are hidden, every group that
      matches opens, and "Nothing matches." stands alone when nothing does.
    - **Context optimizer** (`context-optimizer.tsx`): three rows, "Leave out MCPs agents haven’t used" (a
      `Switch`, on by default; its title's tooltip says an agent loads a left-out MCP or skill when its task needs
      it or you name it), "Not used for" (a `SelectField` of 7, 14, 30, 60 and 90 days, 14 by default, plus the
      current value when it is another) and "Leave out skills too" (on by default), so out of the box it leaves out
      both MCPs and skills unused for 14 days, then a "Not used lately" block (a 32px `SettingsBlock` header, `text-2xs` medium `fg-2`) over a
      shelf of at most five rows, costliest first: each measured MCP that is on and idle past the window ("maple" ·
      "Not used in 30 days · ~4k tokens" · a secondary `sm` Turn off), and the idle skills as one row ("37 skills" · "Not used in 14 days · ~5k tokens"). While the
      optimizer is on, a row ends in "Loads when needed" instead of Turn off. Before the history is read the shelf
      says "Reading which MCPs and skills agents used…"; with nothing idle, "Agents used everything turned on
      here."
    - **MCPs** (`mcp-servers.tsx`): the header has a secondary icon button "Check all MCPs" and Add MCP.
      A config Shinsa could not read is a quiet warning row first. MCPs are grouped by status, each group a quiet
      folding block (`FoldingBlock` in `group.tsx`, laid out like the roadmap's group headers: a 32px header with the
      group's icon at `size='sm'` in its tone and no background, the title, the count right after it in `fg-2`, and
      the section chevron at the far right, 9px from the end like from the top and bottom; so the status icons sit in the column of the rows' own chevrons below
      them) over its shelf, in this order: Connected (green, `IconApiConnection`),
      Needs sign-in (orange, `IconUserKey`, the Sign in gate's glyph), Failing (red, `IconCircleX`), Not checked yet
      (neutral, `IconCircleDotted`; only while a check is due) and Off (neutral, `IconCircleMinus`; turned off, or its
      plugin is). Each group's title, tone and icon are one table (`SERVER_GROUP_STATUS` in `lib/extensions.ts`) on the
      shared tones (`lib/format/tone.ts`); Connected never takes a checkmark, which is the accent's (15). Connected
      and Needs sign-in start open; Failing, Not
      checked yet and Off start open only with six MCPs or fewer. An MCP is one 40px row, whatever number of
      places define it (`definedIn`): a chevron and the name (medium) as the details toggle, its sources in `fg-2`
      ("Claude Code, Codex"; "Claude Code · ‹path›" for one per-project MCP; every file in its tooltip), then what
      it costs or plainly why it cannot say (`text-2xs fg-2 tabular-nums`): "~4.2k tokens", "Sign in to measure",
      "Can’t measure while failing", "Checking…", or for one that is off its last estimate or "Not measured while off";
      "Loads when needed · ~4.2k tokens" while the optimizer leaves it out. Then a primary `xs` Connect when it needs
      a sign-in (a Claude Code or plugin MCP's cost carries the tooltip that Claude runs can still use the sign-in
      made in Claude Code), the `Switch` (tooltip: "Only for Shinsa’s agents. Claude Code and Codex keep their own
      settings."; toast on off: "Turned off ‹name› for Shinsa’s agents. Claude Code and Codex keep their own
      settings.") and the `•••` menu ("MCP options"): Connect or Sign in again (web MCPs), Sign out, Check now, Show
      details / Hide details, Use everywhere, Use in one project ▸, Use in one repository ▸ (radio items, the current
      place checked), Edit… (Shinsa's own) or Copy to Shinsa and edit…, and Remove behind `ConfirmDialog` (Shinsa's
      own only, "Remove MCP"). The details sit inside the row, indented to the name (`pl-7`, `pr-2`), with no surface
      of their own (`resolveServerDetail`): a failing MCP's error in red, then only its tools, a grid of names (mono
      `text-xs fg-3`) whose descriptions are each name's tooltip, or one quiet line saying why there are none ("Sign
      in to see its tools."), and last one quiet `text-2xs fg-2` line of notes joined by " · " ("Defined in
      ‹files›", "Only in the ‹name› project", "Only in ‹repo›", "Overridden by Shinsa’s ‹name›", "Its plugin is
      off", "Not used in 30 days"), whose tooltip is the command and its arguments or the URL.
    - **The MCP dialog** (`server-dialog.tsx`) is the dialog that takes a typed value (26), its description in
      `fg-2` under the title like every dialog's (`DialogDescription`): How Shinsa
      reaches it (Command on this machine, HTTP, Server-sent events), Name, then Command, Arguments (one per line) and
      Environment (`NAME=value` lines), or URL and Headers (`Name: value` lines), and Where agents use it
      (Everywhere, one project, one repository). Editing shows the saved keys with empty values and "Leave a value
      empty to keep the saved one."; the web never sees a secret. The title is "Add an MCP", "Edit ‹name›" or "Copy
      ‹name› to Shinsa", and the primary button says what it does: Add MCP, Save MCP, Save copy. A wrong field gets
      its `FieldError`; a refusal is the server's message in a toast.
    - **Signing in** opens a blank tab on the click (so the browser allows it), points it at the server's
      authorisation page, and watches until the server reads as signed in and checked: the callback page posts on
      `BroadcastChannel('shinsa-mcp')` and to `window.opener`, the snapshot is read at once on either, whenever the
      window gets focus or becomes visible, and every 2 seconds for up to 2 minutes; "Signed in to ‹name›." once it
      is.
    - **Plugins** (`plugins.tsx`): one 40px row per plugin, the name (medium; what it brings and its folder in the
      tooltip), the estimate and a `Switch`. A plugin turned off turns off its skills, agents, hooks and MCPs.
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
    - **⌘K**: Jump to has MCPs, Plugins and Skills; the global Integrations group has Add an MCP (opens
      Settings → Integrations with the dialog open through `?add=mcp`, dropped from the address once it opens), the
      three sections, and while typing "Connect ‹name›", "Turn on ‹name› for agents" / "Turn off …", "Turn on the
      ‹name› plugin", "Turn on the ‹name› skill" (or off; never one of Shinsa's own) and "Turn on the context
      optimizer" (or off). The chat's `extensions` notice row (26) shows what a run loaded, with "· 2 left out" and a
      "Left out until needed" group when the optimizer left something out.

30. **A task runs in rounds** (`docs/engine.md` → Rounds; `lib/tasks/rounds.ts`, `components/chat/round-divider.tsx`,
    `components/overview/round-header.tsx`, `components/overview/rounds-panel.tsx`). Nothing about rounds shows until a task has a second one, so a small task
    looks exactly as before.
    - **One round icon, `IconArrowsRepeatCircle`** (`ROUND_ICON` in `lib/tasks/rounds.ts`: circling arrows read as
      another pass over the same work; `IconLayersThree` stays the stacked pull request's), on every round surface:
      the facts row, the chat's round dividers, the Rounds panel and ⌘K's "Keep “‹title›” in this task". Once a task
      has more than one round the facts row has a round fact right after the handle: the icon and "Round 2 of 3"
      (`resolveRoundCount`). Its tooltip has the round header's structure and nothing else: the round and its title
      ("Round 2: Explain what it can do"), then one line with the round icon as a 16px `StatusTile` and the status in
      its tone ("In progress") and, muted at the right, when it started or ended in sentence case ("Started just
      now", "Finished 2h ago", "Stopped 1d ago"; `describeRoundTime`, `resolveRoundFact`). The handle itself stays per
      task and still copies alone. Roadmap, queue and Home rows, a task link's preview card and ⌘K read "SW-14 ·
      round 3" (`resolveHandleText`). The now card's eyebrow is one sentence-case fact per segment: "Building · Round
      2 of 3 · Agent · Started just now".
    - **The chat is one conversation; a round only marks where it starts.** Nothing folds and nothing boxes a
      round: the chat runs on from the first message to the last, and a divider (`RoundDivider`) stands where each
      round begins, on the chat line anatomy (7): the round icon in the 20px slot and one `text-xs` `fg-2` line,
      "Round 2" (medium `fg-3`) · its title (`truncate`) · its status in its tone (In progress blue, On its pull request
      green, Merged purple, Finished green, Waiting to start and Stopped neutral), then a hairline (`bg-border`, at
      least 24px) to the column's right edge. Its tooltip, over the text only, is "Round 2: ‹title›" over when it
      started or ended ("Started 2h ago", `describeRoundTime`; `resolveRoundDivider`). It is a `separator` named
      "Round 2 · ‹title› · In progress". Under it sits the request that started the round as your bubble, then its
      runs. A divider after the first gets 20px more space above it (`mt-7` against the first's `mt-2`), so a round break reads stronger than
      the space between two runs. **Round 1 has a divider too, once there is a second round**: the chat opens on
      "Round 1 · ‹title› · Merged", so every round reads the same way, its title and how it ended are named where
      its work is, and scrolling up to the top lands on a label instead of an unnamed stretch; a task with one round
      has no divider at all. The divider carries no pull request, shipping choice or progress track: the header's
      round fact and the Overview (its now card's track, the Rounds panel's pull requests and How round 4 ships, ⌘K)
      already say them. `?tab=chat&run=` scrolls straight to the run, whatever round it is in, since nothing is
      folded away.
    - **The Overview shows the current round**: every card is the current round's, and a Rounds `Panel` sits under
      the current round's content (after What changed, before Activity), never above the answer.
      It lists the earlier rounds and the rounds waiting to start, each a `RoundHeader` row: the round icon as a
      20px `StatusTile` in the round's tone, "Round 3" (medium `fg-4`), its title (`fg-3`, `Truncate`), its status
      in its tone (`text-2xs`), the chevron, then at the right its pull request (a `PrLink`-style tile and `#N`, its
      state in the tooltip) and, while the choice is still open, a ghost `sm` `SelectField` "How round 4 ships"
      with "Onto #12" and "As a stacked pull request". An
      opened round is indented to its title: a short summary in `fg-3` (`resolveRoundSummary`: what it was about,
      what it did or found, and how it ended, or for a waiting round why it is new and when it starts), then the
      quiet "Open in chat ›". A waiting round keeps its shipping select.
    - **A message can be new work.** The composer's hint still says what feedback does. At a gate that takes words
      (the plan, the review, a question, your OK, the operation, a failure, Sign in or setup gate) that is all it
      does: a message there is never queued as a round. Elsewhere Shinsa's classifier decides
      whether a message is feedback, the next round or another task's work, so the chat shows a new round's divider
      (Waiting to start) and its request as soon as one is queued. A merged task keeps its composer: "Ask for the next piece of work. It
      starts as a new round of this task." A closed task (marked done, cancelled) has none.
    - **A split-off is a suggested task's row** in Suggested tasks with Make it a task (outline) and Keep it here
      (secondary, in Dismiss's place); keeping it queues the next round ("Kept in this task. It starts as the next
      round."). ⌘K offers "Keep “‹title›” in this task" and, per round whose shipping can change, "Ship round 4 as a
      stacked pull request" or "Ship round 4 onto #12".
    - **On `/ui`** (chat specimens): the round dividers of a four-round task in every state and its Rounds panel.

31. **The desktop app is the same page in a Mac window** (`apps/desktop`, its `CLAUDE.md`; `lib/desktop.ts` on the
    web side). It loads the UI from the server (the CLI's port, `http://127.0.0.1:7446` by default), so the app, a
    browser tab and Floaty always show one version; Floaty stays the floating window and the app is the full one.
    The page learns it runs in the app only from the preload bridge `window.shinsaDesktop`; a browser and Floaty
    have none and nothing below applies there. Shinsa Canary is the same app under its own name, icon (the mark on a
    canary-yellow squircle, `icon-canary.*`) and engine on `http://127.0.0.1:7447`; its page differs only in Settings →
    Updates (above).
    - **The title bar is the top bar.** The traffic lights sit inset over the 44px top bar, centred on it.
      `applyDesktop` (called from `main.tsx`) sets `data-desktop` on `<html>` (`window`, or `fullscreen` when the
      lights are gone), and the `desktop:` variant (`app.css`) holds the room they take: the Cards top bar
      `desktop:ps-16`, the Sidebar rail's header and compact bar `desktop:ps-20`. A bar marked `data-window-drag`
      drags the window; its buttons, links, inputs and the reconnecting dot stay clickable, and toasts, dialogs,
      menus and tooltips never drag. The bars are chrome, so a drag across them never selects text, while content
      (the chat, the overview, code) stays selectable (39).
    - **Home, not the wordmark.** A Mac app's toolbar carries its controls, not its name (the menu bar and the
      Dock already say Shinsa), so in the app the Shinsa wordmark is a Home button: `HomeLink`
      (`components/layout/home-link.tsx`) renders a `NavButton` there, as Tasks and Settings are (secondary `sm`, `IconHomeRoundDoor` and the word Home; on Home itself
      `IconHomeRoundDoorFilled` in `fg-4` with `aria-current="page"`; the tooltip "Home ⇧⌘H") and `BrandLink` in a browser and Floaty, in the Cards top bar, the rail's
      header and the compact bar alike. The site's demos (`apps/marketing`, which never have the bridge) ask for the
      app's look with the `DesktopChrome` context (`lib/desktop.ts`) and render the bar at the demo's page with
      `RouteScope` (`router.ts`); nothing else reads either. In the Cards top bar the wordmark, which has no padding of its own, keeps 8px after it (`brandClassName`, `me-2`), so what it draws sits as far from Tasks as every other pair in the bar sits apart: 19px between what one button draws and the next, Home in the app, Tasks, Services and the queue on the left and Settings, usage and Focus on the right included; the icon-only Settings keeps 2px more after it (`me-0.5`), since a square icon button pads its glyph less than a labelled button does (measured from the pixels at 1440 and 900, light and dark, in the browser and the app: every gap 19px, the browser's Services to the queue 18px). The Go menu has the matching keys: Back ⌘[ and Forward ⌘] step through
      the page's own history (`MainWindow.step`, which never steps onto the waiting page,
      `resolveHistoryStep`), and Home ⇧⌘H opens `/`, as in Finder and Safari. The code editor keeps ⌘[ and ⌘] for
      indent and outdent while it has focus, since the page sees the key before the menu does.
    - **Only the app notifies.** In the app the page never creates a browser `Notification` (and the app denies
      the page that permission): `notifyDesktop` hands the decision to the app, which shows a silent macOS
      notification (the page plays its own sound) whose click shows and focuses the window and opens the task.
      Show a notification defaults to When Shinsa is in the background there, Never in a browser; the browser's
      permission is never asked. The test notification goes the same way.
    - **One surface notifies.** Every page says on connect which surface it is (`desktop` or `browser`; Floaty
      is a browser), and the server tells every page whether the app is connected. While it is, a browser tab or
      Floaty stays quiet (`isPageQuiet`, checked by `AttentionWatcher`): no sound and no notification. The count in
      the title, `floaty:badge` and `floaty:status` stay as they are, since Floaty reads them to show what waits.
      Settings → Notifications there shows one line instead of its rows: "The Shinsa app is open and handles
      notifications, so this page stays quiet." The app keeps all of it, the Dock badge included. When the app
      quits, the next decision rings in the browser again; the ones that came up while it was open never do.
    - **The Dock badge** is the tab's count: `writePageAttention` sends `floaty:badge`'s n to the app with the title
      and the meta tags, and the badge clears at 0 and while the server is unreachable.
    - **`shinsa://` links** open in the window, from any app or from inside the page: `shinsa://task/LOC-4` (a
      handle or an id) opens the task, `shinsa://tasks`, `shinsa://settings` and `shinsa://` their pages, anything
      else Home. Links to other sites open in the default browser.
    - **The engine's status page**: the app starts its own engine, so there is no dialog and nothing to run. While the
      engine starts the window shows one quiet page with a small spinner ("Starting Shinsa"); when it cannot run, the
      same page says why and offers the fix, the first button `primary`: Allow Shinsa to run in the background (Open
      Login Items, Try again), Port 7446 is taken, The engine keeps stopping (Start engine, Copy details, with the
      engine log's warnings and errors under it), or The engine is not running (Start engine, Open Privacy & Security,
      Copy details). The page opens Shinsa by itself as soon as the engine answers, and the window switches to it if
      the engine stops answering for 15 s while you work (`apps/desktop/src/lib/engine.ts`,
      `static/waiting.html`).
    - **The window**: closing it hides it (the page keeps its socket, so the badge and notifications go on), the
      Dock icon or Window → Shinsa brings it back, ⌘Q quits the app and never stops the engine. Its size and place
      are kept and restored onto a connected display, 900 × 1100 by default. The menu is macOS's own (Settings… ⌘,
      opens `/settings`; View has Reload ⌘R, zoom, full screen; Go has Back, Forward and Home); no other shortcut
      and no menu bar icon.
    - **It is called Shinsa** in the menu bar, its first menu (About Shinsa, Hide Shinsa, Quit Shinsa), the About
      panel, the Dock and notifications, packaged and in development alike. The menu bar and the Dock read the
      bundle's `CFBundleName`, so `bun run dev` runs a copy of Electron.app renamed to `.electron/Shinsa.app`
      (`scripts/dev.ts`, under the bundle id `studio.overclock.shinsa.dev`, with Shinsa's icon) rather than
      Electron.app itself.
    - **No pointer hand, every other cursor.** A Mac app shows the arrow over buttons, links, tabs and rows, so
      inside the app (`html[data-desktop]`) whatever a browser shows the pointer hand on takes the arrow instead
      (`src/desktop.css`, imported by `app.css`): the elements and roles the kit's base rule gives the pointer,
      `a[href]`, `cursor-pointer`, an inline `cursor: pointer`, CodeMirror's fold markers and completion rows, and
      the text inside them. It is `!important` so it beats utilities, the kit, inline styles and third-party
      sheets, and it stops at any other cursor utility. Nothing else changes: text and inputs keep the I-beam, a
      resize handle and the whole page while a pane is dragged the resize cursor, what drags grab and grabbing,
      `zoom-in` images the magnifier, and a disabled control `not-allowed` (inside it too). A browser and Floaty
      keep the pointer (Component checklist → State). `test/desktop-css.test.tsx` renders the clickable controls
      under the kit's cursors and fails if any computes `pointer` in the app or if text, resize, grab or
      not-allowed is lost.
    - **Native feel.** The page root never rubber-bands in the app (`overscroll-behavior: none` on `html` and
      `body`); a scroller inside still bounces like any Mac list. There are still no focus rings (11). Getting
      around is instant (35).

32. **The Code tab is a small workbench** (`components/code/`, `lib/code/`, `routes/task/code.tsx`, lazily loaded with
    its editor). Every task with a repository has one (`listTaskTabs`); a task with changes opens it on Changes,
    one without on Files, reading the repository at its default branch. Since 2026-10-25 the review is not a mode of
    the workbench: it is the Review tab (34), and Code is the raw material, the changes and the files.
    - **It opens at once** (`routes/task/lazy-code.tsx`, `lib/code/prefetch.ts`). A task page that has a Code tab
      prefetches it when the browser is idle (`requestIdleCallback`, 2 s at most), and at once when the Code tab is
      hovered or focused, or open on load: the tab's and CodeMirror's chunks, the tokenizer worker, and in parallel the
      refs, the diff, the root folder, the file the review opens first (both sides of it) and that file's language. Reads go through the
      one cache by commit (`lib/connection/code.ts`), and a read already answered renders in the same frame, with no
      "Reading…" frame between; the paths list for ⌘P is read when the tab opens, not when ⌘P is pressed. Neither
      the tab nor the editor is a `React.lazy` behind Suspense: React 19 holds a revealed Suspense boundary for
      300ms, which was most of the wait.
    - **Every click is instant** (since 2026-10-25; the numbers and how they were measured are `docs/performance.md`
      → Code tab). A tree row acts on the mouse press, not the release (a file opens, a folder opens or closes;
      touch and the keyboard still act on the click), and nothing in the Code tab animates: hover and selected
      backgrounds, the indent guides, the chevrons and the kit's buttons inside it change in the frame they are asked
      to (`INSTANT` on the workbench turns every transition off). The one exception is a tab indicator: the kit
      marks every `Tabs` indicator `data-motion="move"` and `INSTANT` skips it, so the explorer's Changes / Files and
      a finding's Fix / Dismiss (`FindingVerdictChoice`) slide with the kit's movement duration, exactly as the task
      tabs' does, while their colours stay instant. `INSTANT` names the transitions of `::before` and `::after` with
      `[&_*::before]`, never the `before:` variant, which also gives every element an empty `content` box: in a flex
      row that box is an item, and it pushed the explorer's header apart (2026-10-26). A file is read before you click it: hovering a row
      for 40 ms (`useHoverIntent`) or focusing it reads it (both sides of a changed file) and tokenizes it in the
      worker, in side by side builds the file's pair of editor states when the browser is next idle
      (`EditorSession.prefetchPair`), so a first side-by-side view costs what a revisit does, and opening a file reads the two files after it and the one before when the browser is next idle
      (`listNeighbourPaths`, `scheduleIdle`). The Files tree reads the closed folders in view when the browser is idle
      (up to 64 at a time), so opening one shows its rows the next frame; a folder not read yet opens in the one render
      its rows arrive in (`flushSync`), never a loading frame. There is one CodeMirror view per Code tab (`EditorSession`,
      `lib/code/editor/session.ts`): opening a file swaps that file's state into it instead of building an editor, and
      the last 24 files keep their state (scroll, folds, cursor, undo) to come back to. A file shows as plain text the
      frame it arrives in and takes its colours from the worker a moment later, or at once when its tokens are
      cached (by language and text); the Lezer language that folds and indents it joins when the browser is idle.
      `shinsa:code-open` and `shinsa:code-shown` (and `shinsa:tree-toggle` / `shinsa:tree-toggled`) are User Timing
      marks around each open and each folder toggle (`lib/code/marks.ts`).
    - **Shape.** An explorer column on the left, or on the right when Settings → Appearance → File list (⌘K has it too,
      and the Code tab's ⌘K "Move the file list to the right") says so, kept in `shinsa.code-explorer-side` (280px by
      default, resizable from 200 to 480 by the same handle as the rail, on whichever edge faces the code, the width kept
      in `shinsa.code-explorer-width`; never narrower than its header row needs: the explorer
      measures the mode tabs and the search button at their natural width and that, with the row's padding, is the
      least the handle allows, so the search button never covers a tab, whatever the modes or the font; below `md` it is a sheet opened from the toolbar's
      Show the files, closed by picking a file, Escape or a click outside) and the editor on the right: the 36px
      `Toolbar` (the file's icon, its path and diff counts, "Saving…" while an edit is on its way, and on a diff the
      layout toggle), then the code. The toolbar has no Open in editor: Shinsa is where you read and edit the code
      (the task's ⌘K and its menu still open the checkout in your editor). There are no editor
      tabs: one file is open at a time, and you switch from the file list, the review, a search result or ⌘P. The
      column's header is the mode `Choice` (Changes, Files; one mode shows as its plain label), the
      search button (`icon-sm`, pressed while Search is open) and the ref picker under them: a `SelectField`
      (`sm`, full width) with Head of the branch (or the default branch's name), Working copy (while the worktree
      exists; its hint says whether there are uncommitted edits), Base, and every earlier commit by its subject, each
      with its short id as the hint. The ref is the "after" side of everything: the trees, the files, the search and
      the diffs (base against it).
    - **Spots and findings in the code.** A spot's lines carry a 3px mark in its attention tone (Critical red, Read
      carefully amber, Context `fg-2`) in a gutter of their own left of the line numbers (`cm-spotGutter`,
      `lib/code/editor/annotations.ts`); hovering it names the attention and why ("Read carefully: …") in the app's
      `Hint` tooltip, beside the mark and following the pointer down it (never the browser's `title`: each drawn
      mark is handed to `SpotHintRegistry`, `lib/code/editor/spot-hints.ts`, and the editor renders a `Hint` into
      it), and a line two spots share takes the stronger tone and both reasons, one to a line. The code itself carries only the diff's own marks (below),
      so a coloured bar on a line of code always means added (green) or removed (red). The `spot` in the URL (a link
      from the Review tab) washes that spot `primary-a1` and scrolls to it. There is no walkthrough here and no
      Previous spot / Next spot: stepping through what needs you is the Review tab's (34).
    - **A link to a file and line opens it there** (`FileLink`, the review's snippets, the chat's file references,
      the Overview's finding cards: all `resolveCodePath`). The Code tab opens on that file, whatever file it had open
      and whether or not it was opened before (a kept tab never puts back the file it last showed over the one the
      address names, `hasFileInAddress`), scrolls the line to the centre, opening any fold over it (in side by side
      both sides' folds, `revealSplitLines`), and washes the line or range `primary-a3` for 2 s
      (`FOCUS_FLASH_MS`), then leaves it `primary-a1` while the file stays open.
    - **A changed file opens at its first change** (`revealFirstChange`, `lib/code/editor/first-change.ts`). Opened
      without a line (from Changes, the Files tree, quick open, a search's file, a Review place or a smart link with no
      line), a diff in either layout, or a changed file opened as a plain file (read against the base, `baselinePath`),
      scrolls once the editor has measured so its first changed hunk sits near the top with 3 lines of context above it
      (the margin a fold keeps, so the change is never behind a fold); when the change already starts in the top half
      of the pane nothing moves, and an unchanged file opens at the top. A line or spot in the address keeps going to
      that target. Each file is placed once: coming back to it puts back where you left it, and a show, hide and show
      again before a frame (React's StrictMode in development) keeps that place (`EditorSession`'s settling entry).
    - **Changes** is the changed files as a tree (folders first; a chain of single folders is one row, `apps/web`),
      each file with a red risk dot with its reason, your comment count, the diff counts (or Binary), its status
      letter (Added green, Deleted red, Modified and Renamed `fg-2`, the name in a tooltip) and a viewed box: the
      kit's `Checkbox` at `sm` (14px, a quiet `icon-1` edge that turns `fg-1` on hover, `rounded-checkbox`; ticked,
      filled `primary-4` with a white check centred over the whole box, border included, so it sits true at 14px as
      at 16px), with no tooltip: the box says what it does. The diff counts have no tooltip either; the letter's says
      its name ("Added") and your comment count's what it counts ("2 comments from you"), since neither is on screen
      (13). A folder has a viewed box too: ticking it marks every file under it, at
      any depth, viewed (`writeViewedFiles`), unticking clears them, and it reads ticked when all of them are viewed
      and indeterminate (the kit's `Checkbox` with `indeterminate`, a dash) when some are; a fully viewed folder greys
      like a viewed file. A viewed row reads as done, greyed to the disabled step: its name, status letter, counts, comment
      count and risk dot all `fg-1`, its icon in `icon-1` even when the language mark is coloured
      (`file-icons-muted`); the open file keeps its selected look whether viewed or not. "2 files · 1 viewed"
      heads the tree beside the total counts and the Hide viewed files toggle (`icon-xs`, an eye; remembered in
      `shinsa.code-hide-viewed`; ⌘K has the same toggle), which drops viewed files from the tree but the open one and then reads "2 files ·
      1 viewed hidden". When every file is viewed the tree shows only the calm line "Every file is viewed." in its
      place, with no button (the header's toggle shows them again), even for the open file, which stays open in the editor (`listShownChanges`). Viewed files
      are kept per task and commit.
      **Files** is the repository as a lazy tree, a folder read when you open it (`/tree`), the open file's folders
      opened for you; changed files carry their status letter at the right. **Search** (the button or ⇧⌘F) is a
      field with the three search toggles inside it, a Files to include pattern, a one-line summary ("12 results in
      4 files." and whether it stopped early) and the matches grouped under a collapsible row per file, the match
      marked in `amber-a2`; a result opens its file at its line.
    - **Tree rows are compact, like VS Code** (`components/code/tree-row.tsx`, `TREE_LIST`): 22px, `text-2xs`,
      indented 8px a level, then a 14px chevron slot (empty for a file, so a level's icons share one column), the
      14px file or folder icon and the name, 6px after it. Hover is `bg-bg-a2`, the open file `primary-a1` with
      `fg-4` text, so the two never read as the same. The Changes, Files and Search trees all use it; the list sits
      4px in from the column (`px-1 py-1`). Hover and selection change in the same frame, with no transition, and a
      folder's chevron turns without one. **Indent guides** are VS Code's on hover: a 1px line under each
      ancestor's chevron, hidden until the pointer is over the explorer column (`TREE_HOVER_GROUP`, shown at once),
      then `bg-a4`; the guide of the folder holding the open file is `fg-1`, a step stronger, over that
      folder's rows only (`findActiveGuide`, `resolveActiveGuide`, `pickGuideLevel` in `lib/code/tree.ts`).
    - **File and folder icons** (`lib/code/file-icons.ts`: `resolveFileIcon(path)`, `resolveFolderIcon(path,
      open)`) mark every file in the trees, the review's spots, search results, ⌘P, the editor's toolbar and every
      `FileLink`. Well-known names win over the extension (package.json, the lockfiles, tsconfig, Dockerfile and
      compose files, `.gitignore`, README, LICENSE, CHANGELOG, CLAUDE.md (Claude's mark) and AGENTS.md (a sparkle,
      the generic mark for agent instructions, in purple), `.env*`, tool configs, test files), then the extension, then a plain page (`IconFileText`). They are `Icon`s like any other, drawn at
      `sm`: Central's own language marks (TypeScript, JavaScript, React, Markdown, Rust, Swift, Java, PHP, C++, Vue,
      Svelte, npm, Git) and Central glyphs for the rest (`{}` JSON, `#` CSS, `</>` HTML, a console for shell, a key
      for `.env`, a lock for lockfiles, a test tube for tests, a gear for configs), plus our own marks for Python,
      Go, Docker and a database (`components/icon/custom.ts`). A mark that helps you tell a language apart carries
      a soft pastel tint (`TONED_ICON_SOURCES`: the base icon drawn in `--file-<tint>`, fifteen tints set apart
      from the tone ramps in globals.css, mid-light in light and lifted and a little drained in dark, so a tree of
      them reads as gentle colour and each language as its own hue): TypeScript and tsconfig blue, JavaScript and
      `.env` gold, React and Docker azure, Python yellow, Go cyan, Rust orange, JSON and SVG amber, CSS purple,
      HTML, Swift, Svelte and Git coral, Markdown slate, YAML pink, shell and tests green, Vue and databases teal,
      PHP and C indigo, Java, npm and PDF red. The rest draw in the row's icon ink. A row that sets
      `file-icons-muted` (a viewed file) draws even the tinted marks in its ink: the generator writes each mark's
      colour as `var(--file-icon-ink, var(--file-<tint>))`. A closed folder is solid (`IconFolder1Filled`) and an open
      one outlined (`IconFolderOpen`), as in VS Code's icon themes, and the folders that say what they hold are tinted
      (`IconFolderSource`…, solid while closed): `src`/`lib`
      blue, tests green, docs azure, `scripts`/`bin` gold, assets purple, `.git`/`.github`/`.husky` coral.
    - ⌘P (Go to file) opens any file of the repository by name: Buzzkit's command dialog over every path at the
      ref, ranked by `rankPaths` (a name that contains what you typed first, then word starts and consecutive
      letters), the matched letters in `primary-text`, the folder as the hint, the open file first with no query.
    - **Search toggles** (`components/code/search-field.tsx`, `SEARCH_OPTIONS`): Match case (`IconTitleCase`),
      Match whole word (`IconWholeWord`) and Use a regular expression (`IconRegex`), the last two our own marks,
      `icon-xs` buttons with 14px glyphs inside the right end of the field. Off they are the field's quiet ink, on
      they are `primary-text` on a `primary-a2` fill, so the state reads without hovering. The file search and the
      editor's find bar share the field.
    - **The editor is CodeMirror 6**, coloured from the `--code-*` tokens (`globals.css`: keyword purple,
      string green, number orange, comment `fg-2`, function `primary-text`, type amber, property blue, tag red,
      punctuation `fg-3`; the diff washes `--code-added`/`--code-removed` and their strong steps for changed words),
      12px ABC Areal Mono on an 18px line, so both themes need no override. **Highlighting is VS Code's**: the
      TextMate grammars VS Code itself ships (through Shiki's `@shikijs/langs` and the Oniguruma engine) tokenize the
      file in a worker (`lib/code/editor/tokenize.worker.ts`, `textmate.ts`), line by line from each line's state, a
      slice at a time with the file on screen ahead of prefetching, and only from the first line an edit changed;
      the editor draws the visible lines' tokens as classes (`lib/code/editor/syntax.ts`, `tm-code-keyword`…).
      One theme maps TextMate scopes to the `--code-*` tokens for the editor and every other highlighted code (chat
      code fences, tool output and snippets, `lib/code/grammar.ts`, `CODE_THEME`), so a fence and the editor read the
      same tokens and colours in both themes. Comments follow Better Comments (the user's VS Code extension): one
      that starts with `!`, `?`, `TODO`, `*` or a second `//`, after its marker or a doc comment's margin star, takes
      `--code-comment-alert` (red), `-query` (blue), `-todo` (orange), `-highlight` (green) or `-strike` (`fg-1`,
      struck through) from the tag to the end of the line (`lib/code/comment-tags.ts`, tokens in `app.css`), in the
      editor and every fence alike. Markdown is rich: headings bold, emphasis, code spans, fenced code in
      its own language (the worker loads each fence's grammar first), links underlined, lists, tables and front
      matter (as YAML). The language comes from the path the way VS Code decides it (`resolveGrammar`): the name
      first (`Dockerfile`, `Makefile`, `COMMIT_EDITMSG` and the other git message files as git commit,
      `git-rebase-todo`, `.gitignore`, `.dockerignore` and the other `*ignore` files with a small ignore grammar,
      `.env*` as dotenv, `tsconfig*.json` and `.vscode/*.json` as JSON with comments, `Cargo.lock` as TOML), then the
      folder (`.husky/*` hooks as shell), then the extension (TOML, Prisma, Proto, Astro, Svelte, MDX, Terraform and
      a hundred more), then the shebang. A line over 20,000 characters stays plain, as in VS Code. A diff opens side by side:
      CodeMirror's merge view with the old file on the left. Unified is the toggle (an `icon-sm` button at the
      toolbar's end, hidden below `md`, showing the layout it switches to: `IconLayoutTopBottom` "Show unified",
      `IconLayoutColumn` "Show side by side"; ⌘K has it too), remembered in `shinsa.code-unified`. Unified puts
      removed lines above where they were, highlighted from a parse of the whole old file (so a removed line inside a
      block comment reads as a comment), numbered in red in the gutter. A changed line has exactly two layers: the
      line's wash (`--code-added` or `--code-removed`, the whole width) with a 2px bar at the code's left edge in
      `green-4` or `red-4`, and the strong wash on the words that changed; nothing boxes the line's text. The bar is
      on the code, not in the gutter, so it slides with the code when it scrolls sideways. Unchanged
      stretches of four lines or more fold into "N unchanged lines": a click opens them, and they are no place for the
      cursor, so the arrow keys step over a fold (`lib/code/editor/collapsed.ts`, a transaction filter that moves a
      cursor landing in a folded block widget past it in the direction it was going; a selection or an edit is left
      alone). Each side scrolls sideways on its own: its line numbers stay pinned at its left on the page background
      and the code slides under them, while the fold labels and the notes under lines stay beside the gutter. They
      are block widgets in the editor's content, `position: sticky` at the gutter's width (`--cm-gutter-width`,
      measured when the editor's geometry changes, never on scroll; `pinBlocksToGutter`) and as wide as the visible
      side, so they move with the text in the same frame, vertically and sideways, and never widen what the side
      scrolls over: a side scrolls as far as its code and no further. A file added or deleted whole has one side only, so side by side shows
      that side at the full width (the unified view, no empty half) and the layout toggle is hidden for it
      (`hasOneSide`). Below `md` (a phone or a narrow window) every diff is unified and the toggle is hidden, since two
      columns of code do not fit. A binary file shows nothing as text, and an image before and after on a checkerboard; a file
      over 2 MB says its size and that it is too large to show as text. A file over 1 MB, or with a line over 10,000
      characters (a minified bundle), stops before the editor with "Opening this file may slow the page", the reason
      ("‹path› has a line of 900,000 characters, too long to show as text.") and Open anyway (`resolveTextGuard`).
    - **You edit directly.** The file at Head of the branch or the Working copy of an open task is editable: typing
      edits, there is no mode to turn on and nothing to confirm, and ⌘Z undoes (every VS Code editing key, below). In a diff the new side is the editable
      one (the right side side by side, the whole editor unified) and the diff follows each keystroke. Each pause
      (600ms) saves the file to the task's working copy (`lib/code/edits.ts`, `FileSaver`; `hooks/use-file-saver.ts`;
      `POST /api/tasks/<id>/file`, `docs/engine.md` → Your edits), "Saving…" shows in the toolbar meanwhile, and a file
      you leave or close is saved at once, as is the file when you press ⌘S. A save never rebuilds the editor: when
      the first save makes the file one you edited and its read moves to the working copy, the pane keeps the text on
      screen until the new read lands (`holdPaneContent`), so the cursor, focus and undo history stay where they were. A save names the text it expects on disk; when the file changed there (an
      agent writing, another window), the editor takes the disk version: your unsaved edit is kept when it touches
      other lines, and otherwise the disk version shows with "This file changed on disk where you were typing, so it
      shows the new version." in a one-line strip under the toolbar (`IconCircleInfo`, `text-2xs` `fg-2`). Once you
      edited a file, the Code tab reads it from the working copy, so a reload shows your edit and not the commit
      (`isEditedPath`; in GitButler the working copy is the files the task owns read from disk and the rest from its
      branch, `docs/engine.md` → Your edits). Elsewhere the
      editor is read-only and the same strip (`IconLock`) says why: an earlier commit or the base ("This is an earlier
      commit, so it is read-only. Pick Head of the branch to edit."), a merged task, a finished one, one with no checkout
      (`resolveEditRefusal`, core), or the server's refusal of a save. Shinsa still makes every commit: your edits go
      into the round's next commit, and the agent hears which files you edited (`docs/engine.md` → Your edits).
    - **Inline.** Findings sit under their last line as the review card (`ReviewNote`, 34) in its compact form: the
      author (Agent review), the tone (Blocking red, Suggestion amber), the title, the message as markdown and the
      suggested fix, with no snippet or place (the line above is the place); at a review gate the row of its label and
      title carries the same Fix / Dismiss `Choice` on its right as the Review tab and the Overview (`NoteHead`,
      `components/review/verdict-choice.tsx`, on the
      one review draft, so a verdict set anywhere shows everywhere). Each spot's lines carry their mark in the spot
      gutter (above) and the selected one the `primary-a1` wash. Every note is rendered by React into an element
      the session keeps per note (`SlotRegistry`), and the editor's block widget only moves that element in and out,
      so a note scrolled back into view is already drawn at its height and nothing trails the scroll. At a review or
      merge gate a click on a line number opens a comment box under it (on the selected lines when the click is in a
      selection); a removed line's number does the same for the removed line, and its comment sits under the removed
      block. A comment is kept per gate in localStorage, anchored to the commit it was
      made at, and goes with Request changes. Saved, it is the compact review card with its header bar (34),
      authored You, its lines as the tag, with Remove at the right of the bar, and folds from the bar. A comment is words only; to change the code, edit it (above). The comment
      box and every note under a line are at most 36rem wide and never wider than the side they sit in less its
      gutter (`100cqw - 6rem`, each editor being its own inline-size container), so a box for a long selection wraps
      inside the visible pane instead of running off it.
    - **Keys.** While the Code tab is open, and only then, it binds ⌘P (Go to file), ⇧⌘F (Search in files), ⌘F
      (find in the open file) and ⌘G (go to line), Ctrl elsewhere (`hooks/use-code-keys.ts`,
      `lib/code/keys.ts`). Each is also a ⌘K command with its key at the right, so the menu stays the one complete
      place. This is an exception to ⌘K being the only shortcut, as are the Review tab's J and K (34) and the Terminal
      page's ⌘T and ⌘W (37), and `bun lint:conventions` rejects a global key listener anywhere else. Inside the editor, CodeMirror's own keymap gives VS Code's editing keys
      (`lib/code/editor/commands.ts`, `EDITOR_COMMANDS`, each one CodeMirror command; Ctrl for ⌘ off the Mac where
      VS Code does): ⌘S save now, ⌘Z undo, ⇧⌘Z and ⌘Y redo, ⌘F find, ⌥⌘F (Ctrl H) replace, ⌃G and ⌘G go to line,
      ⌘D add the next occurrence, ⇧⌘L select every occurrence, ⌥⌘↑ / ⌥⌘↓ (Ctrl Alt) add a cursor above or below,
      ⌥-click add a cursor, ⇧⌥-drag select a column, ⌥↑ / ⌥↓ move the line, ⇧⌥↑ / ⇧⌥↓ copy it, ⇧⌘K delete it,
      ⌘] / ⌘[ indent and outdent (Tab and ⇧Tab too), ⌘/ toggle a line comment, ⌘L select the line, ⌃⇧⌘→ / ⌃⇧⌘←
      (⇧Alt → / ←) expand and shrink the selection by syntax, ⌥⌘[ / ⌥⌘] (Ctrl ⇧[ / ]) fold and unfold the block,
      ⌃⌥[ / ⌃⌥] fold and unfold every block, Escape back to one cursor. They act only while the editor has focus,
      so they are no global listener, and ⌘K lists every one in its Editor group with its key (`lib/command/editor.ts`;
      the ones that edit are off, with the reason, on a read-only file).
    - **Folding is VS Code's.** A gutter after the line numbers holds a chevron for every line that starts a block,
      shown while the pointer is over the gutter, and always on a folded line (`lib/code/editor/folding.ts`); a click
      folds or unfolds, and a folded block shows `⋯` on a soft `bg-a2` pill that unfolds on a click. Blocks come from
      the syntax tree where the language has one (JSON objects and arrays, TypeScript blocks, Markdown sections and
      fences, Python bodies), and from indentation otherwise, as VS Code folds a language without a folding provider
      (`indentFolding`: a line folds what is indented under it, over blank lines). The fold keys and ⌘K's Fold the
      block act on the same blocks.
    - **Find in the open file** (⌘F) is our find bar in CodeMirror's top panel (`components/code/editor/find-bar.tsx`
      on `lib/code/editor/find.ts`, which hands the panel's element to React): the shared search field (up to 320px),
      Previous match / Next match right after it, then "3 of 12" (or "No results", counted up to 999), and Close at
      the far end; Enter and ⇧Enter step, Escape closes and puts you back in the code. On an editable file a chevron
      before the field (Show replace) opens a second row, also opened by ⌥⌘F: Replace with, Replace and Replace all
      (Enter replaces the next, ⌘Enter all). CodeMirror's own panel, with its text buttons and checkboxes, is gone.
    - **Loading is centred, and almost never seen.** The Code tab's reads are prefetched (above and 36), so in
      normal use none of its waits shows. When one does ("Reading the code…", "Opening the code…", "Reading the
      changes…", "Reading the files…", "Opening ‹path›…"), the pane stays empty for its first 300ms and only then
      shows the spinner with its line under it, centred in the pane it holds (`components/code/code-loading.tsx`).
      Searching keeps the last results on screen while the next search runs, with "Searching" under the field
      only after 300ms.
    - **Nothing moves when you switch.** Switching the ref (Head of the branch, Base, Working copy, a commit) or
      Changes and Files measures zero layout shift (a `layout-shift` PerformanceObserver over every switch, on the
      seed and on a 4,500-file task): the changes tree keeps the diff on screen until the next ref's diff arrives
      (`holdLoaded`), the Files tree keeps its last fully read rows until every open folder of the new ref is read
      (`isTreeSettled`) and then shows the new commit's rows as a new list, and a new editor stays hidden until
      CodeMirror has measured its lines, so its gutter never slides into place.
    - **Large changes stay fast.** The trees and the search results are virtual lists (`VirtualRows`, 22px rows), so
      a change of thousands of files or a 100,000-file repository renders only the rows in view. The diff the tree
      reads is a summary with patches for the small files only (`docs/engine.md` → The Code tab's reads); the editor
      reads both sides of the open file and never the whole patch. Opening a file swaps a state into the one editor,
      its tokens come from the worker and its Lezer language joins when the browser is idle, and the merge diff gives
      up after 20ms (`DIFF_CONFIG`), so no main-thread task passes 50ms on open, scroll or switch (measured on a production build: `.playwright-mcp/shinsa-perf/` in the Kanna checkout). A search
      streams: matches show as they are found, and the summary line once it ends.
    - **Every position is in the URL** (`lib/code/location.ts`): the mode, the open file and whether it
      is a diff, the line and range, the ref, the spot, the order and the search, so a reload or Back
      puts you where you were. Files are read by commit and cached by commit (`docs/engine.md` → The Code tab's
      reads), so a merged task whose worktree is gone keeps its code, a review never shifts while an agent types, and
      nothing is read again because the task changed in some other way.
33. **Two ways to show code: the Code tab is an editor, every other diff is `@pierre/diffs`.** The Code tab (32)
    stays CodeMirror 6, its merge view included: it edits, finds, goes to a line, folds and
    holds a 10k-line file, which a diff renderer does not. Every small diff anywhere else goes through one wrapper,
    `CodeDiff` (`components/text/code-diff.tsx`), on `@pierre/diffs` (diffs.com): the chat's Edit and Write rows
    (a write is a new file, every line added), the spots in a phase hand-over card, the Review tab's points (34) and a review finding's code (in the chat's review card and the fix gate's findings). Never hand-build `+`/`−` rows or a second diff renderer.
    - **Lazy.** `CodeDiff` itself is a few lines in the entry bundle; the library loads with
      `components/text/code-diff-view.tsx` the first time a diff is shown (its own chunk, about 81 KB gzipped, and
      the Shiki grammars it shares with the code fences), and the language's grammar is loaded before the first
      paint, so a diff never shows without its colours. It is not behind `React.lazy` (`requestCodeDiffView`): a task
      page with a Review tab loads it at idle and when a task row is hovered (36), and if it is still loading the
      space stays empty, with "Reading the changes" only after 300ms.
    - **Looks like the rest of the code.** The syntax colours are `lib/code/highlight.ts`'s theme on the `--code-*`
      tokens; changed lines wash `--code-added` / `--code-removed`, changed words their strong steps, line numbers
      `fg-2` (green or red on a changed line), on a transparent background in ABC Areal Mono at `text-2xs` on an
      18px line (`lib/code/diff-theme.ts`). It follows the page's light or dark class (`useColorScheme`). No file
      header, no border and no background of its own: the card it sits in (the chat's detail block, the change
      snippet's frame, the comment) is the chrome.
    - **Unified, folded at 14 lines.** Always unified. A diff over 16 rows shows 14 and "Show N more lines"
      (`resolveDiffClamp`, the chat's own button). A snippet (an edit's old and new text) has no line
      numbers and marks lines `+`/`−`, since its numbers would not be the file's; a whole file or a slice of the
      task's diff is numbered with a 2px bar on changed lines. A binary file says "A binary file, not shown as
      text.", a renamed one "Renamed from ‹path›." above its lines, identical text "No line changed."
    - **A change snippet** (`components/text/change-snippet.tsx`) is a file and its lines in a frame, folded until
      you open it. Its header (28px) is the file's icon, path and lines, and a click anywhere on it but the place folds
      it, the chevron box 3px from the top, bottom and end; on a task with a repository that place is a link that
      opens the Code tab at those lines (with the spot, so the Code tab washes it; "Open in Code" on hover), and it can
      lead with a label (a spot's attention). Open, open, it shows the task's diff (base against head) narrowed to the hunks around those lines with
      two lines of context (`narrowHunks`), the lines themselves washed `primary-a1`; when the change does not reach
      them, the file at the head around them as unchanged lines (`createContextHunk`). A finding's place is its
      header, so a finding with a snippet drops its place chip. A blocking finding's snippet starts open
      (`startsOpen`); a suggestion's and every spot's stay folded.
34. **Review is the technical read; the Overview is the decision** (`routes/task/review.tsx`,
    `components/review/note.tsx`, `lib/review/report.ts`, since 2026-10-25; the deep read since 2026-10-26). Review is
    a task tab of its own, after Overview and before Code: Overview, Review, Code, Chat. It shows once there is something
    to review (`hasReview` in `lib/tasks/tabs.ts`): the task builds, and it has a work report or agent findings, or it
    reached the review gate or anything after it. The two never say the same thing twice. The Overview is the quick
    decision layer: the findings with Fix / Dismiss, suggestions, the checks in the facts, What changed (each phase's
    title and summary, no code) and one line pointing here. Evidence is shown once: on the Overview it is one card
    whose only content is its 36px header band, "4 pieces of evidence in the review" with See the evidence at the
    right (`components/evidence/evidence-pointer.tsx`), and the Activity panel's "Attached …" rows carry no
    thumbnail; a task with no Review tab (an operation) shows the Evidence panel on the Overview instead. Review is the in-depth read of how the change works: what it
    does, the structure and flow of the new logic, the pieces of code that carry it explained simply, and above all the
    judgement calls made on the way, with the alternatives and why. It guides you through everything the change asks you to
    know, every important point marked; forty or fifty points on a large change is normal. It reads top to bottom as a
    document in the same centred column, never a split with a file list:
    - **What the change does.** A `NowFrame`: the status and the diff counts as the eyebrow, the report's headline as
      the title, and how many points it marks and which matter most ("40 points to read, 1 blocking, 4 critical, 10
      judgement calls, 2 disputed by the agent review."). The decision sits at its top right exactly as on the Overview's now
      card (`ReviewActions`, `components/overview/review-actions.tsx`, shared by both): Approve changes, or Fix N
      findings once you keep any, or Merge #N at the merge gate; Request changes stays ⌘K's. The Fix / Dismiss verdicts
      and your line comments live in the review draft (`ReviewDraftProvider`), so the Overview, the Review tab, the Code
      tab's inline cards and ⌘K always agree. Without a report the points come from the riskiest changes, and without a
      walkthrough the review is the marked points; a quiet line says which.
    - **Evidence, before the code** (`components/evidence/`, `lib/evidence/`, since 2026-10-26). Right under it, an
      **Evidence** `Panel` (`IconImages1`, the count of items after the title) shows what the agents attached this round
      (`docs/engine.md` → Evidence) as items grouped by kind, each group under a `SectionLabel` naming its kind
      (Comparison, Recording, Screenshot, Test, Check, Note, Preview; plural with the count beside it when the
      group has more than one), in that order (`resolveEvidenceLayout`, from core's `listEvidenceItems`). A comparison
      is one item: its title and facts ("1280px · Dark"), what to look at, then its parts side by side (three across
      from `sm` when it has more than two), each labelled Before, After or its state. One view shot in light and in dark
      is one comparison too, its parts labelled Light and Dark and its facts the width alone ("1280px"), since its parts
      differ in theme. Recordings and screenshots sit in
      a two-column grid (one below `sm`), each with its title, facts and what to look at; a lone screenshot shows no
      stage, since it has no before. A test or a check is a reference to one of the task's checks, never a text of its
      own: every piece with a `checkId` (the agent's link, `shinsa://check/<id>`, and the output Shinsa kept each time it
      ran the check) folds into one item per check (`resolveEvidenceLayout`), a Test when the agent linked it as one,
      else a Check. It renders as the check's row from the Checks list (`CheckRowItem`, 12): its label, who added it, its
      command and outcome, the agent's note on what it proves under it (with the review mark when the reviewer linked
      it), and Show the output on the latest output Shinsa kept this round; a check the task no longer has reads "No
      longer one of the task’s checks". A test or check piece without a `checkId` still reads as its result: a
      bordered list of each command it ran (`lib/evidence/runs.ts`), each with `CheckOutcomeIcon` and its counts. A note is markdown
      (`IconNote1` in its caption): the shared `Markdown` renderer, `text-xs` in an `INSET` (`px-3.5 py-2.5`), so its
      tables, lists, code and smart links (a file, a task or a pull request in the reference syntax, 8) read as they
      do everywhere else. A run whose text names no command is a code block (`CodeFence`, monospace, copy on hover, at
      most 320px tall and scrolling inside); a preview is a link row. Last, a line with where the files are on disk ("Stored in ~/…/evidence/<task>/round-1",
      `IconFolder1`, a copy button), from the data folder `/api/health` reports. Every thumbnail is a 16:10 frame
      (`object-contain`, `bg-bg-2`, a 1px border so a dark shot keeps its edge on a dark card); a click opens the
      image viewer on it, whose arrows step item by item ("1 of 4") and whose bar switches Before and After inside a
      comparison. A recording's frame shows its first frame (muted, metadata preloaded) under a round play glyph, and
      plays only in the viewer, with its controls (the server answers byte ranges so it seeks). An item the reviewer
      attached carries a purple "From the agent review" badge: evidence from outside the author. Only current evidence
      shows (`docs/engine.md` → Evidence): an item that replaced an earlier one says so beside its title in a quiet
      `text-2xs` `fg-2` line, never a badge ("Updated after your review", "Updated after the agent review", "Updated
      after the checks", "Updated after the pull request feedback", else "Updated"), and the replaced and removed items
      sit under a collapsed **Earlier versions** line at the end of the panel (`DisclosureHeader` as Advanced in a
      service form: `line`, `glyph`, `text-2xs` `fg-2`, the count beside it; `task:<taskId>:evidence:panel:earlier`),
      each over its status ("Replaced by a later version", "Removed: " and the agent's reason) and drawn as in the panel
      (the image viewer steps through them only while the line is open), so stale proof is never read as the work as
      it is. With every item removed the panel says "The agents removed
      the evidence they attached this round." over that line. With nothing
      attached, the panel says so ("No screenshots, recordings or test runs were attached this round. Request changes
      to ask the agent for them."), so a missing proof is visible, not silent. 20px between groups, 4px from a group's
      label to its items. When the task has no work report and its changes cannot be read (a merged branch that was
      cleaned up), the tab says so in one quiet line and still shows this panel under it, since the Overview points
      here with one line that counts the items by kind ("1 comparison, 1 recording and 2 tests in the review",
      `describeEvidenceSummary`).
    - **Reading order, by context.** The chapters follow how you come to understand a change: **How it's built**
      (Approach, How it works, How to test, then **Pre-merge steps** and **Post-merge steps** when the agent left
      steps for you), **Key code** (the spots marked Context), **Judgement calls**, **Read carefully** (the Critical
      and Read carefully spots, then the risks), then the **Agent review**. Each
      chapter with more than one block opens with a `SectionLabel` (its count beside it) 4px over its cards, 8px between
      cards, 20px between chapters, as on the Overview (`listReviewChapters` in `lib/review/report.ts`).
    - **Every point, pinned.** One compact line stays fixed above the scrolling column
      (`components/review/point-index.tsx`): a card whose only content is a `Panel` header band (36px, `IconListBullets`,
      "Every point" and the count right after it, the box chevron at the right). While you read it says where you are:
      "12 of 40 · Judgement calls · the point's title", or the chapter and section name on a part of the walkthrough
      (How it's built · Approach). The point in view is the last one whose top passed a line 48px under the top of the
      scroller, or the last in view once the page is scrolled to its end (`resolveStopInView`); a jump holds its point
      in place for a moment and the line takes over again once you scroll. The line has one edge, the card's border, and
      the popover one edge, its ring, as every popup (Shape & depth). A click opens the whole index as a popover the
      width of the line, over the content so nothing moves: grouped by chapter, each chapter labelled, one 28px row each
      (its number, its tag as a dot and label, its title or first sentence, its place `path:lines` from `md`), the walkthrough
      parts as unnumbered rows that carry their panel's icon (`REVIEW_PROSE_ICON`: Approach `IconLightbulbGlow`, How it
      works `IconLayersThree`, How to test `IconTestTube`, Pre-merge `IconChecklist`, Post-merge
      `IconMerged`, 14px) in the number's 20px slot, right-aligned like the numbers, the point you are on carrying the shared highlight (`HoverHighlight`, which rests on it
      and slides to the row you point at) and scrolled into view. A row jumps there and
      closes the list. There is no sidebar and no Previous / Next button: J and K and ⌘K step.
    - **Section cards everywhere.** Approach, How it works, How to test, Pre-merge steps, Post-merge steps, the risks
      and the agent review are each a `Panel`
      (the Overview's: `CARD_HEADER` band, icon slot, title, count right after the title, `DisclosureHeader` with the box
      chevron), never loose text under a heading.
      - **Approach** and **How it works**: the agent's walkthrough as prose, the idea and structure of the change, then
        the flow of data and control through the new code, with a text diagram in a code fence (a tree, or boxes and
        arrows) whenever the change has structure or a flow worth drawing; every seeded review has one. A fence drawn
        with box-drawing lines (`isTextDiagram` in `lib/code/highlight.ts`) is set on a 14px line (`leading-3.5`) so
        its vertical lines join; like every fence it never wraps and scrolls sideways inside the block. Every code
        block (`CodeFence`: markdown fences in the chat, the Review tab and review cards, diagrams, evidence text, the
        How to test commands and the steps around the merge; and the chat's tool-call blocks) is one `CodeBlock`
        (`components/text/code-block.tsx`): `bg-bg-2` with the hairline `border-border` every card has, so it keeps its
        edge on a card in both themes. `CodeBlock` owns **one corner** for everything a block offers, as Buzzkit's
        code block does: Copy, and **Run in terminal** after it, both `secondary icon-xs` buttons side by side on one
        surface of its own (the block's `bg-bg-2`, a hairline `border-border`, `rounded-control`). Run in terminal
        (`IconConsole`) is there only on a command meant to be run: a fence marked `run` after its language
        (```` ```bash run ````, or `sh`, `zsh`, `fish`, `shell`, `console`; in `console` only the `$` lines count),
        How to test's commands and the steps around the merge, in agent prose, notes, the chat and the Overview alike.
        The mark is read from the fence's info string (`isRunnableFence` in `lib/code/block.ts`, the `meta` the
        markdown keeps beside the language), never shown and never changes the highlighting. A plain
        ```` ```bash ```` fence, or a block that only opens on a `$ ` prompt, is an example and has Copy alone; the
        house rules and the `handover` and `review` skills teach agents the mark. The
        task page provides the runner (`TaskCommandRunner`, `components/task/command-runner.tsx`) only when the task
        has a folder to open a terminal in (`selectTaskTerminal`, the check `openTaskTerminal` makes), so a block
        with nowhere to run has Copy alone; the chat's tool-call blocks are a record of what the agent ran and keep
        Copy alone too. Its delayed tooltip is "Run in terminal" over the folder it runs in; pressing it opens a
        terminal in the task's folder and runs the command, and nothing runs without it. Copy and Run both drop a
        leading `$ ` prompt (`resolveBlockCopy`, `resolveBlockCommand` in `lib/code/block.ts`), on an example as on a
        runnable block. **Where the corner
        sits** follows the block's logical lines (`resolveCodeCorner`; a block never wraps, it scrolls, so its lines
        are its text's): beside a single line it is centred at the right edge, in the block's own row, so the line
        ends before it and never runs under it, even scrolled; on several lines it stays in the top-right corner, 6px
        from the top and end, with a 12px fade from the code into its surface on its left, so code scrolling under
        it never shows through behind the buttons. Either way the corner appears on hover, when a button has
        keyboard focus (`has-[:focus-visible]`, a reveal, not a focus mark) and always on touch
        (`pointer-coarse:`). Copy waits `TOOLTIP_DELAY` like every tooltip and flips to Copied, through
        `useCopyText`. `/ui` shows the two side by side: runnable blocks (one line, several lines, and one where
        nothing can run it) and examples (a plain ```` ```bash ```` fence, a `$ `-prompted block and code).
      - **Key code**: the Context spots of every phase in plan order, each a review card: its title in the header,
        how the code works in plain words (`explain`), "Why it matters" in the spot's tone (the risk), and the change snippet of its exact
        lines, open. The phase it belongs to is the card's section. A spot without an explanation shows its why as the body.
      - **Judgement calls**, more important than the code: each call a card (Judgement call, purple) headed by its
        title (a few words naming the decision), then the call itself and the reason,
        "Also considered" listing each alternative and why it was rejected, and the snippet of its lines. When the agent
        review would have decided otherwise the card is Disputed (orange) and carries "The agent review disagrees" with
        its reason on an orange inset note (`orange-a2` on the inset's hairline), so you read both sides in one place.
      - **Read carefully**: the Critical and Read carefully spots as review cards, then the **Risks and edge cases**
        panel: each risk the agent named as a row with its title, the risk and its snippet, the row you are on washed `primary-a1`.
      - **How to test** (`components/review/testing.tsx`, `TestingPanel`): two parts, each under a quiet `text-2xs`
        label, and never a checklist. **Covered by tests**: the agent's one or two lines on what the tests cover, as
        plain text, then the Checks list in both stages (12, The Checks list). Under them, when the checks measured it, the changed-line coverage in one
        `fg-2` line ("85% of changed lines are covered (36 of 42) · 2 files have uncovered lines.", or "All 42 changed
        lines are covered.") and a quiet `text-2xs` toggle, Show 3 files, that opens the files: each a `FileLink`, "10
        of 14 lines" and, when some are missed, "Not covered:" with each range a `FileLink` into Code at those lines
        (`lib/coverage.ts`). Nothing at all when coverage is off, could not be measured or no changed line runs as
        code. **Try it yourself**: the steps to try in order, each a `StepNumber` with the
        action (Markdown, so its smart links work), its target, and "You should see" over what you should see. A target
        renders by its kind (`resolveTestTarget`, `lib/review/testing.ts`): a web address (`http` or `https`) is a link
        that opens in the browser, with `IconGlobe`; a file is a `FileLink` into the Code tab at its lines (`path`,
        `path:12-20` or a `shinsa://file/` reference); a command is a shell `CodeFence` with Copy and Run in terminal
        in its corner, as every command in a task has; a screen, and an address or file that cannot be read, is
        plain text with its icon. The panel shows when the walkthrough has either part, there are checks or coverage was measured. It sits in
        How it's built, after How it works.
      - **Pre-merge steps** and **Post-merge steps**: the steps around the merge as checklists (Steps around the
        merge, 12), each panel's count beside its title; you
        tick them here as on the Overview.
      - **Agent review**: one panel with the reviewer's summary in its own words, what it found and "A signal for you,
        never the approval.", then each finding's card (`rounded-lg`, nested) with Fix / Dismiss at a review gate, the
        shared `FindingVerdictChoice` (`components/review/verdict-choice.tsx`) the Overview's finding verdicts and the
        Code tab's inline cards use too; "The agent review has not run yet." before it ran. Its `VerdictChoice` is the
        same control on a value and `onValueChange`, without the draft or the connection, which `/ui` shows.
    - **Snippets are the marked lines.** A snippet shows the lines a point marks and two rows around them, not the whole
      hunk: a long removal before replaced lines shows only as many removed lines as the point marks new ones, plus two
      (`narrowHunks` in `lib/code/diff-view.ts`); a pure removal shows whole.
    - **Your comments**, each with Remove; then **Everything else**, collapsed: the changed files nothing above points
      at, each a file link with its counts, and the findings you dismissed in earlier rounds, compact.
    - **Every point once.** A point appears in one chapter only; there is no separate attention list, no phase
      walkthrough (What changed is the Overview's) and no second checks list: the Checks list is How to test's.
    - **The review card** is how every point and every review comment looks, anywhere: a `CARD`
      (`components/review/note.tsx`, `ReviewNote`) in one of two variants, picked by what it is (`isFindingItem` in
      `lib/review/report.ts`: a finding is the one the agent review wrote).
      - **A point or a comment** (key code, a judgement call, a Read carefully spot, your comment) opens on a header
        bar: the 36px `bg-bg-a1` band (`DisclosureHeader`, `strip='band'`, box chevron at the right, as a `Panel`)
        with the author's icon in its icon slot (Agent `IconAgent`, You `IconBubbleText`; `REVIEW_AUTHOR_ICON`), then
        what the card is (`text-xs` medium `fg-4`, `resolveNoteHeading`): on the agent's points (key code, a judgement
        call, a Read carefully spot, a risk) their short title, never an "Agent" label, since every point is the
        agent's; an author's name only where it tells two authors apart, "You" on your comment (and "Agent review" on
        a finding's label line). Then the tag as a dot and label, the section it belongs to (`text-2xs`
        `fg-2`, truncated), and the action at the right before the chevron (Remove for a comment). The whole bar folds
        the card to the bar alone ("Collapse judgement call"); a click on the action does not. Every card starts
        open and remembers a fold (`task:<id>:review:card:<point>`, 40), and a card you jump to (J and K, the
        index, `?spot=`) opens again. Under the bar, 12px in: a judgement
        call's call (`text-xs` medium `fg-4`), then the body as markdown (`fg-3` under the call, `fg-4` without).
      - **A finding** (Blocking, Suggestion, a dismissed one in Everything else) has no bar. It opens on the head every
        finding has (`NoteHead`, `components/text/note-head.tsx`, the Overview's too): one full-width row,
        `justify-between`, with the label line (`text-2xs`: Agent review in `fg-2`, the tag as a dot and label) and
        the title (`text-xs` medium `fg-4`) stacked on the left and Fix / Dismiss on the right at a review gate,
        aligned to the row's top, then the body full width. It does not fold, so the verdict is always in view.
      Both then show, full width: Why it matters, Also considered, the disagreement, the change snippet of its exact
      lines open (the header a link into Code at those lines, with the point's key), and the suggested fix on an inset
      note headed "Suggested fix" (`IconBandage`); the body's markdown has inline code and smart links to tasks, pull
      requests, files and branches through the shared reference components. The card you jump to has a 2px
      `primary-a3` outline 2px outside it and scrolls into view; on the Review tab the outline (and a risk row's
      `primary-a1` wash) holds 1.5s and fades over 500ms (`useSpotlight`, `hooks/use-spotlight.ts`, the hold the chat's
      jumped-to run uses), while `?spot=` keeps the place. In the Code tab the same card is compact: no snippet and no
      place (32). The chat's review card and the Overview's finding verdicts (`FindingText`) show a finding's parts on
      the same `NoteHead`, with the severity as the label line. There is one finding layout with Fix / Dismiss, never a
      variant with the toggle in a header band; /ui shows both variants (Review: a point, a finding, your comment, and
      both inline in the Code tab).
    - **Instant.** Nothing on the tab waits on a read it could have made earlier: the snippets are slices of the task's
      diff the tab already holds, and prefetching a task (on hover and at idle, 36) loads the diff view and the
      grammars of every point's language (`prepareCodeDiff`), so switching to Review paints every snippet in the first
      frame.
    - **Stepping.** The point you are on is `?spot=` in the URL (the keys the Code tab uses: `0:1` a spot, `call:0` a
      judgement call, `risk:0` a risk, `finding:0` a finding, `comment:<id>` your comment; `approach`, `flow` and
      `testing`, `pre_merge` and `post_merge` the walkthrough's parts), so a link opens the Review tab on that card, and a snippet's link opens the Code
      tab on the same key, marked there like a spot (`listReviewTargets` marks judgement calls and risks with lines too).
      J and K step to the next and previous stop in reading order, from the one in view, walkthrough parts included,
      while the Review tab is open and you are not typing (`hooks/use-review-keys.ts`, `lib/review/keys.ts`), each also a ⌘K command (Next point, Previous
      point) with its key; this and the Code tab's keys are the only exceptions to ⌘K being the one shortcut.
    - **Links in.** The Overview's Review button and What changed's Read the review, ⌘K's Review the changes, a task
      link's action and the queue's Review changes open `?tab=review`, and a chat hand-over (a phase or a fix) that
      carries a walkthrough ends with one line, Read the walkthrough, linking there.

35. **Getting around is instant** (`root.tsx`, `routes/task/index.tsx`, `lib/kept-views.ts`, `hooks/use-idle.ts`;
    measured in `docs/performance.md` → Shell and navigation). A click paints its page in the next frame or two,
    the way a native app switches views:
    - **Pages you have been to stay mounted.** Home, All tasks, Settings and Terminal, once visited, and the last three task
      pages you opened stay in the tree inside React's `Activity`, hidden (`display: none`) rather than unmounted,
      so going back shows the same page, its scroll and its open sections, without building it again. A hidden
      page runs no effects (no ⌘K commands, key bindings, transcript subscriptions or reads); they start again
      when it shows.
    - **Ahead of the first visit.** Once the browser is idle after the first state arrives, Home, All tasks,
      Settings and Terminal are rendered hidden (Terminal opens the socket of the terminal it would show, so its screen
      is in the page before you get there; 37), and a task page renders its other tabs (Overview, Review, Code, Chat) hidden,
      so even the first click on one only shows it. The Code tab's chunks and reads are prefetched as before (32).
    - **Hidden pages wait for idle.** A hidden page or tab gets the state as of the last idle moment
      (`useIdleValue`), not every push, so a busy server does not keep re-rendering pages no one sees; the page you
      look at gets every push at once. Pages and tabs are memoised on their state and route, so showing one
      re-renders only what changed.
    - **No route waits on a chunk.** The pages are in the main bundle, never behind `React.lazy` and `Suspense`
      (whose reveal throttle alone holds a boundary for 300ms); only `/ui` and the Code tab's editor load apart,
      and the Code tab is prefetched on idle and on hover.
    - **What they cost.** A kept page holds its components and DOM. On the seed, a task page with Home, All tasks
      and Settings kept and its Review and Chat tabs warm holds 20 MB of JS heap: All tasks and Settings rendered
      ahead are 3.3 MB of it, the hidden tabs 0.6 MB. So a row in a kept list mounts no overlay of its own: hints,
      times and clipped text share the page's one tooltip (13). Visiting more tasks does not grow it past the three
      kept ones; what grows is code loaded once (the Settings page, the Code tab's chunks and grammars).
36. **No loading state in normal use** (since 2026-10-25; `routes/task/prefetch.tsx`, `lib/tasks/prefetch.ts`,
    `lib/chat/prefetch.ts`, `lib/code/prefetch.ts`, `hooks/use-delayed.ts`, `components/status/loading-line.tsx`;
    measured in `docs/performance.md` → Loading states). Whatever a click shows is already on the page: rendered
    ahead (35), read ahead, or the last answer kept while a newer one loads. A spinner, a skeleton or a "Reading…"
    line is a design bug unless the work could not be foreseen.
    - **Read before the click.** Hovering a task anywhere (a queue row, Home's lists, All tasks, a task reference,
      the sidebar) for 40ms, or highlighting it in ⌘K, reads what its page shows: the Code tab's refs, diff
      summary, root folder, ⌘P's paths and first file, the review's snippets, the diff view's chunk, the
      evidence (its images decoded ahead, its texts read into the cache; `lib/evidence/prefetch.ts`, the last 64
      images, `EVIDENCE_IMAGE_LIMIT`; the server marks evidence immutable, so they stay in the browser's cache), and the
      transcripts of its last two runs. Once the browser is idle, the first four tasks of the queue get the same
      code reads, and Settings' versions and integrations are read. An open task page reads its own at idle; the
      Code tab reads the other refs (head, base, working copy) of the open file and its folders, the folders above
      a file you open, ⌘P's top match as you type and a search match you hover.
    - **Keep it, then refresh it.** Code reads are cached by commit (32) and, once read, a read shows its last
      answer at once while a newer version (a task update, a moved head) loads, the way the Files tree and the
      diff already held. Every cache is bounded: the code reads keep the last 300 (`CODE_READ_LIMIT`), finished
      searches 20 (`CODE_SEARCH_LIMIT`), evidence texts 32 (`EVIDENCE_TEXT_LIMIT`), the review's snippets read
      ahead 8 per task (`SNIPPET_PREFETCH_LIMIT`), the socket's transcripts every run a chat follows plus the 24
      read last (`TRANSCRIPT_CACHE_LIMIT`).
    - **A wait shows only after 300ms.** For what could not be foreseen (a file nothing pointed at, a search
      never run, the first state after a reload, a sign-in), the place stays empty for 300ms
      (`LOADING_DELAY_MS`, `useDelayed`) and only then shows the spinner and its line (`LoadingLine`,
      `LoadingSpinner`, `CodeLoading`), so a fast read never flashes one. Each carries `data-loading-state`,
      and `data-loading-pending` while it waits unseen, which the walk in `scripts/perf/loading-walk.ts` looks for.
    - **Not a loading state.** A busy button (22), the live agent's shimmering line (7), "Working out the steps" on
      the progress track and an update's toast report work the server or an agent is doing, not a read, and stay.

37. **A terminal per project, and its services** (since 2026-10-26; `routes/terminal.tsx`, `components/terminal/`,
    `components/services/`, `lib/terminal/`, `lib/connection/terminals.ts`, `lib/command/terminal.ts` and
    `services.ts`, `hooks/use-terminal-keys.ts`; how the engine runs them is `docs/engine.md` → Terminals). For what
    agents leave to you: your own dev servers, an interactive sign-in, a command an agent asked you to run. It replaces
    opening another terminal app for those, so it has the keys a Mac terminal has, in Shinsa's look.
    - **Services, beside Home.** Most of the time you do not want a shell, you want a project's dev servers running
      and to know they still are. Desk's top bar has Services right after Tasks (`ServicesMenu`, the look of the queue
      button: `secondary sm`, icon and label, a trailing chevron, a popover from its start edge); Shelf has it as a
      row of the rail under Tasks, its popover to the right. Its icon is `IconServer`, `IconServerFilled` while you
      are on the Terminal page. Its label says what matters at a glance, the worst first: "1 failed" in red text, "1
      starting" in blue, "2 running" in the button's own ink, else "Services" (`describeServicesTrigger`). There is no
      status dot: state is a `StatusTile` and a tone in text.
    - **The popover** (`ServicesPanel`, 352px, `w-88`, wider than the queue's 320px for the commands in mono, the
      forms and the removal question in the footer) lists the services of the project you are in (the Terminal
      page's project there, else the focus project, else every project with one), **drawn as the compact queue
      is** (the queue button's popover): the list is built from the same pieces, `CompactSections` and
      `CompactSection` (`components/layout/compact-section.tsx`, which the compact queue renders too), so each project
      is a queue section (`px-2 py-1.5`, a hairline between sections) whose header is the queue's: 24px, the project's
      dot in the 20px icon slot, its name (`text-2xs` medium `fg-2`, `fg-4` under the pointer) and its counts in normal
      weight, worst first and in their tones ("1 failed", "1 starting", "3 running", else "4 stopped";
      `describeServiceGroup`), and the queue's fold chevron, revealed on hover, right after the counts (6px after "1 running"). The whole header folds the project,
      as a queue section folds, and each project remembers its fold (`services:project:<projectId>`, `resolveServiceGroupId`, 40). When two or more of
      the project's services are not running, the header ends with a play button (`icon-sm`, `IconPlay`, no text,
      the tooltip "Start all services in ‹project›", `describeStartAll`; the section's action, so a press on it never
      folds) that starts every one that is not; the header then ends 4px in (`pe-1`), as a row does, so the play
      button stands in the column of each row's last button, while the chevron stays after the counts. The rows follow one
      another with no gap, as the queue's do. The list's top is inset 6px more than a section's own padding
      (`COMPACT_POPOVER_INSET`, the queue popover's too), so the first header's dot sits as far from the top as from
      the side (measured: 20px and 20px; the header box 12px from the top, 8px from the side). A row
      (`ServiceRow`) is a `ListRow`: the state's tile (`SERVICE_GLYPHS`: running `IconPlay` green, starting
      `IconHourglass` blue, failed `IconExclamationCircle` red, stopped and exited `IconCircleDashed` neutral, an idle
      mark that never reads as a checkbox), the name over the state in its tone ("Running for 12m", "Failed with code
      1") and the command in mono. Pressing the row opens its terminal once it has one. The row's actions sit at its
      end, `icon-sm`: Start (`IconPlay`) is always there on a service that does not run; Restart
      (`IconArrowRotateClockwise`) and Stop (`IconStop`) show on a running one while the row is under the pointer (the
      shared highlight's `data-hovered`), 1px apart (`gap-px`), as the same pair is on the Terminal page's toolbar and
      as adjacent ghost buttons in an `InputGroup` addon are: each hover wash is its own edge, so the pair reads as one
      set (measured: 1px between Restart and Stop, each 24px). A row has no `•••`: editing and removing are Manage's. Measured in the
      browser: the header's play button and every row's last button at the same x, 12px from the popover's end and
      24px wide.
    - **Its height is its content's, like the queue's.** The list sizes to what it lists up to the room under the
      trigger (`max-h-(--available-height)`, `COMPACT_POPOVER`, the queue popover's classes) and then scrolls,
      its footer staying put. Add services, the custom form and a service's form keep one height of their own,
      `min(28rem, the room under the trigger)` (`resolveServicesPanelHeight`: `content` for the list, `fixed` for
      the rest), so a view that loads, opens Advanced or shows a problem never moves the popover's edges; going
      from the list to one of them moves only its bottom edge, once, since the top and the width are the
      trigger's. Manage keeps the list's height: its rows are the list's rows with a checkbox and an edit button in
      place of the tile and the run buttons, and it has no header of its own.
    - **The footer is always there** (`PANEL_FOOTER`, 41px with its hairline, 8px in on every side, measured: each
      24px button 8px from the footer's top, bottom and sides): Manage (`IconSettingsSliderHor`, disabled while the
      popover lists no service), Add… (`IconPlusMedium`, disabled when there is no project to add to) and, at its
      end, Terminal, which goes to the Terminal page. With no services the body is the kit's `EmptyState` (`sm`,
      `IconServer`): "No services in ‹project› yet" (or "No services yet"), "A service is a command you keep running
      for a project, like its dev server.", with the footer's Add… to add some, and Create a project… in the empty
      state itself when there is no project. The rows tick every second, since the running time is in them.
    - **Everything happens in the popover, never in a dialog.** Adding, editing and removing services are views of
      the same popover (`lib/terminal/services-panel.ts`: `reduceServicesPanel` moves between the list, Manage, Add
      services, the custom form and a service's form, and `resolveShownServicesView` falls back to the list when a
      view lacks what it needs; `components/services/panel-views.tsx` draws them). It goes back to the list once it
      has closed (`onOpenChangeComplete`), so the next open starts there. ⌘K's Add services… and Manage services…
      open the mounted Services menu straight on that view (`requestServicesPanel`).
    - **Add services** (Add… in the footer) turns the popover into what the engine found (`docs/engine.md` →
      Services → Found for you): a header with "Add services", one muted sentence and, when several projects are in
      view, the Project select (ghost, `sm`, with dots) at its end. Every view's header (Add services, the custom
      form, a service's form) is padded 12px at the top, bottom and start (`py-3 ps-3`), so its title starts as far
      from the popover's top as from its side (measured in all three: 12px and 12px; it had been 6px from the top),
      and 6px at the end, which the ghost select's own 6px inset brings to 12px to its glyph. Then a `SectionLabel` "Found in the project" with the
      count and Select all (or Deselect all); the found ones as `ListRow`s (`ServicePicker`: a checkbox in the icon
      slot, `outline` like Manage's, the name over the command in mono and its folder by the project's place, "bun run dev in
      shop/apps/api"); and last Custom service… (`IconPlusMedium`). The recommended ones start ticked, so the common
      case is one press of the primary "Add 2 services" (disabled at none) beside Back; what you already added is not
      listed. While it reads, "Looking for services" after 300ms. Once added, the popover is the list again.
    - **The form** (Custom service…, "Add a service"; or a service's, "Edit ‹name›") is short: Name, Folder (a
      select of the project's repositories and folders, never a typed path) and Command, with Environment
      (`NAME=value` lines) folded under Advanced (open by itself when the service has variables or the field has a
      problem). Its fields are the kit's `Field` and `FieldLabel`, as in every Shinsa form (the project and MCP
      server dialogs), its Name, Folder, Command and Environment the kit's `Input`, `SelectTrigger` and `Textarea` as
      they are in Settings and every dialog: filled, never bordered (21). In a dark popover those had drawn as bare
      text, since the popover's surface is `bg-2`, the fields' own fill; the kit now fills a field a step above
      whatever popover it sits in, so they read as fields in both themes. The form sets the dialog's ink, `fg-3`, so
      its labels read as theirs do (measured: 13px,
      weight 450, `fg-3` in both; in the popover they had been `fg-4`). The footer has Back and the primary (Add
      service, or Save). When nothing is found Add services opens on the form, its sentence says "No services found
      in ‹project›. Name the command that starts one and the folder it runs in." and Back goes to the list. **A field
      shows its problem only once you have typed in it and left it, or tried to add** (`resolveShownErrors`); from
      then on it follows what you type, so fixing it clears it at once.
    - **Manage** (the footer's Manage, or ⌘K's Manage services…) keeps the list and turns it into one you pick
      from: each row's tile becomes a checkbox in the same slot and pressing anywhere on the row ticks it or clears
      it (`ManagedServiceRow`; the kit's `Checkbox` `outline`: an empty box at rest, since a filled box on every row of
      a popover outweighs the rows, and the accent fill once ticked); editing has its own
      button at the row's end, where the run buttons were (`icon-sm`, `IconPencil`, "Edit ‹name›", always shown, the
      kit's `bare` button: no wash at all, only the pencil going from `fg-2` to `fg-4` under the pointer, since the
      row under it already washes), which opens the service's form in place (Back or Save comes back
      with the ticks kept). The play buttons go. The footer has the destructive "Remove 2 services" (Remove services,
      disabled, at none) and Done. Remove asks in the footer itself, with no dialog: "Remove 2 services?" over "They
      stop and their terminals close.", Cancel and Remove; Remove removes them all in one call (`POST
      /api/services/remove`) and clears the ticks, and a refusal keeps them.
    - **Where it is.** `/terminal?project=<key>&terminal=<id>` (the URL is the view: project and tab), a hub page kept
      mounted once you have been to it and rendered ahead at idle (35). Services → Terminal, Open terminal on a
      service and ⌘K's Terminal under Go to all go there. A task's `•••` menu and ⌘K's Open a terminal open one in
      the task's worktree (its repository when it has none), in its project, and go there.
    - **Shape.** The page fills the space under the top bar edge to edge, with no column: a 36px `Toolbar` with the
      project picker, the tabs, New terminal (`icon-sm`, `IconPlusMedium`), after a divider the active service's
      Restart and Stop (or Start) when a service's tab is in front, else, while any of the project's services is not
      running, one play button that starts them all ("Start all services in ‹project›"; a shell's tab or no tab is
      in front, `resolveActiveService`), and Find in the scrollback (`IconMagnifyingGlass`), then the terminal on its own
      background, 8px from the top and 12px from the left. The project picker is the Focus menu's own trigger and
      rows (`ProjectMenuTrigger`, `ProjectRadioItems` in `components/focus/menu.tsx`): the project's dot, its name and
      the chevron, a radio list of every project with its dot, which closes on the one you pick (the Focus menu's
      stays open for how long to keep it). A project with no terminal shows the `EmptyState` with
      Open a terminal (`primary sm`, no tooltip).
    - **Tabs** (`tab-bar.tsx`). A tab is the kit's segmented tab, 22px inside the 26px list: its mark, the label (the
      name you gave it, else the shell's title, else the folder's name; a service's tab is its name;
      `resolveTerminalLabel` in core), and a close button (`icon-2xs`, 18px) revealed on hover and always on the
      active tab. The button sits in an even 2px inset: 2px from the tab's top and bottom, and the tab's end padding
      is 2px too (`pe-0.5` over the kit's `px-2`; measured), so the × is centred in its corner. A shell's mark is
      `IconConsole`, `IconConsoleFilled` on the tab in front (19, the filled rule); a service's is its state's glyph
      in its tone, filled on the tab in front too (`IconPlayFilled`…), so a service tab reads apart from a shell and
      shows whether it runs. They are the kit's `Tabs` (each tab a `TabsTrigger` rendered as a `div`, since it holds its close
      button), so the selected pill slides between terminals like every other tab bar; an ended shell's label
      is `fg-2`. The tooltip names the folder and how it ended, or a service's state and command. Double-click
      renames in place (Enter keeps it, Escape puts the old name back, an empty name goes back to the title); drag a
      tab onto another to put it there; the middle button closes it.
    - **Closing.** An ended shell or service closes at once. A running shell closes at once unless a program other
      than the shell is in front of it (the engine's foreground check; Terminals, in `docs/engine.md`): then "Close
      this terminal?" names it ("vim is still running in “Dev server”."). A running service asks "Stop api?" with
      Stop and close. The tab to the right is shown next.
    - **New terminal.** One click opens it in the project's only place; with several, a menu lists Repositories,
      Folders and Task worktrees (`IconFolder1`, `IconFolders`, `IconBranch`, as Settings → Projects marks them:
      plain icons in the row's grey ink, never the Code tab's tinted folder marks), each by name. ⌘K has the same as a
      page. ⌘T opens one where the tab in front is, else in the project's first place.
    - **Ended.** A shell that exited, or that a restart of the engine ended, keeps its last screen, and a bar under it
      says which ("The shell exited with code 1.", "Shinsa’s engine restarted, so this shell ended. Its last output is
      above.", "api exited with code 1.") with Close (`secondary sm`) and Start again (`primary sm`,
      `IconArrowRotateClockwise`), which starts a new shell, or the service again, below the old output and gives it
      the keyboard.
    - **The look is Shinsa's.** The Code tab's mono font (`--font-mono`, ABC Areal Mono) at its size, 12px, with
      1.25 line height, a block cursor that does not blink, and the Code tab's colours: the `--terminal-*` tokens in
      `app.css` are the editor's own (its `--background`, `fg-4` text and cursor, its `primary-a2` selection), and
      the ANSI palette is the `--code-*` syntax tokens (red `--code-tag`, green `--code-string`, yellow
      `--code-type`, blue `--code-function`, magenta `--code-keyword`, cyan `--code-property`, white
      `--code-punctuation`, bright black `--code-comment`, bright yellow `--code-number`, bright white
      `--code-meta`, black the text, `bg-4` in dark), so `ls`, git and a fish prompt read like the editor's syntax.
      The selection is the same whether or not the terminal has focus, as in the editor, and find marks its matches in
      the Code tab's find colours (`--terminal-find-match` the editor's `amber-a2`, `--terminal-find-active` its
      `amber-a4`). Nothing comes from xterm.js's, Ghostty's or iTerm's defaults but the 256-colour cube above the
      sixteen, which is the standard xterm one every terminal shares. Colours reach xterm.js as hex, converted from
      the tokens' OKLCH and `color-mix(…, transparent)` (`lib/terminal/color.ts`), and the theme switches with the
      page's. **The scrollbar is the app's** (6): xterm.js 6 draws VS Code's, which `app.css` restyles to
      `ScrollArea`'s thumb (5px of `fg-a1` at 60%, 3px from the right and 4px from the ends, 7px and full strength
      under the pointer or while dragged, on a 14px strip), and `lib/terminal/scrollbar.ts` makes it show as that
      one does: while it scrolls and while the pointer is on its strip, never just because the pointer is over the
      terminal, fading 200ms after half a second. ⌘+ and ⌘− change the size a step (9 to
      24px) and ⌘0 puts it back, for every terminal (`lib/preferences/terminal.ts`).
    - **Rendering.** xterm.js 6 with its WebGL renderer, Unicode 11 widths (CJK and emoji take two cells), clickable
      links (plain URLs and OSC 8, opened in your browser), 5,000 lines of scrollback, fit to its pane when the pane's
      size changes. One `TerminalView` per terminal (`lib/terminal/view.ts`) lives as long as the terminal, outside
      React, so switching tabs, pages or projects keeps it. A view keeps its WebGL renderer when you leave it, so going
      back draws at once; the six shown last keep theirs (`WEBGL_LIMIT`), and the one shown longest ago gives its
      context back, so a dozen tabs never run out of WebGL contexts. While it reconnects a small `LoadingSpinner` sits
      in its top-right corner.
    - **Find** (⌘F while it has focus, or the button): the find bar of the Code tab (`SearchField` with match case,
      whole word and regular expression, previous, next, the count, and Close, `icon-sm`, as in the Code tab's),
      searching the scrollback; Enter goes to the next match, ⇧Enter the previous, Escape closes it and gives the
      terminal the keyboard back.
    - **Keys** (`lib/terminal/keys.ts`, through xterm.js's key handler on the terminal's own element, so they are the
      terminal's while it has focus, not page shortcuts; 14). A focused terminal takes every key it would take in
      Terminal.app or Ghostty, Control ones included (Ctrl-K is the shell's), and keeps them from the page. On a Mac:
      ⌘⌫ deletes to the start of the line (`^U`), ⌘← and ⌘→ go to its start and end (`^A`, `^E`), ⌥⌫ deletes the word
      back (`ESC DEL`), ⌥← and ⌥→ move a word (`ESC b`, `ESC f`), ⌥ is Meta (ESC and the key) unless your keyboard
      layout types a character with it (⌥L is @ on a German Mac, and that is what you get), ⇧⏎ and ⌥⏎ send `ESC CR`,
      which fish, zsh's line editor and agents' prompts read as a new line instead of running it, ⌘C copies a
      selection and does nothing without one, ⌘V pastes (bracketed when the program asks), ⌘A selects all, ⌘F
      finds, ⌘L clears the scrollback (the engine's copy too, and `^L` to the shell outside a full-screen program, so
      the prompt is drawn again at the top; ⌘K stays the command menu, where Clear the scrollback is a command), ⌘+,
      ⌘− and ⌘0 set the font size, ⌘Home, ⌘End, ⌘PageUp and ⌘PageDown scroll; Home, End, PageUp and PageDown go to
      the program, as in Ghostty. Every other ⌘ key is Shinsa's and the app's (⌘K, ⌘,, ⌘R, ⌘[…). Elsewhere it is
      Ctrl+Shift+C, V, A, F and L, and Ctrl K goes to the shell, so ⌘K's menu opens from outside the terminal.
    - **⌘T and ⌘W.** While the Terminal page is open, ⌘T opens a tab (as New terminal does) and ⌘W closes the one in
      front with the rule above (`hooks/use-terminal-keys.ts`, the one page-level listener besides 14's, 32's and
      34's). The Mac app's menu has no Close Window item, so ⌘W reaches the page there; a browser keeps both for its
      own tabs.
    - **Run in terminal.** Every shell fence marked `run` (```` ```bash run ````) in a task's prose, notes, chat and
      Overview, How to test's commands and the steps around the merge has Run in terminal in its code block's corner
      beside Copy; a plain ```` ```bash ```` fence is an example with Copy alone (`CodeBlock`, How
      it's built above; the runner is `CommandRunnerProvider` in `text/code-block.tsx`, which the task page fills
      while the task has a folder). Its tooltip names the folder it runs in. Pressing it opens a terminal in the
      task's folder and runs the command; nothing runs without it.
    - **⌘K.** Services (Start all services, Add services…, Manage services…, and Start, Restart or Stop each service of the project
      in focus), and on
      the Terminal page New terminal, Find in the scrollback, Clear the scrollback (⌘L), Start the shell again, Rename,
      Close, the service in front's Restart and Stop, and every other tab.
    - `/ui` shows the Services trigger in each state, in the bar and the rail, a service row in each state, the
      popover with three projects, with a project's none and with no project, Manage with two ticked and asking before it removes them, Add services with the project picker, the custom form and a service's form, the project picker, the tabs with services, renaming, the ended bars,
      the empty page with the place menu and the `--terminal-*` colours; the terminal itself needs the engine.

38. **A render error stays where it happened** (since 2026-10-26; `components/errors/boundary.tsx`,
    `components/errors/fallback.tsx`, `lib/errors.ts`). React unmounts everything above a component that throws while
    rendering, up to the nearest error boundary, so without one a single broken widget blanks the whole window. Every
    region that reads live state sits in an `ErrorBoundary`, in layers, so a failure takes down only its own region:
    - **The app root** (`Root`): the last resort, a full page ("Shinsa hit an error.", reload to start again).
    - **Each routed page** (`Pages` in `root.tsx`, inside the page's `Activity`): the page fallback ("This page hit
      an error." and "The rest of Shinsa keeps working…") in place of the page, under a shell that keeps working (the
      top bar or rail, ⌘K). It starts over each time you come back to the page, or when its route or search changes.
    - **Each task tab's content** (`TaskTabs`): the inline card in the page column, under the header and tabs.
    - **Shell widgets that read live state**: in the top bar the Services menu, the queue button, the connection
      status, the Update button, the usage menu and the Focus menu get the icon fallback; in the rail its top-row
      widgets get the icon fallback, and the Services entry, the Focus menu and the queue the inline card. The
      banners, the attention signals and the prefetch are `silent` (nothing in their place), and ⌘K is too, but it
      closes and says so in a toast with Copy details (`recordCommandMenuError`), and it starts over when it opens
      again.
    Three looks, one owner (`ErrorFallback`): **page** is the kit's `EmptyState` with `IconExclamationTriangle`, the
    title, the line under it, the error's message small in a bordered mono block (`rounded-lg`, `border-border`,
    `bg-bg-2`, `text-2xs`, at most 128px tall, scrolling), and Try again (primary `sm`), Reload and Copy details
    (`secondary sm`); **inline** is a `CARD` (`p-3`) with a 14px orange warning icon and "This part of Shinsa hit an
    error." (medium `fg-4` `text-xs`), the same block and the same three buttons at `xs`; **icon** keeps the trigger's
    place as a `secondary icon-sm` button with the orange warning icon, its tooltip the title over the message, and a
    press opens the inline card's content in a popover. Try again renders the region again; Reload reloads the page;
    Copy details copies the message, the stack and React's component stack. Every caught error is logged with
    `console.error` and its component stack. A boundary resets on its `resetKey` (the route, or the task for a tab),
    so going somewhere else and back recovers. A new top-level region or a widget that reads live state gets a
    boundary of the right size; `/ui` shows all three under Shinsa composites · errors.

39. **Chrome is never selected; content opts in** (since 2026-10-27; `packages/ui/src/styles/globals.css`,
    `packages/ui/src/lib/selection.ts`, `packages/ui/src/hooks/use-select-all-scope.ts`). A Mac app does not let a
    drag or ⌘A select its toolbar, its lists or its labels, and shows the arrow over them, never the I-beam. So the
    whole desktop app is chrome by default: under `html[data-desktop]`, `body` is `user-select: none` (and `-webkit-`)
    with `cursor: default`, and links and images never ghost-drag (`-webkit-user-drag: none`). This is the desktop
    app only, like the arrow over clickable controls: in a browser (the web app, shinsa.dev) a page selects, drags and
    shows its cursors the way every page does, because that is what feels native there. Real content a person may want to copy opts back in
    through **one class, `selectable`** (the kit's `@utility selectable`, `SELECTABLE` in `lib/selection.ts`), which
    makes it selectable and shows the I-beam together; there is no other way in.
    - **What is content.** `Markdown` (every block of prose: the chat's agent text, review prose, plan and spec
      bodies, findings, a suggested fix, the task's request, evidence notes, test steps) is `selectable` on its own
      root; `CodeBlock` (fences, the chat's tool-call blocks, test and check output) and the `@pierre/diffs` view
      (`CodeDiff`, `ChangeSnippet`) are too. Beyond those, a line of prose that is not a `Markdown` block opts in
      where it renders: your chat message's bubble, the live card's latest agent text, an agent's error line, a
      failed tool's message, the handover card's what changed, phase details, judgement calls, question and
      answer, a review note's Why it matters and Also considered, a plan revision's lines, a check-in's notes, a
      delegated question, an evidence comparison's detail and an error fallback's message. `InlineMarkdown` is not
      selectable by itself: it is mostly titles and row text, so a prose use adds the class.
    - **What is chrome.** Everything else: buttons and links styled as buttons, every list row (tasks, the queue,
      Settings), tabs, menus, the rail and the top bar, headings and card and section titles, labels, badges,
      status lines, times, the greeting and Home's guide, Settings' descriptions and hints, toasts, tooltips and
      empty states. A control inside content stays chrome (`globals.css` keeps buttons, labels, tabs and the
      other controls out of any selection under a `selectable` region), and so do a badge, a `Kbd`, an icon and a code
      block's line numbers there, under the arrow.
    - **Fields and editors keep their own.** Inputs, text areas and anything `contenteditable` (the Code tab's
      CodeMirror) select and show the I-beam as always; the terminal keeps xterm.js's own selection.
    - **⌘A is scoped** (`useSelectAllScope`, mounted once in `Root`; `scopeSelectAll`): in a field, an editor or a
      terminal it is theirs; inside a content region (where the selection or the focus is) it selects that region
      alone, the outermost `selectable` around it; anywhere else it selects nothing and never the page.
    - **A drag selects nothing.** While a pane's edge is dragged, `body[data-dragging]` turns content off too
      (`lib/preferences/pane-width.ts`); a drag that starts on chrome never starts a selection.

    | Element | Selectable | Cursor |
    | --- | --- | --- |
    | Prose (`Markdown`, chat messages, review prose, plan bodies, findings, notes, error messages) | Yes, `selectable` | I-beam |
    | Code blocks, command and test output, diffs (`CodeBlock`, `CodeDiff`) | Yes, `selectable` | I-beam |
    | Inputs, text areas, the Code tab's editor | Natively | I-beam |
    | The terminal | xterm.js's own | xterm.js's own |
    | Buttons, links, tabs, menu and select items, list rows, chips (branch, PR, file, commit) | No | Pointer in a browser, arrow in the app (31) |
    | Headings, card and section titles, labels, badges, `Kbd`, status, times, hints, the greeting, toasts, tooltips, empty states | No | Arrow |
    | Line numbers and controls inside content | No | Arrow (pointer on a control in a browser) |

    `bun lint:conventions` rejects `select-text`, `select-all`, `select-auto` and `cursor-text` anywhere in the
    app, the kit and `/ui` (`scripts/lint-selection.ts`), and `user-select` set by hand (`userSelect`, `user-select`)
    in the app's code and style sheets. `packages/ui/test/lib/selection.test.ts` covers ⌘A and
    `apps/web/test/selection-policy.test.tsx` renders content and chrome and checks which is selectable.
40. **Every collapsible remembers whether it is open** (since 2026-10-27; `lib/preferences/disclosure.ts`,
    `scripts/lint-disclosure.ts`). Fold a Review card, an Overview panel, a Home section, a test run's output, a
    tool row in the chat or a settings group, then refresh, leave and come back: it is as you left it.
    - **One store.** `useDisclosure(persistId, defaultOpen)` reads `localStorage` key `shinsa.disclosures`
      (`{ version: 1, entries: [[id, open], …] }`) synchronously on the first render, so a folded panel is never
      drawn open and then snapped shut, and since the first frame already has the right state no fold or chevron
      animates on load. The default holds until you toggle; after that your choice wins. Writes are kept in
      memory, saved 250ms after the last toggle and on `pagehide`; another tab's save (the `storage` event) is
      taken in, keeping this tab's unsaved toggles. Only the 600 entries toggled last are kept: a toggle moves its
      entry to the end and the oldest fall off. `useDisclosureSet(prefix, marked)` is the same store for a tree,
      one entry per folder (the Code tab's file and changes trees).
    - **Stable ids from what it shows.** `createDisclosureId(scope, …parts)` joins a scope (`task`, `home`,
      `queue`, `services`, `roadmap`, `settings`, `ui`) and parts with `:`, never an array index:
      `task:<taskId>:review:card:<point>` (the point's kind and a hash of its place and text,
      `resolveReviewItemIdentity`), `task:<taskId>:review:panel:<prose>`, `task:<taskId>:overview:panel:<panel>`
      (`resolveOverviewPanelId`), `task:<taskId>:overview:round:<n>`, `task:<taskId>:evidence:<evidenceId>:output`, `task:<taskId>:evidence:panel:earlier`,
      `task:<taskId>:chat:tool:<callKey>` (the chat's rows under `DisclosureScope`, `useDisclosureScope`),
      `task:<taskId>:code:files:<path>`, `home:section:<section>`, `queue:section:<section>`,
      `services:project:<id>`, `roadmap:group:<group>`, `settings:mcp:server:<id>`, and `ui:…` for `/ui`.
    - **Required.** Every collapsible primitive (`Panel`, `CompactSection`, `WideSection`, `FoldingBlock`,
      `RoadmapSection`, `ChangeSnippet`, `ReviewNote`, `ExpandRow`, `ToolGroup`, `UserMessage`, `TestingPanel`,
      `MergeStepsPanel`, `EvidencePanel`) takes a `persistId`; `DisclosureHeader` takes the `disclosure` the hook
      returns, never its own open state. A fold that should be forgotten says why, `notPersisted('…')`: a finding
      card (it never folds) and a search's result groups (new with every query). Popovers, menus and dialogs are
      not collapsibles, and a one-way Show more on a long diff, code block or tool output is a reveal, not a fold.
    - `bun lint:conventions` rejects a collapsible primitive without `persistId`, a `DisclosureHeader` without
      `disclosure`, and fold state (`open`, `expanded`, `folded`, `collapsed`) in `useState` in a file that folds
      (it sets `aria-expanded` or renders a `DisclosureHeader`).

`bun lint:conventions` (`scripts/lint-conventions.ts`) checks the app (`apps/web/src`) for raw `text-[N]` sizes, a
weight other than normal, `font-medium` and `font-semibold`, `gap-0.5` (outside `SectionLabel`), Tailwind's own
shadows (`shadow-2xs` … `shadow-2xl`, `shadow-inner`) and raw `shadow-[…]` or `ring-[…]` (the tokens `shadow-1…4`
and `shadow-control*` are allowed), a `hover:` with no `active:` on its line (a `group-hover:` with no
`group-active:`, unless it reveals from `opacity-0`), a tooltip trigger that is a block with no fitted width (13), a hand-built card (`rounded-xl border border-border bg-card`
instead of `CARD`) and `formatAge(…)` or `formatDuration(…)` rendered in JSX outside `components/text/time-ago.tsx`
(pass the time to `TimeAgo` or `Duration` instead; a time built another way is not caught). In the app and the kit
(`packages/ui/src`) it also rejects raw corners, any `focus:` / `focus-visible:` / `focus-within:` state or
`ring-offset-*`, an icon faded by hand (19), a checkmark icon in green and a transition on a hover, press or
highlight colour (`transition-colors`, `transition-shadow`, or a bare `transition` or a colour in
`transition-[…]` on a line with a `hover:` or `active:`; Motion); the `/ui` catalog pages are checked for raw corners
and those transitions only. Besides that it bans comments (outside `packages/ui`), enforces the verb catalog and rejects a
global key listener (`keydown` or `keyup`) in the app outside `hooks/use-command-key.ts`, `hooks/use-code-keys.ts` and
`hooks/use-review-keys.ts` and `hooks/use-terminal-keys.ts` (32, 34, 37); a terminal's keys go through xterm.js's own
handler on its element (37). It also rejects an ad hoc selection (`select-text`, `select-all`,
`select-auto`, `cursor-text`) in the app, the kit and `/ui`, and `user-select` set by hand in the app (39).

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
| `rounded-checkbox` | 4px = sm − 1 | the `Checkbox` box, 14px (`sm`) and 16px |

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
- **A collapsible header's trailing chevron** sits as far from the end as from
  the top and bottom: `DisclosureHeader` derives the end padding from the
  header height and the chevron box (Where Shinsa differs, the whole header is
  the trigger). Never pad a collapsible header's end at the call site.
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

Three sizes, and only three, tied to the text an icon sits with. `Icon`,
`Spinner` and `Logo` take them as `size`; a primitive sets `--icon-size` for
the glyphs inside it.

| Size | Pixels | Where                                                                                                                                                      |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sm` | 14     | Beside 12–13px text: every chat row, facts, notices, list and menu rows, toasts, badges, `Kbd`, `xs`/`sm` buttons and selects, `StatusTile`'s glyph, the default |
| `md` | 16     | Beside 14px+ text and in 26/30px controls: `default`/`lg` and `icon`/`icon-lg` buttons, `default` selects and inputs, tabs, nav rows, ⌘K's search glyph, the logo |
| `lg` | 20     | Rare and large: the `EmptyState` tile, a full-page wait's spinner, an evidence recording's play glyph, the icon specimens on `/ui`                       |

- 14 for 12–13px text keeps the glyph's drawn part (about 10px of the 24-unit
  box) at the text's x-height-plus, so it reads as a word in the line; 16 is the
  same proportion for 14px text and the 26px control; 20 is for an icon that
  stands alone. 12, 18 and 24 are gone: a 12px glyph beside 12px text read a
  size smaller than the 14px one in the next row, which is what made the chat's
  rows look uneven.
- Inside a primitive, pass nothing. Anywhere else pass `size`. Never a
  `size-*`, `w-*` or `h-*` class on an icon, and never `[&_svg]:size-*` on a
  parent (lint fails).
- Spinners and chevrons are on the same scale: a Button's spinner takes the
  button's size, a disclosure chevron its row's.
- **Chevrons are drawn larger in their box.** Central's `Small` chevron spans 8
  of the 24 units and its `Medium` one 12, where an icon spans about 18, so a
  14px chevron read a size smaller than the 14px icon beside it. Every chevron in the product is one size: `Icon` draws
  any chevron in the `sm` 14px box whatever size it is given, and the generator
  (`scripts/icons.ts`, `CHEVRON_SCALE`) scales `Small` 1.4× and `Medium` 0.9333×
  about the box's centre, dividing the stroke by the same factor, so every
  chevron is 6.5px long at the same weight: the size of the Overview cards'
  fold chevrons.
- **Crosses are drawn at the chevrons' size.** An X (close, remove, dismiss,
  clear) is the same kind of glyph and often sits beside one, or beside the
  pen in the queue, but Central draws `IconCrossSmall` 8 × 8 units and
  `IconCrossMedium` 11 × 11, so a 14px Small cross read clearly smaller. `Icon`
  draws any cross in the `sm` 14px box too, and the generator (`CROSS_SCALE`)
  scales `Small` 1.4× and `Medium` 1.0182× about the centre, the stroke divided
  by the same factor (1.4286 / 1.9643), so every cross is 11.2 units (6.5px) on
  both axes. Measured in the browser at 14px, round caps included: a chevron's
  ink is 7.7 × 4.45px, a cross's 7.7 × 7.7px (it was 5.85px for `Small` and
  7.6px for `Medium`), both starting 3.15px from the box's edge, so the X's ink
  box covers the chevron's long side exactly.
- A tile is not an icon: `StatusTile` is an 18px (`sm`) or 20px (`md`) tinted
  square around an `sm` glyph, so the glyph's drawn part matches the 14px icons
  in its row.

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

### Icon colour — a solid ink a step under its text

An icon draws in `--icon-color`, a solid colour one step quieter than the text
it sits with (Where Shinsa differs, 19). No icon has an opacity.

| Text                                                   | Icon ink      | Light  | Dark   |
| ------------------------------------------------------ | ------------- | ------ | ------ |
| `fg-4`, `foreground`, `card-`/`popover-foreground`     | `icon-4`      | L 0.538 | L 0.66 |
| `fg-3` (body)                                          | `icon-3`      | L 0.631 | L 0.58 |
| `fg-2`, `muted-foreground`                             | `icon-2`      | L 0.665 | L 0.5 |
| `fg-1`                                                 | `icon-1`      | L 0.831 | L 0.44 |
| Any tone (`*-text`, `*-4`, `primary-*`, white on a fill) | the tone itself | — | — |

- **How the step is set.** In light each `icon-N` sits at 72% of its `fg-N`'s APCA
  contrast on `bg-1`. Dark needs a bigger step to read as quieter on a near-black
  background: `icon-4` matches `fg-2` there, and each step below follows it down. `icon-2` in light is held at 3:1 (WCAG non-text contrast),
  because an icon-only secondary button carries meaning by the glyph alone.
  Chroma and hue are the matching `fg` step's.
- **Automatic.** `text-*` colour utilities set `--icon-color` (the `@utility
  text-*` and the `--icon-ink-*` map in globals.css), so a component that sets
  its text colour sets its icons' ink with it: Button variants, menu, select
  and command rows, tabs, Badge, list rows, notice and chat rows, facts. The
  body is `fg-3`/`icon-3`; prose sets its inks next to its colours (app.css).
- **Same row, same ink.** Where an icon and its label are separate elements,
  put the icon inside the label's colour or give it the label's class (the chat
  rows share `LINE_INK`), hover included. A class on the icon changes its ink,
  never its strength: `text-fg-3` on an `Icon` draws `icon-3`.
- **Never brighter than its text.** An icon's ink is never a higher step than
  its text's (lint fails on `text-fg-N`/`text-icon-N` on an icon inside text of
  a lower step).
- **Tones keep the tone**, on the icon and its text alike: a destructive menu
  row (`DESTRUCTIVE_ITEM`) draws its icon in the row's red, the error toast its
  red, a filled primary button its white.
- `opacity-*` on an icon is a reveal (`opacity-0` → `group-hover:opacity-100`)
  or disabled styling on its control, never a way to mute it. `Spinner`'s faint
  track is part of its drawing, not a fade of the icon.

### Sizes — one table, keyed by control height

An icon's spacing comes from **the height of the control it sits in**, and its
size from the three-size scale (Icon sizes): `sm` in 22/24px controls, `md` in
26/30px ones. Primitives set the size for their glyphs; never override it.
The pixel columns below are paywall-next's; Shinsa's control heights are
Where Shinsa differs, 20.

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
- Badges: `sm` (14px), 1px outside the text inset like buttons.

NumberField steppers, `Label` icons, toast icons, the Select trigger, menu and
select items, tabs, segments and `GroupText` are on the table. Still off it:
Toggle (see Toggle) and `Input`'s own text inset (see Open issues).

---

## Layout

- **No sidebars: navigation inside a page is a horizontal tab bar.** Shinsa's UI is compact and every page
  is one centred column, so a page with parts (Settings, the task page) switches them with a tab bar under
  its heading, at every width, never with a rail or a list of links at the side. The Sidebar layout's task
  rail (Where Shinsa differs, 10) is app chrome you choose, not a page's own navigation.
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
  scroll timeline, so it is right on the first painted frame (Where Shinsa differs, 6). It's on menus, select and context-menu lists, popovers,
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
16px. A Button's icons draw in the icon ink of its text, leading and
trailing alike (Iconography → Icon colour): a trailing chevron or a
"view all" arrow is the label's ink. On a secondary button the icon rests at
`icon-2` beside the `fg-2` label and turns `icon-4` with it on hover; on a filled
button it is the label's white. Icons in a Button never take a size, colour,
opacity or stroke override: the button's size sets them (`sm` in `xs`/`sm`,
`md` from `default` up), chevrons and the loading spinner included.
Icon sizes are square: `icon-xs` 24px (14/16px glyph), `icon-sm` 28px,
`icon` 32px at every width, `icon-lg` 36px (16px glyph), `icon-xl` 40px
(18px glyph), each at every width. `list-row` is a
full-width, left-aligned, `font-normal`, **single 32px line** — its label goes in `Truncate`
so a long one ends in an ellipsis with the full text in a tooltip. A row that
genuinely needs two lines is `list-row-two-line` (48px: the label over a
`text-xs` tertiary meta line on a 16px line) — never `h-auto py-*` on
`list-row`.
No transitions on state: a hover or press wash appears at once and the fill
deflates in the frame of the press (Motion). Focus recolours the border
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
  button's border takes, at the same instant (no transition), so seam and
  border change together. (On teal primary groups the seam is
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
**Every tab bar is the kit's.** In Shinsa a row of tabs is `Tabs` from
`@shinsa/ui/components/tabs`, or `Choice` (`components/controls/choice.tsx`)
for a labelled switch: the task tabs, the Code explorer's Changes / Files, the
Settings tabs and Appearance's choices, a finding's Fix / Dismiss, the
terminal tabs and the `/ui` specimens. The selected pill (or the underline's
line) slides on the movement clock, 200ms `cubic-bezier(0.22, 1, 0.36, 1)`
(`INDICATOR_TRANSITION`), and the tab colours change at once. Every one
slides, Settings → Appearance's Layout included: Desk and Shelf are one frame
(`AppFrame`, `components/layout/frame.tsx`) that adds or drops the top bar and
the rail around the same `main`, so switching keeps the page under it mounted,
with its tab bar, its scroll and the focused tab. The indicator
carries `data-motion="move"`, and anything that turns transitions off for a
subtree (the Code tab's `INSTANT`) skips it. `bun lint:conventions` rejects a
`role="tab"` or `role="tablist"` written in `apps/web/src`, an import of
`@base-ui/react/tabs` outside the kit, a subtree-wide `transition-none`
that does not spare `[data-motion=move]`, and `before:` or `after:` on a
subtree (the variant sets `content`, so every element gains a box). The command menu's pages are a
stack, not tabs, and All tasks filters with a status button, not tabs.

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
toggle outline — changes colour at once with the rest (no transition), so a
seam never lags or leads the border beside it. And a translucent edge
only matches another if both composite over the same background: draw a seam
as the part's own border over its own fill, or reproduce the fill under it
(see the button-group separator), never as a bare line over the canvas.

**Truncate.** One line by default, or up to two with `lines={2}` for gallery
names and paywall results. It ends in an ellipsis and, only when it's actually
clipped, shows the full text in a tooltip after the one tooltip delay
(Where Shinsa differs, 13; `components/ui/truncate.tsx`, ported from buzzkit). Use it instead of a bare
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
never blur; the scrim only fades. Dialogs enter at scale 0.96 + opacity over
150ms and leave over 100ms, the command palette at 0.98 over 75ms and out in
75ms; popovers, tooltips and
preview cards over 150ms (see Motion); sheets slide 32px over 250ms on the
drawer curve; list popups appear instantly. Floating popups sit 4px from their
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
  is rare, and when it happens both sides are 4px. A tooltip opens at once unless
  its `Tooltip` (or `useTooltipTrigger`'s options) or the nearest nested
  `TooltipProvider` sets a `delay`; the trigger's own wins. Moving straight
  from one trigger to the next opens the next after its own delay. The
  outermost `TooltipProvider` is the page's one tooltip (Where Shinsa
  differs, 13); without it nothing opens.
- **Toast.** Neutral surface; the type sets only the icon. Content `p-3`,
  `text-sm`, 2px between title and description, 8px to the action. Icons
  are `sm` (14px, the size beside the toast's 13px text), 11px from the edge
  and 6px to the text, the icon ↔ label of a menu row or a button (Where Shinsa
  differs, 20): the toast's 8px gap less the icon box's -2px end margin, so the
  action stays 8px from the text. A one-line toast centres the icon on the
  title's cap height; with a description it sits on the title, 2.5px up. `Alert` shares the 12px inset and the 2px title → description.
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

**Copy.** One interaction everywhere: `CopyButton` (a ghost icon button whose
delayed tooltip says "Copy", then "Copied"; Where Shinsa differs, 13), or
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
| State feedback | none                                  | 0ms   | hover, press, focus, open, selection, a highlighted menu row's text — fill, border, text, icon colour, seams, a hover-revealed control, and the press itself: a button's or select trigger's fill deflating (`inset`), the link button's, ghost tab's and checkbox's press `scale`, a pressed highlight's deflate |
| Movement       | `duration-move`                       | 200ms | tab / segmented / filter-tab indicators, the shared list highlight (menus, selects, ⌘K, the rail, the queue, option lists), chevron turns, accordion and collapsible height, sidebar collapse, the icon swap |
| Popup          | `duration-popup`                      | 150ms | popover, tooltip, preview card (enter at scale 0.98 + opacity)                                                            |
| Dialog         | `DIALOG_MOTION`, `DIALOG_SCRIM_MOTION` | 150ms in, 100ms out | dialog, alert dialog and their scrims (enter at scale 0.96 + opacity, `ease-out`)                                         |
| ⌘K             | `COMMAND_MOTION`, `COMMAND_SCRIM_MOTION` | 75ms in, 75ms out | the command menu and its scrim (enter at scale 0.98 + opacity, `ease-out`)                                              |
| Sheet          | `duration-sheet` + `ease-drawer`      | 250ms | sheets and their scrim                                                                                                    |
| Toast          | literal                               | 500ms | stacking toasts (unchanged)                                                                                               |

Easing: `ease-out` is the strong ease-out `cubic-bezier(0.23, 1, 0.32, 1)`
and is the default for every transition. `ease-in-out` is
`cubic-bezier(0.77, 0, 0.175, 1)`; `ease-drawer` is
`cubic-bezier(0.32, 0.72, 0, 1)` for anything that slides like a drawer.
Never `ease-in` and never `ease-linear` on UI (a progress bar may be linear).

Rules:

- **State is instant; only motion eases.** (Since 2026-10-25, for a native
  feel: every click and hover lands in the frame it happens, as in a Mac app.)
  A hover, press or highlight wash, a text, border or icon colour change, a
  group seam and a control revealed on hover appear at once, with no
  transition. Transitions are only for things that move: a sheet, a popup or
  dialog entering, a turning chevron, a sliding selection indicator, a height
  that opens. A press is state too: the fill deflates, and the link button, a
  ghost tab and a checkbox scale, in the frame of the press, and lift in the
  frame of the release, with no transition; a highlight that slides
  (`useAnimatedIndicator` with `slide`) holds its slide off while the press
  scale lands and lifts. `transition-colors`, `transition-shadow`,
  a bare `transition` and a colour in `transition-[…]` beside a `hover:` or
  `active:` fail `bun lint:conventions`; a colour that changes for another
  reason (a chat run you jump to, flashed with `data-focused`; a switch being
  turned on) may still ease.
- **Never `transition-all`.** Name the properties.
- **A chevron turns, its colour snaps.** A disclosure chevron is
  `DisclosureChevron` (or `transition-disclosure`: `rotate` and `transform`
  on the move clock), never a hand-rotated icon; its colour follows its
  trigger's hover at once like everything else.
- **Highlights slide.** Every list of rows you pick from shares one highlight
  surface: `HighlightList` (rows marked `data-highlighted` by the primitive) or
  `HoverHighlight` (rows marked `data-highlight-item`, resting on the
  `data-active="true"` one), both on `useAnimatedIndicator`. It slides to the
  hovered or keyboard-highlighted row on the movement clock (200ms
  `cubic-bezier(0.22, 1, 0.36, 1)`, `INDICATOR_TRANSITION`) and only through
  `transform`: a translate, and a scale from the box it was laid out at when
  the next row is another size, so no frame of the slide lays out or paints.
  When a slide ends on a row of another size, the indicator is laid out once
  at that size and its scale returns to 1, so its corners never rest stretched. A
  row draws no hover, highlighted or selected background of its own; it only
  changes its text colour (`data-indicator-here`, `data-hovered`), in the frame
  it happens. A press deflates the surface in the frame of the press. The
  indicator carries `data-slot="highlight-indicator"` and `data-motion="move"`,
  so a subtree that turns transitions off (the Code tab's `INSTANT`) spares it.
  It slides in:
  - the kit's `DropdownMenu` (every dropdown and context menu, sub menus,
    `LazyMenu`'s menus, the task, project, MCP server, usage, Focus and queue
    menus), `Select` (`SelectField`, the workspace select, every settings
    choice list), and `Command`'s `CommandList`: the command menu (⌘K, its
    pages included) and Go to file (⌘P);
  - the rail's nav (`NavItem`), the queue in the rail and in the "need you"
    popover, Home's queue sections, Recently finished and Recent
    conversations (`ListRow`), setup's option lists (`OptionList`), the task
    rows in a popover (`TaskPopoverRows`: the guide, a pull request, a fact),
    the Who worked on this list, and the Review tab's Every point index.

  Instant, on purpose: the Code tab's file tree, changes tree and search
  results (their rows' hover and selection change in the frame they are
  asked to, `INSTANT` in `workbench.tsx`), and single controls that are not
  rows in a list (buttons, a trigger's open fill). `bun lint:conventions`
  rejects a row that draws its own highlight background (`data-highlighted:`,
  `data-hovered:` or `data-indicator-here:` with a `bg-`, or a
  `data-highlight-item` / `role="option"` / `role="menuitem"` row with a
  `hover:`, `active:`, selected or active `bg-`), and an option or menu item
  written in `apps/web/src` outside `HighlightList` or `HoverHighlight`;
  `shared-highlight.test.tsx` in the kit renders the menu, select and command
  rows and fails if any of them loses the sliding surface. The segmented
  control's pill and the underline tabs' line slide the same way. The command
  palette enters like every dialog, and list popups open instantly.
- **Hover is colour, not motion.** No hover scale or translate. The only press
  shapes are the fixed `inset` deflate and the scale of the link button, a
  ghost tab and a checkbox, and they land at
  once, never eased.
- **Tooltips:** open after `TOOLTIP_DELAY` (600ms) and fade in over 150ms, and
  instant (`data-instant`, no transition) on a trigger reached within
  `TOOLTIP_SKIP_DELAY` (400ms) of the last one (Where Shinsa differs, 13).
- **Dialogs enter visibly** (since 2026-10-26; `DIALOG_MOTION` in the kit's
  `dialog.tsx`, shared by `alert-dialog.tsx`): a fade with a scale from
  0.96 over 150ms `ease-out`, out in 100ms, the scrim fading with it. A dialog
  mounted already open (every `useDialogState` dialog) never gets base-ui's
  `data-starting-style`, which is why they used to appear in one frame; the
  `starting:` variant (`@starting-style`) gives them the same entry. Each size
  has a fixed width (`min(420px, 100vw − 2rem)`, `sm` 320px, ⌘K 520px), never
  one its content decides, so nothing that loads late changes it. Measured in
  the browser: opacity 0 → 1 and scale 0.96 → 1 over the first 150ms, the
  width 420px from the first frame.
- **⌘K comes and goes in a blink** (since 2026-10-26; `COMMAND_MOTION` and
  `COMMAND_SCRIM_MOTION` in the kit's `command.tsx`, merged over the dialog's
  motion through `DialogContent`'s `overlayClassName` for the scrim). You open
  it many times an hour, so it does not wait on a dialog's pace: 75ms in from a
  scale of 0.98 and 75ms out, its scrim in step; every other dialog keeps 150ms in
  and 100ms out. Both directions are written out (`duration-75
  data-ending-style:duration-75`), since the dialog's own `data-ending-style:duration-100`
  would otherwise win the close. Under reduced motion it keeps only its fade, like a dialog.
  Measured in the browser: `transition-duration` 0.075s on the menu and its
  scrim while it opens and while it closes.
- **Reduced motion** is global: under `prefers-reduced-motion: reduce` every
  transition and animation is cut to nothing, except a spinner and the dialogs
  and their scrims (`data-reduced-motion="fade"`), which drop their scale and
  keep their fade. Looping movement
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
  `cursor-default` on something that responds to a click. In the Mac app the
  pointer hand becomes the arrow and every other cursor stays (Where Shinsa
  differs, 31, No pointer hand, every other cursor).
- Disabled: `opacity-50` and the `not-allowed` cursor, no separate colours. A disabled control keeps its pointer events — so the cursor shows and a tooltip can explain it — and never reacts: the app's `hover:` variant excludes `:disabled`, `[aria-disabled=true]` and `[data-disabled]`, and a base rule in `styles.css` sets the cursor. Never `pointer-events-none` or `cursor-default` for disabled.
- Every colour change on hover, press or highlight — fill, text, border,
  separator, icon, overlay — is instant: no `transition-colors`, no colour in
  `transition-[…]` (see Motion; lint-enforced).
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
   text (`text-fg-*`); an icon takes its text's icon ink (`icon-N` beside `fg-N`), never an opacity.
6. **One accent.** Teal for the single most important beat. `bg-accent` is a
   hover wash, not the brand. One per view, not one per page: the same action
   repeated (a header button and a closing call to action on a long page)
   keeps the same look everywhere — never demote a copy to grey.
7. **Three weights, and state never changes width.** 400 / 500 / 600;
   `faux-medium` for active labels.
8. **No eyebrows, no italic.**
9. **Hover is colour, not motion.** Rows wash `foreground/3` (sidebar rows
   5%), controls `bg-accent`, secondary controls lay `foreground/3` over their
   card fill; instant, no transition (only motion eases); no scale or
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
