# Shinsa: spec

> 審査, *shinsa*: examination, judging.
> **A human-assisted harness. The agents do the work; you make the calls.**

## 1. The problem

The limit on how much ships is no longer the agents, it is the person managing them. Today
that person runs 15 tabs across 5 projects, starts a second feature while the first one is
running, then gets buried when all three finish at once. Every finished chat becomes something
to remember, re-read, nudge ("fix the review comments"), commit, PR, chase, merge. Most of that
work does not need a human, but it is the human who does it, so the human is the bottleneck.

Existing harnesses (Kanna, T3 Code, Claude Code, Codex) are tools a human *uses*: the human
opens the chat, drives it, tracks it, closes it. Shinsa inverts that. **The harness runs the
work and asks the human for small, specific pieces of judgment.** Nothing else reaches them.

## 2. Principles

1. **Gates, not chats.** The human appears at exactly three points: approving the spec,
   reviewing the result, approving the merge. Plus answering a question when an agent is
   genuinely blocked. Everything between gates is the harness's job.
2. **The human never manages.** No projects to create, no tabs to keep open, no lists to
   groom. You state an intent; Shinsa works out the repo, the worktree, the branch, the order.
3. **One thing at a time for the human, many for the agents.** The human sees one gate, then
   the next. Parallelism is the harness's problem, not the human's.
4. **Nothing reaches main without the human.** No commit to the default branch, no merge,
   ever, without an explicit approval. Everything short of that can be automated.
5. **The AI is never the decider.** It prepares, checks, ranks and explains. If AI wrote the
   code, AI does not also approve it. (Shinsa's original thesis, kept whole.)
6. **Evidence over assertion.** "It works" is not a review input. Screenshots, recordings, a
   running preview, passing checks, a reproduced bug that now passes, are.
7. **Measure prompt-to-merge.** The product metric is human turns per merged change. Every rule,
   skill, lint and automation exists to push it down.

## 3. Core model

### Intent → Task

You write an **intent** ("block duplicating code-first paywalls", "the embedded chat should
use MCP v2"). Shinsa turns it into a **task**: one deliverable, one worktree, one branch, at most
one PR. A task is the only thing with a lifecycle. Chats, runs, agents, checks are
parts of a task, never things the human manages.

The repo is inferred (from the intent, recent work, mentioned files) and confirmed at the spec
gate. "Projects" exist only as known repos in settings, never as navigation.

### Lifecycle

```
draft ─► spec ──[GATE: approve spec]──► build ─► self-check ─┐
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

- **Size decides the spec gate.** Small tasks (a fix, a copy change) skip straight to build
  with the plan shown inside the review gate. Large or risky tasks stop at spec. The manager
  proposes the size; you can always override it.
- **Self-check** is everything an agent can verify alone: types, lint, tests, the repo's rules,
  a review pass against the rules skills, and for UI work the evidence capture (§5).
- **After review**, the PR loop is automated: review-bot comments and CI failures go back to
  the building agent, which fixes and pushes until the PR is clean. You are not asked again
  until the merge gate, unless something needs your judgment.
- **Questions** can interrupt any stage. They are gates too: one question, one answer.

### Gates

A gate is a durable record: what is being asked, the evidence attached, the options, who
answered, when. Gates survive restarts. Four kinds:

| Gate | What you see | Your answers |
| --- | --- | --- |
| Spec | The proposed spec as a document, inline comments | Approve · Comment (agent revises) · Reject |
| Review | The change running, evidence, diff ranked by risk, checks | Approve · Request changes (comments go to the agent) |
| Merge | Final diff summary, CI, bot verdicts, what changed since review | Merge · Hold |
| Question | One question, the context it needs, suggested answers | Answer |

### The manager

One always-on agent per Shinsa install (not per chat). Its job is to keep every task moving
toward its next gate and to decide what reaches the human, in what order.

- Turns intents into tasks; proposes size and spec; picks the provider and model.
- Orders work across tasks: dependencies (embedded chat waits on MCP v2), what unblocks the
  most, what you said matters. A task that depends on nothing starts at once, on its own agent,
  however many others are running, and lands at your review whatever its priority; priority only
  decides how high its decisions sit. A task that depends on others waits, costing nothing, until
  every one of them has merged, then starts from the updated default branch (`docs/engine.md` →
  Scheduling).
- Drives the PR loop: watches CI and review bots, sends fixes, re-requests review.
- Writes the briefing: the one decision to take now and why, the two or three after it, what
  agents are doing, and a heads-up when something is stuck. Kept current.
- Keeps notes per task so nothing depends on the human remembering it.
- Never approves, never merges, never commits to main.

Built on the event-sourced core (§6), so its decisions are records you can audit, not chat text.

### Focus

You can say "I'm on Superwall now". Gates from other areas are held silently (no badge, no
notification) until you switch or a date you set comes. Side work started in passing still
runs; its gates queue up behind your focus.

## 4. The human surface

Desktop-first and responsive: built for a full window, still right in a ~900px floating window. Web, served by `shinsa serve`, with an Electron app around it next.

- **Queue (home).** The current gate, full width. Under it, a short ranked list of the next
  gates and the manager's briefing. A count of tasks that are running and need nothing. No
  sidebar, no tabs, no project tree.
- **Intent box.** Always one keystroke away. Type, send, keep working. It does not navigate.
- **Gate views.** Spec (document with comments), Review (§5), Merge, Question.
- **Task page.** Everything about one task for when you want to look: spec, timeline of runs,
  the agents' transcripts (read-only by default, you *can* talk to the agent), evidence, PR.
  Reachable from any gate; never required.
- **All tasks: the roadmap.** Every task in to-do order: ready to merge, changes to review, plan
  to approve, needs your answer, paused, in progress, waiting on another task (drawn as chains
  that handle several parents), then done and cancelled, collapsed. Priority then age
  inside each section. This is the page to open each day and work down. A task can be told to
  wait for others from here, from the task page and from ⌘K, and the new-task box can start a
  request "after ‹task›".

## 5. Review, the core surface

Review is where Shinsa earns its name. It replaces "open GitHub, read the diff top to bottom".

- **Run it, don't read it.** Each task's worktree gets a preview: a dev server on its own port
  (web), a simulator build (iOS). The review page opens with the change running.
- **Evidence first.** Before the diff: what was asked, what was done, and proof. For UI work the
  agent records Playwright screenshots and a short screen recording of the flows it touched
  (both themes, desktop and phone width); for iOS, simulator recordings. For logic, the test it
  wrote, shown failing before and passing after.
- **Diff ranked by risk, not by file order.** Hot spots first (public API, data, auth, money),
  boilerplate collapsed. The ranking explains itself.
- **Comments go to the agent.** A comment on a line is a change request. Review again only sees
  what changed since your last pass.
- **Local first, remote too.** Review runs on the local worktree before any PR exists. Any
  GitHub PR link can also be opened in Shinsa for review, agent or not; that is the standalone
  review product for people outside this harness.

## 6. Architecture

```
Browser or desktop app ──WebSocket──► shinsa serve (Bun, on your machine)
                                        ├─ orchestration: command → event → effect
                                        │    (SQLite event log, projections, outbox)
                                        ├─ manager agent
                                        ├─ provider adapters: Claude, Codex, Cursor, Grok, Pi
                                        ├─ git: worktree per task, hidden-ref checkpoints
                                        ├─ forge: GitHub PRs, checks, review-bot comments
                                        ├─ preview: dev servers / simulators per worktree
                                        └─ MCP server for agents (gates, evidence, PR links)
```

- **Event-sourced core** (from T3 Code): commands are decided purely, events and projections
  committed in one SQLite transaction, side effects run from an outbox after commit and report
  back as commands. Gates, tasks and the manager's decisions are all events. Restart-safe by
  construction.
- **Provider engine** ported from Kanna: the five adapters and their normalization into one
  event stream, quick-model calls, account handling. Kanna is MIT; we take the engine, not the
  UI or its chat-first model.
- **Worktrees are mandatory**, one per task, so parallel tasks never collide. Checkpoints per
  run as hidden refs for revert and per-run diffs.
- **Agents talk to Shinsa over MCP**: `request_gate`, `ask_question`, `attach_evidence`,
  `link_pr`, `report_progress`. The manager and building agents use the same tools.
- **Rules as system skills.** The rules you enforce everywhere (no comments, the verb catalog,
  copy rules, the review method, "agents never commit to main") ship as skills injected into
  every agent, so they are followed before review instead of found during it.
- **Local only at first.** No accounts, no cloud. Remote access later through Tailscale.

## 7. Codebase

A fresh codebase in the Polis/Buzzkit shape, enforced as strictly:

- Bun workspaces + Turborepo. `apps/server` (Bun server and the `shinsa` command, also serves the web app),
  `apps/web` (React, the product UI), `packages/core` (domain, `decide`, queue, prompts and the
  wire protocol, all pure), `packages/ui` (design system). Provider adapters beyond Claude move
  into `packages/providers` when the second provider lands.
- Biome at Polis's settings (comment ban, `noFloatingPromises`, exhaustive switches, sorted
  classes, no `lucide-react`), `lint-conventions.ts` (comment ban, verb catalog), knip,
  cspell, sherif, strict tsconfig with `noUncheckedIndexedAccess`, Husky hooks, CI mirroring
  hooks. Root and per-app `CLAUDE.md`, `.claude/skills/` for conventions, review, copy, design.
- Tests next to the code (Vitest), golden tests for the orchestration core, replayed provider
  fixtures, Playwright for the web app.

## 8. Design

- Tokens and components from **Polis** (the newest fork of the Buzzkit system), plus Buzzkit's
  command and registry components, with Buzzkit's `design.md` and the `polis-design` skill
  ported as the written reference.
- Shinsa's density and corners: compact controls (~30px), less rounded than Buzzkit, squircle
  corners.
- Dark mode tuned as carefully as light, taking Shinsa's warm dark palette as the starting
  point, since Buzzkit's dark mode is the weak spot.
- One radius, height and spacing scale, enforced by components and lint, so buttons can never
  disagree again.

## 9. Milestones

| | Deliverable | Done when |
| --- | --- | --- |
| M0 | Repo skeleton, tooling, design system, daemon serving the web app | `bun dev` shows the empty queue in both themes; CI green |
| M1 | Tasks, worktrees, one provider (Claude), intent box, task page | An intent becomes a task in its own worktree and the agent builds it |
| M2 | Gates: spec, review (diff + preview), merge, questions; the queue | A small task goes intent → review → merge with only gate clicks |
| M3 | PR loop: open PR, watch CI and bots, auto-fix, merge gate | A PR with bot comments reaches the merge gate clean, untouched by you |
| M4 | Manager: ranking, dependencies, stacks, briefing, focus | Three parallel tasks arrive one gate at a time, in a sensible order |
| M5 | Evidence: Playwright capture, recordings, iOS simulator | UI review opens with recordings and a running preview |
| M6 | Remaining providers, standalone PR review, polish | Codex and Cursor tasks run; any GitHub PR opens in Shinsa |

Kanna stays your daily driver until M3. The Focus layout built in Kanna on 2026-10-21 is the
stopgap until then.

## 10. Status (2026-10-21)

Built and verified end to end against a scratch repository:

- **M0** done: the repo in the Polis/Buzzkit shape, Biome + Grit plugins, the conventions linter,
  knip, sherif, Husky, CI; the design system from Polis with the warm dark palette from the old Shinsa.
- **M1** done: intents become tasks, triage picks title, repository, size and branch (Haiku, with a
  heuristic floor), one worktree per task, Claude runs through the Agent SDK with the `shinsa` MCP
  tools and the agent plugin (review, evidence, handover skills), live transcripts, steering.
- **M2** done: spec, review, merge, question and failure gates; the ranked queue; the agent review
  loop with automatic fix rounds; review with evidence, a risk-ranked diff and line comments that go
  back to the builder; "Spec first" in the composer.
- **M3** built, unit-tested, not yet run against GitHub: PR opening, the 45 second PR watcher, CI and
  review-thread fix rounds, the merge gate, settlement and worktree cleanup.
- **M4** partly: focus by area with an expiry, the briefing, dependencies (triage, the new-task
  box or the task menus make a task wait on one or several others; it starts after all of them
  merge, chains, fan-outs and diamonds included). Still open: the manager learning priorities from corrections.
- **M5/M6** not started: preview servers and simulator capture driven by Shinsa itself (agents
  already capture evidence through the evidence skill), Codex and other providers, standalone
  review of any GitHub PR.

### Second pass (2026-10-21, evening)

- **The hand-over protocol.** Specs, work reports and review findings are fixed shapes with hard
  length limits (`packages/core/src/report/validate.ts`), enforced on every tool call. The work report is
  the review: phases in reading order, each pointing at line ranges ranked critical, high or normal,
  plus checks run and judgement calls.
- **Code-first review.** The review screen is a split: the walkthrough on the left (phases, or every
  spot ranked by attention, then agent findings, judgement calls, checks), the code on the right with
  the whole file as context, the spot spotlit, findings inline, line comments, `j`/`k` to step.
  Changes is a separate tab: a file tree and the full diff. Spec, Evidence and Agents are tabs too.
- **Desktop shell.** Home and the queue button show the same queue: Needs you, In progress, Not
  started, Waiting on another task and Outside your focus. A task page steps through what needs you (Next, "2 of 5") and moves on by
  itself once you decide. Cards is the default layout: no rail, a "3 need you" button at the top
  left, next to the logo, opens the queue over the page. Sidebar, picked in Settings, keeps the queue in a permanent rail.
- **Command menu.** ⌘K, the app's only keyboard shortcut, opens a menu that acts on the page in
  front of you first (the task's decision, tabs, priority, worktree, cancel; Home's Now task; a
  Settings section; the All tasks filters), then jumps to any task, switches focus, layout and
  theme, and starts a task from whatever you typed.
- **No repositories to manage.** Shinsa finds git repositories on the machine, registers one the
  first time it works there and files it into an area named after its GitHub owner.
- **`shinsa` CLI.** The server is `shinsa serve`; `shinsa do "<request>"`, `shinsa status` and
  `shinsa open` let people and agents hand work over from any project.
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

## 11. Open questions

1. **Spec gate threshold.** Today: "Spec first" in the composer, plus triage marks new features and
   reworks as large. Should certain paths (UI flows, data model) always stop at spec?
2. **Learning from you.** Your past corrections (in Kanna transcripts) could seed the rules skills
   and the manager's ranking. Worth a dedicated pass once the PR loop has run against GitHub.
3. **Local review.** The review gate opens the worktree in your editor or a terminal. Should it also
   start the repository's dev server automatically (M5), and with which command per repository?
