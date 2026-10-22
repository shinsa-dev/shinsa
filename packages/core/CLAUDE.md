# @shinsa/core

The pure domain. Every decision Shinsa makes is made here, from the event log alone; `apps/server` does the I/O and
reports back with commands. No `node:*`, no Bun, no clock, no randomness: `decide` gets `now` and `newId` from its
caller. It runs in the browser too, so the web reads the same queue, progress and references.

## Layout

```
src/
├── index.ts         The public barrel. Everything it exports stays importable by the same name
├── model/           Entity types, stage sets and priority order, settings and their defaults, DomainError
├── models/          The agent model catalog, the default model per role, resolveAgentModel, model labels
├── events/          ShinsaEvent: past-tense facts, the only way state changes
├── commands/        UserCommand (from the web), AgentCommand (from Shinsa's MCP tools), SystemCommand (from effects)
├── effects/         ShinsaEffect, effect keys (dedupe) and lanes (ordering)
├── state/           project.ts (createState, applyEvent, replayEvents), activity.ts (the wording of a task's
│                    activity), queries.ts (list*, find/select, isDependencyOf, resolveTaskArea)
├── decide/          decide(): one exhaustive switch over the command, then releaseQueued, enforceLiveness and
│   │                dispatchRuns, over a Decider (decider.ts) that works on a clone and emits events and effects
│   ├── lifecycle.ts Starting each step (work, planning, a phase, checks, review), the review gate, settling a task
│   ├── fixes.ts     Fix loops: checks and review reactions, the automatic budget, stall detection
│   ├── pull-requests.ts  Pushing, reacting to a synced pull request, the merge gate and merging
│   ├── dependencies.ts   Resolving and changing what a task waits on, releasing waiting tasks
│   ├── gates.ts     Answering a gate: which decisions each kind takes, what each one does
│   ├── messages.ts  A message from you: steer, answer, revise or fix, depending on where the task is
│   ├── retry.ts     Retry: restart the current step with a fresh fix budget
│   ├── runs.ts      Agent run ends, recovery with one nudge, dispatch
│   ├── agents.ts    Agent hand-overs (propose_plan, complete_phase, complete_fix, report_review, ask, evidence, note)
│   ├── tasks.ts     Creating, triaging, prioritising, blocking, cancelling and completing tasks; worktrees
│   ├── settings.ts  Repositories, areas, focus, settings, the stored guide
│   └── liveness.ts  resolveLiveness and the stuck-task failure gate
├── queue/           Needs you (rank.ts), stepping through decisions (step.ts), the `shinsa status` summary
├── briefing/        The Home guide: fallback, parsing the writer's answer, reconciling a stored one, plain text
├── report/          The hand-over protocol: types, PROTOCOL_LIMITS and validate*, Markdown, assembleReport
├── chat/            The chat protocol (ChatEntry), shinsa:// references, inline code marking
├── prompts/         House rules, each role's prompt, fix prompts, restart and answer prompts
├── progress/        The steps a task shows on its page
└── protocol/        WebSocket messages, diff parsing
```

`test/` mirrors `src/` file for file. `test/harness.ts` drives `decide` with a fixed clock and ids and has the steps
a test needs (`createTask`, `reachReviewGate`, `reachShipping`, `pushFix`, `shipAndMerge`).

## Rules

- **Replay rebuilds state.** `applyEvent` reads only the event and the state before it; `decide` never mutates its
  input. Never store a shared constant into state by reference (`createSettings()`, not `DEFAULT_SETTINGS`).
- **Events are forever.** Never remove an event type or change its meaning; add optional fields and new events.
- **Validate before emitting.** A command that is not allowed throws `DomainError` and leaves no events.
- **Repeated commands are no-ops.** Effects retry and tools get called twice; a command that changes nothing emits
  nothing.
- **The invariants**, checked after every random command in `test/decide/invariants.test.ts`:
  - at most one active run per task, and none still `queued` once `decide` returns;
  - every open task is live: a gate, an active run, or a step Shinsa runs itself;
  - settled tasks have no runs and no gates;
  - an agent's question is open only while the run that asked it is active;
  - no failure gate while an agent runs (starting a step withdraws it);
  - a plan gate exactly when `awaiting_spec`, a review gate exactly when `awaiting_review`, a merge gate only in
    `awaiting_merge` and never while the task waits on an unfinished task; `awaiting_merge` without a merge gate
    means the merge is running;
  - no dependency cycles;
  - every task sits in one place in the queue (deciding, working or waiting);
  - replaying the log reproduces the state, and the same input gives the same decision.

## Tests

`bun test` here enforces 100% line and function coverage (`bunfig.toml`). The property test runs 30 seeds of 400
random commands in about five seconds; when it fails it names the seed, the step and the command. Raise `SEEDS`
locally to sweep wider before landing a change to `decide`.
