# Shinsa: spec

> 審査, *shinsa*: examination, judging.
> **A control plane for coding agents. Hand over the work; keep the decisions.**

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
never pick one, and a project is what you work on, never navigation. A request that names a
repository outside the project ("fix the button in kanna") works there and stays in its project.
A request that does not make the repository clear ("make the answer a doc in the repo") binds none
and asks you which one when its work needs code, instead of guessing the one used last
(`docs/engine.md` → A task without a repository).

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

- **Plan approval decides the plan gate.** Settings → Agents → Engine, Approve plans has three choices. When
  you ask, the default: building starts as soon as the plan is written. Large plans: a plan with more than 3
  phases or 6 files stops at the plan gate, judged from the plan itself rather than from the request, and so
  does any plan the agent revised. Always: every plan stops there. A task you ask for plan first
  (`shinsa do --plan-first`, or a session brought in with `shinsa import`) always stops there, and so does a task
  in the backlog, a task that runs an operation or a plan that asks for your approval, whatever the setting says
  (`docs/engine.md` → A task's path).
- **Self-check** is everything that can be verified before you look: the checks the agent chose for the
  task, which Shinsa runs after each phase (a test file or folder, one package's type check, the linter on
  the changed paths; never the whole suite, which CI runs on the pull request), a review pass against the
  rules skills, and for UI work the evidence capture (§5).
- **After review**, the PR loop is automated: review-bot comments and CI failures go back to
  the round's agent, in the session that planned and built the work, and Shinsa pushes each fix until the PR is
  clean. You are not asked again
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
the checks its agent chose and an independent agent review. Everything else is the agent's to compose while it plans: a
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

The classifier picks a preset from the request; you never pick one. The agent then keeps it
or composes the task's own steps from the building blocks, before it plans: investigate, your
OK, then an operation; research, your OK, then a change; a change, then an operation once it
merged; or something smaller when the request needs no change at all. Every step and gate is
an instance of one typed schema, and a rule set over it applies David's workflow to any work that
changes code or runs an operation: a verification plan up front (the checks that prove the change),
the evidence the plan asks for, those checks run by Shinsa, an independent agent review, your review, the pull request, CI and your merge;
an operation needs a plan you approved and states its impact, and one that runs after a merge
asks you again on the merged commit before it runs. A question, research or an investigation
gets none of it. Core checks every composition and every plan against the schema and the rules
and hands a broken one back to the agent to fix (`docs/engine.md` → Steps and gates). All tasks, the stage strip and the kind of task on the Overview show
the composed steps. An answer, investigation or report can propose a
change; it becomes one only with your OK (a gate: Make it a change, or keep it as it is). Every
shape change is an event in the task's activity. The kind is Shinsa's: nothing changes it after
triage but the agent while it plans and your OK (`docs/engine.md` → Task shapes).

### Gates

A gate is a durable record: what is being asked, the evidence attached, the options, who
answered, when. Gates survive restarts. The decisions, as you see them (the schema of every gate is
`docs/protocol.md` → Steps and gates):

| Gate | What you see | Your answers |
| --- | --- | --- |
| Plan | The proposed plan as a document, its version and what changed since the last one | Approve this version · Comment (agent revises) · Reject |
| Review | The change running, evidence, diff ranked by risk, checks, how many of the changed lines the tests run, each agent finding | Approve · Request changes · Fix or dismiss each finding |
| Merge | Final diff summary, CI, bot verdicts, what changed since review | Merge (or write in the chat to send it back) |
| Question | One question, the context it needs, choices to pick in one click | Answer |
| Your OK | What an answer, investigation or report proposes to change, and why | Make it a change · Keep it as it is |
| Operation | After a merge: the merged commit, the operation's steps and its impact, and the notes for the agent in a box you can edit | Run the operation with the notes in the box (a message in the chat replaces them and runs nothing) · Finish without it |

A paused task (out of recovery, an agent's wait that ran out of time or check-ins, its usage or cost limit reached), an
incomplete setup (a missing repository or default branch, found before any agent starts) and a provider that
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
  changeable in one click. The round's agent keeps the kind or composes the task's steps, then writes
  its plan and builds it in the same conversation (`docs/engine.md` → Agents, Task shapes).
- **Ordering.** A task that depends on nothing starts at once, on its own agent, however many
  others are running; one that depends on others waits, costing nothing, until they have merged.
  One stacked on another as a bundle starts once that one is ready to merge, and the bundle merges as one.
  Priority and what a decision unblocks only decide how high it sits in Needs you (`docs/engine.md`
  → Scheduling).
- **The pull request loop.** CI failures, review-bot comments and conflicts go back to the task’s agent until
  the pull request is clean; you are asked only when it cannot go on (`docs/engine.md` → The pull
  request watch, Merge queues). A conflict is resolved by the agent merging the base in, never by rebasing, in every workspace
  (`docs/engine.md` → The pull request watch → Conflicts).
- **The pull request reads like the review.** Its description is the review in small for a teammate who only has
  GitHub: the approach, the before and after evidence shown inline (screenshots and recordings uploaded as GitHub
  attachments, nothing committed), every check with its result, how it works, the judgement calls, the risks, how
  to test it and the steps around the merge, with a link that opens the task in Shinsa. Each push rewrites Shinsa's
  block and keeps what anyone wrote around it (`docs/engine.md` → The pull request description).
- **Every push is current and passes the hooks.** Before each push Shinsa merges the latest base into the branch
  (never a rebase, so no force push), so it carries the base's fixes and its current pre-push hook; a conflict goes
  to the agent, which resolves it before Shinsa checks and pushes again. The repository's pre-push hook always runs:
  a rejection goes to the agent with the hook's output and the failing tests, never to a blind retry, and the same
  failure twice stops at a gate (Send to the agent again, or Cancel). A network failure is retried, and the task shows
  each attempt and why, as in "Pushing again in 30s, attempt 2 of 5: …" (`docs/engine.md` → Pushing the branch).
- **The briefing** says which decision to take now and why, the two or three after it, what agents
  are doing, and gives a heads-up when something is stuck (`docs/engine.md` → The briefing).
- **Notes.** Agents keep notes on a task (`note`), so nothing depends on you remembering it.
- **Watchdogs after the merge.** You cannot verify everything before a merge. The Agent writes watchdogs for a change
  whose effects only real traffic shows: each reads a data source (an MCP server the project lists: traces, logs,
  analytics, support messages) for a window once the change is live (72 hours by default), checking soon after and less
  often as it holds up, as a read-only turn of the task's own conversation. A check reads its source the way a watch
  does: each thing wrong it finds is filed as a report, a new task forked from this one that quotes it, deduped
  against every report the project already filed. Where the merge is not the release, a watchdog starts only once the change is live in
  production. The agent sets each one's schedule from what the change needs; Settings → Agents → Watchdogs holds the
  defaults. When no server has the data, it asks you for one with what the code sends where and the servers worth
  connecting (`docs/engine.md` → Watchdogs).
- **Forks.** A follow-up on what a task did (a bug in a change it shipped) is its own task, kept apart on screen, whose
  agent starts from a copy of that task's conversation (Fork into a new task, `create_task`'s `fork_from`;
  `docs/engine.md` → Forking a task).
- **Work across repositories.** A task works in one repository and ships one pull request. A change that also needs
  another repository of the project is a second task its agent files there, forked from the first and ordered with
  `this_task_waits` or `after_this`, so each pull request merges in the order the change needs (`docs/engine.md` →
  Work across repositories).
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

Desktop-first and responsive: built for a full window, still right in a ~900px floating window. On your Mac, Shinsa is the Mac app (`apps/desktop`): it carries the engine, runs it in the background and shows the interface the engine serves; the same interface is the hosted dashboard later (`docs/plans/app-plan.md`).

- **Home.** The briefing (the decision to take now and why, then the next two or three), the
  new-task box, then the queue: what else needs you, what is in progress, what waits on another
  task. No tabs, no project tree; a sidebar only if you pick that layout.
- **Request box.** Always one keystroke away (Home's composer, or ⌘K). Type, send, keep working. It
  does not navigate. The project defaults to the focus project; When to start and Priority default
  to Auto, and picking one overrides what Shinsa would decide. The kind of task is not asked: the
  classifier and the agent decide it.
- **Attachments.** Home's composer, every task composer and a question's answer box take files and
  images: the paperclip, a paste or a drop. Each shows as a chip above the text while it uploads and
  can be removed; a message or an answer can be attachments alone. The chat shows them as thumbnails
  and file chips, an answer's under the question it answers, and the agent gets each file's path (`docs/engine.md` → The chat protocol → Attachments).
- **Gate views.** Each decision is the first card of the task's Overview: the plan (approve it, or
  say in the chat what to change), Review (§5), Merge, Question, a proposed change. Once you sent changes back,
  the review card leads with the Agent's reply to them, point by point.
- **Task page.** Everything about one task, in three tabs: Overview (the decision, the plan,
  progress, evidence, the pull request), Code (the review and every changed file) and Chat (the
  agents' transcripts; you can write to the agent).
- **Terminal.** A real terminal per project, so the few things agents leave to you (your own dev server, an
  interactive sign-in, a command an agent asks you to run) need no other app. Tabs per project, opened in one of the
  project's repositories, folders or task worktrees, in your login shell with your environment, in Shinsa's own
  colours and mono font, with the keys a Mac terminal has. The engine runs the shells, so a dev server keeps running
  when you close the window or quit the app, and a reload shows each terminal as it was. Agents never type into it; an
  agent that needs you to run a command puts it in its question, and Run in terminal runs it when you press it.
- **Services.** What you usually start in a terminal by hand (a project's `apps/api` and `apps/web` dev servers),
  started with one press from Services, beside Home and Tasks, and then only watched: the entry says "2 running" or "1 failed",
  and its popover lists each service's state, how long it has run, Start, Stop, Restart and its terminal. Shinsa
  offers the ones it finds (each workspace's `dev` script, a `Procfile`, Docker Compose) and you add any, all inside
  the popover with no dialog; its Manage edits one or removes several at once, and one press starts all of a
  project's that are not running. Each runs in a terminal tab of its own, owned by the engine like every terminal, and starts again by itself
  when the engine restarts. Also `shinsa services list|start|stop|restart` and ⌘K. A service is defined once per
  project and also runs for any open task, in that task's worktree beside your own run: from the Services item
  among the task's facts, `--task`, or by the task's agent, which can start, stop and read only its own task's runs. The popover
  lists the tasks running each service under it, and a task's run closes when its worktree goes. A service may name a
  preview URL with `{port}` in it: each task's run gets a free port of its own, and an Open button wherever it runs
  takes you to that run, so before the review the task's agent leaves the services that show its change running and
  attaches each link as a preview: a preview deployment on this machine, up until the task is finished.
- **All tasks.** Every task in to-do order: ready to merge, changes to review, plan
  to approve, needs your answer, paused, in progress, waiting on another task (drawn as chains
  that handle several parents), then snoozed, the backlog, done and cancelled, collapsed. Priority then age
  inside each section. This is the page to open each day and work down. A task can be told to
  wait for others from here, from the task page and from ⌘K, and the new-task box's When to start offers
  Auto start, Start now, After another task… (a search over every open task, several at once) and Backlog.
- **The backlog.** Work you want written down and planned now, but built later, waits in the backlog. It is
  triaged (a clean title, the repository, the kind of task, a priority) and planned, which costs a small share of a
  task, and then stops: its plan stays out of Needs you, the queue, the guide and the Dock badge, and shows in the
  Backlog group of All tasks. Start building approves the plan, moves its worktree onto the latest default branch
  and builds; Remove from the backlog (the task's menu or ⌘K) makes it a plan to approve. You put work there yourself (When to start → Backlog,
  Move to the backlog, `shinsa do --backlog`, accepting a suggested task into it), or an agent you asked does;
  Shinsa never decides it for you. Questions, research and investigations never wait there.
- **Snoozing.** Snooze (the task's menu, a row's menu, ⌘K or `shinsa tasks snooze`) takes an open task in any step
  out of Needs you, In progress, the queue, the guide, the Dock badge and notifications, and changes nothing else:
  its agent keeps working, and a gate it reaches waits quietly. Home and the queue show it in a folded Snoozed
  section, All tasks in a folded Snoozed group. Unsnooze puts it back where it is now. Nothing wakes a task on
  its own.
- **Feedback.** A Feedback button beside Settings in the header (Desk), the rail (Shelf) and Shelf’s bar in a narrow window, and Send feedback on
  Shinsa in ⌘K, open the feedback popover: the note field, with Draft issue inside it, and one row per entry, its title and who it is from;
  clicking one opens it in a dialog to read in full, edit, dismiss or open. You write a note in your own words; your agent rewrites it as a public
  GitHub issue on `shinsa-dev/shinsa` without your projects, repositories, files, branches, names, code or links, and
  you read it before it opens under your GitHub account. Every issue follows one detailed template (summary, where in
  Shinsa, what happened, what should happen, steps, why it matters, a suggested change, acceptance criteria) and ends
  with an Environment section Shinsa adds itself (version, system, runtime, agent model, and for an agent's report the
  kind of task and its stage), so an automation reading the issues can act on them. A check in core refuses an issue that still holds an email, a folder path, a token
  or key, a link elsewhere or one of your project, repository, branch, task or account names, and shows what it found.
  Agents report what in Shinsa got in their way with `report_feedback`; a report waits in the same popover, marked as
  from an agent and linked to its task. Only you open an issue (Open issue, with your GitHub login); an opened
  issue's row shows who sent it and, once it is closed on GitHub, Closed. The button's count is what waits for you (`docs/engine.md` → Feedback).
- **Setup.** Your first task, on first run (and from Settings → General → Setup later), with a fixed list of
  steps you pass like gates: the folders that hold your repositories (found on this machine, with their
  repository counts), the projects for them, the default model, the merge method and plan approval, signing in
  with Claude, and the tools Shinsa needs, each installed with one click. It can never add, skip or reorder a
  step, and finishing leaves a done "Welcome to Shinsa" task. Nothing about folders is hard-coded:
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
- **The command line.** Nobody has to use it: the app runs the engine and does everything. For a
  terminal, `shinsa .` opens the app on the project you are in, `shinsa do "…"` hands work over,
  `shinsa status` says whether the engine runs and what needs you, `shinsa start`, `stop`,
  `restart`, `logs` and `version` look after the engine, and `shinsa <group> <action>` drives
  everything else the same way: every command the web sends, plus reads, accounts, folders and the
  health check, each with `--help` and `--json`. Shaped like Tailscale's and Docker's
  (`docs/cli.md`). Agents in your own terminal can use it too.
- **Claude accounts.** Shinsa runs agents on several Claude logins of its own (Settings → Agent usage:
  sign in to each, claude-swap's accounts included, default, order, per-account
  switch threshold). Each run uses the account with room (a task can be pinned to one, and a step
  rerun on the account you choose); a turn the limit rejects moves to another account, and when
  none has room the task waits for the reset and carries on by itself. A signed-out account asks
  you to sign in instead of failing the task. Every account is a login of its own, signed in in
  Shinsa: it never runs on your Claude Code login or copies claude-swap's, so their refreshes never
  sign it out (`docs/engine.md` → Accounts and usage limits).
- **Codex too.** Everything above works for agents on Codex, on its one login for now: its usage
  windows (read the way CodexBar reads them), a cost for every run that counts toward the usage
  and cost limits per task, waiting for its limit to reset and carrying on, a sign-in gate,
  compaction under the same setting, and the agents a Codex agent starts shown in its turn like
  Claude's subagents. Agent usage shows every connected provider in Settings and at a glance in the
  top bar.
- **Statistics.** Settings → Statistics, between General and Agents, shows what shipped and where the tokens went over the last
  7, 30 or 90 days or all time (back to the first task), picked beside the page title (the range stays in the URL). With a project in focus it counts only that project's tasks and their runs, and each section says so beside its title; it counts everything again once the focus ends. Shipping: pull requests merged, tasks finished, lines merged and the
  shipping streak, a year of merged pull requests as a contribution graph, and an area chart of them by day (by week
  past a month); every chart shows a readout of the day, point or bar under the pointer. Usage: tokens, known cost, cache hit rate and tokens per merged pull request, a stacked chart of
  input, output, cache-read and cache-write tokens per day, tokens by role, kind of work and model, the tasks that
  used the most. Counts and costs stay compact as they grow (15.4k, 3.3B, 1.2T tokens; $12.34, then $15.4K): token
  counts everywhere drop a trailing `.0` and move up a unit rather than read 1000k, and costs keep cents under $1,000. Lines added show in green and lines removed in red, as in a diff. All of it is folded from the event log in core (`resolveStats`); lines
  changed come from GitHub's pull request read (`changes`), so pull requests merged before it show none. Quick calls
  (triage, briefings, titles) are not metered, and tokens are counted per run, not per turn or tool call.
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
  recordings; for logic, the test it wrote, shown failing before and passing after. It opens the
  Review tab, before and after side by side (Evidence in the review, below). Shinsa does not run a
  browser of its own yet (M5).
- **Diff ranked by risk, not by file order.** Hot spots first (public API, data, auth, money),
  boilerplate collapsed. The ranking explains itself.
- **Comments go to the agent.** A comment on a line is a change request. (Planned: a second review
  shows only what changed since your last pass.)
- **Local first, remote too.** Review runs on the local worktree before any PR exists. Planned
  (M6): any GitHub PR link opened in Shinsa for review, agent or not, the standalone review product
  for people who do not run their agents through Shinsa.

## 6. Architecture

```
Browser ──WebSocket──► shinsa engine (Bun, on your machine)
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

The Mac app (`apps/desktop`) is how you run Shinsa: the engine is compiled into the app and runs as a launchd job the
app registers, so it keeps working when the window is closed or the app quit, and the app adds the Dock badge,
notifications, `shinsa://` links, the `shinsa` command and its own updates (`docs/plans/app-plan.md`,
`docs/engine.md` → The engine in the background). While it is connected it is the one surface that notifies.
On an always-on Linux server the same engine runs headless as a systemd user service that `shinsa start` sets up,
set up over SSH and reached through remote access (`docs/engine.md` → Run on a server); on a Mac mini without the
app, `shinsa start` runs it as its own launchd job. Every release publishes that engine on its own for Linux x64,
arm64 and Apple Silicon: `curl -fsSL https://shinsa.dev/install | sh` or `npm i -g shinsa` (`docs/release.md` → The
engine on its own).
Planned, not built: signing with a Developer ID, other providers (Cursor), and dev-server and
simulator previews per worktree.
Remote access: Settings → General → Remote access pairs this machine with app.shinsa.dev through GitHub sign-in and adds
the devices (browsers and phones) that may reach it; app.shinsa.dev is one dashboard over every machine a device was added to, each
task showing its machine, and with several machines New task places each task automatically (its project's machine, a
where your policies, plain-English sentences the classifier reads with the request, send it, else the one with the most room under its task capacity) or on the machine you pick (`docs/engine.md` → Remote access; what is still to come is
`docs/plans/remote-plan.md`). Share task (a task's menu) makes a link,
`app.shinsa.dev/share/t/<token>#<key>`, that anyone can open without signing in: live, read-only remote
access to that one task through the machine's tunnel, sealed with the key in the link, which no server sees. It is the
owner's own task page with every button and input taken away, showing everything its owner sees on its Overview,
Review, Code (a private repository's too, from the working copy before a pull request) and Chat, with the agents'
live output and tool calls but never your messages to them, and it changes the moment the task does. Share as picks
what it shows: Status (an anonymous status card of the title, a short description an agent writes when sharing
starts, a customer timeline (planning, in progress, in review, deploying, live) and a plain update for customers, such as in progress, deploying or live, which says live only
once the change is out), Standard (that page) or Full access (Standard and your own chat messages); it defaults to
Settings → General → Sharing, and Manage on the banner changes it and how long while the link stays; the machine reads
nothing back, and app.shinsa.dev stores nothing. A share lasts until the task is done by default, or for an hour, a day,
a week or until you stop it (Settings → General → Sharing, and in Share task before you share); the task's page shows a banner that
cannot be dismissed while it lasts, its title carries a share mark in the task list, on Home and in Needs you, and Stop sharing, which asks first, ends every open link at once
(`docs/engine.md` → Sharing a task).
Teams: Settings → Teams makes a team, a teammate joins with its link, and you pick which of your projects it sees; every
member then sees every task in them, live and read-only, next to their own, on app.shinsa.dev and in the local app,
marked with whose it is. The focus menu reads Your work, your projects, then Teams; focusing a team shows your tasks
in it and your teammates'. A teammate's task opens on the same read-only page a Standard share link shows: the agents'
live output but never your messages to them, and no controls, read live from its owner's machine, and app.shinsa.dev keeps only who is in which team
(`docs/engine.md` → Teams).
Share preview, on a task's running service with a preview URL, does the same for the dev server itself: a link,
`<label>.shinsa.page/?key=…`, that opens the running service in any browser through the machine's tunnel, hot reload
included, each preview its own origin on a domain apart from shinsa.dev. It has the same time limits, ends with the
task, says when the service is stopped or the machine offline, and is only yours to share; unlike a task's link it is
not sealed end to end, since a browser loads it as plain pages (`docs/engine.md` → Sharing a preview).
Slack: mention the Shinsa bot in a channel or a thread and the machine of whoever mentioned it reads the thread
and starts a task from it exactly as a request typed on Home, its project, kind and priority picked for it (anything
that is not work gets "Not a task" once and no task: Shinsa never chats), or messages the task the thread already has; the task's status, its questions, its plan, its review and its result come back in the thread; a question's choice
can be answered with its button there, and every other decision is made in Shinsa. One bot for everyone through app.shinsa.dev, each person connecting their Slack user to their
own machine in Settings → General → Slack (`docs/engine.md` → Slack).

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
- **Local first.** Shinsa runs on your machine and keeps its own Claude accounts; no cloud. Remote access
  opens your machines as one dashboard at one URL, app.shinsa.dev, behind GitHub sign-in, through a Cloudflare tunnel the
  machine dials out, end to end encrypted to devices enrolled at the machine; the cloud holds no state but the
  tasks you share by link, as a read-only projection without their chat (`docs/plans/remote-plan.md`).

## 7. Codebase

A fresh codebase in the Polis/Buzzkit shape, enforced as strictly:

- Bun workspaces + Turborepo. `apps/engine` (the Bun engine and the `shinsa` command, also serves the web app),
  `apps/web` (React, the product UI), `packages/core` (domain, `decide`, queue, prompts and the
  wire protocol, all pure), `packages/ui` (design system). Provider adapters live in
  `apps/engine/src/agents/providers/<id>/` (Claude and Codex), since each one spawns and talks to a
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
  back to the agent; plan first from `shinsa do --plan-first` and `shinsa import`.
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
  and the full diff. Since 2026-10-24 Code is a workbench (Review, Changes, Files and Search, tabs, ⌘P quick open,
  find, go to line, a ref picker) on CodeMirror, reading every file from git at a pinned commit, so a merged task
  keeps its code; since 2026-10-25 you edit it directly (Direct editing in the Code tab, below; `docs/design.md`, 32;
  `docs/engine.md` → The Code tab's reads), and the review is a tab of its own that reads like a report (Review is a
  report, below).
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
  first time it works there and files it into a project: the one whose folder holds it, the task's
  while that project has no repository yet, or one named after its GitHub owner.
- **`shinsa` CLI.** The server is `shinsa engine`; `shinsa do "<request>"`, `shinsa import` (bring a
  Claude Code session in as a task), `shinsa status` and `shinsa open` let people and agents hand work
  over from any project.
- **Design.** Blue is the one accent (primary buttons included), the Feedbase mark is the logo,
  controls are more compact and less rounded, the secondary button has real contrast.
- **Next:** an Electron desktop app around `shinsa engine` (the old Shinsa's `apps/desktop` shape),
  dev-server previews in review, the PR half against a real GitHub repository.

### Third pass (2026-10-22): everything starts

- **Everything starts.** Tasks without a dependency are planned, built and checked at once, each on
  its own agent; the "Hold new work" and "Agents at once" settings are gone. Low priority work still runs and
  lands lower in Needs you and the guide.
- **Dependencies instead of stacks.** A task waits on one or several others (from triage, the
  new-task box's "After ‹task›", or the Waits on menu and ⌘K) and starts on its own once all of
  them are merged or done, from the updated default branch. Several tasks can wait on the same
  one. A cancelled parent pauses its waiting dependents with a
  clear note.
- **All tasks lists every task** in to-do order with status-coloured sections; Home's queue, the
  sidebar and ⌘K use the same sections, tones and order. Paused is orange everywhere now, so it
  never reads as a review.

### Fourth pass (2026-10-23): process and structure

Ported from Paperclip's execution semantics (`docs/engine.md` → Process and structure):

- **Plans are versioned.** Approving binds to the version you read; a revision withdraws the gate,
  keeps the old version with a change summary, and the agent builds the approved version.
- **Reviews escalate instead of failing.** When fix rounds run out or stop changing the code, the
  review comes to you with the last findings; you keep or dismiss each one.
- **Waits are typed.** An agent waiting on something outside the repository calls `wait_for`, its
  run ends and the same session checks in again later; a task waiting on other tasks names the one
  holding the chain up.
- **Cost is counted** per run, task, step and phase, and so is the share of the account's weekly
  usage window each step used: its cost at a rate Shinsa learns per account from how far the window moved while
  runs worked, the way tokens become dollars at the model's prices. Each run is charged its own cost, so runs in
  parallel never count the same usage twice. Every run is charged at the account's current rate, so a task's share
  can move a little as the rate improves. A task shows its share of the weekly window on a subscription whose rate
  is learned (from 5 tasks and 10 points of movement), with how many tasks it was learned from, and dollars until
  then and on an API key. Two optional per-task limits pause the task: a share of the weekly window (for
  subscriptions; an early estimate while the account is learning) and a dollar amount (for API keys and Codex, and
  the limit that always holds while an account is learning). Both are off by default.
  Unknown prices stay unknown. A task's cost shows in one place, the popover of the cost icon among its facts;
  nothing else on screen repeats it, and a paused task names the limit it reached, not what it spent.
- **Quiet agents are flagged**, informationally, after 5 and 15 minutes without output.
- **Recovery budgets follow durable state** (failing checks, finding files, the tree), so prose
  never resets them.
- **Questions offer choices**, and a newer message of yours makes an older question historical.
- **Ask mode** answers a question about a repository without a worktree, plan or pull request.
- **Agents suggest tasks** you add as tasks of their own, optionally after the current task.
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
- Quick calls (triage, the briefing) ask for structured output with a fallback across
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

**WS5 Onboarding** (`docs/engine.md` → The setup steps): setup reads as your first task, "Set up Shinsa", whose
five steps (Folders, Projects, Defaults, Claude, Tools) are gates you pass one at a time, each with the
recommended answer already picked (folders also by path), any earlier one open to change. Your projects are
suggested from the repositories in your folders and made with one press, a folder macOS keeps private asks for
access instead of failing, Claude Code is installed if it is missing and you sign in to your Claude account (no
login is found or imported for you), and each missing tool installs in a terminal on the step when you click
Install (Bun only when a repository uses it). When an install still fails, an agent reads the failing checks and
replies with commands you run with one click. Finishing records a done "Welcome to Shinsa" task that sums up what
you set up, and you land on it. Nothing else opens until setup is complete.

**WS6 Delegation** (`docs/engine.md` → Delegation): a working agent hands self-contained work to
other agents and gets the results pushed back into its turn; it can file tasks of its own
(`create_task`) and split a plan into tasks.

**WS7 Triggers, idle sessions and notifications** (`docs/engine.md` → Schedules and webhooks, The
agent loop; `docs/design.md`, Where Shinsa differs, 27):

- **Schedules and webhooks start work for you.** An agent can set a schedule (once, every N minutes,
  daily at a time on chosen weekdays) or a webhook that starts a task or messages one. A machine
  that slept runs a missed schedule once, not once per slot; a run is skipped while the last one is
  still open. A watch reads one of a project's integrations (a Slack channel, a support inbox,
  traces) on a clock or a webhook, out of sight, and files a task for each new report in it, with the report kept on the
  task, forked from the task that shipped the feature it is about, and never filed twice.
  A project that starts using an integration is offered one watch suited to it ("File a task for
  each new bug in #feedback", hourly), added or dismissed in one click; a watch an agent sets, such
  as one asked for from Home ("watch #feedback for bugs, hourly"), is that same suggestion, the one
  thing to approve.
  Settings → Automations and ⌘K pause, resume and delete them. Webhooks are signed
  (HMAC), deduped by a replay key and rate limited, and what they carry reaches the agent framed as
  untrusted data.
- **Secrets never touch the chat.** An agent asks for one (`request_secret`); you paste it into a
  password field, Shinsa keeps it on disk and the agent only ever sees a one-use reference.
- **Some decisions are only yours.** The decisions at your gates (`docs/engine.md` → Who can
  change Shinsa) happen there, by you: agents have no tool and no command for them, core refuses one sent on
  your behalf, and an agent asked in chat to merge points you to the gate. The settings that spend money, merge or
  decide for you, and a repository's own check commands, are yours too. An agent's shell
  can still do whatever your account can (`gh pr merge`, `git push`), so turn on GitHub branch
  protection for the default branch; it is what really guards a merge. Shinsa itself answers only
  on this machine and refuses requests from other websites.
- **Idle sessions let go.** A session left waiting on you is stopped and your answer resumes it.
  With provider compaction picked, a finished session near its context limit can also be
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
  for your OK at a gate; the agent can make a task smaller while it plans. Each change is recorded and shown in
  the activity.
- **The kind, the start and the priority are automatic.** The composer's three controls default to
  Auto; triage decides them from the request and the open tasks and says why, and each part
  changes in one click from the task's Overview and from ⌘K.
- **The agent composes the steps.** The six kinds are presets: before it plans, the round's agent
  keeps one or composes the task from the building blocks (investigate, your OK, then an
  operation; research, your OK, then a change; build, ship and merge a change, then run an
  operation on it), and core's rules checker refuses a composition that skips your review, merges
  without a pull request or goes on from an inquiry without your OK.
  Your OK is a step of its own on the strip and a gate with the diagnosis, the report or the
  answer: approve to plan what comes next, or keep the task as it is.
- **Each fact once.** The Overview's line of decisions ("Auto: answer only · starts now · normal
  priority") is gone: the facts row shows the kind, the priority and when the task started, and
  why Shinsa chose each one is that fact's tooltip, with its menu to change it.

### Leaner agent sessions (2026-10-31)

- **Each step starts from the plan, not the history.** The Agent keeps one session per task, but
  when a build phase, a fix or an operation starts, everything before it is folded and the turn
  opens with the round brief: the request, the accepted plan and the earlier hand-overs in full.
  The builder never carries the planning conversation, and a fix never re-reads the whole build.
- **eunoe runs inside Shinsa.** eunoe's core is a library now, and Shinsa serves it from its own
  engine on a local port: nothing to install, no second process. A conversation eunoe cannot fit
  any more ends its turn and starts fresh with a handoff, instead of rewriting its cache on every
  call.
- **Watchdog checks have a session of their own.** A check reads logs after the merge in a watch
  session that starts with the brief and is resumed by the next check; the Agent's own session never
  carries a check's output, and a check never carries the Agent's build.
- **Context management is a setting.** Settings → General → Context, Management: Default
  (folds at each step and compacts near the limit), Compaction only (eunoe near the limit, no folds
  between steps), Provider compaction (Claude Code's or Codex's own) or Off.
- **Bots don't wake the Agent for notices.** A bot's comment on the pull request conversation (a
  preview deployment, a "reviewing…" placeholder) no longer starts a fix, and nor does a bot editing
  its comment. A bot's review and its inline comments still do.

### Compaction through eunoe and fast mode (2026-10-23)

- **eunoe compacts, not Claude Code.** Claude sessions go through eunoe, served by Shinsa itself
  (since 2026-10-31, inside the engine), in its own folder: at the context limit it folds the finished turns
  to your messages, the output that mattered and the replies, so nothing is summarised away and the
  full transcript stays searchable. Settings → General → Context picks how (Management,
  since 2026-10-31). Each fold shows as a quiet line in the chat.
- **A missing eunoe never stops work.** When eunoe cannot start, the run talks to Claude directly
  with Claude Code's compaction and the chat says why. Shinsa's eunoe is its own: its own port and
  folder under Shinsa's data, never the eunoe you run yourself or its settings.
- **Compaction near the limit, folds at each step.** Within a step nothing is compacted before the
  session nears its context limit, and compacting idle sessions is off; each new build, fix or
  operation folds the steps before it (Leaner agent sessions, above).
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
- **Task agents read and file across every task.** Every working agent can read another task
  (`read_task`), create tasks, schedule work and suggest tasks; the reviewer now files tasks
  and schedules too.

### Rounds (2026-10-23)

- **A task is a conversation; a round is a piece of work in it.** Huge chats that grow one goal
  for weeks and one-task-per-thing both fit: a tiny task is one round, and new ideas become the
  next round on the same branch, worktree and sessions. Old tasks replay as one round.
- **Feedback or new work.** The classifier reads each message as feedback (it steers, revises or
  fixes as before), a new round (waiting until the current round is at its merge gate or done), or
  another task's work (a split-off you can keep here). One round works at a time. New work never
  waits behind your own review or merge: while a round waits for you, what you ask for (a change, starting
  the dev server so you can try it, a question) goes to that round, and the gate comes back after it;
  a round already queued says what releases it ("Sends after you merge round 1.") and Send now gives
  it to the current round instead. Your message shows
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
- **Notes for an operation.** A message at the operation gate replaces the notes for the operation on the
  same gate: nothing runs and nothing notifies you again until you choose.
- **On screen.** The chat runs on as one conversation, a quiet divider with the round's title and status where
  each round starts; the Overview and the rows show the current round ("SW-14 · Round 3"), and the Overview's
  Rounds panel keeps earlier rounds folded and readable with their pull requests.
- **A second lock on your decisions.** Core now refuses an answer to one of your gates sent on an
  agent's behalf, beside the tool list that never offered one; while one is open an agent cannot
  retry the task or mark it done, and its message cannot retry a Sign in gate.

### Steps and gates (2026-10-23)

- **One schema for every step and gate.** Each step declares who does it, what it reads, what it
  must hand over, when it is done, whether it is a hard gate (you), a soft gate (an automatic
  check) or no gate, and what it must follow or precede; each gate declares who decides, what they
  see, which decisions it takes and what each does. The agent composes from it while it plans and sets plan
  parameters (the verification plan, evidence, extra checks, the impact, asking for approval); it
  cannot invent a step or a gate.
- **Strict verification for work, none for questions.** Any change now always runs its checks and
  an independent agent review, needs a verification plan in its plan and the evidence the plan
  asks for before your review. An operation states its impact. A broken composition or plan goes
  back to the agent with every problem named.
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

### Where agents work (2026-10-24)

- **A repository chooses where its agents work**: Worktrees (the default: a worktree and a fresh branch per task)
  or Main checkout (agents work in your checkout on a branch Shinsa makes, one task at a time; the next waits).
  Settings → Projects on each repository, or ⌘K. The setup check stops a task whose repository is not ready for its
  mode: the main checkout needs no uncommitted changes before a task takes it (`docs/engine.md` → Where agents
  work).

### One agent per task (2026-10-24)

- **One agent holds the task.** A task has one agent, the Agent, and one conversation for its whole life. Planning is
  its round zero; then it builds every phase in order, takes every fix (failed checks, the agent review's blocking
  findings, your messages and line comments, CI and review comments on the pull request) and runs the operation, and
  every later round (new work, feedback, an answer or an investigation, the change you OK after it) is the same
  conversation's next turn. Each phase is still committed when the agent hands it over, but the next phase is a short
  instruction to the same conversation, so what it learned while planning, in earlier phases and in earlier rounds
  stays with it. There is no fixer and no separate operator any more.
- **A separate agent only where context must stay apart.** The reviewer reads only and never shares the Agent's
  conversation, so it never judges the work from inside the head that wrote it; checks stay commands; the agent
  delegates only work whose context should stay apart (a review or a test of its own work) or that is truly
  independent and runs in parallel, never one agent per phase (`docs/engine.md` → Agents, which has the why).
- **It survives restarts and lost sessions.** A restart resumes the task's conversation; one that cannot go on (its
  context is full, the provider lost it, you changed its provider or model) starts fresh with a brief of the task so
  far: the plan, every finished phase with its summary and the step it is on.
- **Settings follow.** One conversation needs one provider and one model, so Settings → Agents → Models has an Agent
  row (plans, builds and fixes) instead of separate Planner, Builder and Fixer rows.

### One agent session per task, cached (2026-10-25)

- **Per task, not per round.** Every round and every kind of work on a task continues the task's one session: an
  answer round after a change, the change after an answer, a retried step, a scheduled round, a round from a kept
  split-off, a round after a merge on a new branch, a run moved to another account, a restart. A fresh one only when
  the old one cannot go on (`docs/engine.md` → Agents).
- **The reviewer keeps a session of its own per task**, resumed by every review, so it remembers what it asked to be
  fixed; each review is told to judge the new commits on their own.
- **Cache first.** What a long session costs is mostly its prompt cache, so nothing that changes between turns goes
  into an agent's system prompt or tool list; every kind of work on the task sees the same tools, and read-only steps
  are enforced without removing tools (`docs/engine.md` → Caching, measured by `test/e2e/prompt-cache.test.ts`).
- **Other work in the repository.** Agents can list the other open tasks in their repository, with their branches,
  stacks, changed files and whether an agent works on them now, and the Agent is told once when another task changes
  the same files (`docs/engine.md` → Other work in the repository).
- **Conflicts resolve themselves.** A pull request that conflicts with its base (main moved, or a stacked base merged
  or moved) goes to the task's Agent as a fix in its own session, whatever the workspace: it merges the base in and
  resolves the conflicts, and the task shows "resolving conflicts with ‹base›". The agent asks you only what it cannot
  resolve itself (`docs/engine.md` → The pull request watch → Conflicts).
- **Disabled commands say why.** A ⌘K command or option that cannot run now is shown greyed with the reason as its
  hint (`docs/design.md`, 14).

### Direct editing in the Code tab (2026-10-25)

- **You edit the code where you read it.** At Head of the branch or the Working copy of an open task the editor is
  simply editable: typing edits, ⌘Z undoes, and each pause saves the file to the task's working copy (the worktree,
  or your checkout in main-checkout mode). There is no Suggest a change and no suggestions; line
  comments are words only. Shinsa still makes every commit: your edits go into the round's next commit; approving
  the review with edits no commit took yet commits them and runs the checks again before the push, and approving the
  merge with them pushes them and merges once CI passes. The agent is told which files you edited, at once if it is
  working and in its next turn either way. A merged or finished task, an earlier commit and the base are read-only, with a
  one-line reason. A file that changed on disk under you keeps your unsaved edit when it touched other lines, and
  otherwise shows the disk version with a notice (`docs/engine.md` → Your edits).
- **Side by side first.** A diff opens side by side with its new side editable; unified is the toggle and is
  remembered, and on a phone or a window below `md` every diff is unified. Each side scrolls sideways under its own pinned line numbers, folded "N unchanged lines" are no place
  for the cursor, and a comment box for a long selection fits the visible pane. Open in editor left the toolbar:
  Shinsa is the editor (the task's ⌘K and menu still open the checkout elsewhere).

### Review is a report (2026-10-25)

- **Review is its own tab.** A task page has Overview, Review, Code and Chat. Review shows once there is something to
  review (a work report, agent findings, or the review gate reached); Code keeps the raw material: the changes and the
  files. The walkthrough split inside Code, with its order switch and its spot stepper, is gone.
- **It reads top to bottom, like the Overview.** What the change does in a sentence, with the decision (Approve
  changes, Fix N findings, Merge #N) where it is on the Overview; then what needs your attention, most critical first:
  blocking findings, critical spots, spots to read carefully, should fix and optional findings, judgement calls; then the walkthrough by
  section with its snippets; then the agent review's summary and the checks; then everything else, collapsed.
- **Every review comment is one rich card**: author (Agent review, Agent, You), severity in its tone, a short title,
  the reason as markdown with smart links, the exact lines as a snippet whose header opens Code there, and the
  suggested fix. The Code tab shows the same card inline under the line.
- **Step with J and K** (or ⌘K's Next place to check and Previous place to check); the place is in the URL, so a link
  opens the Review tab on it.
- **The reviewer says more.** `report_review` takes a summary of what the reviewer checked and thinks, and each finding
  a title and a suggested fix besides its reason (`docs/protocol.md` → Hand-overs).

### Delegations at once is a setting (2026-10-25)

- **No limit by default.** How many delegations run at once under one step used to be capped at eight; it is now
  Settings → Agents → Engine, Delegations at once (No limit, 2, 4, 8, 16 or a custom number; ⌘K and
  `shinsa settings set delegationLimit` too), changed only by you. The nesting depth stays three. The agents' rules
  no longer mention a running limit, so changing it never invalidates a cached session; a refused delegation says
  the limit and where it is set (`docs/engine.md` → Delegation → Limits).

### Review is the technical read (2026-10-26)

- **Overview decides, Review explains.** The Overview stays the quick decision layer: findings with Fix / Dismiss,
  suggestions, the checks, What changed as each phase's title and summary, and one line pointing at the review.
  Review became the in-depth technical read, ordered by context: what the change does, then how it is built (the
  approach, how it works behind the scenes, how to test it and the steps around the merge), the key code explained
  simply, the judgement calls with the alternatives and why, what to read carefully (the critical spots and the
  risks), then the agent review, each a section
  card like the Overview's. The index of every point is one line pinned above the column that says where you are and
  opens the whole grouped list in place. Every point appears once; the attention list, the phase walkthrough and the
  checks list left Review (`docs/design.md` 34).
- **The agent that built it writes the walkthrough; the reviewer checks it.** The reasons live in the builder's head,
  so `complete_phase` carries them: spots gain a `title` and an `explain` for the key code, judgement calls gain
  a short `title` and `alternatives`, and the last phase hands over a `walkthrough` (approach, flow, risks with a
  title and lines, and how to test it: what the tests
  cover, then a guide you follow by hand, each step with where to go and what you should see). The
  reviewer keeps its own session and never sees the builder's reasoning, only its numbered calls, and says where it
  would have decided otherwise (`report_review`'s `disagreements`); the reader sees both on the judgement call's card
  (`docs/engine.md` → The review report, `docs/protocol.md` → Hand-overs).
- **Steps around the merge are yours, as a checklist.** What a change needs that no agent can do from the worktree (a
  variable or secret to set, a migration or deploy to run, a flag to flip) comes back as concrete steps in the
  walkthrough (`steps`: before or after the merge, with the exact command), after the agent did everything it can in
  the repository. They are steps of the task, Pre-merge and Post-merge: the merge waits until you tick
  each step before it, and a merged task waits at Post-merge ("Post-merge · 2 steps left", in Needs you)
  until you tick the ones after it, across later rounds too; a step's command opens in a terminal only when you ask. The reviewer checks the
  list is complete (`docs/engine.md` → Steps around the merge).
- **Instant.** Prefetching a task loads the diff view and the grammars of every point's language, so the snippets
  paint with the tab instead of a second later.

### A terminal per project (2026-10-26)

- **A terminal inside Shinsa.** Each project has terminal tabs (add, close, rename, drag to reorder) on its own page,
  reached from Services in Desk's top bar and Shelf's rail, and from ⌘K; a task opens one in its worktree. The engine owns every shell (Bun's own PTY,
  so the compiled engine needs nothing native) and keeps a headless copy of each screen, so a terminal survives the
  window and the app, reattaches exactly (the alternate screen of an editor included) and, when the engine itself
  restarts, shows its last output with Start again. The page renders with xterm.js and WebGL: true colour, Unicode 11
  widths, links, selection, copy and paste, find in the scrollback, 5,000 lines. It takes Shinsa's own colour tokens,
  light and dark, and the Code tab's mono font (`docs/engine.md` → Terminals, `docs/design.md`, 37); reading your
  Ghostty config was removed on 2026-10-26, so the terminal looks like the rest of Shinsa.
- **Services and Mac keys (2026-10-26).** Services, closing without a question unless a program runs, ⌘T and ⌘W,
  and the line-editing keys of Terminal.app and Ghostty (`docs/design.md`, 37).
- **Services per task (2026-10-27).** A project's services run for a task in its worktree, started by you or by the
  task's agent (`list_services`, `run_service`), shown under each service and among the task's facts
  (`docs/engine.md` → Services → Runs for a task).
- **Agents add services (2026-10-29).** The task's agent adds a service the project lacks (`add_service`), such as
  the dev server that shows its change, so it can run it and attach the preview (`docs/engine.md` → Services →
  Agents add the services they need).
- **Local previews (2026-10-29).** A service's preview URL and port variable, a free port per task run, Open in
  the Services popovers, a task's Services fact and the Terminal toolbar, and the agent's `preview` evidence before
  the review (`docs/engine.md` → Services → A live preview).
- **Why xterm.js and not ghostty-web.** ghostty-web runs Ghostty's own parser in WebAssembly and handles complex
  scripts better, but it is at 0.4, has no WebGL renderer, no search, serialize or headless counterpart, and its
  xterm.js compatibility is partial. xterm.js 6 is what VS Code ships: the WebGL renderer, the add-ons this needs, and
  the same parser headless in the engine, so the screen the engine keeps and the one you see agree cell for cell.
  The renderer sits behind `lib/terminal/view.ts`, so it can be swapped once ghostty-web matures.
- **Agents point, you press.** Agents mark a command for you to run as ```` ```bash run ````, and the `ask` tool
  tells them to put one in their question; the question card offers Run in terminal in its corner, as every block
  marked `run` on a task's pages does. A plain ```` ```bash ```` block is an example you can only copy. No agent tool, command or route lets an agent type into your terminals.

### Evidence in the review (2026-10-26)

- **Why you never saw any.** Nothing failed: nothing asked for it. The builder's prompt had one generic line about
  screenshots, the reviewer's none, the skill described captures without saying what makes them useful (before and
  after, widths, themes), files went into one flat folder, and the only display was a panel on the Overview that the
  seed never filled (one test log).
- **The agents capture it.** The Agent captures before shots ahead of its first edit when the plan asks for
  screenshots, after shots at the same title, width and theme, a recording for interactions and the test that fails
  without the change; the reviewer gets the list of what was attached and adds its own where a claim has none or it
  doubts one, shown as from the agent review. `attach_evidence` gains `detail`, `width`, `theme` and `stage`; the
  `evidence` skill is the recipe (Playwright's command line or a script in a scratch folder, 1280px and 390px, light
  and dark, at a device scale factor of 2 so shots stay sharp on a Retina screen). Prompts stay cache-stable: the list and the planned kinds ride in the user turn.
- **Kept per task and round, served properly.** `<data>/evidence/<task id>/round-<n>/`, files named after their
  title, cached as immutable, recordings served in byte ranges so they seek (`docs/engine.md` → Evidence).
- **Seen in the Review tab, first.** An Evidence section right under the summary: before and after pairs side by side,
  shots and recordings in a grid, test output as code, links, and where it is stored; images open in the image viewer
  and step through the section; a missing proof says so. The Overview keeps one line pointing there
  (`docs/design.md` 34). The seed carries real screenshots, a recording and test runs on six review tasks.

### Checks the agent chooses (2026-10-27)

- **Why.** Shinsa ran the repository's whole check suite (its configured commands, else every `lint`,
  `check-types`, `typecheck` and `test` script it found) after the last phase and after every fix of every task.
  With several tasks at once on a loaded machine, a whole suite is slow, can time out in tests the change never
  touched, and sends the agent into fix rounds for failures that are not its own. A repository with no commands got
  a setup gate that could only be waived.
- **The agent chooses, Shinsa runs.** The plan's verification is now a list of checks, each a label, a scoped
  command and the phases it covers (`bun test apps/engine/test/agents/transcripts`,
  `bun run --cwd apps/web check-types`, `bunx biome check <changed paths>`). A command that runs the whole suite is
  refused at the plan: CI runs that on the pull request. While it builds and fixes, the agent adds, changes and
  removes checks with a reason each (a new file in a later phase gets its own check), and the task's activity says
  so. The repository's own commands stay as an optional baseline that runs once before review, and only you change
  them. Checks are like evidence: chosen for the task, a bonus, not a burden.
- **When they run.** After each phase, that phase's checks and the ones just added or changed; before review also
  the repository's commands; after any fix (failed checks, the agent review's findings, the changes you asked for),
  the checks that failed, the ones the fix names and the checks of every phase whose files the fix changed, never
  the whole set; after you approve with your edits, all of them. In parallel, at low priority, headless, with no
  limit across tasks.
- **Only the change's failures block.** A failing test file runs again alone once, and a check that then passes is
  marked "passed when re-run alone". One that still fails runs on the base commit (cached per commit and command),
  and Shinsa compares the failures themselves, not just the exit code: each failing test by its file and name, each
  type or lint error by its file, code and message, never its line number, so errors that only moved still match.
  When every failure is already on the base, the check is marked "already failing on the base branch" and does not
  block. New ones on top block, named first: "2 new type errors, 14 already on the base branch". Output Shinsa
  cannot read into failures always blocks. Changed-line coverage comes only from the tests among the task's checks,
  once before review.
- **Two stages, one list.** Before the pull request, the task's checks; after it, CI's check runs from the pull
  request, in the same Checks list. The pull request's fix loop is unchanged.
- **Evidence links a check.** An agent proving its change with a test links the check by its id instead of pasting
  its output, and Shinsa keeps the output of each check run beside its result (`docs/engine.md` → Checks,
  Evidence).
- **Setup asks less.** "No checks to run" and Start without checks are gone: a repository with no commands of its
  own runs only its tasks' checks, so nothing is missing.

### Memory, and less guidance (2026-10-27)

- **Why.** Research on context files and skills (ETH Zurich's "Evaluating AGENTS.md", SkillsBench, both February
  2026) found that context an agent can find itself, or writes for itself, makes it no better and costs every turn,
  while short rules written by people help. Shinsa had the opposite: long house rules repeating its tools, and no place
  for what you teach agents at a gate, so the next task forgot it.
- **Memory.** Rules you keep for every later agent, for every project or one: at most 240 characters each, 20 per
  scope. Agents propose with `remember` when you correct them; only you keep, edit or remove one, in Settings → Agents
  → Memory or with `shinsa memory`. A fresh session (the task's agent or the reviewer) hears every rule in its brief,
  a resumed one only the new ones; never the system prompt, so the prompt cache holds (`docs/engine.md` → Memory).
- **Less guidance.** The house rules lost what a tool's own description already says (a third shorter, about 5,700
  characters per role), the writing rules are one block (`WRITING_RULES`), and the `handover` skill keeps only what the
  schemas cannot say (13.7k to 3.9k characters). No skill editor and no style setting: your skills come from
  `~/.claude/skills` and each repository, and taste is a memory rule.

### Watchdogs, forks and the pattern check (2026-10-28)

- **Forks.** A task can start from a copy of another task's agent session: Claude's `forkSession`, Codex `thread/fork`,
  behind the `sessions.fork` capability, with the transcript handoff when there is nothing to copy. The source task
  is never touched, and the reviewer never forks.
- **Watchdogs.** The last phase's walkthrough lists them; they arm when the pull request merges, check on their own
  clock as a read-only `watch` turn of the task's session, defer while the task works, pass at the end of their window
  and file a forked task for an issue. Data sources live on the project and are added by the agent when it names a
  server the project does not list yet, or asked of you with suggestions when none holds the data.
- **The pattern check.** The reviewer reads new code against the code around it: a helper re-implemented, or a new way
  of doing what the repository does one way, is a finding, blocking when the repository's rules name the pattern.
  This is the validation harness for now; a rule engine for patterns waits until a project needs one.

### The backlog (2026-10-30)

- **Planned now, built later.** "Everything starts" stays the rule, but usage is finite, so work you choose can wait
  in the backlog after its plan: triage and planning are a small share of a task (about 4% of a measured log's
  usage), building, checks, fixes and review the rest. It is manual only: triage never puts work there, and nothing
  starts from it on its own; scheduling from a usage estimate waits for its own design.
- **When to start has four choices**: Auto start, Start now, After another task… (now every open task, searchable,
  several at once, whatever project the box shows) and Backlog.
- **No roadmap.** The word named nothing Shinsa has; the page is All tasks, its sections are task groups, and the
  backlog is the closest thing to a roadmap there is.

### Slack (2026-10-31)

- **Tag the bot, from anywhere in Slack.** A mention outside a thread starts one; in a thread the bot reads all of it,
  so a bare mention under a bug report is enough. It always answers in the thread and never chats: the new task's
  status message, "Sent to" the task the thread already has, or, for greetings, thanks and small talk, the one line
  "Not a task, so nothing was started." and silence after. Work runs
  the same loop as Home's input with everything on Auto: triage picks the project, the repository, the kind (a
  question is answered and ends there) and the priority.
- **One shared bot, locked to its owner.** The app lives on app.shinsa.dev and relays each mention to the machine of
  the Slack user who wrote it, over remote access's tunnel; someone who has not connected Slack to their own Shinsa
  gets a private link to do so, and nothing runs. A teammate who connects gets tasks on their machine. No machine holds
  a Slack token, and the relay stores no message text.
- **The thread follows the task, in Block Kit**: one status message edited in place as it moves, one post for each
  question, secret, plan and review, each a header, the gist bold or quoted, its details as fields or a list, a
  button to decide in Shinsa and a small line naming the task and its `PR #<number>`, and the result's start with a
  button to the rest. No icons in the posts: the state is the one reaction on your
  message (⏳ sizing up, 🛠️ working, ✋ needs you, ✅ done), there from the moment the bot reads it. No streamed text
  and no "Thinking…" placeholder. A question's choices are buttons: the person who started the task answers with one, the post then says who
  answered what, and anyone else is told privately they cannot; plans, reviews, merges and the rest are decided only
  in Shinsa.
- **Built on remote access** instead of Socket Mode: a Socket Mode app is one per workspace with its token on every
  machine, and Slack spreads a socket app's events across its connections, so one shared bot needs the relay.
  Mentions while a machine is offline are not kept.

### Duplicates (2026-10-31)

- **A duplicate is a cancel with a reason.** A task that repeats another closes as its duplicate: cancelled like any
  cancel, linked to the task it repeats, and shown as Duplicate, in its own Duplicates group on All tasks, with a
  "Duplicate of" fact that opens the original and says who closed it and why. The original shows it too, as a
  "Kept over" fact linking every task closed in its favour.
- **Triage catches them before any work.** It is asked whether a new request is the same work as an open task of its
  project, with a strict bar: the same outcome only. Not a duplicate starts any duplicate again: one triage closed
  as if it had not flagged it, one that had already worked in a fresh round with the same request. You close one yourself with Close as a duplicate in the
  task's menu or ⌘K, and agents with `tasks_duplicate`.
- **Across a team next.** Triage checking teammates' open tasks for duplicates is its own task, on the teams'
  read API.

### Replies on the Overview, not in the chat (2026-10-31)

- **The goal is never to need the chat.** At review you iterate: you ask for a change, ask a question, add a second
  thought. Whether the Agent addressed it was only in the chat, so every round meant scrolling a transcript. Now
  each thing you send after the work is in is a request, and the fix that answers it must hand over a reply
  (`complete_fix`'s `reply`, `docs/engine.md` → Your requests and their replies).
- **Confirmations, not a thread.** Five designs were tried in `/ui`; the one chosen reads as a report: a headline,
  each point you raised marked Done, Answered or Not changed with a note, then What to do now. What you sent folds
  above it as a quote of your own words; no bubbles, no inline chat: the plan and the reply are one shared record, and
  earlier requests (plan feedback included) fold below as the same report. Every fact on the card is a live link
  (the pull request with its hover card), never plain text that names one.
- **Less noise at review.** The checks fold to one line ("All 13 checks passed") and open only when one fails;
  pre-merge steps wait for the merge gate, and their text renders like any Markdown (inline code, links, task hover
  cards).

### Teams (2026-11-01)

- **A team is a share link for whole projects.** You join a team and pick which of your projects it sees; every
  task in them is shown to every member, live, without a link, a banner or a warning per task. It reuses the share
  link's projection, channel and page, so a teammate sees exactly what a share link shows: the title, status,
  request, plan, phase reports, review, findings, checks, branches, the pull request with its diff and code,
  evidence, gates without your answers, runs without their prompts, and activity without messages. Never a chat, a
  transcript, live agent output, a message to an agent, a gate answer, a verdict note, an attachment, the worktree
  or a path on your disk, and they can change nothing.
- **Joining works like a machine invite.** The owner's join link names the team and sends a request; the owner
  accepts or declines it in Settings → Teams, and a member leaves or is removed there, which ends their access at
  once. Asking to join asks which of your projects to share first, from every machine the browser reaches, so none
  is forgotten. Which projects a team sees is yours alone: no agent can add one.
- **A teammate is one click from your machine.** Give machine access beside a teammate makes them a member of this
  machine, with full control, without an invite or a request; their browser adds itself with the team's key the next
  time they open Shinsa Cloud. You take it back under Remote access, like any member.
- **Nothing about the work leaves your machine for the cloud.** app.shinsa.dev keeps who is in which team, never a
  task. Each view is read from the owner's machine over its tunnel and sealed with a team key that lives only on
  members' machines and browsers, carried in the join link's fragment, which no server receives. A teammate's
  machine that is offline shows nothing until it is back.
- **Focus on a team.** The focus menu says Your work instead of All work, then your projects, then Teams. A focused
  team's Home and All tasks add your teammates' tasks, each marked with its owner; they never count towards Needs
  you, since they never wait for you. A machine a teammate also gave you remote access to shows as your own, with
  full control, never twice.
- **For agents.** The engine serves the team's tasks at `GET /api/teams/tasks`, which triage's team-wide duplicate
  check will read. Agents can list teams (`teams_list`) and change nothing about them.

### Bundles (2026-11-01)

- **A stack of pull requests, as tasks.** A task can stack on another (Stack on another task… in the composer's When
  to start, the Waits on menu, `•••`, ⌘K, `shinsa tasks stack-on`, `create_task`'s `stack_on_this`): it waits until
  that task is ready to merge, not merged, then branches off its branch, and its pull request targets that branch, so
  GitHub shows the stack. A bundle is one line in one repository (`docs/engine.md` → Bundles).
- **Why not just wait.** The only difference from a dependency is that the bundle merges together. That buys three
  things: the next task starts sooner; a flaw a later task finds in the root is fixed in the root's still-open pull
  request instead of a follow-up on top of a merged one (the stacked task's agent messages the task below); and each
  pull request's diff is small and builds on the one before, for you and for review bots.
- **Ready, then one merge, on the root.** A stacked task never gets its own merge gate: it shows Ready, merges with
  its bundle, and keeps fixing CI, comments and conflicts. The root, the task whose pull request targets main, owns
  the merge: one merge gate for the whole bundle once every task above is ready, listing each pull request; approving
  merges them from the last back to the root and every task ends merged.
- **Our own stack, not GitHub's.** Shinsa runs the bundle itself rather than through GitHub's stack API, which gives
  it the control: it decides when each task is ready, holds the one gate, checks every task's pre-merge steps and,
  since GitHub checks a pull request only against its own base, merges the whole bundle into main in git before the
  gate opens and again before the merge. A branch that would conflict with main is brought up to date bottom up, a
  conflict going to that task's agent, so a bundle never merges halfway because of a conflict. The task
  toolbar's Bundle item ("Bundle 2/3") lists each task in order with its state and pull request, a queue row carries
  the same count, and All tasks nests each task under the one below, as it now nests every waiting task under the
  task it waits on instead of filing it in a section of its own.
- **Stack or wait.** Both stay first-class: stack the next piece of one feature that should ship with it and may
  still change it; wait when the earlier piece should ship on its own, needs to be live first, or lives in another
  repository. Agents get the same rule in `create_task`.
- **Not yet.** Bundles that branch, GitHub's own stack API (chained bases already show as a stack), triage inferring
  a bundle and `split_task` splitting into one.

### Feedback (2026-11-01)

- **Why.** Feedback on Shinsa had no way in but a chat with the person who builds it, and agents, who meet its
  rough edges first, had no way to say so. Every issue is public, so the first rule is that nothing private leaves.
- **Two passes.** A quick call rewrites the note as a generic issue, told your private words; then a pure check in
  core (`listFeedbackLeaks`) refuses what still names you, again at the moment you open it, after your edits.
- **Your click.** Agents propose with `report_feedback`, like memory rules; nothing opens an issue but you, with no
  setting to change that. Feedback is an entry, not a task: no worktree, no pipeline. Issue-scoped tasks,
  automations over the issues and shared task views are later work.

## 11. Open questions

1. **Plan gate threshold.** Today: `shinsa do --plan-first` and `shinsa import` always stop at the plan gate, and
   with Settings → Agents → Engine, Approve plans on Large plans, plans of more than 3 phases or 6 files and
   revised plans stop too, and on Always every plan does. Are 3 phases and 6 files the right line?
2. **Learning from you.** Your past corrections (in Kanna transcripts) could seed the rules skills
   and the ranking of decisions. Worth a dedicated pass once the PR loop has run against GitHub.
3. **Local review.** The review gate opens the worktree in your editor or a terminal. Should it also
   start the repository's dev server automatically (M5), and with which command per repository?
