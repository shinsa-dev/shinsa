# Shinsa: spec

> 審査, *shinsa*: examination, judging.
> **A control plane for coding agents. The agents do the work; you make the calls.**

## 1. The problem

The limit on how much ships is no longer the agents, it is the person managing them. Today
that person runs 15 tabs across 5 projects, starts a second feature while the first one is
running, then gets buried when all three finish at once. Every finished chat becomes something
to remember, re-read, nudge ("fix the review comments"), commit, PR, chase, merge. Most of that
work does not need a human, but it is the human who does it, so the human is the bottleneck.

Agent harnesses (Claude Code, Codex) and the chat apps built on them (Kanna, T3 Code) are tools a
human *uses*: the human opens the chat, drives it, tracks it, closes it. Shinsa inverts that. It is a
control plane for coding agents: **Shinsa runs the work through those harnesses and asks the human for
small, specific pieces of judgment.** Nothing else reaches them.

## 2. Principles

1. **Gates, not chats.** The human appears at exactly three points: approving the plan (when
   asked for), reviewing the result, approving the merge. Plus answering a question when an agent
   is genuinely blocked. Everything between gates is Shinsa's job.
2. **The human never manages.** No projects you must create (Shinsa files repositories into
   projects by their folder or GitHub owner; shaping a project is optional), no tabs to keep open,
   no lists to groom. You state a request; Shinsa works out the repo, the worktree, the branch, the
   order.
3. **One thing at a time for the human, many for the agents.** The human sees one gate, then
   the next. Parallelism is Shinsa's problem, not the human's.
4. **Nothing reaches main without the human.** No commit to the default branch, no merge,
   ever, without an explicit approval. Everything short of that can be automated.
5. **The AI is never the decider.** It prepares, checks, ranks and explains. If AI wrote the
   code, AI does not also approve it. (Shinsa's original thesis, kept whole.)
6. **Evidence over assertion.** "It works" is not a review input. Screenshots, recordings, a
   running preview, passing checks, a reproduced bug that now passes, are.
7. **Measure prompt-to-merge.** The product metric is human turns per merged change. Every rule,
   skill, lint and automation exists to push it down.

## 3. Core model

### Request → Task

You write a **request** ("block duplicating code-first paywalls", "the embedded chat should
use MCP v2"). Shinsa turns it into a **task**: the conversation about one goal, with one worktree and one branch at
a time. A task is the only thing with a lifecycle. Chats, runs, agents, checks are
parts of a task, never things the human manages.

A task runs in **rounds**. A round is one piece of work inside it (its own plan, build, checks,
reviews and pull request), and a small task is a task with one round. A new idea in the chat
starts the next round on the same branch, worktree and agent sessions, which remember
everything; feedback on the current round stays feedback. Shinsa's classifier tells the two
apart, and an idea that belongs elsewhere becomes a suggested task you can still keep in the
chat. You choose per round whether it ships onto the open pull request (the default) or as its
own stacked one. The merge ends a round, not the task: the next round starts from fresh `main`
on a new branch, and the task is done when you mark it done, or when its agent does with
nothing left open (`docs/engine.md` → Rounds).

Triage infers the repository from the request within the task's project (Projects, below); you
never pick one, and a project is what you work on, never navigation.

### Lifecycle

```
draft ─► plan ──[GATE: approve plan]──► build ─► self-check ─┐
                                                              │ loops until clean
                    ┌─────────────────────────────────────────┘
                    ▼
            ready ──[GATE: review]──► (changes requested → build)
                    │
                    ▼
            approved ─► PR opened/updated ─► CI + review bots ─► fix loop
                    │
                    ▼
            mergeable ──[GATE: merge]──► merged ─► settled (worktree cleaned)
```

- **Plan approval decides the plan gate.** It is off by default (Settings → Agents → Engine, Approve
  plans): building starts as soon as the plan is written. With it on, a large task stops at the plan gate
  (triage sizes new features, changes across several areas, UI flows, the data model and anything
  ambiguous as large), and so does any plan the planner revised. A task you ask for plan first
  (`shinsa do --plan-first`, or a session brought in with `shinsa import`) always stops there, and so does a task
  that runs an operation or a plan that asks for your approval, whatever the setting says (`docs/engine.md` → A
  task's path).
- **Self-check** is everything an agent can verify alone: types, lint, tests, the repo's rules,
  a review pass against the rules skills, and for UI work the evidence capture (§5).
- **After review**, the PR loop is automated: review-bot comments and CI failures go back to
  a fixer (resuming the builder's session), and Shinsa pushes each fix until the PR is clean. You are not asked again
  until the merge gate, unless something needs your judgment.
- **Questions** can interrupt any stage. They are gates too: one question, one answer.

### Task shapes

Not every request ends in a pull request. A debug question, a support question or a comparison
needs a diagnosis, an answer or a report first, and maybe a change later. Each task follows its own
pipeline, composed from fixed building blocks (answer, research, investigate, your OK, plan,
operate, build, checks, agent review, your review, pull request, merge) under guards that never
change: anything that changes code goes through your review before a pull request, and merges
only after one; an operation's plan always waits for you; an answer, research or investigation
goes on to a change or an operation only with your OK, which you can refuse; every change runs
Shinsa's checks and an independent agent review. Everything else is the planner's to compose: a
task can run an operation before its change or after its merge (ship a column, then backfill
it). The six shapes below are presets:

| Shape | Pipeline | Ends with |
| --- | --- | --- |
| Answer only | answer | an answer, in the repository itself, nothing changes |
| Investigation | investigate | a diagnosis: the cause and how it was reproduced, from a scratch worktree |
| Research | research | a report: a comparison or a recommendation |
| Change | plan → build → checks → agent review → your review → pull request → merge | a merged change |
| Find and fix | investigate, then the change | the cause, then a merged fix |
| Operation | plan (always approved by you) → run | a one-off action in the repository, no pull request |

The classifier picks a preset from the request; you never pick one. The planner then keeps it
or composes the task's own steps from the building blocks, before it plans: investigate, your
OK, then an operation; research, your OK, then a change; a change, then an operation once it
merged; or something smaller when the request needs no change at all. Every step and gate is
an instance of one typed schema, and a rule set over it applies David's workflow to any work that
changes code or runs an operation: a verification plan up front, the evidence the plan asks for,
Shinsa's checks, an independent agent review, your review, the pull request, CI and your merge;
an operation needs a plan you approved and states its impact, and one that runs after a merge
asks you again on the merged commit before it runs. A question, research or an investigation
gets none of it. Core checks every composition and every plan against the schema and the rules
and hands a broken one back to the planner to fix (`docs/engine.md` → Steps and gates). The roadmap, the stage strip and the kind of task on the Overview show
the composed steps. An answer, investigation or report can propose a
change; it becomes one only with your OK (a gate: Make it a change, or keep it as it is). Every
shape change is an event in the task's activity. The kind is Shinsa's: nothing changes it after
triage but the planner and your OK (`docs/engine.md` → Task shapes).

### Gates

A gate is a durable record: what is being asked, the evidence attached, the options, who
answered, when. Gates survive restarts. The decisions, as you see them (the schema of every gate is
`docs/protocol.md` → Steps and gates):

| Gate | What you see | Your answers |
| --- | --- | --- |
| Plan | The proposed plan as a document, its version and what changed since the last one | Approve this version · Comment (agent revises) · Reject |
| Review | The change running, evidence, diff ranked by risk, checks, each agent finding | Approve · Request changes · Fix or dismiss each finding |
| Merge | Final diff summary, CI, bot verdicts, what changed since review | Merge (or write in the chat to send it back) |
| Question | One question, the context it needs, choices to pick in one click | Answer |
| Your OK | What an answer, investigation or report proposes to change, and why | Make it a change · Keep it as it is |
| Operation | After a merge: the merged commit, the operation's steps and its impact, and the notes for the operator in a box you can edit | Run the operation with the notes in the box (a message in the chat replaces them and runs nothing) · Finish without it |

A paused task (out of recovery, an agent's wait that ran out of time or check-ins, its usage or cost limit reached), an
incomplete setup (missing repository, default branch or checks, found before any agent starts) and a provider that
needs signing in again (a Claude account, or Codex's own login) are gates too: Retry, Verify again or Sign in, and
Cancel. Every gate is yours: an agent can never close one, and a message it sends for you waits for the task's next
agent.

### Keeping work moving

Shinsa keeps every task moving toward its next gate and decides what reaches you, in what order.
No agent does this: there is no always-on manager (a task's agent acts on Shinsa only while it
works on its task, and only as far as you asked). Triage and the briefing are quick model calls, and the ordering, the pull request loop and
recovery are rules in the event-sourced core (§6), so every decision is a record you can audit,
not chat text.

- **Triage** turns a request into a task (title, the repository within its project, size,
  branch) and decides the kind of task, plus what you left on Auto: when it starts (now, or after
  the open tasks it needs) and its priority, each with a one-line why in the tooltip of that fact
  on the task's Overview. The kind is always Shinsa's; when it starts and the priority are
  changeable in one click. The planner keeps the kind or composes the task's steps, then writes
  its plan (`docs/engine.md` → Agents, Task shapes).
- **Ordering.** A task that depends on nothing starts at once, on its own agent, however many
  others are running; one that depends on others waits, costing nothing, until they have merged.
  Priority and what a decision unblocks only decide how high it sits in Needs you (`docs/engine.md`
  → Scheduling).
- **The pull request loop.** CI failures, review-bot comments and conflicts go to a fixer until
  the pull request is clean; you are asked only when it cannot go on (`docs/engine.md` → The pull
  request watch, Merge queues).
- **The briefing** says which decision to take now and why, the two or three after it, what agents
  are doing, and gives a heads-up when something is stuck (`docs/engine.md` → The briefing).
- **Notes.** Agents keep notes on a task (`note`), so nothing depends on you remembering it.
- Nothing in it approves a gate, merges or commits to the default branch on its own.

### Focus

You can say "I'm on Superwall now". Gates from other projects are held silently (no badge, no
notification) until you switch or a date you set comes. Side work started in passing still
runs; its gates queue up behind your focus.

### Projects

A project is what you work on, not a folder: Superwall is one project with about ten repositories
in `~/Developer/Superwall`, Basket one with an iOS SDK, a server and an app in three. A project has
repositories you add and folders whose repositories all belong to it, a key (`SW`) and a
description (Settings → Projects, `shinsa projects`). A new task belongs to a project, the focus
project unless you pick another in the composer; triage picks the repository within it, and every
agent is told the project, its description and every repository with its path, so you never say
which repository you mean. Each task has a handle in its project, `SW-142`, that never changes:
the task's page, its link and the command line all take it (`docs/engine.md` → Projects and task
identity).

## 4. The human surface

Desktop-first and responsive: built for a full window, still right in a ~900px floating window. Web, served by `shinsa serve`, with an Electron app around it next.

- **Home.** The briefing (the decision to take now and why, then the next two or three), the
  new-task box, then the queue: what else needs you, what is in progress, what waits on another
  task. No tabs, no project tree; a sidebar only if you pick that layout.
- **Request box.** Always one keystroke away (Home's composer, or ⌘K). Type, send, keep working. It
  does not navigate. The project defaults to the focus project; When to start and Priority default
  to Auto, and picking one overrides what Shinsa would decide. The kind of task is not asked: the
  classifier and the planner decide it.
- **Gate views.** Each decision is the first card of the task's Overview: the plan (approve it, or
  say in the chat what to change), Review (§5), Merge, Question, a proposed change.
- **Task page.** Everything about one task, in three tabs: Overview (the decision, the plan,
  progress, evidence, the pull request), Code (the review and every changed file) and Chat (the
  agents' transcripts; you can write to the agent).
- **All tasks: the roadmap.** Every task in to-do order: ready to merge, changes to review, plan
  to approve, needs your answer, paused, in progress, waiting on another task (drawn as chains
  that handle several parents), then done and cancelled, collapsed. Priority then age
  inside each section. This is the page to open each day and work down. A task can be told to
  wait for others from here, from the task page and from ⌘K, and the new-task box can start a
  request "after ‹task›".
- **Setup.** A chat on first run (and from Settings → General → Setup later) with a fixed list of
  questions: the folders that hold your repositories (found on this machine, with their
  repository counts), the default model, the merge method, plan approval, your Claude accounts and
  the tools Shinsa needs. Pick a suggestion or answer in your own words; an answer that names an
  option is taken as is, a skip (or a plain yes where no option is a yes) keeps what is saved, and
  any other is read by a quick model call that knows what each option means, said back and confirmed (the accounts and tools steps act at once). It can never add, skip or
  reorder a question. Nothing about folders is hard-coded:
  Settings → Projects → Repository folders shows the chosen ones, editable, with Find folders.
- **Every agent can manage Shinsa.** There is no separate conversation: the task chat is where you
  talk, and a question with no repository work (an Answer task) is how you just talk. Every task
  agent can do anything you can do in Shinsa: start, message, retry, prioritise and cancel tasks,
  accept suggested tasks, set up and change schedules, change settings (all but the ones that spend money, merge or
  decide for you), projects, the focus,
  repositories and folders, and read every task, chat, diff and the usage. It marks its own task
  done when it knows the work is over. What it does to another task is in that task's activity as
  "‹handle› agent (on your behalf)". The decisions at your gates are yours alone: no agent has a
  tool or a command for them, and one asked to do it points you to the gate (the list is
  `docs/engine.md` → Who can change Shinsa).
- **The command line.** `shinsa <group> <action>` drives the running server the same way: every
  command the web sends, plus reads, accounts, folders and the health check, each with `--help` and
  `--json` (`docs/cli.md`). Agents in your own terminal can use it too.
- **Claude accounts.** Shinsa runs agents on several Claude logins of its own (Settings → Agent usage:
  sign in, import your Claude Code login or claude-swap's accounts, default, order, per-account
  switch threshold). Each run uses the account with room (a task can be pinned to one, and a step
  rerun on the account you choose); a turn the limit rejects moves to another account, and when
  none has room the task waits for the reset and carries on by itself. A signed-out account asks
  you to sign in instead of failing the task (`docs/engine.md` → Accounts and usage limits).
- **Codex too.** Everything above works for agents on Codex, on its one login for now: its usage
  windows (read the way CodexBar reads them), a cost for every run that counts toward the usage
  and cost limits per task, waiting for its limit to reset and carrying on, a sign-in gate,
  compaction under the same setting, and the agents a Codex agent starts shown in its turn like
  Claude's subagents. Agent usage shows every connected provider in Settings and at a glance in the
  top bar.
- **Fast mode only on credits you have.** Agents run at standard speed unless you pick Fast. Fast
  mode costs usage credits on a subscription, so Shinsa checks before each run whether the account
  has them, runs at standard speed (and says so in the chat) when it does not, and never turns
  extra usage on. Settings shows Fast as "Unavailable: needs usage credits" then.

## 5. Review, the core surface

Review is where Shinsa earns its name. It replaces "open GitHub, read the diff top to bottom".

- **Run it, don't read it** (planned, M5). Each task's worktree gets a preview: a dev server on its
  own port (web), a simulator build (iOS). The review page opens with the change running. Today the
  review opens the worktree in your editor or a terminal.
- **Evidence first.** Before the diff: what was asked, what was done, and proof. Agents attach it
  with `attach_evidence`, guided by the evidence skill: for UI work screenshots and a short screen
  recording of the flows it touched (both themes, desktop and phone width); for iOS, simulator
  recordings; for logic, the test it wrote, shown failing before and passing after. Shinsa does not
  capture any of it itself yet (M5).
- **Diff ranked by risk, not by file order.** Hot spots first (public API, data, auth, money),
  boilerplate collapsed. The ranking explains itself.
- **Comments go to the agent.** A comment on a line is a change request. (Planned: a second review
  shows only what changed since your last pass.)
- **Local first, remote too.** Review runs on the local worktree before any PR exists. Planned
  (M6): any GitHub PR link opened in Shinsa for review, agent or not, the standalone review product
  for people who do not run their agents through Shinsa.

## 6. Architecture

```
Browser ──WebSocket──► shinsa serve (Bun, on your machine)
                         ├─ orchestration: command → event → effect
                         │    (SQLite event log, effect outbox, command receipts)
                         ├─ triage and the briefing (quick model calls)
                         ├─ agent runs behind a provider interface: Claude and Codex
                         ├─ Claude accounts and usage limits, Codex's sign-in
                         ├─ schedules, webhooks and secret refs
                         ├─ git: worktree per task
                         ├─ forge: GitHub PRs, checks, review-bot comments
                         └─ MCP server for agents (hand-overs, questions, evidence, delegation)
```

Planned, not built: a desktop app around `shinsa serve`, other providers (Cursor), and
dev-server and simulator previews per worktree.

- **Event-sourced core** (from T3 Code): commands are decided purely, events, the effect outbox and
  the command's receipt committed in one SQLite transaction, side effects run from the outbox after
  commit and report back as commands. State is rebuilt in memory from the events. Gates, tasks and
  every decision are events. Restart-safe by construction (`docs/engine.md`).
- **Provider engine** after Kanna and T3 Code (`docs/harness-plan.md`): one provider interface and its
  normalization into one chat protocol, quick-model calls, account handling. Two providers exist,
  Claude (the Agent SDK) and Codex (`codex app-server`), each role choosing its own in Settings →
  Agents; Kanna is MIT, and we take the engine, not the UI or its chat-first model.
- **The agent programs stay current.** Settings → Agents → Versions shows the installed Claude Code and Codex,
  the latest of each and the minimum Shinsa needs (Claude Code's is the one its Agent SDK pairs with), and updates
  either with its own updater, its output streamed into a toast (⌘K: Update Claude Code). The Agent SDK's version
  is shown too; Shinsa takes a newer one in its own release (`docs/engine.md` → Versions and updates).
- **Worktrees are mandatory**, one per task, so parallel tasks never collide.
- **Agents talk to Shinsa over MCP**: they hand over (a plan, a phase, a fix, a review, an
  answer, a diagnosis, a report, an outcome), ask, attach evidence and everything else only through
  Shinsa's tools (`docs/protocol.md` → Agent tools).
- **Rules before review.** Every agent loads Shinsa's plugin (the review, evidence and handover
  skills), and its prompt carries the house rules and defers to the repository's own `CLAUDE.md`,
  so the rules are followed before review instead of found during it.
- **Agents talk to you, not about themselves.** You read a task's chat as it is written, so every task agent
  writes to you directly, like a colleague. A hand-over shows in the chat as it is, so the agent stops after it
  without announcing it, summarising it or saying its turn is over. A delegated agent's final reply is its result
  for the agent that delegated it, with no narration.
- **Your tools come along, visibly.** Agents load the MCP servers, plugins and skills you already set up in Claude
  Code, Codex and your repositories, for Claude and Codex alike, and Settings → Integrations lists every one with
  its health, its tools and roughly what it costs at the start of a run, so you turn off what you do not use, add
  servers, sign in to remote ones inside Shinsa and never need `/mcp`. A server defined in several places is one
  row, grouped by whether it is connected, waiting for a sign-in, failing or off, and turning one off changes only
  Shinsa's agents, never Claude Code's or Codex's settings. The context optimizer, on by default, leaves out the
  servers and skills agents have not used for 30 days (configurable), read from your Claude Code sessions and
  Shinsa's own transcripts; an agent that needs one later, or that you name one to ("use the Maple MCP"), loads it
  mid-run (`load_mcp_server`, `load_skill`). Each run's chat
  says what it loaded and what it left out (`docs/engine.md` → MCP servers, plugins and skills).
- **Local first.** Shinsa runs on your machine and keeps its own Claude accounts; no cloud. Remote
  access later through Tailscale.

## 7. Codebase

A fresh codebase in the Polis/Buzzkit shape, enforced as strictly:

- Bun workspaces + Turborepo. `apps/server` (Bun server and the `shinsa` command, also serves the web app),
  `apps/web` (React, the product UI), `packages/core` (domain, `decide`, queue, prompts and the
  wire protocol, all pure), `packages/ui` (design system). Provider adapters live in
  `apps/server/src/agents/providers/<id>/` (Claude and Codex), since each one spawns and talks to a
  local process.
- Biome at Polis's settings (`noFloatingPromises`, exhaustive switches, sorted classes, no
  `lucide-react`), `lint-conventions.ts` (the comment ban, the verb catalog, class rules), knip,
  sherif, cspell (`bun lint:spelling`, British and American English with the project's words in
  `cspell.json`), strict tsconfig with `noUncheckedIndexedAccess`, Husky hooks, CI mirroring hooks. Root and per-app
  `CLAUDE.md`, `.claude/skills/` for conventions, review, copy, design.
- Tests run on `bun test`, in separate `test/` trees beside `src/`, with a 100% line and
  function coverage floor in every package: unit tests, a random-command property test for the
  core, the whole server end to end against scripted agents and a fake `gh`, a crash test, an HTTP
  fuzzer, the web's components under happy-dom and Testing Library, and a live run on real Claude
  agents outside `bun test` (`docs/engine.md` → Testing). There are no browser tests; the
  screenshots and recordings agents attach as evidence come from their own tools.

## 8. Design

The look is `docs/design.md` (its "Where Shinsa differs" wins over the rest) and the `design` skill:
paywall-next's application register on Buzzkit's kit in `packages/ui`, one blue accent, a compact
control ramp, squircle corners, both themes tuned with the same care, and one radius, height and
spacing scale that the components and the lint enforce, so buttons can never disagree again.

## 9. Milestones

| | Deliverable | Done when |
| --- | --- | --- |
| M0 | Repo skeleton, tooling, design system, daemon serving the web app | `bun dev` shows the empty queue in both themes; CI green |
| M1 | Tasks, worktrees, one provider (Claude), request box, task page | A request becomes a task in its own worktree and the agent builds it |
| M2 | Gates: plan, review (diff + preview), merge, questions; the queue | A small task goes request → review → merge with only gate clicks |
| M3 | PR loop: open PR, watch CI and bots, auto-fix, merge gate | A PR with bot comments reaches the merge gate clean, untouched by you |
| M4 | Ordering: ranking, dependencies, briefing, focus | Three parallel tasks arrive one gate at a time, in a sensible order |
| M5 | Evidence: Shinsa captures screenshots and recordings itself, iOS simulator, previews | UI review opens with recordings and a running preview |
| M6 | Remaining providers, standalone PR review, polish | Codex and Cursor tasks run; any GitHub PR opens in Shinsa |

Kanna stays your daily driver until M3. The Focus layout built in Kanna on 2026-10-21 is the
stopgap until then.

## 10. Status

### First pass (2026-10-21)

Built and verified end to end against a scratch repository:

- **M0** done: the repo in the Polis/Buzzkit shape, Biome + Grit plugins, the conventions linter,
  knip, sherif, Husky, CI; the design system from Polis with the warm dark palette from the old Shinsa.
- **M1** done: requests become tasks, triage picks title, repository, size and branch (Haiku, with a
  heuristic floor), one worktree per task, Claude runs through the Agent SDK with the `shinsa` MCP
  tools and the agent plugin (review, evidence, handover skills), live transcripts, steering.
- **M2** done: plan, review, merge, question and failure gates; the ranked queue; the agent review
  loop with automatic fix rounds; review with evidence, a risk-ranked diff and line comments that go
  back to the builder; plan first from `shinsa do --plan-first` and `shinsa import`.
- **M3** built, unit-tested, not yet run against GitHub: PR opening, the 45 second PR watcher, CI and
  review-thread fix rounds, the merge gate, settlement and worktree cleanup.
- **M4** partly: focus by project with an expiry, the briefing, dependencies (triage, the new-task
  box or the task menus make a task wait on one or several others; it starts after all of them
  merge, chains, fan-outs and diamonds included). Still open: learning priorities from your corrections.
- **M5/M6** partly: Codex is the second provider (2026-10-23; any role, delegation across
  providers, a provider switch mid-task, its sign-in in Settings and onboarding). Not built: preview
  servers and simulator capture driven by Shinsa itself (agents already capture evidence through
  the evidence skill), Cursor and other providers, standalone review of any GitHub PR.

### Second pass (2026-10-21, evening)

- **The hand-over protocol.** Plans, work reports and review findings are fixed shapes with hard
  length limits (`packages/core/src/report/validate.ts`), enforced on every tool call. The work report is
  the review: sections in reading order, one per phase, each pointing at line ranges ranked critical, high or normal,
  plus checks run and judgement calls.
- **Code-first review.** A task page has three tabs: Overview, Code and Chat. Code's review view is a
  split: the walkthrough on the left (sections, or every spot ranked by attention, then agent findings,
  judgement calls, checks), the code on the right with the whole file as context, the spot spotlit,
  findings inline, line comments, Previous spot and Next spot to step. Its changes view is a file tree
  and the full diff.
- **Desktop shell.** Home and the queue button show the same queue: Needs you, In progress and Waiting on
  another task, all within the focus project (switching the focus is how you see other work). ⌘K's Next and Previous task that needs you step through the
  decisions; nothing moves you on by itself after you decide. Cards is the default layout: no rail, a
  "3 need you" button at the top left, next to the logo, opens the queue over the page. Sidebar,
  picked in Settings, keeps the queue in a permanent rail.
- **Command menu.** ⌘K, the app's only keyboard shortcut, opens a menu that acts on the page in
  front of you first (the task's decision, tabs, priority, worktree, cancel; Home's Now task; a
  Settings section; the All tasks filters), then jumps to any task, switches focus, layout and
  theme, and starts a task from whatever you typed.
- **No repositories to manage.** Shinsa finds git repositories on the machine, registers one the
  first time it works there and files it into a project: the task's, the one whose folder holds it,
  or one named after its GitHub owner.
- **`shinsa` CLI.** The server is `shinsa serve`; `shinsa do "<request>"`, `shinsa import` (bring a
  Claude Code session in as a task), `shinsa status` and `shinsa open` let people and agents hand work
  over from any project.
- **Design.** Blue is the one accent (primary buttons included), the Feedbase mark is the logo,
  controls are more compact and less rounded, the secondary button has real contrast.
- **Next:** an Electron desktop app around `shinsa serve` (the old Shinsa's `apps/desktop` shape),
  dev-server previews in review, the PR half against a real GitHub repository.

### Third pass (2026-10-22): the roadmap

- **Everything starts.** Tasks without a dependency are planned, built and checked at once, each on
  its own agent; the "Hold new work" and "Agents at once" settings are gone. Low priority work still runs and
  lands lower in Needs you and the guide.
- **Dependencies instead of stacks.** A task waits on one or several others (from triage, the
  new-task box's "After ‹task›", or the Waits on menu and ⌘K) and starts on its own once all of
  them are merged or done, from the updated default branch. Several tasks can wait on the same
  one. A cancelled parent pauses its waiting dependents with a
  clear note.
- **All tasks is the roadmap**, in to-do order with status-coloured sections; Home's queue, the
  sidebar and ⌘K use the same sections, tones and order. Paused is orange everywhere now, so it
  never reads as a review.

### Fourth pass (2026-10-23): process and structure

Ported from Paperclip's execution semantics (`docs/engine.md` → Process and structure):

- **Plans are versioned.** Approving binds to the version you read; a revision withdraws the gate,
  keeps the old version with a change summary, and the builder follows the approved version.
- **Reviews escalate instead of failing.** When fix rounds run out or stop changing the code, the
  review comes to you with the last findings; you keep or dismiss each one.
- **Waits are typed.** An agent waiting on something outside the repository calls `wait_for`, its
  run ends and the same session checks in again later; a task waiting on other tasks names the one
  holding the chain up.
- **Cost is counted** per run, task, step and phase, and so is the share of the account's weekly
  usage window each step used. Two optional per-task limits pause the task: a share of the weekly
  window (for subscriptions) and a dollar amount (for API keys and Codex). Both are off by default.
  Unknown prices stay unknown.
- **Quiet agents are flagged**, informationally, after 5 and 15 minutes without output.
- **Recovery budgets follow durable state** (failing checks, finding files, the tree), so prose
  never resets them.
- **Questions offer choices**, and a newer message of yours makes an older question historical.
- **Ask mode** answers a question about a repository without a worktree, plan or pull request.
- **Agents suggest tasks** you add to the roadmap, optionally after the current task.
- **The setup is verified before any agent starts**; missing pieces are their own gate.

### The harness plan, WS1–WS7 (2026-10-23)

What each workstream built. `docs/harness-plan.md` has the item-by-item status and where each piece
lives; `docs/engine.md` has the behaviour.

**WS1 Agent loop** (`docs/engine.md` → The agent loop, Providers):

- Every failure is classified and recovered by its class: another account, a wait for the usage
  reset, a fresh session, a resume, or a gate at once.
- A lost session is restored from Shinsa's own transcript within a budget; work a restart
  interrupted is resumed once, and a crash spends the recovery budget instead of looping.
- Messages reach a running agent by prompt id; runs use your own `claude`, at a minimum version.
- Quick calls (triage, the briefing, the setup chat) ask for structured output with a fallback across
  every provider, and take their judgements as typed choices among named options.
- One provider interface with capability flags; Claude was the only provider then (Codex followed on 2026-10-23).
- In the chat: a notice when a conversation is handed over to a fresh session, and a meter for how
  full the context window is.

**WS2 Accounts and limits** (`docs/engine.md` → Accounts and usage limits):

- Shinsa signs in and imports Claude accounts of its own (Settings → Agent usage), runs each turn on
  the account with room, moves a rejected turn to another account, waits for the reset when every
  account is spent and carries on by itself, and asks you to sign in again instead of failing.
- A task, or a single run, can be bound to an account, and a step can be rerun on an account you
  choose.
- Usage per account and per provider (Codex) in Settings → Agent usage and at a glance in the top
  bar, which names it Agent usage.

**WS3 Process and structure**: the fourth pass above, plus:

- A wait that runs out of check-ins opens a gate, like one that runs out of time.
- When you accept a suggested task you choose whether it waits for the current task.

**WS4 Engine hardening** (`docs/engine.md` → Command receipts, The effect outbox, The pull request
watch, Merge queues, Health):

- Every command has an id and a repeat is answered, not applied; the server's own commands get
  deterministic ids, so one repeated after a crash is answered too.
- Effects are cancellable and safe to run again after a crash.
- The pull request watch acts only on what is new; a pull request that cannot be read is counted
  across restarts and asks you after eight tries; a pull request in GitHub's merge queue is
  waiting, not failed.
- The web shows a banner when the server skipped a damaged event at boot.

**WS5 Onboarding** (`docs/engine.md` → The setup chat): a chat on first run, with a fixed list of
questions answered by a pick or in your own words, and the prerequisites checked.

**WS6 Delegation** (`docs/engine.md` → Delegation): a working agent hands self-contained work to
other agents and gets the results pushed back into its turn; it can file tasks of its own
(`create_task`) and split a plan into tasks.

**WS7 Triggers, idle sessions and notifications** (`docs/engine.md` → Schedules and webhooks, The
agent loop; `docs/design.md`, Where Shinsa differs, 27):

- **Schedules and webhooks start work for you.** An agent can set a schedule (once, every N minutes,
  daily at a time on chosen weekdays) or a webhook that starts a task or messages one. A machine
  that slept runs a missed schedule once, not once per slot; a run is skipped while the last one is
  still open. Settings → Automations and ⌘K pause, resume and delete them. Webhooks are signed
  (HMAC), deduped by a replay key and rate limited, and what they carry reaches the agent framed as
  untrusted data.
- **Secrets never touch the chat.** An agent asks for one (`request_secret`); you paste it into a
  password field, Shinsa keeps it on disk and the agent only ever sees a one-use reference.
- **Some decisions are only yours.** The decisions at your gates (`docs/engine.md` → Who can
  change Shinsa) happen there, by you: agents have no tool and no command for them, core refuses one sent on
  your behalf, and an agent asked in chat to merge points you to the gate. The settings that spend money, merge or
  decide for you, and a repository's checks, are yours too. An agent's shell
  can still do whatever your account can (`gh pr merge`, `git push`), so turn on GitHub branch
  protection for the default branch; it is what really guards a merge. Shinsa itself answers only
  on this machine and refuses requests from other websites.
- **Idle sessions let go.** A session left waiting on you is stopped and your answer resumes it.
  With Claude Code's compaction picked, a finished session near its context limit can also be
  compacted just before its prompt cache expires (Settings → General → Context, off by default).
- **Shinsa tells you when something needs you**: the tab title counts it ("[3] Shinsa"), a sound
  plays (by default only when Shinsa is in the background) and, if you allow it, a browser
  notification names the task and the question. Only what the focus project lets through counts, and
  a page load never chimes.

### Task shapes and automatic options (2026-10-23)

- **Tasks have shapes.** Answer only, Investigation, Research, Change, Find and fix and Operation,
  each a pipeline of fixed building blocks with guards in core; the stage strip on the Overview
  draws the task's own pipeline, and each All tasks row marks its kind, with its steps in the
  tooltip. Ask mode is the answer shape.
- **Shapes change mid-task.** An answer, investigation or report can propose a change and waits
  for your OK at a gate; the planner can make a task smaller. Each change is recorded and shown in
  the activity.
- **The kind, the start and the priority are automatic.** The composer's three controls default to
  Auto; triage decides them from the request and the open tasks and says why, and each part
  changes in one click from the task's Overview and from ⌘K.
- **The planner composes the steps.** The six kinds are presets: before it plans, the planner
  keeps one or composes the task from the building blocks (investigate, your OK, then an
  operation; research, your OK, then a change; build, ship and merge a change, then run an
  operation on it), and core's rules checker refuses a composition that skips your review, merges
  without a pull request or goes on from an inquiry without your OK.
  Your OK is a step of its own on the strip and a gate with the diagnosis, the report or the
  answer: approve to plan what comes next, or keep the task as it is.
- **Each fact once.** The Overview's line of decisions ("Auto: answer only · starts now · normal
  priority") is gone: the facts row shows the kind, the priority and when the task started, and
  why Shinsa chose each one is that fact's tooltip, with its menu to change it.

### Compaction through eunoe and fast mode (2026-10-23)

- **eunoe compacts, not Claude Code.** Claude sessions go through eunoe, a local proxy Shinsa runs
  for itself on its own port, in its own folder: at the context limit it folds the finished turns
  to your messages, the output that mattered and the replies, so nothing is summarised away and the
  full transcript stays searchable. Settings → General → Context, Compaction picks eunoe compaction
  (the default), eunoe always fold (folds as the session grows, too), Claude Code's compaction, or
  off. Each fold shows as a quiet line in the chat.
- **A missing proxy never stops work.** When eunoe cannot start or is missing, the run talks to
  Claude directly with Claude Code's compaction, the chat says why, and Shinsa tries eunoe again a
  minute later. Shinsa's eunoe is its own: its own port and folder under Shinsa's data, never the
  eunoe you run yourself or its settings.
- **Compaction only near the limit.** By default nothing is compacted before a session nears its
  context limit: eunoe compaction folds at the limit, and compacting idle sessions is off.
- **Fast mode when you want it.** Settings → Agents, each role's speed (Standard by default), runs
  that role's Claude or Codex agents, their subagents and delegations, and the quick calls at
  the faster speed. When a model or account
  cannot run fast, the chat says so and the run carries on at standard speed.

### Projects, task handles, and agents that manage Shinsa (2026-10-23)

- **Areas became projects**: repositories and folders, a key and a description; tasks are scoped
  to one and agents are told about it; triage picks the repository within it.
- **Handles**: `SW-142` per project, given once and kept; task URLs, the command line and agents
  use it, while the UUIDv7 id stays the key of everything stored. Before, a task had no number:
  its URL was `/tasks/<uuid>` (which still opens) and the command line matched the start of an id
  or an exact title.
- **Every task agent manages Shinsa**: it has the management tools, but none for a decision only
  you make (approvals, merges, an operation, a secret, a sign-in); the kind of task is no longer
  asked in the composer or changed on the Overview.

### The full command line (2026-10-23)

- **One surface, two ways in.** Every command Shinsa takes from you has a command-line path and a
  tool for every task agent, generated from one list of specs; a test fails when core gains a command
  without one. `shinsa command <type>` sends any command by its type as a fallback.
- **Task agents read and file across the roadmap.** Every working agent can read another task
  (`read_task`), create tasks, schedule work and suggest tasks; the reviewer now files tasks
  and schedules too.

### Rounds (2026-10-23)

- **A task is a conversation; a round is a piece of work in it.** Huge chats that grow one goal
  for weeks and one-task-per-thing both fit: a tiny task is one round, and new ideas become the
  next round on the same branch, worktree and sessions. Old tasks replay as one round.
- **Feedback or new work.** The classifier reads each message as feedback (it steers, revises or
  fixes as before), a new round (waiting until the current round is at its merge gate or done), or
  another task's work (a split-off you can keep here). One round works at a time. Your message shows
  as sent the moment you send it; the classifier reads it afterwards and Shinsa delivers it when it
  has.
- **How each round ships.** Onto the open pull request by default, or as its own stacked pull
  request; the merge of the top one merges the stack. After a merge the task stays open and the
  next round starts from fresh `main`.
- **Done means done.** You mark a task done, or its agent does when nothing is open; a merged
  task otherwise waits for its next round, and a schedule that messages it starts one. A task is
  never marked done while an earlier round's pull request is still open, and when that pull
  request merges on GitHub outside Shinsa, the round in flight opens its own pull request from
  the default branch.
- **Notes for an operation.** A message at the operation gate replaces the notes for the operator on the
  same gate: nothing runs and nothing notifies you again until you choose.
- **On screen.** The chat runs on as one conversation, a quiet divider with the round's title and status where
  each round starts; the Overview and the rows show the current round ("SW-14 · round 3"), and the Overview's
  Rounds panel keeps earlier rounds folded and readable with their pull requests.
- **A second lock on your decisions.** Core now refuses an answer to one of your gates sent on an
  agent's behalf, beside the tool list that never offered one; while one is open an agent cannot
  retry the task or mark it done, and its message cannot retry a Sign in gate.

### Steps and gates (2026-10-23)

- **One schema for every step and gate.** Each step declares who does it, what it reads, what it
  must hand over, when it is done, whether it is a hard gate (you), a soft gate (an automatic
  check) or no gate, and what it must follow or precede; each gate declares who decides, what they
  see, which decisions it takes and what each does. The planner composes from it and sets plan
  parameters (the verification plan, evidence, extra checks, the impact, asking for approval); it
  cannot invent a step or a gate.
- **Strict verification for work, none for questions.** Any change now always runs its checks and
  an independent agent review, needs a verification plan in its plan and the evidence the plan
  asks for before your review. An operation states its impact. A broken composition or plan goes
  back to the planner with every problem named.
- **An operation after a merge asks again.** When the change merges, the task stops at "The change
  merged. Run the operation now?" with the merged commit and the operation's plan: run it with the notes in its
  box, or finish without it.
- **Changing the kind is gone.** `shinsa tasks reshape` and the reshape command no longer exist;
  the kind is decided for you.

### Icons and the task's facts (2026-10-24)

- **Every icon is 30% quieter than its text.** Ghost and icon-only buttons, destructive menu rows,
  the error toast and the logo used to draw their icons at full strength; now every icon is 70% of
  its text (75% in a menu row), with no exceptions in the app.
- **The facts row shows the status with its own icon, and no kind.** Each status has one icon in
  its tone; the kind of task is no longer a fact, since the task itself shows it.

## 11. Open questions

1. **Plan gate threshold.** Today: `shinsa do --plan-first` and `shinsa import` always stop at the plan gate, and
   with Settings → Agents → Engine, Approve plans on (off by default), large tasks and revised plans stop too; triage
   sizes new features, UI flows and data model changes as large. Should some of them stop at the plan gate
   even with plan approval off?
2. **Learning from you.** Your past corrections (in Kanna transcripts) could seed the rules skills
   and the ranking of decisions. Worth a dedicated pass once the PR loop has run against GitHub.
3. **Local review.** The review gate opens the worktree in your editor or a terminal. Should it also
   start the repository's dev server automatically (M5), and with which command per repository?
