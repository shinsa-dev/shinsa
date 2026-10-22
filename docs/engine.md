# The engine

How a request becomes merged code while the human only steps in at gates. It borrows from
T3 Code's orchestration v2 (events and effects committed together, effects in ordered lanes,
results pushed back as commands, a split between process-bound and replay-safe work) and from
Paperclip (an execution policy the runtime enforces, a liveness invariant, bounded recovery that
escalates instead of looping). The rules live in `packages/core` (pure, `decide`) and the I/O in
`apps/server`. An agent cannot skip a step by forgetting it.

## Agents

Each step is its own agent, and each role's model is set in Settings → Agents. The agent that
builds never reviews its own work.

| Role | Default model | Session | Tools | Hands back with |
| --- | --- | --- | --- | --- |
| Classifier | Haiku | one call, no tools | none (JSON) | title, repository, size, branch, the tasks it waits on |
| Planner | Opus | fresh, cannot edit | `propose_plan`, `ask`, `find_tasks`, `note` | 2–8 phases |
| Builder | Opus | a fresh session per phase | `complete_phase`, `ask`, `attach_evidence`, `find_tasks`, `note` | a phase report |
| Reviewer | Opus | always fresh, cannot edit | `report_review`, `attach_evidence`, `find_tasks`, `note` | findings |
| Fixer | Opus | resumes the latest builder or fixer session | `complete_fix`, `ask`, `attach_evidence`, `find_tasks`, `note` | a summary |
| Writer | Haiku | one call, no thinking | none (JSON) | the Home guide: now, up next, a heads-up |

The defaults come from `DEFAULT_AGENT_MODELS`; `settings.agentModels` overrides any role. Model
names come from `KNOWN_AGENT_MODELS` in `packages/core/src/models/index.ts` ("opus" is "Opus 5.5"), so
Settings shows the right name from the first paint; `GET /api/models` then replaces the list
with the live catalog from the Claude SDK, labelled the same way (`resolveModelLabel`).

**Checks are not an agent.** Shinsa runs the repository's check commands itself (`apps/server/src/checks`:
the configured commands, otherwise `lint`, `check-types`, `typecheck` and `test` from
`package.json`), so a green build is a fact, never an agent's claim.

## A task's path

```
create → classify → (wait for the task it depends on) → worktree → plan → phase 1 … phase n
       → checks → agent review → YOUR REVIEW → pull request → CI and bots → YOUR MERGE → merged
          checks, review, CI and your messages all loop through a fixer
```

1. **Classify.** One Haiku call picks the title, repository, size, branch and, given every open
   task, the tasks this one depends on (`depends_on`, a list, usually empty). Then the task either
   waits for them (Scheduling, below) or gets its worktree at once (`worktree.create`): a fresh
   branch from the freshly fetched default branch.
2. **Plan.** The planner reads the code and calls `propose_plan`. With Settings → Approve plans
   on, a large plan waits at a plan gate; otherwise building starts at once. A decision only the
   human can make is asked with `ask` before planning finishes.
3. **Build.** Each phase is a new builder run with a fresh session. It sees the plan, its own
   phase and the summaries of the phases before it. Phases run in order in one worktree.
   `complete_phase` commits the phase (`<type>: <phase title>`) and starts the next one.
4. **Checks.** After the last phase Shinsa runs the checks. A failure goes to a fixer with the
   output.
5. **Agent review.** A fresh reviewer reads the diff. Blocking findings go to a fixer, and then
   the checks and a new reviewer run again. Suggestions alone do not block.
6. **Your review.** The review gate shows one report built from every phase. Approve it, or write
   in the chat: a message while the gate is open withdraws it and goes to a fixer.
7. **Pull request.** Shinsa pushes and opens the PR. Every sync is checked: failing CI,
   unresolved threads or conflicts start a fixer, and `complete_fix` pushes the fix. While a push
   is on its way (`pull_request.push_requested` until `pull_request.pushed`), and until GitHub
   reports the pushed commit, a sync is stored but not judged, so a stale result never starts a
   second fixer.
8. **Your merge.** The merge gate opens only on a clean PR, and only after every task it waits on
   has finished. A task that starts waiting on another while its merge gate is open loses the
   gate until that task merges. Approving starts the merge; syncs that arrive while it runs never
   reopen the gate. Merging settles the task, removes the worktree and starts the tasks waiting on
   it.

## Scheduling

Shinsa is a roadmap: everything you ask for is worked on as soon as it can be, and only the order
in which finished work reaches you is managed.

- **No dependency, no waiting.** A new task is classified, gets its worktree and starts planning
  at once, on its own agent, then builds, checks and lands at your review gate. How many
  decisions are already waiting does not matter, and neither does how many agents are already
  running: there is no cap. A run is created `queued` and `dispatchRuns` starts it in the same
  command, so `queued` only lasts until the end of that command (or across a restart, until the
  boot dispatch). An agent may start as many subagents of its own as it needs.
- **No agent limit.** There used to be an **Agents at once** setting (`maxConcurrentRuns`) and a
  "Not started: waiting for a free agent" state. Both are gone: work you asked for should not
  wait for a slot, and an agent's own subagents never counted against it anyway. A stored
  `maxConcurrentRuns` is ignored. There is no hidden cap or environment switch either; if a
  machine ever needs one, it belongs in `dispatchRuns` and nowhere else.
- **Not started.** The only way a task waits before its first agent is a dependency:
  `listWaitsOn` (core) returns the unfinished tasks it waits on, and the task shows in Waiting on
  another task in Home's queue, the sidebar and All tasks.
- **Priority decides what reaches you first, not what runs.** Low priority work is built just
  the same; its decisions sort below every higher one in Needs you (`resolveQueue`: priority,
  then what it unblocks, then ready to merge, changes to review, plan to approve, a question,
  paused), and the guide never leads with a low priority decision while anything else waits
  (`parseBriefing` drops such an answer; low ones go to the end of next).
- **No hold.** There used to be a "Hold new work" setting (`holdNewWorkAt`) that parked new tasks
  while decisions piled up. It is gone: holding the compute only delays work you asked for, and
  the attention limit and priority already keep finished work out of your way. Old `queued`
  tasks it parked are released by the same loop that releases dependents. A stored
  `holdNewWorkAt` is ignored.

### Dependencies

A task can wait on other tasks (`task.blockedBy`, a list). They come from three places: the
classifier (`depends_on`, only when the request needs that work to exist first, and only when you
did not choose any), you when creating the task (the composer's When to start: "After ‹task›"), or
later (the Waits on menu on the task page, the task's `•••` and context menus, All tasks' chain
arrow, ⌘K's Wait for another task… and Stop waiting, all `task.block` with the whole new list).

- **Waiting.** A task with an unfinished dependency sits in stage `queued` ("waiting for ‹A›,
  ‹B› to finish", kept current as each one finishes) with no worktree and no agent. Nothing runs
  on it, so it costs nothing. Its liveness is Shinsa itself, not a stuck agent.
- **Several parents.** A task can wait on any number of tasks; it starts only when every one of
  them is merged or marked done.
- **Fan-out.** Any number of tasks can wait on the same task. When it merges they all start at
  once, each on its own agent, and its decision ranks higher in Needs you for every task it
  unblocks.
- **Release.** When every task it waits on is merged or marked done, the task starts by itself
  (`releaseQueued`, after every command): `worktree.create` makes its branch from the freshly
  fetched default branch, which now holds every parent's work, and planning starts. A worktree
  left from before (a task that was planning when it was told to wait) is reset onto the updated
  default branch first; it never has commits of its own at that point. Its prompts name the tasks
  it built on and say they have merged (`baseLine`).
- **Chains and diamonds.** MCP v2 → embedded chat → paywall editing in the chat: each link waits for
  the one before it, so they start one after another as each merges. A diamond (B and C wait on
  A, D waits on B and C) starts B and C together when A merges, and D only after both. Cycles
  are refused (`task.block` and `task.create` throw "‹task› already waits on this task.").
- **Cancelling a parent.** The work a dependent needed will never exist, so it is not started
  blind: each waiting dependent gets a failure gate, "“‹parent›” was cancelled", and shows as
  Paused. With other parents still pending, the gate says Retry keeps waiting on those only.
  Retry drops the cancelled dependencies (and waits on the rest, or starts); Wait for another task
  points it elsewhere; unticking the cancelled task in the Waits on menu does what Retry does;
  Cancel drops it. Tasks further down a chain keep waiting on their own parent. A task cannot
  newly wait on a cancelled task, but a cancelled task it already waits on stays in the list
  until you remove it, so adding another parent next to it works.
- **Changing your mind.** The Waits on menus tick and untick one task at a time and keep the menu
  open; Stop waiting clears them all and releases the task at once. Waiting added to a task that
  is still planning cancels the planner and puts it back to waiting (it plans again after the
  release). Once building has started, a new dependency only holds the merge gate until every
  task it waits on merges: the work is not thrown away.
- **No stacking for new work.** Earlier versions branched a dependent off its parent's unmerged
  branch and targeted its pull request at it. Dependents now wait for their parents to finish
  instead. Tasks stacked before the change (`baseTaskId`) still finish the old way: their pull
  request is retargeted to the default branch after the base merges.

## Gates

`review` and `merge` are your decisions. `question` is an agent waiting for an answer.
`failure` means the engine ran out of automatic recovery. The plan gate exists only with plan
approval switched on. Nothing else waits on you.

Each gate takes only the answers that mean something for it (`gate.answer` refuses the rest):
a plan, review or merge takes approve, ask for changes or reject; an agent's question takes an
answer with words in it; a failure takes retry (approve, or an answer used as guidance) or
reject, which cancels the task. A question belongs to the run that asked it: when that run ends
for any reason the question is withdrawn and the waiting tool call is released. A failure gate
is withdrawn as soon as a new agent step starts or the pull request turns clean, since the
problem it reported no longer applies.

## The briefing

The guide at the top of Home. `Briefings` (`apps/server/src/briefing`) rewrites it 4 s after
the last command that asks for one (a gate opening or closing, a task finishing), so a burst of
changes costs one call.

- **Shape.** `Briefing` in `packages/core/src/briefing/types.ts`: `now` (a task id and why to take it
  first), `next` (up to three more, each with a why), `running` (one line on what agents are
  doing) and `note` (a heads-up, or null). It is stored on `briefing.written` beside a plain
  `text` rendering, which `shinsa status` prints.
- **The writer** gets every open decision with its id, title, what the gate really is (a review
  is built and checked, not ready to merge), its age, what it unblocks, priority and repository,
  plus what agents are working on. It answers with JSON.
- **Validation** (`parseBriefing`): `now` must be a decision in the queue, or the whole answer is
  dropped. `next` keeps known decisions once each, at most three, and falls back to the ranked
  order when empty. A why or note is replaced by the plain one when it is too long, points at a
  position ("item three"), names a task by id, starts with its own title, or calls something
  other than a merge ready to merge. Dashes and exclamation marks are cleaned up.
- **The note never repeats the guide.** It must not name a task that is in `now` or `next`
  (its title, or a quoted part of it of 12 characters or more): those lines already say why it
  matters. A note that does is replaced by the plain note for the tasks the guide leaves out,
  or null. The writer is told the same, the fallback picks its paused or stale task from the
  decisions the guide does not name, and `reconcileBriefing` checks again against the live
  `now` and `next`.
- **Fallback** (`resolveFallbackBriefing`): the ranked queue with a fixed why per gate, and a
  note for a paused task, a merge waiting two days or more, or tasks waiting for another to finish.
  Used when the model is off, fails or answers badly.
- **Nothing outside the focus.** The guide never mentions decisions outside the focus: the
  writer is not told about them, and `parseBriefing` and `reconcileBriefing` replace a note
  that does (one that says "outside your focus", or names a held decision) with the plain one.
- **Showing it** (`reconcileBriefing`): Home checks the stored guide against the live queue.
  A `now` that no longer needs you means the plain guide until the next write; `next` drops
  decisions that are gone; `running` is always recomputed. Briefings stored as text only, before
  the guide had a shape, replay with `briefing: null` and show the plain guide.

## Guarantees

- **One commit for events and effects.** `EventLog.commit` writes the events and the effect
  outbox in one SQLite transaction, so a crash can never keep one and lose the other.
- **Durable, ordered effects.** Each effect has a key and a lane: one lane per task, plus
  separate lanes for each run's session, cancel and steer, so a cancel is never stuck behind the
  session it cancels. Effects in a lane run in order. A failed effect retries after
  100 ms × 2ⁿ (capped at 30 s), up to 5 attempts, then opens a failure gate on its task.
  Effects report back only by dispatching commands.
- **Stale output is dropped.** Agent commands carry their run id. A run that has ended, a
  finished task, or the wrong role is rejected with a message telling the agent to stop.
- **Liveness.** After every command each open task must have something moving it: a gate, an
  active run, or Shinsa itself (triage, checks, pull request). A task stuck in an agent stage
  with none of these gets a failure gate instead of hanging silently (`resolveLiveness`).
- **No agent cap.** Every queued run is dispatched in the command that created it (see
  Scheduling).

## Recovery

- A run that ends without handing over, or fails, is resumed once on its own session with a
  nudge. A second stop opens a failure gate. Any progress resets that budget.
- A fix loop stops with "not making progress" when the same failures come back after two fix
  rounds (checks by failing check names, the agent review by the files of its blocking findings,
  the pull request by its checks, comments and conflicts). `maxFixRounds` caps the automatic
  rounds; "until clean" keeps going, up to 12, while each round changes something.
- Retrying a task, and asking for changes yourself, start a fresh automatic budget. Changes you
  ask for never use it up.
- A message that reaches a session just as it ends is not lost: it is delivered to whatever
  runs next (`message.deliver`).
- A run that goes two hours without handing over is stopped as failed. Time spent waiting on your
  answer does not count, however many questions are open at once.
- On restart, effects bound to a dead process (sessions, cancels, steers, question replies) are
  cancelled. Their runs are resumed with "continue where you left off", and queued runs are
  dispatched. Everything else (triage, checks, git, pull requests) runs again from the outbox.

## The chat protocol

Every agent run streams one transcript in Shinsa's own format, `ChatEntry` in
`packages/core/src/chat/protocol.ts` (version `CHAT_PROTOCOL_VERSION`, 2). It never carries a provider's
names: a provider adapter maps into it, and the web renders only it. Each entry is
`{ v, id, at, type, … }`, one JSON line in `transcripts/<runId>.jsonl`:

| Type | Fields | Meaning |
| --- | --- | --- |
| `user` | `from` (`you` or `shinsa`), `text`, `attachments` | Shinsa's brief, or your message (images and files as `{ kind, name, url, mimeType, size }`) |
| `agent` | `phase`, `text` | The agent's words. `interim` between tool calls, `final` for the turn's closing reply |
| `tool_call` | `callId`, `tool` | A normalized call, below |
| `tool_result` | `callId`, `status` (`ok` or `error`), `output`, `images` | Linked to its call by `callId`; images are `/api/evidence/…` URLs |
| `status` | `status`, `outcome` | `started`, `waiting` (on your answer), `working`, `ended` (with the run outcome). Written by the run supervisor (`agents/supervisor.ts`), so every provider gets them |
| `error` | `text` | The session failed |

`tool` is a union keyed by `kind`, with structured input instead of raw JSON:

| Kind | Input |
| --- | --- |
| `read` | `path`, `range` (`start`, `end` lines) |
| `write` | `path`, `content` |
| `edit` | `path`, `hunks` (`before`, `after`) |
| `command` | `action` (`run`, `output`, `stop`), `command`, `description` |
| `search` | `mode` (`content`, `files`, `list`), `query`, `path` |
| `fetch` | `url` or `query`, `prompt` |
| `browser` | `action` (navigate, click, type, screenshot …), `name`, `target`, `code`, `args` |
| `task` | `description`, `prompt`, `agent` (a subagent) |
| `todo` | `todos` (`text`, `status`) |
| `mcp` | `server`, `name`, `args` |
| `shinsa` | `name` (one of Shinsa's own tools), `args` |
| `other` | `name`, `args` |

**Interim and final.** The last agent message of a turn is `final` when no tool call follows it;
everything before is `interim`. A live adapter can't take a line back, so it holds each text block
until the next event: a tool call or another text makes it `interim`, the end of the turn makes it
`final`. A turn that ends on a tool call has no final reply, and the chat falls back to the last
interim text. `markFinalReplies` applies the same rule to a finished list (converters, migration).

**The Claude adapter** is `apps/server/src/agents/claude/`: `map.ts` (tools, results, prompts), used live
by `createClaudeRecorder` in `recorder.ts` and offline by `convertClaudeSession` in
`import.ts`. `Read`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Bash`, `BashOutput`,
`KillShell`, `Grep`, `Glob`, `LS`, `WebFetch`, `WebSearch`, `Task`, `TodoWrite` map to their kinds;
`mcp__<server>__<tool>` maps to `shinsa` for Shinsa's own server, `browser` for `browser_*` tools
and `mcp` otherwise. Subagent messages stay out of the run (the `task` result carries their
output), `<tool_use_error>` becomes an error result, and wrapper tags (`<system-reminder>` and the
like) are stripped; `<kanna-attachments>` become attachments.

**Older transcripts** (the Claude-shaped `{ kind: 'prompt' | 'assistant' | 'tool' … }` lines) are
migrated on read by `readChatEntries` in `agents/transcripts`, through the same Claude mapping.

**Another provider** plugs in by emitting `ChatEvent`s through the session's `onEntry` callback: a Codex adapter maps `item/started` and `item/completed` (`commandExecution` → `command`,
`fileChange` → `edit` or `write`, `mcpToolCall` → `mcp`, `webSearch` → `fetch`,
`agentMessage` → `agent`) and holds agent text until the next item, exactly like the Claude
recorder; a Cursor adapter maps its `tool_call` events the same way. Nothing in `packages/core`,
the run supervisor or the web changes.

**References.** Agents point at things Shinsa tracks with plain markdown, so the protocol stays
provider-agnostic: an `agent` entry's text carries links whose target is a `shinsa://` reference,
and any provider that writes markdown can use them. `packages/core/src/chat/references.ts` parses them
(`parseReference`, `serializeReference`):

| Reference | Target | Shown as |
| --- | --- | --- |
| Task | `shinsa://task/<id>` | the task link with its status tile and preview |
| Pull request | `shinsa://pr/<repo>#<n>` (also `pr/<repo>/<n>`, `pr/<n>`) | the pull request link, opening GitHub |
| File | `shinsa://file/<path>#L12-L20` | inline code that opens the file in the current task's changes |
| Repository | `shinsa://repo/<name>` | the repository chip |
| Branch | `shinsa://branch/<name>` | the branch chip |

`listReferenceSpans` also finds bare `shinsa://` URLs, quoted exact task titles, exact titles of 12
characters or more and a bare `#N` that exactly one pull request has; code spans, fences and
other links are left alone. `linkReferences` rewrites those into links before markdown renders.
Anything that does not parse or resolve renders as its plain label. Agents learn the syntax from
`REFERENCE_RULES` in every role's house rules (`prompts/rules.ts`), each prompt links its own task, and
the `find_tasks` tool (`serializeTaskReferences`) returns tasks as ready links with status,
repository, branch and pull request, so agents never guess an id.

**Live transcripts.** `Transcripts.record` appends and pushes to subscribers. While a socket
watches a run, `Transcripts.follow` also tails the file, so lines another writer appends stream
too.

## Where the rules live

`packages/core/src` has one folder per domain, each with an `index.ts` barrel; the package's
`index.ts` re-exports them, and other packages import only `@shinsa/core`. Files inside a
folder import each other directly; other folders are imported through their barrel or file.

| Folder | Holds |
| --- | --- |
| `model/` | Entity types (`types.ts`), stage sets and priority order (`stages.ts`), settings and their defaults (`settings.ts`), `DomainError` |
| `models/` | The agent model catalog, the default model per role and `resolveAgentModel` |
| `events/`, `commands/`, `effects/` | The event, command and effect unions; effect keys and lanes |
| `state/` | The projection (`project.ts`: `applyEvent`, `replayEvents`), the activity wording (`activity.ts`) and the read queries (`queries.ts`) |
| `decide/` | `decide` (`index.ts`: one exhaustive switch, then release, liveness and dispatch) over the `Decider` (`decider.ts`), split by area: `lifecycle` (starting each step, settling), `fixes` (fix loops and their budget), `pull-requests`, `dependencies`, `gates`, `messages`, `retry`, `runs` (recovery, dispatch), `agents` (hand-overs), `tasks`, `settings` (repositories, areas, focus), `liveness` |
| `queue/` | Needs you ranking (`rank.ts`), stepping through decisions (`step.ts`), the `shinsa status` summary |
| `briefing/` | The guide: its fallback, validating the writer's answer, reconciling a stored guide, its plain text |
| `report/` | The hand-over protocol: types, validation limits, Markdown, assembling the review report |
| `chat/` | The chat protocol, `shinsa://` references, inline code marking |
| `prompts/` | House rules, each role's prompt, fix prompts, session prompts |
| `progress/` | The steps a task shows on its page |
| `protocol/` | The WebSocket messages and diff parsing |

## Testing

- `packages/core/test/` mirrors `src/` file for file and runs every path through `decide` with a
  fixed clock and id source (`test/harness.ts`): `decide/lifecycle` (planning, phases),
  `decide/fixes` (checks and review loops, the fix budget), `decide/pull-requests` (the PR loop,
  pushes in flight, merging, waiting after building started), `decide/runs` (recovery),
  `decide/agents` (stale and wrong-role hand-overs), `decide/gates`, `decide/messages`,
  `decide/dependencies` (waiting and release, several parents, fan-out, chains, diamonds,
  cancelling a parent, adding and removing one at a time, priority and the guide's low priority
  rule), `decide/tasks`, `decide/settings` and `decide/index` (scheduling, no agent cap).
- `packages/core/test/decide/invariants.test.ts` drives `decide` with thousands of random
  commands (user, agent, system, stale and invalid ones) and checks after every step: a refused
  command changes nothing, `decide` never mutates its input and is deterministic, replaying the
  event log rebuilds the same state, at most one active run per task and none queued, every
  open task is live, no dependency cycles, settled tasks have no runs or gates, a question's run
  is active, no failure gate beside a running agent, plan, review and merge gates match the stage
  (and a merge gate never opens while the task waits on another), and every task sits in one
  place in the queue. `bun test` in `packages/core` enforces 100% line and function coverage
  (`bunfig.toml`).
- `apps/server/test/runtime/engine.test.ts` and `test/store/event-log.test.ts` run the real engine
  and outbox on SQLite: retries and backoff, failure gates, lane ordering, restart, effect keys.
- Every module in `apps/server/src` has a unit test in the mirrored path under `test/`, with fake
  `gh` and `open` binaries on `PATH` (`test/helpers/bin`), a fake Claude SDK `query`
  (`test/helpers/query.ts`) and a stub engine (`test/helpers/state.ts`). `bun run test` enforces
  100% line and function coverage (`bunfig.toml`).
- `apps/server/test/e2e/` runs the whole server (engine, outbox, effects, run supervisor, real
  checks, real git with a bare `origin`) against scripted agents (`FakeAgents`) and the fake `gh`
  (state in a JSON file). It covers request to merge, every fix loop,
  questions, steering, recovery, cancel, three planners at once with no cap, waiting on other
  tasks (the dependent starts after the merge from the updated default branch; a cancelled
  parent pauses it; a task waiting on two starts only after both), plan
  approval, evidence, protocol
  rejections and restarts mid-run, mid-checks and mid-question.
- `bun run --cwd apps/server test:live` runs one task through real Claude agents on a throwaway repo
  (GitHub stays faked). It costs real tokens, so it is not part of `bun test`.

- `packages/core/test/chat/references.test.ts` covers reference parsing, detection and linking;
  `test/prompts/roles.test.ts` the prompts' reference rule.
- `packages/core/test/chat/protocol.test.ts` covers `markFinalReplies`; `apps/server/test/agents/` covers
  the Claude mapping for every tool, live interim and final recording, session conversion, legacy
  migration and following an appended file.

Not covered by automated tests: GitHub's real JSON (the fake `gh` mirrors its shape) and the real
Claude Agent SDK process, which only the live run exercises.
