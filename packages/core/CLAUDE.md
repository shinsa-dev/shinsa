# @shinsa/core

The pure domain. Every decision Shinsa makes is made here, from the event log alone; `apps/server` does the I/O and
reports back with commands. No `node:*`, no Bun, no clock, no randomness: `decide` gets `now` and `newId` from its
caller. It runs in the browser too, so the web reads the same queue, progress and references.

## Layout

```
src/
├── index.ts         The public barrel. Everything it exports stays importable by the same name
├── domain/          Entity types (types.ts), stage sets and priority order (stages.ts), settings, their defaults and
│                    SETTINGS_KEYS (settings.ts; resolveAgentFastMode: a role's fast mode, else the global one;
│                    resolveDelegationLimit: delegations at once under one step, null for no limit;
│                    HUMAN_ONLY_SETTINGS and HUMAN_ONLY_REPO_FIELDS, the fields only the human changes),
│                    DomainError (errors.ts), the tools of each role (tools.ts: listCallableToolNames, what a role may
│                    call, the one source for decide and prompts; listToolNames, what a session is served: one union
│                    for the TASK_SESSION_ROLES; isHandOverTool, and PURPOSE_HAND_OVERS: the hand-over each purpose
│                    of the task's agent may call), the delegation limits, isReadOnlyRole and isReadOnlyRun (the
│                    agent is read-only while it plans) (delegations.ts), accounts, schedules (SCHEDULE_LIMITS), pull request watch
│                    types, time units (time.ts), task shapes (shapes.ts: SHAPE_PIPELINES (the presets),
│                    validateComposition (the rules checker for the steps the agent composes while it plans), the shape
│                    of a task, resolveShapeState (whether triage or the agent may still change the steps),
│                    findInquiryStep, findWorkStep, resolveProposalUpgrade, SHAPE_LIMITS), the step and gate schema
│                    (steps.ts: PipelineStep, STEP_SCHEMA, GATE_SCHEMA with the hard GateType and the SoftGateType
│                    that escalatesTo one, resolveGateDefinition, PLAN_GATE_RULE and describePlanGateRule,
│                    validatePipeline read from each step's needs), the verification rules
│                    (verification.ts: VERIFICATION_RULES, validateVerification, validatePlanRules,
│                    listMissingEvidence), projects (projects.ts: keys, task handles,
│                    folders: resolveProjectKey, parseTaskHandle, selectFolderProject), rounds (rounds.ts: Round,
│                    resolveTaskRounds, resolveCurrentRound, isTaskResting, isTaskClosed, resolveRoundStamp and
│                    isOfCurrentRound, the stack and how a round ships: resolveRoundBase, listStackedPullRequests,
│                    canChangeRoundShipping, selectShippingTarget), gates (gates.ts: isPausingGate, isDecisionGate
│                    for plan, review and merge, isAgentQuestion for a question or a secret), the on-your-behalf record
│                    (on-behalf.ts: OnBehalfAction), where agents work (workspaces.ts: WORKSPACE_MODES,
│                    resolveRepoWorkspace, WORKSPACE_SETUP_REASON, canUseGitButler; resolveApprovalPath, what
│                    approving the review or the merge does with your edits, for decide and the web's toast), the
│                    files another open task changes too (overlaps.ts: listNewOverlapPaths, describeOverlaps, the
│                    note the Agent's next turn gets)
├── agent-models/    The agent model catalog, the default model per role, resolveAgentModel, model labels, and
│                    RUN_AGENT_ROLE (which agent role's settings each run role uses)
├── events/          ShinsaEvent: past-tense facts, the only way state changes (delegations.ts, schedules.ts split
│                    out)
├── commands/        UserCommand (from the web), AgentCommand (from Shinsa's MCP tools), SystemCommand (from effects
│                    and clocks), with delegations.ts and schedules.ts split out; parse.ts: parseUserCommand checks
│                    the shape of untrusted input field by field before it reaches decide, which owns every range
│                    (settings bounds included); USER_COMMAND_TYPES and SETTINGS_KEYS (domain) are the lists the
│                    command line and the agents' management tools are generated against; isUserCommand (index.ts,
│                    on isUserCommandType) tells a user command from an agent or system one
├── effects/         ShinsaEffect, EFFECT_RECOVERY (process-bound or replay-safe), effect keys (dedupe) and lanes
│                    (ordering)
├── state/           project.ts (createState, applyEvent, replayEventLog: replay that skips and reports an event it
│                    cannot apply, from an empty state or a snapshot), draft.ts (createDraft and sealDraft: the
│                    copy-on-write state decide works on, and the ids it wrote; writeEntry and removeEntry, the only
│                    way a fold writes a record; STATE_RECORDS and STATE_FIELDS name every part of the state),
│                    write.ts (the shared writes the folds use; applyOnBehalf: an event sent on your
│                    behalf marks the activity it records), activity.ts (the wording of a task's activity),
│                    queries.ts (list*, find/select, isDependencyOf, isWaitingOnAnswer, isRunWaiting,
│                    resolveTaskProject, selectTaskByReference, selectStackTarget, selectStackedOnTask and
│                    resolvePullRequestBase for a GitButler task stacked on another's branch), and the folds by
│                    concern, each an apply*Event:
│                    runs.ts (attempts, links, lost sessions, metering, silence, compaction), gates.ts (opened,
│                    answered, withdrawn, noted, superseded), pull-requests.ts, waits.ts (monitors and usage waits),
│                    delegations.ts, schedules.ts, suggestions.ts, reviews.ts (verdicts), accounts.ts (binding),
│                    shapes.ts (reshapes, results, proposed changes), on-behalf.ts (what agents did on your behalf),
│                    inbox.ts (messages accepted and not yet routed), overlaps.ts (task.overlapped, task.overlaps_told),
│                    rounds.ts (round 1 on task.created, archiving a round and starting the next, a round's branch
│                    and pull request, where a merged pull request marks every round still shipped on it merged,
│                    rounds when a task rests, closes or reopens for a follow-up)
├── decide/          decide() (index.ts): one exhaustive switch over the command, then releaseWaiting,
│   │                startQueuedRounds, enforceLiveness and dispatchRuns, over a Decider (decider.ts) that works on a draft and emits
│   │                events and effects (taskSession: the one session every run of a task resumes, whatever its
│   │                kind of work, and the reviewer's own; resumableFrom for a run that failed before it had one);
│   │                equality.ts (isSameValue)
│   ├── lifecycle.ts Starting each step (work, planning, a phase, checks, review), the review gate, settling a task
│   │                (which removes its worktree and its scratch folder: worktree.remove, scratch.remove)
│   ├── fixes.ts     Fix loops: checks and review reactions, the automatic budget, stall detection, review escalation
│   ├── fingerprints.ts  Recovery and fix fingerprints, so prose never resets a budget
│   ├── pull-requests.ts  Pushing, reacting to a synced pull request, the merge gate, merging and merge queues
│   ├── watch.ts     The pull request watch (T3's evaluatePullRequestWatch): per-check diff, required gate,
│   │                comment watermark, sticky conflict, comment-only wake limit, the per-check stall key
│   ├── dependencies.ts   Resolving and changing what a task waits on, releasing waiting tasks, stacking a GitButler
│   │                     task on another's branch (stackTask), the lock on that dependency (assertStackKept) and
│   │                     unstacking the tasks above one that settles without a merge (unstackTasksOn)
│   ├── edits.ts     Your edits from the Code tab: recording one (task.record_edit, steering a working agent
│   │                with a note of Shinsa's), committing them (task.commit_edits), and approving the review or the
│   │                merge with them (task.edits_approved: the checks run again before the push, or CI before the
│   │                merge, as resolveApprovalPath in domain/workspaces.ts says; applyEditsApproval); the next
│   │                run's prompt names them (Decider.startRun)
│   ├── overlaps.ts  Files another open task of the repository changes too: recording the new ones
│   │                (task.record_overlaps), steering the task's Agent at work at once when another task's hand-over
│   │                found them, else telling its next run (tellOverlaps, from Decider.startRun); told once
│   ├── gates.ts     Answering a gate: which decisions each type takes, what each one does, plan versions, verdicts;
│   │                refusing any gate answer sent on your behalf (assertHumanDecides) and any command on your
│   │                behalf that leaves an open gate closed (assertGatesStayOpen, run at the end of decide)
│   ├── messages.ts  A message from you: resolveMessageEffect says what it does where the task is (steer, retry,
│   │                verify the setup, revise, fix, replace the operation's notes, a follow-up on a resting task…; the
│   │                web's composer hint reads it), then it is delivered, only recorded (acknowledge), queued as a new
│   │                round or suggested as a separate task by its kind; superseding an open question; a message sent
│   │                for you to a task at a gate is only
│   │                recorded, for its next agent; needsMessageKind (the server classifies such a message first);
│   │                the inbox: receiveMessage, routeMessage (delivers with the classifier's kind), dropMessage
│   ├── retry.ts     Retry: restart the current step with a fresh fix budget
│   ├── runs.ts      Agent run ends, recovery by failure class (one nudge, a fresh session, or a gate at once),
│   │                attempts and stale writes, restart continuation and its loop guards, lost sessions, dispatch
│   ├── agents.ts    Agent hand-overs (propose_plan with the plan rules, complete_phase with the evidence the plan
│   │                asks for, complete_fix, report_review, ask, evidence, note)
│   ├── shapes.ts    Task shapes: the next step of a pipeline, the inquiry steps (answer, research, investigate)
│   │                and the operation, results and proposals, your OK and its proposal gate, the agent's
│   │                presets and composed steps, the operation gate and its notes after a merge, follow-ups (an
│   │                inquiry's own agent, or an answerer on the last session of finished work: answerFollowUp)
│   ├── tasks.ts     Creating, triaging, prioritising, cancelling and completing tasks; worktrees
│   ├── workspaces.ts  Asking for a task's workspace in its repository's mode, and waiting for a main checkout
│   │                another task holds (holdForCheckout)
│   ├── conflicts.ts Commits GitButler left conflicted on a task's branch (recordConflict): steer the Agent at work,
│   │                start a fix (`fixFor: 'conflict'`) at the review gate, the merge gate or while shipping, or
│   │                hold it (task.conflict_held) for the Agent's next build, fix or operation turn (tellHeldConflict,
│   │                from Decider.startRun) or the task's next review or merge gate (startHeldConflictFix);
│   │                a GitButler pull request that conflicts with its base: the Update the workspace gate
│   │                (askToUpdateWorkspace, `cause: 'workspace_update'`), `but pull` (the workspace.update effect)
│   │                and the conflict fix after it (recordWorkspaceUpdate)
│   ├── suggestions.ts  Tasks an agent suggests, accepting and dismissing them, split-offs and keeping one
│   │                as the next round
│   ├── rounds.ts    A new round waiting, starting the next one when the current one rests (startQueuedRounds, after
│   │                every command), its branch and pull request, switching how a round ships
│   ├── config.ts    Setup verification and its configuration gate
│   ├── monitors.ts  wait_for: arming, waking and checking a monitor
│   ├── costs.ts     Metering runs (cost and the weekly usage they used) and the per-task usage and cost limits
│   ├── silence.ts   Snoozing and dismissing a quiet run
│   ├── settings.ts  Repositories, projects (keys, folders, moving repositories in), focus, settings, the guide;
│   │                refusing a human-only setting or repository field changed on your behalf
│   ├── accounts.ts  Binding a task to an account, usage waits (arm, resume, change, resume now), the Sign in gate
│   ├── compaction.ts  Recording an idle session's compaction
│   ├── delegations.ts  Delegations: requests, the ceiling and limits, delivery cohorts, questions, cascades,
│   │                adoption, recovery
│   ├── couriers.ts  create_task and split_task
│   ├── orchestration.ts  Routing the delegation commands
│   ├── schedules.ts Writing, firing, skipping, failing and stopping schedules; webhook deliveries
│   ├── secrets.ts   request_secret and the secret gate (only a ref answers it)
│   ├── on-behalf.ts What a user command sent on your behalf records (`on_behalf.acted`, its sentence, task and
│   │                acting task, kept as `OnBehalfAction`); a system command records nothing here
│   └── liveness.ts  isTaskLive and the stuck-task failure gate
├── accounts/        usage.ts (which windows count for a model, used percent, headroom, spent-until, the weekly
│                    window and what a run used of it), plan.ts (resolvePlanLabel), pick.ts
│                    (pickAccount: the account picker the server leases with; selectNextAccount: the web's next-account
│                    glance) and fast-mode.ts (resolveFastModeAvailability: whether a provider's accounts have the
│                    usage credits fast mode needs)
├── costs/           A run's usage delta per session, the cost rollup per task, role and phase, the usage and
│                    cost limits (listTaskBudgets)
├── schedules/       Schedule times (time.ts: next run, DST-safe daily, time zones), describing a schedule
│                    (describe.ts), validating set_schedule and request_secret (validate.ts)
├── queue/           Needs you (rank.ts), the one table of gate words (reasons.ts), stepping through decisions
│                    (step.ts), the stalled leaf of a chain (stalls.ts), silent runs (silence.ts), the `shinsa status`
│                    summary (summary.ts)
├── briefing/        The Home guide: fallback, parsing the writer's answer, the note rule, reconciling a stored one,
│                    plain text
├── report/          The hand-over protocol: types, PROTOCOL_LIMITS (with minPlanPhases and findingCount), the enum
│                    lists the tool schemas read (ATTENTION_LEVELS, FINDING_SEVERITIES, DELEGATION_MODES,
│                    DELEGATION_ISOLATIONS) and validate*, the delegation and courier requests (orchestration.ts),
│                    plan changes between versions, Markdown, assembleReport
├── chat/            The chat protocol (ChatEntry), shinsa:// references, inline code marking, a task as text for
│                    an agent (task-detail.ts: serializeTaskDetail, what `read_task` and `tasks_show` read), the
│                    other open work in a task's repository (repository-work.ts: listRepositoryWork,
│                    serializeRepositoryWork, what `list_repository_work` reads), and
│                    sentence helpers (text.ts: describeCount, describeList, capitalise, lowerFirst)
├── prompts/         House rules and splitting them off a brief (rules.ts) and the delegation rules
│                    (orchestration-rules.ts), the step catalog, rules and plan parameters the agent reads while it
│                    plans (steps.ts, from the schema), each role's prompt (roles.ts: the round agent's planning prompt,
│                    its short phase and operation instructions and the round brief) and the context it describes
│                    (context.ts), the full brief a resumed agent run sends when its session cannot hold the round
│                    (root.ts: resolveRunBrief), fix prompts, what a fix is for (focus.ts: resolveFixFocus, from the fix
│                    prompts' first words), session prompts (restart,
│                    steer, answer, superseded, usage resume), monitor prompts (waits.ts), the delegated agent's and
│                    the delivery prompts (orchestration.ts), the budgeted context handoff (handoff.ts), the
│                    rules for managing Shinsa every role gets (manage.ts, MANAGE_RULES), the follow-up on a finished
│                    round (follow-up.ts, resolveFollowUpPrompt), the project a fresh
│                    run is told about, and the repository outside it the task works in, if any (project.ts,
│                    resolveProjectContext)
├── progress/        The steps a task shows on its page, and an ended round's (resolveRoundProgress)
└── protocol/        WebSocket messages, state patches (patch.ts: resolveStatePatch, applyStatePatch), the state as
                     the socket sends it (runs.ts: WireRun and WireState, runs without their prompts; serializeRun,
                     serializeState), diff parsing,
                     the accounts snapshot (accounts.ts), MCP servers, plugins and
                     skills (extensions.ts: the snapshot, scopes, token estimates, what a run loaded, the context
                     optimizer's settings and isUnused), the
                     onboarding API types (onboarding.ts)
```

Rounds keep the task's flat fields as the current round's work: a new round archives them into its `Round`
(`outcome`) and starts them empty, so every rule above holds per round without knowing about rounds. A field a step
reads across rounds (evidence, activity, runs, gates) carries `round` from round 2 on.

`test/` follows `src/`: one folder per source folder and a test file per module with behaviour of its own
(`decide/gates.ts` ↔ `test/decide/gates.test.ts`). Some modules are covered through the file that drives them
instead (`decide/decider.ts`, `liveness.ts` and `retry.ts`, the folds in `state/` without a test file of their own
(`rounds`, `waits`, `shapes`, `suggestions`, `reviews`, `accounts`, `gates`, `pull-requests`, `activity`) and
`domain/gates.ts` through the `decide` tests, `state/queries.ts` and `write.ts` through the state tests,
`prompts/context.ts` through the role prompts, `chat/text.ts` and `queue/reasons.ts` through their users). `test/harness.ts` drives `decide`
with a fixed clock and ids and has the steps a test needs (`createTask`, `reachReviewGate`, `reachShipping`,
`pushFix`, `shipAndMerge`).

## Rules

- **Replay rebuilds state.** `applyEvent` reads only the event and the state before it; `decide` never mutates its
  input. Never store a shared constant into state by reference (`createSettings()`, not `DEFAULT_SETTINGS`).
- **No old logs.** Shinsa has never shipped, so there is nothing to replay but logs the current code wrote: rename or
  remove an event or a field outright, with no reader for the old shape and no default that only an old log needs.
  The server rewrites old shapes in the user's log once on start (`apps/server/src/store/legacy.ts`), so core
  never sees them.
- **Nothing runs on import.** `package.json` says `"sideEffects": false`, so a bundler keeps only what a caller
  imports: the desktop app's main bundle, which needs only `ENGINE_PROTOCOL`, holds that one module instead of the
  whole domain. A module that registers something or writes a global when imported would be dropped silently.
- **Validate before emitting.** A command that is not allowed throws `DomainError` and leaves no events. Anything
  that arrives from outside the server (`UserCommand` over HTTP or the socket) goes through `parseUserCommand` first,
  so `decide` only ever sees well-typed fields: a wrong type, an unknown setting or repository field, a priority or
  merge method outside its set is refused there, and the result carries only the fields the command defines. Ranges
  (a fix round count of 1 or more, a switch percentage from 1 to 100) are `decide`'s, so a command from inside the
  server meets the same bounds.
- **Repeated commands are no-ops.** Effects retry and tools get called twice; a command that changes nothing emits
  nothing.
- **The invariants**, checked after every random command in `test/decide/invariants.test.ts` (and listed nowhere
  else; `docs/engine.md` points here):
  - at most one active run per task, and none still `queued` once `decide` returns;
  - every open task is live (`isTaskLive`): a gate, an active run, an armed wait, or a stage Shinsa runs itself
    (triage, waiting on other tasks, checks, the pull request);
  - settled tasks have no runs and no gates;
  - an agent's question is open only while the run that asked it is active, and a superseded question is withdrawn;
  - no failure gate while an agent runs (starting a step withdraws it), and at most one failure gate per task;
  - a task waiting for a usage limit to reset has no run, no failure or Sign in gate and is not settled; at most one
    Sign in gate per task, and it names its provider, and its account for Claude (none for a provider's own login);
  - a task has at most one armed wait (a monitor or a usage limit), and none while a run is active;
  - a plan gate exactly when `awaiting_plan` (for the current plan version), a review gate exactly when
    `awaiting_review`, a merge gate only in `awaiting_merge` and never while the task waits on an unfinished task;
    `awaiting_merge` without a merge gate means the merge is running;
  - a configuration gate only in triage, a budget gate only while the task is past its usage or cost limit, and a task
    has at most ten open suggestions;
  - shapes (`shape-invariants.ts`): every task's pipeline passes `validatePipeline` and the verification rules
    (`validateVerification`), and its plan passes `validatePlanRules`; a task that reported every phase has the
    evidence its plan asks for; its stage belongs to one of its steps (the test's `resolveStageStep`: answering needs `answer`,
    building needs `build`, awaiting an operation needs `operate`…), except an answerer's follow-up on finished work
    (`isFollowUpOnWork`), which happens only once its pull request merged or its operation reported; a proposal gate exactly when
    `awaiting_proposal`, only on a task with `your_ok`, and an open proposal only then; no pull request without a `pull_request` step, no phase report
    without `build`; in its first round, a task that never had a step that needs a worktree has no worktree or
    branch; a task with
    `your_ok` plans or does its work only after your OK (its proposal accepted), and asks for it only after its inquiry
    ran; an operation before the build runs before any phase report, one after the merge only once the pull request
    merged and you answered its operation gate, and such a task never settles as merged; an operation gate is open
    exactly while the task is `awaiting_operation`, which only happens after the merge; an open task with a merged
    pull request is waiting for that gate or running its operation;
  - no dependency cycles;
  - workspaces (`workspace-invariants.ts`): no two tasks of one repository hold its main checkout (from asking for it
    until it is given back), a task with a checkout knows its mode, and a task waiting on other tasks waits on an
    unfinished dependency, a gate or the task holding its checkout;
  - every task sits in one place in the queue (deciding, working or waiting);
  - delegation (`delegation-invariants.ts`): a delegated run's parent is on the same task, depth is its parent's plus
    one and at most three, at most eight live under one step, a read-only parent has no child that writes, a step
    waiting on its delegations always has something on its way to it (a claim, or a running child), a running
    one has no undelivered report outside a claim, and no gate is a delegated run's question (it goes to its parent);
  - schedules (`schedule-invariants.ts`): a stopped schedule is off with no next run, a live timed one has one and a
    webhook none, at most 20 runs and 500 replay keys kept, the run count within `max_runs`, at most 20 live schedules
    per task;
  - rounds (`round-invariants.ts`): rounds are numbered one by one, at most one is active and an open task works on
    exactly one, a round waiting to start comes after every started one and a closed task has none waiting; every
    live run (delegated runs included) and every open gate belongs to the current round; the task works on its active round's branch and through its
    round's pull request; a shipped round's pull request is open and a merged round's merged; a stacked round stacks on
    an earlier round's branch; a pull request open across rounds stays on one branch, and the stack never repeats the
    task's own pull request;
  - projects (`project-invariants.ts`, `assertHandleInvariants`): a triaged task has a handle, no two tasks share
    one, each parses back to itself with a valid key, and its key's counter is at least its number;
  - the task's agent (`agent-invariants.ts`, `assertOneSessionPerTask`): a top-level run is the task's Agent, a
    reviewer or an inquiry agent (planner and builder exist only as delegated runs; there is no fixer or operator),
    every agent run has a purpose and no other run has one, an active agent run's purpose matches the stage (`plan`
    planning, `build` building, `fix` fixing, `operate` operating), and every new run of a task-session role resumes
    the session of the task's latest such run with a session (one session per task, across phases, fixes, rounds,
    kinds of work and models) unless that session ended in a context overflow or an image error, the previous run of
    the role failed with a fresh-class failure, or it belongs to another kind of work on another provider; every
    reviewer resumes the reviewer's own session the same way; checked as each `run.started` is applied;
  - on your behalf (a walk of commands sent on your behalf): nothing sent on your behalf closes a gate, and none
    moves a task waiting at one to merged or done;
  - replaying the log reproduces the state, and the same input gives the same decision;
  - `decide` never changes the state it is given; the state it returns equals applying its events one by one, entry
    by entry for every id it reports changed (and as a whole at the end of the walk); and the state patch of every
    command, sent through JSON and applied to a copy kept on the side, gives the same state, so a page that only
    ever gets patches holds what the server holds.

## Tests

`bun test` here enforces 100% line and function coverage (`bunfig.toml`). The property test runs each walk (the base
one, outages, shapes, compositions, schedules, projects, on your behalf, accounts, rounds and composed rounds) over 30
seeds of 400 random commands, in about three minutes; when it fails it names the seed, the step and the command. Set
`SHINSA_SEEDS` to sweep wider before landing a change to `decide` (`SHINSA_SEEDS=1000 bun test
test/decide/invariants.test.ts` takes about an hour).
