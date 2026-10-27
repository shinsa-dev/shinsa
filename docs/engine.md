# The engine

How a request becomes merged code while the human only steps in at gates. It borrows from
T3 Code's orchestration v2 (events and effects committed together, effects in ordered lanes,
results pushed back as commands, a split between process-bound and replay-safe work) and from
Paperclip (an execution policy the runtime enforces, a liveness invariant, bounded recovery that
escalates instead of looping). The rules live in `packages/core` (pure, `decide`) and the I/O in
`apps/engine`. An agent cannot skip a step by forgetting it. Every object, field and command name is listed in
`docs/protocol.md`.

## Agents

**One agent session per task holds the context; a separate agent only for isolated context.** This is the
engine's first rule. A task has one agent, the **Agent** (`agent` in code), and one provider session for its whole
life: planning is its round zero, and every round after it (new work, fixes, your feedback, pull request and CI
comments, operations, an inquiry and the change you OK after it) is the next turn of the same session. Within a round
it plans, builds every phase in order, takes every fix (failed checks, blocking review findings, your messages and line
comments, pull request and CI comments) and runs the operation. The inquiry kinds (answerer, investigator,
researcher) are not second agents but the same session doing another kind of work: an answer round after a change
round resumes the Agent's session, and the Agent of a change round after an answer resumes the answerer's, so nothing
the task learned is ever retold. Which session a run resumes is one function, `Decider.taskSession(taskId, role)`: the
latest run of the task (delegated runs aside) of any of the four task-session roles (`TASK_SESSION_ROLES`) that has a
session, leaving out a session that ended in a context overflow or an image error. Any other agent is there only because
its context must stay apart: the reviewer, read-only, so it never judges the work from inside the head that wrote it
(it keeps one session of its own per task, Reviewer below); a delegated agent for work that is truly independent and
runs in parallel, or a review or test the Agent's own reasoning would bias.

A fresh session is started only where it cannot be avoided: the task's first run, a context that overflowed or an
image the provider refused (a fresh session with the full brief), a session the provider lost (restored from the
transcripts, Resume fallback), or another kind of work on another provider. One session needs one provider, not one
model: when the session belongs to another kind of work on the same provider but another model (Settings → Agents →
Models sets the Answerer and the Agent apart), the run resumes the task's session on its own model and keeps the whole
context (`Decider.taskSession` compares only the provider); the first turn on the new model writes the conversation into
that model's prompt cache once (Caching, below). When it belongs to another kind of work on another provider, the run
starts fresh and its prompt carries the whole brief with the earlier rounds' results and the change you agreed to
(`describeEarlierWork`); the same kind of work on a changed provider is handed over with the transcript (Resume
fallback), and on a changed model it resumes as well. A run that failed before it had a session is retried on the task's session
(`Decider.resumableFrom`), and so are a usage wait's resume and a monitor's wake. The property walk checks every
`run.started` of a task-session role and of the reviewer against an independent reading of the log
(`assertOneSessionPerTask`).

Why: Anthropic's guidance on agent loops ("Building agents: when to fold subagents into your main agent loop", October
2026) is to keep one loop that discloses tools and skills as it needs them, and to start a subagent only for context
isolation: verification where the builder's context would bias the result, parallel work whose context can be thrown
away, or context that measurably bloats. Splitting the work by problem type (a planner, then a fresh builder per
phase, then a fixer) is a lossy telephone game: each agent re-read the code and saw only the summaries the last one
wrote, so what the planner learned about the code, and what phase 1 found out the hard way, was gone by phase 2. One
session keeps all of it, and its provider prompt cache keeps it cheap: each turn reads the whole conversation from the
cache (Sessions and the prompt cache, The agent loop).

Phases stay checkpoints. `complete_phase` still commits the phase and moves the progress on, but the next phase is the
same session's next turn with a short "Now build phase 2 of 3: …" instruction, not a new agent's full brief. Each turn
is still a run of its own (its attempts, its account, its usage), so every run of a task shares one session, and an
Agent run differs from the next only in its **purpose** (`Run.purpose`: `plan`, `build`, `fix` or `operate`). Long
tasks rely on compaction (eunoe's folds or Claude Code's, Compaction and fast mode below) to stay inside the window.

Each role's provider (Claude or Codex) and model are set in Settings → Agents → Models: Task agents (Opus) and Quick
jobs (Sonnet), and per role underneath. The Agent's planning, building and fixing are one setting, so its turns share
a provider and a model; the Answerer's setting may differ, and its session follows the rules above. The agent that
builds never reviews its own work.

| Role | Default model | Session | Hands back with |
| --- | --- | --- | --- |
| Classifier | Sonnet | one call, no tools | title, repository (or none), size, branch, and for what you left on Auto: the shape, the priority and the tasks it waits on, each with why |
| Agent | Opus | one session per task, resumed by every run of every round: it plans read-only, then builds, fixes and operates with edits; a fresh session only when the old one cannot go on (Recovery) | while planning, 2–8 phases (`propose_plan`) or the task's steps composed anew (`reshape_task`, Task shapes, below); a phase report per phase (`complete_phase`); a summary per fix (`complete_fix`); how the operation went (`report_outcome`), after the evidence its plan asks for |
| Reviewer | Opus | one session of its own per task, resumed by every review of every round and never the Agent's; it cannot edit | a summary and findings (`report_review`) |
| Answerer | Opus | the task's session (fresh only for a task's first run), in the repository itself (a scratch folder of its own when the task has no repository), cannot edit; on another model than the session's it resumes it on its own, on another provider it starts fresh | an answer (`answer`), optionally a proposed change (Task shapes, below) |
| Investigator | the Answerer's | the task's session, in the task's worktree used as scratch (it may run anything and add logging; nothing it changes ships) | a diagnosis (`report_diagnosis`), optionally a proposed fix |
| Researcher | the Answerer's | the task's session, cannot edit, in the worktree when the task has one, else the repository, else a scratch folder | a report (`submit_report`), optionally a proposed change |
| Writer | Sonnet | one call, no thinking | the Home guide: now, up next, a heads-up |

Besides its hand-over tool, every working role can ask (`ask`; never the reviewer, which cannot ask the human
anything), keep notes, find and read other tasks (`find_tasks`, `read_task`, which never changes anything), see the
other open work in its repository (`list_repository_work`, Other work in the repository, below), suggest
tasks, delegate (Delegation, below), file a task (`create_task`; the Agent also `split_task`) and schedule work,
and the Agent and the investigator can wait (`wait_for`). So every task agent can read across the roadmap, file a
task, schedule work and suggest tasks, while its hand-over stays its own. Which role may call which tool is one
table, `listCallableToolNames` in `packages/core/src/domain/tools.ts`: `decide` refuses a call the run's role does not
have, and each prompt's house rules name only the tools the agent has. What a session is served is `listToolNames`:
the four task-session roles share one session, and its tools are the first thing in the prompt-cache prefix, so they
are all served one list, the union of theirs in `SHINSA_TOOL_NAMES` order (the reviewer and delegated agents get
exactly their own). A tool served but not the run's is refused with `wrong_step` and the hand-over it should use:
which hand-over each Agent purpose may call is `PURPOSE_HAND_OVERS` ("You are building a phase: hand it over with
`complete_phase`."), and an answerer, investigator or researcher is pointed at `answer`, `report_diagnosis` or
`submit_report`. The matrix is `docs/protocol.md` → Agent tools.

Every task agent (not a delegated one) also gets the command surface as tools: every `shinsa` command-line action but
the few that need you at the keyboard and `tasks create`, one tool each (Agents manage Shinsa, below). A run the
context optimizer left servers or skills out of also gets `load_mcp_server`, `call_mcp_tool` and `load_skill` (MCP
servers, plugins and skills → Loading what was left out). Pull request fixes are Agent runs too. Which agent role's
settings each run role uses is one table, `RUN_AGENT_ROLE` (`packages/core/src/agent-models/index.ts`). A run
woken by a monitor (Waits and monitors, below) resumes the session of the run that waited.

A role runs on `settings.agentProviders[role]`, else `settings.defaultProvider` (`resolveAgentProvider`). Its model
is `settings.agentModels[role]`; without one, a working role on the default provider uses `settings.defaultModel`,
and every other case takes the provider's own default for the role (`resolveAgentModel` in
`packages/core/src/agent-models/index.ts`: Claude's `DEFAULT_AGENT_MODELS`, Codex's GPT-6-Astra for working roles
and GPT-5.6-Luna for the classifier and the writer). A chosen model belongs to the role's provider: asking for the
role's model on another provider gives that provider's default, and a `settings.change` that moves a role to
another provider drops the model it had, unless the same change names one (switching the default provider clears
`defaultModel` the same way). Model names come from `KNOWN_AGENT_PROVIDERS` (Claude's `KNOWN_AGENT_MODELS`, "opus"
is "Opus 5.5", and the curated `KNOWN_CODEX_MODELS`), so Settings shows the right names from the first paint;
`GET /api/providers` then replaces them with each provider's live catalog (`listModels`: the Claude SDK's
`supportedModels`, Codex's `model/list`), labelled the same way (`resolveModelLabel`). `GET /api/models` still
serves the default provider's list, the one setup's Model step offers.

**Checks are not an agent.** Shinsa runs the repository's check commands itself (`apps/engine/src/checks`:
the configured commands, otherwise `lint`, `check-types`, `typecheck` and `test` from
`package.json`), so a green build is a fact, never an agent's claim. When they pass, Shinsa also measures how much of
the change the tests run (Test coverage of the change, below), the same way: a number Shinsa read from a report, never
an agent's claim.

### Test coverage of the change

After a checks run in which no check failed, the server runs the repository's tests with coverage in the task's
checkout and works out **changed-line coverage**: of the lines the task's diff adds or modifies, the ones the report
marks executable, and of those the ones a test ran (`apps/engine/src/test-coverage/`, the pure parts in
`packages/core/src/test-coverage/`).

- **The setting** is per repository (`Repo.coverage`, `CoverageSetting`), a human-only repository field
  (`HUMAN_ONLY_REPO_FIELDS`) like the checks: whether coverage is measured, and by what command, decides what the
  reviewer and you are told about the tests, so no agent changes it. Settings → Projects shows it on each repository's
  row; `shinsa repos update --coverage auto|custom|off` (with `--coverage-command`, `--coverage-report` and
  `--coverage-format` for custom) changes it. Three modes (`COVERAGE_MODES`):
  - **Auto**, the default: detect a coverage command from the repository's files, or measure nothing;
  - **Custom**: your command and the report it writes (a path inside the repository), with the format when the
    report's name does not tell it (`resolveCoverageFormat`: `.info`/`lcov*` is lcov, `.xml` Cobertura, `.out` and
    `.coverprofile` a Go profile);
  - **Off**: nothing runs, and the agent's phase instruction does not mention coverage.
- **Detection** (`resolveCoveragePlan`) reads only files, and detects nothing rather than guess. The first that applies:

  | What it finds | Command (in the lockfile's runner: `bunx`, `pnpm exec`, `yarn`, else `npx`) | Report |
  |---|---|---|
  | a `test` script that is `c8 …` or `nyc …` with no shell operators | the script with `--reporter=lcov --report-dir=<dir>` added | lcov |
  | a `test` script that is `bun test …` with no shell operators | `bun test --coverage --coverage-reporter=lcov --coverage-dir=<dir> …` | lcov |
  | `vitest` and `@vitest/coverage-v8` or `-istanbul` in the dependencies | `vitest run --coverage --coverage.reporter=lcov --coverage.reportsDirectory=<dir>` | lcov |
  | `jest` in the dependencies | `jest --coverage --coverageReporters=lcov --coverageDirectory=<dir>` | lcov |
  | `pytest-cov` in `pyproject.toml`, `setup.cfg`, `setup.py`, `Pipfile`, `tox.ini` or a `requirements*.txt` | `pytest --cov=. --cov-report=xml:<dir>/coverage.xml` (through `uv run`, `poetry run` or `pipenv run` when their lockfile is there, else `python3 -m pytest`) | Cobertura |
  | a `go.mod` | `go test ./... -coverprofile=<dir>/cover.out` | Go profile |

  `<dir>` is a fresh temporary folder Shinsa removes afterwards, so a stale report is never read; a custom report is
  deleted before its command runs. `GET /api/repos/coverage` says what Auto would run in each repository, for
  Settings.
- **The run** shares the checks' environment, timeout (15 minutes) and cancellation, while the task still holds its
  workspace. A command that exits non-zero but leaves a report still counts (a coverage floor fails the run, not the
  report); one that times out, leaves no report or a report with no files, or any error while reading it or the diff,
  gives `{ status: 'unavailable', reason }`, which is logged and shown nowhere. Checks that fail measure nothing: a fix
  comes first.
- **In a GitButler workspace** one checkout holds every applied branch, so the report covers other tasks' code too,
  and only the task's own lines count, read the way the Code tab assembles its working copy (What the Code tab reads
  in GitButler, below): the lines its branch changes since the base (`git diff -U0 <base> <branch>`), moved to where
  they sit in the checkout through the diff from the branch to the working directory (`mapChangedLines`: a line
  another change rewrote drops out, one below an insertion moves down), plus the uncommitted lines (against the
  workspace commit, `HEAD`) of the files the ledger says the task owns (`LedgerStore.listOwned`, the Code tab's
  `owned` paths). Another task's commits, its owned files and paths nobody owns are never counted.
- **The computation** is pure: the report parsers take text (`parseLcov`: `SF`/`DA` records; `parseCobertura`: each
  class's `filename` joined to each `<source>`, line hits; `parseGoProfile`: `file:start.col,end.col statements
  count` blocks, every line in a block with statements), `parseChangedLines` reads `git diff -U0 <base>` of the
  checkout (untracked files included, through a scratch index) into new-file line numbers, and `measureCoverage`
  intersects them. Report paths become repository-relative by stripping the checkout's path or its real path, then the
  Go module path from `go.mod`; a path still unmatched matches the shortest report path that ends with it. A changed
  line the report does not list is not executable. The base is the one the Code tab diffs against
  (`resolveTaskRefs`), so the whole task's change is measured, every round.
- **Where it goes.** `checks.record` carries it as `coverage`, `checks.recorded` folds it onto `Task.coverage` (cleared
  by checks without it and by a new round, like `checkResults`). The web shows a measured result with an executable
  line under the checks in Review → How to test, with the files and their missed ranges linking into Code, and as a
  fact on the Overview's checks; `read_task` names the summary (`describeCoverage`). The reviewer's brief has the
  summary and up to 20 files with their missed ranges (`listCoverageGaps`), and the review skill tells it to flag
  important new logic no test runs; the Agent's phase instruction and the handover skill tell it to cover new logic
  with tests and that Shinsa measures it, unless the repository turned coverage off. All of it is in the user turn,
  never a system prompt (Caching).

### Who is who

Shinsa is a control plane for coding agents. It does not think or write code itself: it runs the harnesses (Claude
Code through the Agent SDK, and Codex) as agents, one agent session per task and a separate one only where context
must stay apart, and keeps the gates, the commits, the pushes and the merges for itself. In one task:

```
Shinsa                       triage, gates, checks, commits, pushes, merges
├── Classifier · Writer      one-shot calls with no tools; never in a task's chat
└── task SW-14               one Agent session for the whole task
    ├── round 1, round 2 …   each round its own steps, each the session's next turns
    │   ├── Agent            plans (read-only), builds each phase, fixes, runs the operation
    │   │   └── delegated agents (Planner, Builder, Reviewer), only for isolated or parallel work, up to three deep
    │   └── Answerer · Investigator · Researcher   the inquiry kinds of work, on the same session
    └── Reviewer             its own read-only session, resumed by every review
```

The human is in the chat with them. Every agent talks to you directly and hands its work over through a Shinsa tool,
whose result the chat shows as a card; the house rules (`prompts/rules.ts`) tell it never to narrate that hand-over
or announce that its turn is over. A delegated agent talks to the agent that delegated it.

**Agents speak as themselves.** Every agent writes in the first person ("I found…", "I know of one project…", "I
have not worked in that repository yet"); Shinsa stays in the background as the control plane it works in.
`VOICE_RULE` in `prompts/rules.ts`, in every working role's house rules and every delegate's prompt, forbids
writing that Shinsa knows, has or did what the agent itself knows or did, and allows naming Shinsa only where the
reader has to act in it (a setting, a command, a gate). The hand-over is the reply: the answer, diagnosis, report
and outcome tool descriptions (`agents/tools/shapes.ts`) say to write it to the human in the first person, the
tool's reply (`HANDED_OVER` in `agents/handover.ts`) says the human reads it as the agent's reply and to stop and
write nothing more, and the house rules forbid announcing, pointing at, repeating or summarising it ("My answer is
above"). Text the agent writes in that turn anyway folds into the chat's work, under the card
(`docs/design.md`, 7). The tool texts an agent reads avoid the third person too: `find_tasks` and `read_task`,
`repos list` ("the repositories agents have worked in") and the delegation errors ("There is no repository…").
`test/prompts/rules.test.ts` pins the rule and fails on any prompt that speaks of the agent as Shinsa or invites a
closing summary. On screen, each run in the
chat is headed by its role's name and icon, a delegated agent sits inside the turn of the agent that delegated it,
and the task's "Who worked on this" lists the same tree (`docs/design.md`, 12).

## A task's path

Every task follows its own pipeline (Task shapes, below). The longest one, a change, is:

```
create → classify → (wait for the tasks it waits on) → worktree → plan → phase 1 … phase n
       → checks → agent review → YOUR REVIEW → pull request → CI and bots → YOUR MERGE → merged
          one Agent session plans, builds every phase and takes every fix: checks, review, CI and your messages
```

1. **Classify.** One Sonnet call picks the title, the repository or none (A task without a repository,
   below), size, branch and, given every open task, the tasks this one waits on (`waits_on`, a list, usually
   empty). Then the task either waits for them (Scheduling, below) or has its setup verified (`config.verify`,
   Setup verification, below) and gets its worktree (`worktree.create`): a fresh branch from the freshly fetched
   default branch.
2. **Plan.** The Agent reads the code and calls `propose_plan`. It plans read-only (Read-only while planning, The
   agent loop) and is told that it builds the plan itself, in the same session. A task created plan first
   (`planFirst`: `shinsa do --plan-first`, `shinsa import`) always waits at a plan gate; otherwise, with
   Settings → Agents → Engine, Approve plans on (`approvePlans`, off by default), a large task's plan or a revised
   plan waits there (`PLAN_GATE_RULE`, evaluated by `needsPlanApproval`; Gates, below), and building starts at once
   when it does not. A decision
   only the human can make is asked with `ask` before planning finishes.
3. **Build.** Each phase is a run of its own on the session that planned it, now able to edit. Its prompt is short
   (`resolvePhaseInstruction`: "Phase 1 is committed. Now build phase 2 of 3: …" and how to hand it over), since the
   session already holds the request, the plan and every earlier phase. Phases run in order in one worktree.
   `complete_phase` commits the phase (`<type>: <phase title>`) and starts the next one.
4. **Checks.** After the last phase Shinsa runs the checks. A failure goes back to the Agent's session with the
   output. Every fix prompt says what follows the fix: the task's checks and agent review where it
   has them, then your review; for a pull request fix, the push.
5. **Agent review.** A fresh reviewer reads the diff. It hands over one `report_review`: a summary of what it checked
   and its view of the change, each finding anchored to lines with a title, what is wrong and why it matters,
   and a suggested fix when it has one, and the Agent's judgement calls it would have made differently
   (`disagreements`, by their number in its brief; `resolveReviewerPrompt`). The task keeps them as `reviewSummary`,
   `findings` and `reviewDisagreements` until the next review or round (The review report, below). Blocking findings go back to the Agent, and then
   the checks and a new reviewer run again. Suggestions alone do not block.
6. **Your review.** The review gate shows one report built from every phase. Approve it, or write
   in the chat: a message while the gate is open withdraws it and goes to the Agent. Approving with edits you made in
   the Code tab that no commit has yet commits them and runs the checks again before the push (Your edits, below).
7. **Pull request.** Shinsa pushes and opens the PR, then watches it (The pull request watch,
   below). A check that newly fails, a new comment from anyone but Shinsa's own GitHub user, a new
   conflict, or a problem that is still there after the last fix resumes the Agent, told exactly
   what is new; `complete_fix` pushes the fix. While a push is on its way (`pull_request.push_requested` until
   `pull_request.pushed`, which `pull_request.record_push` records), and until GitHub reports the pushed commit, a
   sync is stored but not judged, so a stale result never starts a second fix.
8. **Your merge.** The merge gate opens only on a clean PR with no comment left unread, and only
   after every task it waits on has finished. A task that starts waiting on another while its
   merge gate is open loses the gate until that task merges. Approving starts the merge; syncs
   that arrive while it runs never reopen the gate. Approving with edits from the Code tab that no commit has yet
   pushes them first and merges once CI passes (Your edits, below). A PR GitHub puts in its merge queue (or on
   auto-merge) is waiting, not failed: the stage says where it is in the queue, and a queue that
   takes it out without merging reopens the merge gate with GitHub's reason (Merge queues, below).
   Merging settles the task, removes the worktree and starts the tasks waiting on it; a task that runs an operation
   after the merge resumes the Agent to run it instead and settles when the operation is done (Task shapes, below).
   Approving waits for the steps around the merge you must do yourself (Steps around the merge, below): while one
   before the merge is unticked, core refuses the approval (`merge_steps_open`) and the web holds the Merge button,
   and once it merged, post-merge steps keep the task open behind the Post-merge gate until each is ticked.

That path is one **round**. A task is the conversation, and it can run any number of rounds (Rounds, below): the
merge ends the round, not the task.

### A task without a repository

A task binds a repository only when the choice is clear. Clear means, in this order: the task was created with
one (`repoId`) or from inside one (`origin`); its request names one; or the classifier picks one of the project's
repositories because the request clearly needs that repository's code. Not clear: "the repo", "the code" or "the
project" with no name ("make the answer a doc in the repo"), a repository picked because it is the only one listed
or the one worked on last, and "hey", "what projects do you know", a general question or planning chatter. A task
whose choice is not clear binds none, and its work asks at the setup gate when it needs one.

- **Triage may choose none.** The repository is a choice among the project's repositories (or every one, Projects and
  task identity, below) plus `none` (`NO_REPOSITORY` in `apps/engine/src/triage/index.ts`); the classifier is told
  when to answer none, never to pick a repository only because it is the only one listed or was worked on recently,
  and that "the repo" alone names none. The repositories are listed by name, with nothing saying which was used
  last, and the prompt has no preference for recent work.
- **A repository outside the project is used when the request names it.** A repository on the machine outside the
  task's project is offered only when the request names it: its name appears in the request as whole words, any
  case, punctuation ignored (`kanna` in "Fix the button in Kanna's sidebar", `paywall-next` in "paywall next";
  `resolveCandidatePool`). The prompt lists those as offered because the request names them, and the rest as never
  offered, so a request about one of those gets none (and asks at the setup gate) instead of the project's only
  repository. A named one the classifier picks is registered if Shinsa does not know it yet (`<effect key>:repo.register`,
  filed like any repository triage registers, Projects and task identity, below, never into the task's project) and
  bound; the task keeps its own project, and its agents' brief says the task works in a repository outside it.
  Without the model the task binds none, unless it was created with a repository or from inside one. `task.triage`
  then carries `repoId: null` and nothing is registered.
- **It runs without one.** An answer or research with no repository skips the setup step entirely (`startWork`:
  no `config.verify`, no "verifying the setup", no Find the repository step in the strip) and runs read-only in a
  scratch folder of its own, `data/scratch/<task id>` (`RunSupervisor`, made again before every run), never a
  worktree. Its prompt claims no repository ("The human asked a question or wrote to you", and
  `describeNoRepository`: work from Shinsa's own tools, and ask with `ask` when the request needs the code of a
  repository it cannot tell). The task keeps its project.
- **The scratch folder goes when the task settles.** Settling a task (done, merged or cancelled) runs
  `scratch.remove` (`settleTask`), whatever repository it has now, since an earlier round may have run without one.
  The server waits for the task's runs to stop, then deletes `data/scratch/<task id>` if the task is still settled;
  a task reopened by a new round keeps it. A folder that is already gone is fine, so the effect is replay safe.
- **Work that needs code binds one then.** A step that needs a repository (an investigation, a plan, a build, an
  operation) on a task with none goes through the setup check, which finds the repository first: one quick call on
  the classifier model (`resolveRoundRepository` in `triage/message.ts`) reads the task's rounds, the current
  round's request, the change you agreed to and your messages in that round, and answers one of the project's
  repositories, one outside it that those name, or none. The server registers it like triage does (`repo.register`,
  `<effect key>:repo.register`) and sends `config.record` with its `repoId` and what checking it found; core binds it
  (`task.repo_bound`, "Chose the repository …"), keeping the task's project. So a no-repository task whose next round
  asks for a change ("fix the button in kanna") binds kanna when that round starts, and your OK to turn an answer into
  a change binds one before the Agent plans. When the call answers none (or the model is off), core opens the
  configuration gate "No repository for this task"; a message there ("it is kanna") verifies the setup again, and the
  same call reads it.

## Where agents work

A repository says where its agents work (`Repo.workspace`, Settings → Projects on each repository's row, ⌘K "Where
agents work in ‹repository›", `shinsa repos update --workspace`). It is a human-only repository field
(`HUMAN_ONLY_REPO_FIELDS`): no agent tool, no shell command and nothing on your behalf changes it. There are three
modes (`WORKSPACE_MODES`), each a strategy in `apps/engine/src/workspaces/` behind one interface
(`WorkspaceStrategy`: prepare, claim, commit, push, remove), picked per task by `Workspaces.resolve`:

| Mode | A task gets | Commits | Pushes | When the task settles |
|---|---|---|---|---|
| **Worktrees** (`worktrees`, the default) | its own git worktree on a fresh branch (`data/worktrees/…`) | `git commit` in the worktree | `git push origin HEAD:<branch>` | the worktree is removed |
| **GitButler** (`gitbutler`) | its own virtual branch in the repository's GitButler workspace (`but branch new`), applied next to every other task's and your own branches, in the main checkout | `but commit -b <branch>` with exactly the files the task changed | `but push <branch>` | cancelled or done without a merge: the branch is taken out of its stack, if any, and unapplied (`but unapply`) and its untouched uncommitted edits discarded; merged: left for GitButler, which marks it merged upstream and drops it on your next `but pull` |
| **Main checkout** (`main_checkout`) | the repository's own checkout, switched to a branch Shinsa makes from the freshly fetched default branch | `git commit` on that branch, only while the checkout is on it | `git push origin refs/heads/<branch>` | the checkout goes back to the branch it was on when the task took it (`returnBranch`), or to the default branch when that branch is gone or the checkout was detached; with uncommitted changes it stays where it is |

- **Core holds the mode and the invariants.** A task takes the repository's mode when it asks for its workspace
  (`worktree.requested`, then `worktree.created` carries it) and keeps it for its whole life, rounds included, so
  changing the setting only affects tasks that have not set up yet (`resolveTaskWorkspace`). The setup step says what
  it sets up (`WORKSPACE_SETUP_REASON`: "setting up the worktree", "setting up the branch", "setting up the checkout").
- **One task at a time in a main checkout.** A task holds the checkout from the moment it asks for it until its
  checkout is given back (`worktree.gone`), which is after it settles (`selectCheckoutHolder`). Another task that
  needs the checkout waits on the holder (`waiting_on_tasks`, "waiting for “Title” to finish with the checkout",
  `holdForCheckout`, before its setup is even verified) and starts when the holder gives it back
  (`releaseWaiting`); the queue shows the holder as what it waits on (`listWaitsOn`). Switching the repository to
  another mode releases the waiting tasks at once. A `worktree.ready` for a task that would take a held checkout is
  ignored. The property test checks that no two tasks of one repository ever hold its checkout
  (`workspace-invariants.ts`).
- **The setup check covers the mode** (`describeWorkspaceProblem`, a `workspace` configuration problem, "Agents
  cannot work in this repository yet"): GitButler needs `but` on the PATH and the repository to be a GitButler
  workspace (`.git/HEAD` on `gitbutler/workspace` and `.git/gitbutler`); the main checkout needs a checkout with no
  uncommitted changes (only for a task that does not hold it yet) and refuses a GitButler workspace, since switching
  its branch would take it out of GitButler. Settings only offers GitButler where `GET /api/repos/workspaces` says
  both hold (`canUseGitButler`), and says why otherwise.
- **Agents work where the strategy puts them.** For GitButler and the main checkout a task's `worktreePath` is the
  repository itself, so every role works in your checkout; a read-only agent's edits are never set aside there,
  as in any shared checkout. Checks run in the same checkout, so in GitButler they test every applied branch
  together, your own uncommitted work included, not the task's branch alone.

### GitButler: whose change is whose

GitButler applies several branches in one working directory and decides at commit time which branch a change goes
to; its CLI (0.22) has no lasting per-branch assignment of uncommitted changes (`but rub` and `but stage` are
gone), so Shinsa keeps the assignment itself:

- **One agent that changes files at a time per GitButler workspace.** A run whose role can write claims the
  repository (`GitButlerStrategy.claim`, a lock keyed by repository and owned by the task, so a task's own runs and
  shared delegations never wait on each other) before its session starts, and gives it back when it ends; read-only
  runs (the Agent while it plans, the reviewer, researcher and answerer, a delegated planner) never wait. Checks claim it too. Two agents editing the same
  working directory at once would leave no way to tell whose edit is whose, and GitButler refuses to put a change to
  a file another applied branch changed on a second branch anyway, so Shinsa serialises the writers rather than
  refuse after the fact; planning, review, CI and pull requests still run in parallel. A waiting run is active but
  has no session; cancelling it or a shutdown ends the wait (`RunSupervisor.cancel`, `interruptForShutdown`).
- **The ledger** (`data/workspaces/<repository>.json`, `workspaces/ledger.ts`). When a claim starts, Shinsa records
  every uncommitted path with a hash of its content (`git status --porcelain=v2 --untracked-files=all
  --no-renames`). Whatever changed since belongs to the task (`claimChanges`); a path that was already dirty and is
  not the task's (your work, or another task's pending edit) is a conflict. A hand-over commits only the task's own
  paths, by their GitButler change ids (`but status --json`), to the task's branch; a conflict refuses the commit
  with the paths named, so the agent undoes its edit or asks. Paths a task changed but has not committed stay its
  own across runs and are never taken by another task. Your uncommitted work is never committed and, when a task is
  cancelled, only the task's edits that nobody changed since are discarded (`forgetTask`). Setting a task up again
  before any phase report drops its own such edits too, as a reset worktree drops an investigation's scratch edits
  before the fix is planned; the main checkout never discards anything.
- **Stacking on conflict.** A change to lines another applied branch already changed is refused by `but commit`,
  whose hint names the branch to stack on (`but move <branch> --above <other>`). When that branch is another open task's
  in the same repository that does not wait on this one (`selectStackTarget`), Shinsa runs the move, commits again and
  sends `task.stack` before the hand-over: core records `stackedOn` (`task.stacked`) and adds the other task to the
  ones this task waits on (`task.waits_on_changed` by Shinsa, the existing dependency), so its merge gate waits for the
  other task to merge. Its pull request targets the other task's branch while that task's pull request is open, and the
  default branch otherwise (`resolvePullRequestBase`; the watch retargets it when that changes, as for a stacked round),
  and the Code tab diffs it against the same base. Any other refusal (your own branch, a settled task, a task that
  waits on this one, or a commit that still fails after the move) reaches the agent as before ("GitButler did not
  commit the changes to ‹branch›"), and it is told to leave the file or ask. While the task below is open the
  dependency is locked: `task.wait_on` (from you, or on your behalf) that drops it is refused (`dependency_stacked`,
  `assertStackKept` on `selectStackedOnTask`), so the task above cannot merge first and take the commits below with
  it; the Waits on menus show that task's item ticked and disabled as "Stacked on “‹title›”", and Stop waiting keeps
  it. Once the task below merges the lock is gone and the stack is left to GitButler.
- **Leaving a stack.** A task whose branch settles without a merge (cancelled, or done without a merged pull
  request) is taken out of its stack before its branch is unapplied (`but move <branch> --unstack`, then
  `but unapply`), because GitButler unapplies a whole stack when any branch of it is unapplied. The branches above it
  stay applied on the one below it, or on the workspace target when it was the bottom, with their own commits. Core
  agrees in the same command (`settleTask` → `unstackTasksOn`): each open task stacked on it gets `task.unstacked`
  (its `stackedOn` cleared) and loses that dependency (`task.waits_on_changed` by Shinsa), so its pull request's base
  resolves to the default branch and the watch retargets it.
- **Conflicts an unstack leaves.** A commit above the settled task that changed its lines (the reason the stack
  exists) is left conflicted by the unstack: GitButler keeps it on the branch marked conflicted. After the removal
  the server reads which applied branches have conflicted commits (`listConflicted`, from `but status --json`) and
  sends `task.record_conflict` for each open task on one; Shinsa never pushes a conflicted branch either
  (`GitButlerStrategy.push` refuses with `ConflictedBranchError`, and the push effect sends the same command
  instead of failing). Core (`recordConflict`, `decide/conflicts.ts`) steers the Agent when it is building, fixing
  or operating ("Resolve them before you hand over"); at the review gate, the merge gate or while shipping, with
  no run active, it withdraws the gate and starts a fix (`fixFor: 'conflict'`, "resolving conflicts") in the
  Agent's own session. The Agent resolves in place, never moving your checkout: `but resolve conflicts <branch>`
  lists them, `but resolve apply <path>:<N> --commit <branch>` with the content it wants (or `--ours` /
  `--theirs`) rewrites the commit, and it asks you (`ask`) when it cannot tell which side is right; it is told
  never to run `but resolve <commit>`, which enters resolution mode and checks the commit out, and the shell
  policy refuses it. After the fix a task past your review pushes (`but push` force-pushes the rewritten branch)
  and one before it runs the checks and review again. Elsewhere (planning, reviewing, checking, a merge that is
  running) core keeps the conflict (`task.conflict_held`, `Task.heldConflict`) and tells the Agent at its next turn
  that writes: the first build turn after planning, a fix or the operation gets the same note at the end of its
  prompt (`tellHeldConflict` in `Decider.startRun`, next to your edits and the overlap note, so the session's prefix
  stays the same), and the conflict is no longer held. A conflict still held when no such turn came first is acted
  on at the task's next gate: where the review gate or the merge gate would open, the fix starts instead
  (`startHeldConflictFix`), so the work never reaches you conflicted. A held conflict an Agent at work is then
  steered about is no longer held either, and starting the conflict fix clears it (a conflict fix is never told it
  twice).
- **A pull request that conflicts with its base.** In a worktree or the main checkout the Agent merges the fetched
  base in (The pull request watch). In GitButler it cannot: `git merge` takes the checkout out of GitButler, and only
  `but pull` brings the new default branch in, rebasing every applied branch, yours too. So when the watch reads a
  GitButler task's pull request as conflicting (`mergeable: false`), core opens a failure gate with
  `cause: 'workspace_update'` ("Pull request #12 conflicts with main") instead of starting a fix, and its one action
  is Update the workspace (Retry with guidance passes your words on). Approving sends the `workspace.update` effect
  ("updating the workspace"), which waits for any writing agent in the workspace, then runs `but pull`
  (`GitButlerStrategy.update`; GitButler keeps everyone's uncommitted work and marks a commit that no longer applies
  as conflicted) and sends `task.record_workspace_update`. Core then starts a conflict fix in the Agent's session
  (`resolveWorkspaceUpdatedFixPrompt`): it checks `but status`, resolves what is left in place as above, and
  `complete_fix` pushes. While the gate is open or the update runs, syncs of the pull request start nothing, and a
  pull request that turns clean meanwhile opens the merge gate as usual. A failed `but pull` is a failure gate
  ("Could not update the workspace"), and Retry runs it again.
- **The shell policy in a GitButler workspace.** An agent may read it (`but status`, `but diff`, `but show`) and
  resolve a conflicted commit in place (`but resolve conflicts|apply|status`); every other `but` command (commit,
  push, pull, move, apply, unapply, discard, undo…) is refused, since Shinsa commits, pushes and moves branches
  and the workspace is updated only when you choose Update the workspace.
- **Limits.** An edit you make outside Shinsa while an agent holds the claim, to a file that was clean, is counted as
  the agent's; an edit you make in the Code tab is recorded as the task's at once (Your edits, below).
  An isolated delegation checks out the workspace commit (every applied branch), not the task's
  branch alone. Pull requests open with `gh`, like every mode, not `but pr new`, which needs GitButler's own forge
  sign-in; the branch was pushed with `but push`, so GitButler sees it as pushed.
- **Recovery.** Branch creation, applying, committing and the ledger are safe to repeat: `prepare` reuses an applied
  branch and applies one that was unapplied, a commit with nothing new makes none, and the ledger is on disk, so a
  restart keeps which uncommitted paths are whose (a claim open at the crash is closed by the next run's claim of
  the same task). `but` commands for one repository run one at a time in the server.

### Your edits

The Code tab edits the task's code directly (`docs/design.md`, 32): there is no suggestion step, and Shinsa still makes
every commit.

- **Where they go.** `POST /api/tasks/<id>/file` (`apps/engine/src/http/edits.ts`) takes `{ path, content, base }`
  (`FileWrite`): the file's new text and the text the editor last knew on disk (`null` for none). It writes into the
  task's checkout, `worktreePath`, which each strategy sets: the worktree, or the repository itself for GitButler and
  the main checkout. The path passes `assertRepoPath` and must stay inside the checkout with its nearest existing
  folder's real path (`resolveWritableInside`), so neither `..` nor a symlinked folder leads out. A text over 2 MB is
  refused (`file_too_large`), and so is a task core will not let you edit (`edit_refused`, `resolveEditRefusal`: merged,
  cancelled or done, or no checkout). Inspect mode refuses it with every other write.
- **Never over someone else's write.** When the file on disk is not `base`, nothing is written and the answer is
  `409 file_changed` with the disk's text (`FileChanged`); the editor merges your unsaved edit into it when the two
  touched different lines and shows the disk version otherwise. A running agent is not stopped: you can edit while it
  works, and whoever writes second sees the other's text first.
- **Through the strategy** (`WorkspaceStrategy.writeEdit`). A worktree takes the write as it is. The main checkout
  takes it only while it is on the task's branch (`assertOnBranch`), so an edit never lands on a branch you switched
  to. GitButler writes under its serial lock and records the path in the ledger as the task's (`adoptPath`), so the
  next hand-over commits it to the task's branch and never to another's; a path another task has uncommitted changes
  in is refused (`file_taken`), and a path that ends up clean again leaves the ledger.
- **What core knows** (`task.record_edit`, sent by the route after each write with whether the file now differs from
  the checkout's `HEAD`; `task.edited`). `Task.editedPaths` lists the files you changed that no commit has taken yet,
  and `untoldEdits` the ones no agent has heard of. The first edit of a file shows as "Edited ‹path›" in the activity;
  putting a file back the way it was committed takes it off both lists.
- **The agent is told.** A running agent of the task is steered at once with `describeHumanEdits` ("The human edited
  this file in the working copy: ‹path›. Their edits are part of the work and go into your next commit: keep them, and
  read a file again before you change it."), as a note of Shinsa's (`run.steer` with `from: 'shinsa'`, like the
  overlap and conflict notes), not as a message from you, and the next run of the task gets the same line for every
  untold file appended to its prompt (`Decider.startRun`, `task.edits_told`), on the session it resumes or a new one.
- **Committed with the round.** A phase or fix hand-over commits everything in the checkout as before, your edits
  included (`work.committed` clears `editedPaths`). Edits no hand-over took yet are committed by Shinsa
  (`fix: apply the edits made in the Code tab`, then `task.commit_edits`) and never ship unchecked:
  - Approving the review with them (`task.edits_approved`, `Task.approvedEdits: 'review'`) commits them and runs the
    checks again ("committing your edits and running the checks"; the checks effect commits first). Passing checks
    push straight away, without another agent review or review gate, since you approved; failing ones go to a fix
    turn as usual, and that fix goes through the checks, agent review and your review again.
  - Approving the merge with them (`Task.approvedEdits: 'merge'`) does not merge yet: it pushes them ("pushing your
    edits"; the push effect commits first), waits for CI, and merges when the pull request is clean again
    (`openMergeGate` takes the approval instead of opening the gate). A CI failure, a new comment or a conflict goes
    to a fix turn as usual, and the merge gate opens again after it.
  - On a pipeline without the checks step there is nothing to run again, so approving the review with them pushes
    straight away, as approving without edits does: the push effect commits them first.
  - What an approval does is `resolveApprovalPath` (core), so the decision and the toast after it agree: "Approved.
    Committing your edits and running the checks.", "Approved. Pushing your edits. The pull request merges once CI
    passes.", and without edits "Approved. Opening the pull request.", "Approved. Pushing the changes." (a pull
    request is open) or "Merging." (`resolveApprovalReply` in `apps/web/src/lib/tasks/gates.ts`).
  - A commit of your edits made while a merge is in progress in the checkout (a hand-over that was undone put it
    back) concludes the merge, so it carries git's own merge message, not `fix: apply the edits made in the Code
    tab`: `commitWorktree` builds every commit that concludes a merge that way (The pull request watch → Conflicts).
  - A real fix turn (any `fix.started` past round 0, or yours) drops the approval; a retry keeps it.
- **What the Code tab reads in GitButler.** One working directory holds every applied branch, so the working copy of a
  GitButler task is assembled (`http/code.ts`, the `owned` ref): the files the task owns in the ledger, which include
  every edit you made in the Code tab (`adoptPath`), are read from disk, and every other file from the task's branch.
  A reload shows your edit, and another task's or your own uncommitted work never shows as this task's. The refs say
  `working: true` and `dirty` when it owns any uncommitted file; paths, folders, files, images, search and the diff
  (the branch's commits against its base, with each owned file's working-copy diff in its place) all follow it. An
  agent's edits join it once its run's claim ends and the ledger records them.

### Other work in the repository

Tasks of one repository run side by side, so an agent can see the other work there and is told when it touches the
same files:

- **`list_repository_work`** (every step agent: the Agent, the reviewer, the answerer, the investigator and the
  researcher; not a delegated agent). The reviewer keeps it on purpose: it judges whether the change collides with
  another task's work in the same files, and reading that is not acting on it. It lists the other open tasks (not settled) of the task's repository, most
  recently active first: each as a `shinsa://` link with its handle, its stage, its branch, what its branch is stacked
  on (another task's GitButler branch, `stackedOn`, from either side, and a round stacked on the task's own open pull
  request, `resolveRoundBase`), whether an agent works on it now (an active run) and the files it changed, marking
  those this task changes too (`serializeRepositoryWork`, `chat/repository-work.ts`). The server reads the files
  with git (`git/changed-files.ts`): the branch's commits since its base (the default branch, or the branch it is
  stacked on), plus what its checkout has not committed (worktrees and the main checkout) or what the GitButler
  ledger says it owns (GitButler, where one working directory holds every branch). A file list git cannot read
  shows as not known. The tool text is static, so the tool list stays the same for every turn of a session.
- **Overlaps are facts in the log.** Before a commit hand-over (`complete_phase`, `complete_fix`) dispatches, and
  before `propose_plan` dispatches (adding the files the plan names to the planning task's own), the server compares
  the files of every open task of the repository (`RepositoryWork.recordOverlaps`) and sends `task.record_overlaps`
  for each task that shares a file with another, under `overlaps:<task>:<hash of the overlaps>`. Core keeps each
  file once per other task (`Task.overlaps`, `task.overlapped` for the new ones only), so a repeat or a file already
  known records nothing. A commit by one task records the overlap for both tasks. The command names the task whose
  hand-over compared the files (`from`).
- **The agent is told once, as soon as it can be.** The note names each other task and the files not told yet
  (`describeOverlaps`: "Another open task changed files this task also changes: SW-12 “Fix login” (`src/auth.ts`).
  Keep your changes to those files to what this task needs, and call `list_repository_work` …"), and
  `task.overlaps_told` marks them told. When the task's Agent is at work (any purpose) and the overlap came from
  another task's hand-over, it is steered with the note at once (`run.steer` with `from: 'shinsa'`, so it reads as
  Shinsa's note, not as your message). Otherwise the next `agent` run of the task gets it at the end of its prompt,
  next to your edits (`Decider.startRun` → `tellOverlaps`): the task whose own hand-over found the overlap is about to
  end its turn, so it hears on its next one. The reviewer and the inquiry agents are never told, so the note waits for
  the Agent. A task that settled before the turn is left out. A steer is a user message appended to the
  conversation and a prompt's note sits at its tail, never in the house rules or a tool description, so the session's
  prompt-cache prefix does not change (`test/e2e/prompt-cache.test.ts` steers an Agent mid-turn and checks it). Limit:
  the files an agent edits during a turn count only once its hand-over commits them.

## Rounds

One task fits both ways of working: a huge chat that grows one goal until it is right ("MCP v2" over weeks, new ideas
added as they come) and one task per small thing. A task is the conversation; a **round** is one unit of work inside it,
with its own steps composed by its Agent from the step schema exactly as for any task. A small task is a task with one
round. The rules live in `packages/core/src/decide/rounds.ts` (decisions), `domain/rounds.ts` (the record and the
predicates) and `state/rounds.ts` (the folds); the classifier is `apps/engine/src/triage/message.ts`.

- **Round 1 is the task's request.** `task.created` folds into round 1, so every task has one. The task's own fields (plan, phases, report, checks,
  findings, fix budget, result, proposal, pull request) are the current round's.
- **How a new round is decided.** The classifier decides, not the agent, for every message, the task resting or not,
  except where you decide (below): one quick call on the classifier model reads your message against the task's rounds (each with its kind of work, its
  status and what it did: the result, the report's headline or the plan's goal) and whether a round is in progress, and
  answers `acknowledge`, `feedback`, `new_round` or `separate_task`. Most messages are no new work: thanks, "ok" or
  small talk is `acknowledge`, and a question about what a round did is `feedback`; only a message that asks for
  something to be done that has not been done is a new round (on a resting task a correction to finished work is one).
  You override it by saying what the message is (`shinsa tasks message --as new_round`, an agent's `tasks_message`
  with `as`), which skips the classifier. A new round sent that way without a `shape`, and a suggestion kept as the
  next round (`suggestion.keep` without one), still gets its kind of task: the server asks the classifier the same
  shape question (`resolveRoundShape` in `triage/message.ts`, the task's rounds as context) before it dispatches, and
  the answer travels on the command like a classified message's, so replay never asks again. Only when the model is
  off or gives no usable answer does the round fall back to `change`.
- **Where you decide, a message is always the gate's reply.** At a plan gate, a review gate, an agent's question, your
  OK, an operation gate, a failure, Sign in or setup gate, and while planning with no agent running, the composer's
  words say what sending does (What a message does, below), and that is what it does: the classifier is not asked
  (`needsMessageKind` is false, so neither `MessageInbox` nor an agent's `tasks_message` calls it), and core reads the
  message as `feedback` whatever kind it carries (`FEEDBACK_ONLY_EFFECTS` in `decide/messages.ts`: a kind classified
  earlier, `--as` or `as`). So a message at the plan gate, "I agree, and then group the projects too", revises the
  plan with all of it, the new scope included; it never queues a round, is never only noted and never becomes a
  split-off, and it never approves the plan, which stays the gate's own approve. The merge gate is not one of them: a
  round queued there starts at once (One active round, below), so the classifier still tells a change before the
  merge from the next piece of work, and "thanks" from either.
- **A message that needs no new work stays in its round.** `acknowledge` is recorded in the chat (`task.messaged`,
  "Sent a message") and nothing else happens: no run, no round, wherever the task is but where you decide (above). A pure acknowledgement starts no agent on purpose: a reply would resume a session that has gone cold
  since the round ended, at the cost of reading its whole context again, to say "you're welcome"; the next agent of
  the round reads it among your messages anyway. `feedback` to a resting task is a follow-up in the same round
  (`follow_up`): a finished answer, investigation or report goes to the same agent as before; any other finished round
  (a merged change, an operation that ran) gets an answerer that resumes the task's session (the reviewer's
  excepted; `answerFollowUp`, `resolveFollowUpPrompt`, `Decider.taskSession`), runs in the repository like any answerer and answers with
  `answer`, proposing no change (`follow_up_proposal`). The round reopens while it answers (stage `answering`,
  `isFollowUpOnWork`) and rests again as it was, merged or done, with its result untouched. A message on a resting task
  with no kind (the model off or failed) is such a follow-up, never a new round; only a schedule's message to a
  resting task still starts the next round.
- **A new round is shaped like a new task.** The same call answers, for new work, the kind of work from triage's shape
  question (`SHAPE_QUESTION`), read as the request of a new task with the earlier rounds as its context, and the round
  takes that preset's steps: "how many ended up in Archive?" is an answer round, "open a pull request for it" a change,
  "move the old checkout under Archive instead" an operation. Only a round with no shape (`--as new_round` with none, or a
  suggested task kept as the next round) starts as a change, which its Agent may reshape. A round whose kind needs
  code on a task with no repository binds one as it starts (A task without a repository, above).
- **Accepted at once, routed after.** A message you write is accepted before anything is classified
  (`routeUserCommand` on the socket and `POST /api/commands`): it becomes `message.receive`, which core checks and keeps
  in the task's `inbox`, and the acknowledgement and the state push carry it straight away. `MessageInbox`
  (`triage/inbox.ts`) then routes each task's inbox, one task at a time and in the order sent: it takes everything
  waiting in the inbox, asks the classifier once about all of it (the texts joined by a blank line; not at all where
  you decide, above), read against the task as it is at that moment, and routes it as one (`message.route` with `messageIds`, command id
  `message.route:<ids>`). Messages that arrive while the classifier reads wait for the next pass, which reads the task
  as the first pass left it: a message sent while the follow-up it started is running steers that agent rather than
  being read as a message to a resting task. The classifier's answer is a typed decision (`choice` of `acknowledge`,
  `feedback`, `new_round` or `separate_task`,
  each with what it means where the task is), plus a why (asked first), a title and, for new work, the kind of work (the
  six shapes); it travels on `message.route` and is recorded with it, so replay never asks the model. `feedback` keeps
  the behaviour of What a message does (below): it steers, revises, sends back, fixes or follows up. `acknowledge` is
  only recorded. `new_round` queues the next round. `separate_task` becomes a split-off suggestion (below). When the
  model is off, fails or does not answer within 30 s (`CLASSIFY_TIMEOUT_MS`), the messages are feedback. Messages the
  task can no longer take by the time they are routed (it was closed meanwhile) are dropped with core's reason
  (`message.drop`), and a route that breaks for any other reason is dropped too ("Shinsa could not deliver it. Send
  it again."), so a message never waits in an inbox for ever. Messages still in an inbox at shutdown are routed on
  the next start. An agent's
  `tasks_message` without `as` is classified before it is dispatched, since the agent waits for the result. The
  receipt is taken over the command as you sent it, so the same command id resent after a reconnect is answered from
  its receipt and never accepted twice.
- **The same message twice is taken once.** A message whose text (trimmed) matches one still waiting in the task's
  inbox, or the request of a round still waiting to start, and that arrived within 10 minutes of it
  (`MESSAGE_REPEAT_WINDOW_MS`), changes nothing (`isRepeatedMessage`, in both `message.receive` and `task.message`):
  sending again because the first showed no sign of going makes no second round and no second revision. The window
  is counted from when the first was received or queued; after it, or once the first has been delivered, the same
  text is a new message.
- **Queued messages.** Several messages in a row reach the task in order, never lost and never stuck:
  - **Routed together, delivered as one.** Messages routed in one pass are one delivery: one steer, one follow-up, one
    fix or one new round whose request is their texts in order, so a burst of short messages is one turn of the agent,
    not one turn each. The chat still shows each as its own bubble (one `task.messaged` each).
  - **While an agent turn runs**, a delivered message steers it (`run.steer`): Claude folds it into the running turn
    and Codex sends it with `turn/steer`. When the turn can no longer take it (it is ending, or the provider cannot
    steer), it is the agent's next turn (`message.deliver`), and a steer the agent never answered comes back in
    `undelivered` and is delivered as the next turn after `run.end` (Steering by prompt id, below). Messages sent
    while the run waits to start are held and steered in once its session exists.
  - **After the agent is idle**, a message starts the next turn at once: a follow-up on a resting task, a fix, a
    revised plan or a new round, as What a message does (below) says.
  - **What waits and what does not.** Only new work waits: a message routed as `new_round` while a round is in
    flight becomes a round with status `waiting` (`round.queued`) and starts only when the current round rests or
    reaches the merge gate (below). Everything else is delivered when it is routed: it steers the running turn,
    starts a fix, revises the plan, wakes a step waiting for its delegations, answers or supersedes a gate, or
    follows up a resting task. A message at an open gate is never held for the gate: the gate's own reply starts
    the next step at once. The only waits after routing that the log does not record are the provider's: a steer
    the session cannot take any more (closing, or the stop window) goes as the next turn after `run.end`, seconds
    later, and a message sent while the run waits to start is steered in once its session exists.
  - **Every message ends in a state you can see** (`docs/design.md`, 9): delivering (no line, a light around the
    bubble) from the moment it is sent while it is in the outbox and the task's `inbox`, and for a round that
    started from the queue until the round's first run starts; queued, above the composer, while its round
    waits; then delivered (no line), noted as needing no reply (`acknowledge`, the activity entry's `noted`), or
    not delivered with the reason (the drop's activity entry keeps the text and the reason as `undelivered`).
  - **A queued round can change before it starts.** `round.update` replaces a waiting round's request (its title
    becomes the request's first line; its kind of work and how it ships stay) and `round.remove` takes it out of
    the queue, the waiting rounds after it moving up one number (`round.updated`, `round.removed`, activity
    "Changed queued round 3: …" and "Removed queued round 3: …"). A round that started is refused
    (`round_started`: send a message instead), as is a closed task. Both are on the surface (`shinsa rounds update`,
    `rounds remove`; yours alone, so no agent has a tool for them) and done on your behalf like `round.ship`.
- **One active round, and when the next one starts.** A new round waits (`round.queued`, round status `waiting`, at
  most five waiting) and
  starts by itself once the current round rests (`startQueuedRounds`, after every command, like `releaseWaiting`):
  - the round finished on its own: its pull request merged, or its inquiry or operation ended (the task rests);
  - or the round's pull request is clean and waiting at the merge gate, for a next round that ships through a pull
    request. Starting it withdraws the merge gate; the earlier round is archived as `shipped` with its pull request
    open, and the merge gate comes back when the new round reaches it.

  Everything in between (planning, building, checks, reviews, your review, fixes, CI) is mid-flight, and the new round
  waits. This is the clean rule because the merge gate is the first point where the round's work is finished, verified
  and pushed: nothing of it is in a worktree only, nothing waits on an agent, and the only decision left is yours to
  merge, which a later round can extend. A round that ships no pull request (an answer, research, an investigation or
  an operation) waits for rest instead, so an open pull request is never left without its merge gate. The Agent of a
  later round cannot drop the pull request step while one is open, nor compose `your_ok` then (`pull_request_open`).
  When an earlier round's pull request merges outside Shinsa while a later round works on top of it
  (`round.pull_request_merged`), that round is marked merged and the round in flight goes on to its own pull request
  from the default branch.
- **The same branch, worktree and sessions.** A round started onto the open pull request keeps the task's branch,
  worktree and pull request; a stacked one gets a new branch on the same worktree; one after a merge gets a fresh
  worktree from the freshly fetched default branch on a new branch (`<first branch>-round-<n>`; `worktree.create`
  never resets a later round's worktree to the default branch, it only drops uncommitted scratch edits). The agents
  remember everything: every run of a later round, whatever its kind of work, resumes the task's session
  (`Decider.taskSession`, Agents above), so the round that plans next has the earlier rounds in its context; the
  reviewer resumes only its own session, so it never reviews from inside the Agent's head. A round after a merge runs
  in a new worktree; its first turn says so (`resolveMovedNote`, The agent loop → Caching). Each prompt says which round it is, lists the
  earlier rounds with their pull requests, says how this one ships, and gives the round's request as the human's
  request (`describeRounds`, `resolveRequest`); the reviewer reviews only this round's commits, the ones made since the
  round started (`git log --since`).
- **How a round ships.** Onto the task's open pull request (`onto_pull_request`, the default): its commits go to the
  same branch, the pull request grows, and one merge ships every round on it. Or stacked (`stacked`): its own branch on
  top of the open one, its own pull request with that branch as the base, and the merge gate of the top round merges
  the stack top down (the top into its base, then each one below, the last into the default branch; each is read first
  and only one not merged and not queued is merged, so a retry is safe), and every round on the stack is merged: after
  the merge each stacked pull request is read again, and one that is still open fails the merge while one in GitHub's
  merge queue counts as waiting. You switch it per round
  (`round.ship`, the round's header in the chat, the Overview's Rounds panel, ⌘K) while it waits and, once it started,
  until it goes to its pull request (`canChangeRoundShipping`); switching an active round only changes where it pushes,
  since every round commits on top of the last. After a merge nothing is open, so the next round starts from fresh
  main on a new branch; with a stacked pull request still open (one merged on GitHub outside Shinsa), it continues on
  the stack. When the round below merges outside Shinsa, the round above's base resolves to the default branch and
  the watch retargets its pull request; a conflict that leaves is fixed like any other (The pull request watch →
  Conflicts).
- **Splitting off.** When an idea does not belong in the task, it is suggested as a separate task through the existing
  suggested tasks: the classifier's `separate_task` records one (`splitOff`, from Shinsa), and a working agent can
  mark its own `suggest_tasks` entry `split_off`. You make it a task (`suggestion.accept`) or decline and keep it in the
  chat (`suggestion.keep`, with an optional `shape`), which queues it as the next round of that kind (asked of the
  classifier when it is left out, above).
- **When a task is done.** After a merge the task stays open: it rests, with no run, gate or worktree, and its chat
  takes the next round. You mark it done (`task.complete`, which closes it: `closedAt`), or an agent does when the work
  is complete and nothing is open. Core refuses `task.complete` while an earlier round's pull request is still open
  (`task_open`), and one sent on your behalf also while a round waits, the task's pull request is open (`task_open`)
  or any gate is open (`human_only`: Who can change Shinsa, below). A closed task takes no message.
- **Long sessions.** A round resumes the same provider sessions, and Shinsa's eunoe keys its thread on the session id
  and its first turn, so the folds a session built in earlier rounds carry over into later ones and every compaction
  is a notice in the run's chat. The session id lives in the log, so a restart between or inside rounds resumes the same
  session (`test/e2e/rounds-session.test.ts`: eight rounds, folds every turn, a restart in the middle).
- **Steps belong to their round.** Runs, gates, evidence and activity entries carry the round they were made in
  (`round`, from round 2; `docs/protocol.md` → Rounds), a delegated run its parent's round and account, and the
  evidence a plan asks for counts only when it was attached in the plan's round.

## Task shapes

Not every request is a pull request. A debug question, a support question or a comparison needs an answer, a report or
a diagnosis, and maybe a change later. The rules are core (`packages/core/src/domain/shapes.ts`, `decide/shapes.ts`, the
folds in `state/shapes.ts`).

- **Steps are building blocks, never free-form.** A task's `pipeline` is an ordered subset of fixed steps: `answer`,
  `research`, `investigate`, `your_ok`, `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`,
  `pre_merge`, `merge`, `post_merge`, in that order, and `operate`, which goes right after `plan` (an operation on
  its own, or before a code change) or after `merge` (an operation on the merged code: a backfill, a migration, a
  cleanup), before only `post_merge`. `pre_merge` and `post_merge` are your steps around the merge: Shinsa adds
  them when the work report lists steps for you before or after the merge, and no agent composes them (Steps around
  the merge, below). The liveness rule, the gates and the invariants all key on these steps, so no agent can invent
  one; any valid composition of them is a kind of task.
- **Guards** (`validatePipeline`, generated from each step's `needs` in the step schema, Steps and gates below; checked
  on every shape change, which throws `pipeline_invalid` otherwise). Core keeps the safety rules: code goes through your
  review before a pull request (`build` needs `your_review`, `pull_request` and `merge` after it, in that order), a merge
  needs a pull request, and an inquiry turns into work only with your OK (the rules checker, below). The rest keeps a
  composition meaningful: at most one of answer, research and investigate; `build` and `operate` need `plan` before
  them, and `plan` needs one of them; checks, reviews, pull requests and merges need `build`; an operation never sits
  inside a change ("An operation runs right after the plan, or after the merge, before your steps after it.");
  `pre_merge` needs the pull request before it and the merge after it, and `post_merge` the merge before it; `your_ok` sits after an
  answer, research or an investigation and before a plan. On top of the guards, the verification rules (Steps and gates)
  make `checks` and `agent_review` part of every code change: a composition without them is refused. A task may both
  build and operate.
- **A change and an operation together.** `resolveOperationTiming` says where the operation runs: `alone`,
  `before_build` or `post_merge`. The plan gate always opens when a task operates, so you approve the operation with
  the plan, and the plan states the operation's `impact` (what it changes and how much, its dry run or why there is
  none, how to undo it). With both, the plan's phases are the code change only and the operation is the plan's
  `operation` list (steps in order, each with how to check it worked; `propose_plan` is refused with `plan_invalid`
  without it). Before
  the build, the Agent runs it right after the plan, in the same session, and then builds the phases from the state it
  left. After the merge, the Agent is told not to run it while it builds, and when the pull request merges the task does not settle: Shinsa stops the pull request
  work (`finishMerge`), withdraws any gate and asks you again (`awaiting_operation`, the operation gate: "The change
  merged. Run the operation now?", with the merged commit, the operation's steps and its impact), because the code
  that merged can differ from the code you approved the plan for. Run it, and the Agent resumes its session on the merged code
  in the task's worktree with the gate's notes as its guidance; finish without it, and the task is done ("merged without
  running the operation"). The notes live only on the gate (`Gate.notes`): a message while the gate is open replaces
  them in place (`gate.noted`, the same gate, so nothing notifies you again; an empty message clears them) and nothing
  runs until you choose. `approve` runs with the notes on the gate; `reply` replaces them with its words (empty clears
  them) and runs. A retry leaves the gate for you. The
  Agent's `report_outcome` finishes the task as done ("the operation finished"); a retry or a message while it runs
  restarts the operation, never the merge, and a pull request read that arrives after the merge changes nothing. An
  operation that runs before any code ships keeps "approve with the plan": nothing has changed since you read it.
- **Shapes are the named pipelines** (`SHAPE_PIPELINES`): **answer** `[answer]` (the answerer reads the repository itself, no
  worktree, or no repository at all); **investigate** `[investigate]` (an investigator in a scratch worktree reproduces the problem and reports its
  diagnosis with `report_diagnosis`); **research** `[research]` (a read-only researcher writes a report with `submit_report`); **change**
  (plan to merge, as above); **fix** `[investigate, …change]` (investigate first, then the worktree is reset onto the default
  branch, so nothing the investigator tried ships, and the Agent plans the fix from the diagnosis without asking again);
  **operation** `[plan, operate]` (something to run in the repository, a script, a migration or a cleanup: the plan always
  waits for you, then the Agent that planned it runs it in the same session and reports with `report_outcome`; no
  pull request). `resolveTaskShape` names a
  pipeline back (an answer that became a change reads as a change).
- **Who chooses.** Shinsa. The classifier picks one of the six presets from the request (`task.triage` `shape`, a
  typed choice with what each means) as the starting point; nothing lets you change the kind afterwards (the
  Overview's facts, the roadmap row and the activity show it; neither the composer nor ⌘K asks for it). `task.create`
  takes no `shape`: only triage and the Agent, while it plans, shape a task. The Agent of a task Shinsa
  shaped then keeps that preset (it plans) or replaces it with `reshape_task` before planning: `shape` makes it an
  answer, an investigation or research, and `steps` composes the task from the building blocks (`agent.reshape` with
  `steps`). Never a kind you chose (`shape_chosen`), never once a plan exists (`plan_exists`), and only once per task:
  after an agent set the steps, the Agent plans them (`steps_set`, and its prompt drops the composition note).
- **The rules checker** (`validateComposition`, core) judges every composition: the guards above, plus two rules about the
  task as it stands. An answer, research or investigation that leads to a plan needs `your_ok` between them, unless it
  already ran ("An investigation turns into a change or an operation only with the human's OK: put `your_ok` between
  `investigate` and `plan`."), and an inquiry that already ran stays in the steps. A composition that breaks a rule throws
  `pipeline_invalid` with every problem in one message; the server returns it to the Agent as the tool's error, its run
  carries on and it can try again. Steps the task already has change nothing, and the tool tells the Agent to plan them.
  Otherwise the planning run ends, `task.reshaped` records the steps (`by: agent`, its reason), and the first new step
  starts: when the work step changed (a change became an operation, or the other way), the setup is verified again
  first, so a change gets its checks verified and the Agent plans again, on the same session, with the right prompt.
- **Your OK** (`your_ok`) owns the proposal gate (gate type `proposal`, stage `awaiting_proposal`); an inquiry step has
  no gate of its own, and there is one path to it. The inquiry agent's prompt says the human decides whether the task
  goes on and asks it to end with what the next step should do. When it hands over, Shinsa records a proposal (the agent's own `propose_change`, or the Agent's reason and what comes next: "Plan the
  operation. You approve the plan before anything runs.") and opens the proposal gate ("Run an operation from this
  diagnosis?", or "Turn this investigation into a fix?" before a change). Approving records `task.change_approved` (the
  proposal is accepted), verifies the setup again and goes on to the plan on the reset worktree, with the result and what
  you approved in the Agent's planning prompt. Your veto (reject) declines the proposal, reshapes the task to just its inquiry
  (`by: you`, "kept as an investigation") and finishes it, so it takes follow-ups like any investigation. A message
  instead declines the proposal (`decline_proposal`) and resumes the inquiry agent with it; its next hand-over asks
  again.
- **Changing shape mid-task.** An answerer, investigator or researcher can end with `propose_change` (`request` at most 2,000
  characters, `why` at most 240). On a task without `your_ok` whose pipeline does not already go on to a plan (a fix
  does), the agent's proposal reshapes the task to `[inquiry, your_ok, plan, build, checks, agent_review, your_review,
  pull_request, merge]` (`resolveProposalUpgrade`, `task.reshaped` by the agent with its why) and it waits at `your_ok`
  exactly as above ("Turn this investigation into a fix?"). Any step that would add `build` or `operate` to a task that
  had neither only happens through that gate. The Agent only
  composes a task that already plans work, so its composition can swap a change for an operation (whose plan always waits
  for you), add an operation before or after the change, or the other way (whose code always waits at your review), never
  turn an inquiry into either.
- **Every change is an event.** `task.reshaped` (`pipeline`, `by`: you (from your veto at your OK), agent or Shinsa,
  `reason`) keeps the last 20 in
  `shapeChanges` and writes an activity entry ("Turned into a find-and-fix change", "Made it an investigation", "Turned
  into an investigation, then an operation", "Turned into a change, then an operation" for a composition); `task.change_proposed`, `task.change_approved` (your OK in
  composed steps) and `task.change_declined` record the proposal; `task.delivered` keeps the answer, diagnosis, report or
  outcome on `task.result`.
- **Follow-ups.** A finished answer, investigation or research takes a message as a follow-up on the same session
  (`acceptsFollowUp`); a finished operation or a merged change takes one through an answerer that resumes the task's
  session (Rounds, above).
- **Before triage** a task whose kind Shinsa picks has no `pipeline` yet: an Ask task (`mode: 'ask'`) reads as an
  answer and every other one as a change (`resolveTaskPipeline`).
- **Progress** (`resolveTaskProgress`) draws the pipeline: Find the repository (when it does not start with a plan, and the
  task has a repository or its steps need one), each step,
  the plan's phases, and Your OK to change (Your OK to run before an operation) for a `your_ok` step or while the proposal
  gate is open; the step is done once the proposal is accepted. The steps follow the pipeline's order, so an operation after
  the merge comes after Merge; Pre-merge and Post-merge show how many of their steps are done and wait on
  you while one is open (Pre-merge while the merge gate is open, Post-merge once the round rests); Checks and agent review is named for what the task keeps (Checks, Agent review), and a fix
  in a change without either shows Build as current.
  Until the steps are settled nothing draws them: `resolveShapeState` (`domain/shapes.ts`) is `triage` while an Auto
  task has no pipeline yet, `agent` while the Agent of a task Shinsa shaped can still reshape it (planning or
  waiting, no plan, no composition, a pipeline that starts with a plan), and `settled` otherwise, so the web shows
  "Working out the steps" instead of a guessed plan-to-merge strip.

### Automatic options

The kind of task is always decided for you; when it starts and its priority are decided for you unless you pick
them in the composer.

- `task.create` records which were left to Shinsa (`auto: { shape, start, priority }`): the kind is Auto unless `mode` was
  given, a field you leave out is Auto, and an explicit `waitsOn: []` is Start now. Schedules and accepted suggested tasks
  keep their own choices; a split plan's tasks are changes; a courier's task is Auto.
- Triage answers each Auto part as a typed decision question with a short why: `shape`, `priority` (urgent, high, normal or
  low) and `waits_on` (the open tasks of the task's project, in any repository, listed with their repository and
  stage; a task with no project is offered every open task, and keeps only those in its repository or in none, a
  dropped one with no why). Core applies only the Auto parts
  (`task.triaged` `pipeline`, `task.prioritized`, `task.waits_on_changed` by Shinsa) and keeps the decisions with their why on
  `task.triageDecisions`, so each fact can say why (the kind, the priority and when it starts, in their tooltips on the
  Overview: "Shinsa chose this: …"). The start and the priority each
  change in one command (`task.wait_on`, `task.prioritize`); a part you changed is yours, not Auto, from then on; the
  kind does not change after triage except through the Agent while it plans and your OK. Without a
  model (off, failed or unreadable) the task stays a change at its priority, starting now, and the why says so.

## Steps and gates

The steps and gates are a typed schema in core, not a list of names: `packages/core/src/domain/steps.ts` defines every
step kind and every gate, and `packages/core/src/domain/verification.ts` is the rule set that makes verification
strict. A task's pipeline is a list of instances of that schema; the guards, the verification rules, the stage strip,
the invariants and the Agent's planning prompt and tool schemas are all read from it, so a step or a rule lives in one place.

Each step kind declares its class (inquiry, consent, planning, code, operation, verification, review, shipping), who
does it, what it reads and must hand over, when it is done, its gate (`hard` needs you, `soft` is an automatic check,
`none` hands straight on), where it may sit and what it needs before or after it. Each hard gate declares the decisions
it takes and what each does, the refusal for any other decision and whether it pauses the task; each soft gate its
pass, fail and escalate outcomes and the hard gate it escalates to (`escalatesTo`: checks and CI to a failure gate, the
agent review to your review). A gate stores one `type` (`GateType`; a soft gate is a `SoftGateType`). `gate.answer`
reads the allowed decisions and the refusal from the schema (`resolveGateDefinition(gate)`, `GATE_SCHEMA[gate.type]`)
and `isPausingGate` reads `pauses`, so a gate's behaviour cannot drift from its definition. The plan gate's rule is
data too (`PLAN_GATE_RULE`): `describePlanGateRule()` writes the plan step's `when` from it and `needsPlanApproval`
evaluates it.
The tables (`STEP_SCHEMA`, `GATE_SCHEMA`, the `Gate` record) are `docs/protocol.md` → Steps and gates.

### Verification

`VERIFICATION_RULES` is David's workflow written as rules over the schema (`docs/protocol.md` → Verification). A rule
applies exactly when the composition contains work of its class, so a question, research or an investigation that
changes nothing never meets one, and a change always meets all of them. So a code change always runs: a verification
plan in its plan → the build, with the evidence the plan asks for → Shinsa's checks (the repository's and the plan's)
→ an independent agent review → your review → the pull request → CI and bots → your merge. An operation runs only from
a plan you approved that states its `impact` (and its steps in `operation` when it comes with code), and one after the
merge asks you again on the merged commit. A plan may ask for `evidence` for an operation as for a change; an
operation without a code change must attach it before `report_outcome` (`operation.evidence`), while `checks` stay for
code changes. `validateComposition` adds `validateVerification` to the guards for every composition, `proposePlan`
refuses a plan with `validatePlanRules`, and `completePhase` refuses the last phase, and `report_outcome` an operation
on its own, while `listMissingEvidence` names a kind (`evidence_missing`). The invariants that hold the shapes and the rules are `packages/core/CLAUDE.md`.

### How the Agent composes

While it plans, the Agent cannot invent a step or a gate. It composes steps with `reshape_task` (`steps`, an enum of
`PIPELINE_ORDER` described from `STEP_SCHEMA`) and sets the plan's parameters in `propose_plan` (`verification`,
`evidence`, `checks`, `impact`, `operation`, `approval`; `docs/protocol.md` → Composing). A change you see in the UI
always asks for a screenshot, and `approval` is the Agent's way to put your OK before a risky change. A composition
that breaks a rule throws `pipeline_invalid`, a plan `plan_invalid`, each naming every problem in one message; the
server returns it as the tool's error and the planning run carries on and tries again. The only hard gates an agent
can add are your OK (`your_ok`, after an inquiry) and plan approval (`approval`); gate semantics are core's and cannot
be changed from a plan.

## Scheduling

Shinsa is a roadmap: everything you ask for is worked on as soon as it can be, and only the order
in which finished work reaches you is managed.

- **No dependency, no waiting.** A new task is classified, gets its worktree and starts planning
  at once, on its own agent, then builds, checks and lands at your review gate. How many
  decisions are already waiting does not matter, and neither does how many agents are already
  running: there is no cap. A run is created `queued` and `dispatchRuns` starts it in the same
  command, so `queued` only lasts until the end of that command (or across a restart, until the
  boot dispatch). An agent may start as many of its provider's own subagents as it needs; Shinsa's
  delegations nest at most three deep and run without a limit unless you set one (Delegation → Limits, below).
- **No agent limit.** Work you asked for never waits for a slot: there is no cap, hidden or behind an environment
  switch, and a stored `maxConcurrentRuns` is ignored. If a machine ever needs one, it belongs in `dispatchRuns` and
  nowhere else.
- **Waiting before the first agent.** The only way a task waits before its first agent is a task it waits on:
  `listWaitsOn` (core) returns the unfinished tasks it waits on, and the task shows in Waiting on
  another task in Home's queue, the sidebar and All tasks.
- **Priority decides what reaches you first, not what runs.** Low priority work is built just
  the same; its decisions sort below every higher one in Needs you (`resolveQueue`: priority,
  then what it unblocks, then ready to merge, changes to review, plan to approve, a question (your
  OK, an operation and a secret rank as questions), paused (a failure, a setup to fix, a sign-in),
  then the oldest first), and the guide never leads with a low priority decision while anything else waits
  (`parseBriefing` drops such an answer; low ones go to the end of next).
- **No hold.** New work is never parked while decisions pile up: holding the compute only delays work you asked
  for, and priority already keeps finished work out of your way.

### Dependencies

A task can wait on other tasks (`task.waitsOn`, a list). They come from three places: the
classifier (`waits_on`, only when the request needs that work to exist first, and only when you
left When to start on Auto), you when creating the task (the composer's When to start: "After ‹task›"), or
later (the Waits on menu on the task page, the task's `•••` and context menus, All tasks' chain
arrow, ⌘K's Wait for another task… and Stop waiting, all `task.wait_on` with the whole new list, recorded as
`task.waits_on_changed`).

- **Waiting.** A task with an unfinished dependency sits in stage `waiting_on_tasks` ("waiting for ‹A›,
  ‹B› to finish", kept current as each one finishes) with no worktree and no agent. Nothing runs
  on it, so it costs nothing. Its liveness is Shinsa itself, not a stuck agent.
- **Several parents.** A task can wait on any number of tasks; it starts only when every one of
  them is merged or marked done.
- **Fan-out.** Any number of tasks can wait on the same task. When it merges they all start at
  once, each on its own agent, and its decision ranks higher in Needs you for every task it
  unblocks.
- **Release.** When every task it waits on is merged or marked done, the task starts by itself
  (`releaseWaiting`, after every command): `worktree.create` makes its branch from the freshly
  fetched default branch, which now holds every parent's work, and planning starts. A worktree
  left from before (a task that was planning when it was told to wait) is reset onto the updated
  default branch first; it never has commits of its own at that point. Its prompts name the tasks
  it built on and say they have merged (`describeBases`).
- **Chains and diamonds.** MCP v2 → embedded chat → paywall editing in the chat: each link waits for
  the one before it, so they start one after another as each merges. A diamond (B and C wait on
  A, D waits on B and C) starts B and C together when A merges, and D only after both. Cycles
  are refused (`task.wait_on` throws "‹task› already waits on this task."; a new task cannot close one).
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
  is still planning cancels the planning run and puts it back to waiting (it plans again after the
  release). Once building has started, a new dependency only holds the merge gate until every
  task it waits on merges: the work is not thrown away.
- **No stacking across tasks**, with one exception. A dependent waits for its parents to finish instead of branching
  off an unmerged branch; only a task's own rounds stack (Rounds, above), and a GitButler task whose commit touches
  lines another task's branch changed, which GitButler stacks on that branch and Shinsa makes wait on that task
  (Where agents work → Stacking on conflict).

## Gates

Every gate stores one `type` (`GateType`). `plan`, `review` and `merge` are your decisions (`isDecisionGate`).
`question` is an agent waiting for an answer and `secret` an agent waiting for a secret (`request_secret`); both are an
agent's question to you (`isAgentQuestion`). `proposal` is your OK on what an inquiry proposes next (Task shapes,
above), and `operation` an operation after the merge waiting for your OK on the merged commit. `failure` means the
engine ran out of automatic recovery, an agent's wait ran out of time or check-ins (`cause: monitor`), the task
reached its usage or cost limit (`cause: budget`), or a GitButler task's pull request conflicts with its base and only
updating the workspace can bring it in (`cause: workspace_update`; its approve is Update the workspace, which runs
`but pull`, and its `reply` does the same with your words for the agent; Where agents work → GitButler, above). `configuration` means setup verification found something missing
before any agent started. `sign_in` means a provider needs signing in again: the gate names the provider
(`Gate.provider`, `claude` for a Claude account) and, for Claude, the account (Accounts and usage limits, below).
The plan gate opens by one rule, `PLAN_GATE_RULE`: always for a task that runs an operation, a task created plan
first or a plan that asks for `approval`; with Approve plans on, also for a large task or a revised plan. Nothing else
waits on you. A failure, configuration or Sign in gate pauses the task (`isPausingGate`).

Every gate is yours: only you close it. Core refuses a `gate.answer` sent on your behalf, and any command on your
behalf after which an open gate is no longer open, with `human_only` (Who can change Shinsa, below).

Each gate takes only the answers that mean something for it (`gate.answer` refuses the rest):
a plan, review or merge takes approve, revise (ask for changes) or reject; an agent's question takes `reply` with
words in it; a secret takes `reply` with a secret ref or reject; your OK takes approve or reject; an operation after the
merge takes approve (run it with the notes on the gate), `reply` (replace the notes with your words, empty clears
them, then run) or reject (finish without it); a failure or Sign in gate takes approve (retry), `reply` (retry with
your words as guidance) or reject, which cancels the task; the setup gate takes approve (verify the setup again),
`waive` (start without checks, only when checks are all that is missing) or reject. `reply` is the one decision that
takes words. The table of what each gate takes and does is `GATE_SCHEMA` (`docs/protocol.md` → Steps and gates). A
question belongs to the run that asked it: when that run ends for any reason the question is withdrawn and the
waiting tool call is released. A failure gate is withdrawn as soon as a new agent step starts or the pull request
turns clean, since the problem it reported no longer applies.

**What a message does.** A message you write on a task (`task.message`) never approves anything for you: at a gate it
does what that gate's own words-taking reply does, and it withdraws the gate where an agent then works. One function
decides it, `resolveMessageEffect` (`packages/core/src/decide/messages.ts`), and both `decide` and every composer's
hint read it (`resolveMessageHint`, `apps/web/src/lib/tasks/messages.ts`), so the words under the box always say what
sending does:

| Where the task is | Effect | What the message does |
| --- | --- | --- |
| an agent working, no gate | `steer` | reaches the running agent |
| a step waiting on its delegations | `wake` | is queued into the step's next wake |
| a failure or Sign in gate | `retry` | answers it with `reply`: the step retries with the message as guidance |
| a setup gate | `verify_setup` | verifies the setup again (`approve`); the message is kept for the first agent |
| an agent's question | `supersede_question` | withdraws the question; the agent gets the message instead |
| plan gate, or planning with no agent running | `revise_plan` | withdraws the plan gate; the Agent revises, on the session that planned |
| review gate | `request_changes` | withdraws the gate; the Agent's session works on it, then the review comes back |
| merge gate | `send_back` | withdraws the gate; the Agent's session works on it, then the merge comes back |
| checks, agent review, fixing, shipping | `fix` | resumes the Agent's session with it |
| your OK (the proposal gate) | `decline_proposal` | declines the proposal; the inquiry agent carries on with it |
| operation gate | `operation_notes` | replaces the gate's notes for the operation (`gate.noted`); nothing runs |
| a working stage with no agent | `restart_step` | starts the step again with it |
| triage or waiting on another task | `kept` | is kept for the first agent's brief |
| a resting task (a finished answer, investigation or report; a merged change; an operation that ran) | `follow_up` | a finished inquiry's agent answers it; any other round's last session is resumed by an answerer, in the same round (Rounds, above) |
| a closed task (marked done, cancelled) | `closed` | refused: "This task is finished." |

That is what feedback does, and at a failure, Sign in, setup, question, plan, review, your OK or operation gate, and
while planning with no agent running, it is all a message does, whatever the classifier would read it as (Rounds →
Where you decide, above). Elsewhere, a message the classifier reads as needing nothing (`acknowledge`) is only
recorded, and a message it reads as new work queues the next round,
and one it reads as work for another task becomes a split-off suggested task (Rounds, above). A message an agent sends
on your behalf, or a schedule sends, to a task with any open gate is not delivered into the gate: core records it
(`task.messaged`) and nothing else, the next agent's brief carries it (`resolveLaterMessages`: "Sent by an agent on
the human’s behalf: …", or "Sent by a schedule: …"), and the on-your-behalf record reads "Left a message for the next agent on “‹title›”, which
waits for you".

## Process and structure

Ported from Paperclip's execution semantics, adapted to one developer. Each behaviour lives in
`packages/core/src/decide/` (one file per concern: `agents.ts`, `fixes.ts`, `monitors.ts`,
`costs.ts`, `silence.ts`, `shapes.ts`, `suggestions.ts`, `config.ts`, `fingerprints.ts`), its
state folded by concern under `state/` (`waits.ts` for monitors and usage waits, `runs.ts` for
metering, silence and compaction, `suggestions.ts`, `reviews.ts`), and its server side in
`apps/engine/src` as noted.

### Plan versions

- Every `plan.proposed` bumps `plan.version`. A revision keeps the previous version in
  `planHistory` (the last ten), with the Agent's `change_summary` (`propose_plan`, at most 240
  characters), the feedback that asked for it and a computed list of changes
  (`resolvePlanChanges`: goal, approach, phases added, dropped, reworked or reordered, files).
- The plan gate carries `planVersion`. A revision withdraws the open plan gate and opens a new one
  for the new version. Approving sends the version you read: `gate.answer` with an older
  `planVersion`, or on a plan gate the revision withdrew, is refused with `plan_changed` and says
  which version to read. Approval and the check happen in the same command, so nothing slips in
  between.
- Approving records `plan.approved` (`approvedAt`), and your words with it `plan.answered` (`planAnswers`). The
  first phase's instruction says the plan was approved and carries your words; the round brief a fresh session gets
  names the approved version and says to follow it exactly.

### The review report

The review you read is a technical walkthrough of the change, and the question is who writes it. The agent that
built the change is the only one that knows why it is the way it is: which options it weighed, what it rejected and
where it is unsure. The reviewer must not see that reasoning, or it would judge the work from inside the head that
wrote it (Agents, above). So the work is split:

- **The Agent writes the walkthrough**, in its hand-overs, as part of building (`complete_phase`, `docs/protocol.md`
  → Hand-overs): every spot it marks, with a `title` and a plain-words `explain` for the key pieces of code; every
  judgement call with a short `title` naming the decision, its `alternatives` and why each was rejected; and on the last phase a `walkthrough` for the
  whole change: the approach, how it works behind the scenes (a text diagram in a code fence whenever the change has
  structure or a flow worth drawing), the risks, each with a short `title` and its lines, and how to test it. `resolvePhaseInstruction` asks for it, and for the walkthrough only on the last phase.
  How to test it has two parts: what the automated tests cover, and a guide you follow by hand, step by step, each
  step an action, where it happens (a URL, a file, a command or a screen) and what you should see. The guide starts
  from where to go (the preview deployment, or the command that starts the app and its local URL) and ends with the
  edge cases worth trying. The review gate's body and the pull request's description write both parts
  (`serializeTestingMarkdown`: "Covered by tests", then numbered "Try it yourself" steps with "Expected:"), and
  `read_task` lists them (`listTestingLines`). A plain list of strings, the older form, is read as what the tests
  cover; logs written before the guide are rewritten once on start (`store/legacy.ts`, log version 3).
  `assembleReport` keeps the latest phase's walkthrough, so a later phase may restate the whole.
- **The reviewer checks it from outside.** Its own session sees the request, the plan, the phase summaries and the
  Agent's judgement calls as numbered claims, each its title, the call and its reason (`describeJudgementCallsForReview`), never the Agent's conversation. Besides
  its findings it names each call it would have made differently, with why and what it would do instead; `decide`
  resolves each number to the call's text (`unknown_judgement_call` for a number the brief never gave) and the task keeps
  them as `reviewDisagreements`. A call that breaks the request or a rule is a blocking finding instead. It also sees
  the guide for testing the change (`describeTestingForReview`) and follows the steps it can from the worktree: a step
  it cannot follow, or one whose expected result is vague, is a finding, and so is a claim about the tests that the
  tests do not back.
- **You read both side by side**: the Review tab puts the reviewer's disagreement on the call's own card and its
  findings after the walkthrough (`docs/design.md` 34). Nothing of this is in a system prompt or a tool list beyond
  the static schemas: the instruction, the numbered calls and the earlier phases all go in the user turn, so both
  sessions keep their cached prefix (Caching, below).

A fix that changes how the change works revises the walkthrough: `complete_fix` takes an optional `walkthrough` with
only the parts that changed (approach, flow, risks, testing), each replacing that part whole, and every fix prompt
asks for it only when the fix changes one of them (`describeFixClosing`). `decide` records it as `walkthrough.revised`,
and the fold merges it into the walkthrough of the latest phase report that has one; when none has one yet, a revision
with both the approach and the flow starts one on the latest phase report (risks and testing empty: `createTesting`), and anything else
is ignored. `assembleReport` reads the result as before, and a new round starts without phase reports, so a revision
never reaches an earlier round's report. The `walkthrough` schema is static like every tool's (Caching, below).

### Steps around the merge

The two kinds have standard names, like a pre-commit and a post-commit hook. A **pre-merge step** is done before the
merge, because the merged code needs it in place; Merge waits until each is ticked. A **post-merge step** needs the
merged code, so it only exists for you once the pull request has actually merged: before that it cannot be ticked,
no gate asks for it and no status counts it.

Some of a change cannot be done from the worktree: an environment variable or a secret production needs, a migration
or a deploy to run, a config or feature flag to flip, a service to restart, a backfill, a third-party setting. No agent
has production access, and none should, so the Agent hands these over as steps for you, in the walkthrough's `steps`
(`MergeStep`: `when` `pre_merge` or `post_merge`, `kind` env, secret, migration, deploy, config or other, a `title` that
names the thing, a `detail` with where and how, and the exact `command` when the step is one; `docs/protocol.md` →
Hand-overs). The last phase's instruction (`resolvePhaseInstruction`) and the handover skill ask for them: everything
the Agent can do inside the repository it does itself (code, tests, docs, `.env.example`, the migration file); a step
names its variable and where to set it, never a secret's value. A fix that changes them sends the whole new list in its
`walkthrough` revision. The reviewer's brief lists them (`describeMergeStepsForReview`) and asks it to check the list
is complete: a variable the code reads that no step names, or a step an agent could have done, is a finding.

You tick a step once you did it (`merge_step.tick`, human-only: core refuses it on your behalf, and its spec,
`shinsa merges tick`, is `humanOnly`); `merge_step.ticked` keeps the step's key in `Task.mergeStepsDone`. A step's key
is its timing and a hash of everything it says, its kind, title, detail and command (`resolveMergeStepKey`), so a fix
that changes any of them asks you again, and one that sends the step unchanged keeps the tick. `listMergeSteps` reads
the steps from the latest walkthrough with their ticks, plus the ones carried over from earlier rounds; each says its
round and whether it can be ticked now (`due`).

**They are steps of the pipeline.** `pre_merge` ("Pre-merge") and `post_merge` ("Post-merge") are two
steps of the schema like every other, of class `handover`, done by you and guarded by their `needs` (Task shapes):
`pre_merge` sits after `pull_request` and before `merge`, and `post_merge` is the last step, after `merge` and
after an operation that follows the merge. No agent composes them (`composable: false`: `reshape_task` does not offer
them and `validateComposition` refuses them); Shinsa adds them. After every command, `syncMergeSteps`
(`decide/merge-steps.ts`, run after the command and again after a queued round starts) looks at each task the command
changed: it gives the pipeline `pre_merge` exactly while the work report (or an earlier round still shipping onto
the same pull request) lists a pre-merge step, and `post_merge` exactly while this round's report lists a
post-merge step (`resolveHandOverPipeline`), through `task.reshaped` (`by: shinsa`, "Added the step Pre-merge"), the
same shape change every other step goes through, checked by `validatePipeline`. A fix revision that clears a timing's
steps takes its step out again.

- **Pre-merge** is a gate on the merge gate (its gate type is `merge`). Approving the merge gate waits until
  every pre-merge step is ticked (`assertMergeStepsDone`, `merge_steps_open`); revising or rejecting it does
  not. While one is open the merge gate's Needs you line says so ("1 pre-merge step for you") and the progress
  shows Pre-merge as the step waiting on you, with how many are done; once each is ticked Merge is.
- **Post-merge** is a gate of its own, `post_merge` ("Post-merge"), and it opens only after the merge happened. A
  post-merge step ticks only once its pull request merged (`merge_step_early`; a pre-merge step no longer changes once
  it has). When the round rests (it merged, or the operation after the merge finished) with a post-merge step
  unticked, the gate opens:
  it shows in Needs you below the decision gates, the task's status reads "Post-merge · 2 steps left", the
  progress shows Post-merge as current and its Overview opens on the steps. The gate takes no decision: ticking
  the last step withdraws it, and unticking one opens it again. The round rests as merged meanwhile, so a new round can
  start, but the task is not done until each is ticked: neither you nor an agent marks it done (`task_open`).
  An operation after the merge runs before these steps: they are what is left for you once Shinsa's work on the round
  is over, and something the operation needs first belongs before the merge or in the operation gate's notes.
- **Carry-over.** A new round archives the walkthrough, so the open steps of the round that ends move to
  `Task.carriedMergeSteps` with their round: every open post-merge step, and every open pre-merge step of a
  round that shipped onto the pull request the next round ships on too (it still blocks that merge). The post-merge
  gate stays open across rounds until the last carried step is ticked, and the Overview shows them under Post-merge
  steps while the later round works. Steps ticked before a round starts are dropped.
- **Visible to agents.** `read_task` (`serializeTaskDetail`) numbers the steps with their ticks, the review gate's body
  and the pull request's description list them as task lists (`serializeMergeStepsMarkdown`), and the activity
  records each tick. Nothing runs a step for you: a step's command opens in a terminal only when you ask (Run in
  terminal).

### Evidence

The review opens with proof, not the diff: screenshots before and after, a recording of an interaction, test output
(`docs/spec.md` 6). Shinsa does not run a browser of its own; the agents capture evidence with the tools they have
and hand it over with `attach_evidence` (since 2026-10-26).

- **Who captures it.** The Agent proves its own work. Every phase instruction (`resolvePhaseInstruction`,
  `describeEvidenceForPhase`) names the kinds the plan's `evidence` asks for; on the first phase of a plan that asks for
  a `screenshot` or a `recording` it says to capture the screens as they are, `stage: "before"`, before editing
  anything a user sees; every phase asks for after shots at the same title, width and theme, a recording for an
  interaction and the run output of the test that fails without the change; the last phase says Shinsa refuses it
  until each planned kind is attached (`code.evidence`, `evidence_missing`). The reviewer is given the list of what
  the Agent attached this round (`describeEvidenceForReview`: kind, title, stage, width, theme) or told there is none,
  checks it against the diff, and may attach its own; its pieces show as from the agent review, independent of the
  author. How to capture (start the app per the repository, Playwright's command line or a script in a scratch folder,
  1280px and 390px, light and dark, `git worktree add --detach` of the base for a before shot taken late, the
  simulator for iOS) is the `evidence` skill (`apps/engine/plugin/skills/evidence/SKILL.md`), which the skill index
  in the system prompt points to for a change a user sees and for a review of one.
- **What it carries.** `attach_evidence` takes `kind`, a `title` (80) that a before and its after share, an optional
  `detail` (280, what to look at), `width` (CSS pixels), `theme` (`light`, `dark`), `stage` (`before`, `after`) and
  exactly one of `path`, `url` or `text` (40,000). A note's text is markdown (a table for measurements, `shinsa://`
  references for files and tasks), and the Review tab renders it so; test and check output stays plain text. Core's `validateEvidence` checks it and the server refuses with every
  reason (`Shinsa did not attach it. Fix these…`). `evidence.attached` keeps the optional fields only when set.
- **Items, not files** (since 2026-10-26). One call is one item of one kind: a **comparison** (one view in two to six
  states: before and after, or empty, loading and full), a **recording**, a **screenshot**, a **test** or **check**
  run, a **note** or a **preview**. A comparison is `kind: "comparison"` with `parts` (2 to 6,
  `PROTOCOL_LIMITS.evidenceParts`, each a `path` with a `stage` or a `label` of 40); the server stores each part and dispatches `agent.attach_comparison`, which
  `decide` folds into one `evidence.attached` per part sharing a fresh `itemId` (each part a `screenshot` or
  `recording` by its file, carrying its `stage` and `label`), so the event stays the one it was and a planned
  `screenshot` is met by a comparison of screenshots. Core's `listEvidenceItems` turns a round's pieces back into
  items (`EvidenceItem`: `id`, `kind`, `title`, `parts`): the pieces of one `itemId` are one comparison; a `before`
  and an `after` screenshot or recording attached by separate calls with the same title, width and theme pair into
  one too (the latest of each stage, so a retaken after replaces the earlier one), which is how a before shot taken
  early meets its after; every other piece is an item of its own kind. The Review tab and the Overview count these
  items, never files.
- **Where it is kept.** The server copies a file, or writes the text (a note as `.md`, other text as `.txt`), into
  `<data>/evidence/<task id>/round-<n>/<slug of the title>-<id>.<ext>` (`EvidenceStore`, 200 MB a file), so the
  agent's own temporary files can go; a URL is kept as given. `/api/evidence/<task id>/round-<n>/<name>` serves it
  (and the chat's tool images, still one level up), only names of that shape resolve, with
  `Cache-Control: private, max-age=31536000, immutable` and byte ranges (206, 416), so a recording seeks.
- **Cache-stable.** The schema and the skill index are static; the kinds the plan asks for and what was attached reach
  the agents only in the user turn (Caching, below).
- **Shinsa's own checks are evidence too** (since 2026-10-26). After every checks run (`checks.run`), the server
  writes each command with Passed or Failed and the tail of its output (`tailOutput`, the whole piece at most 40,000
  characters) as one text file in the round's folder, titled "Checks run by Shinsa: all 3 passed" or "1 of 3 failed"
  (`serializeCheckEvidence`, `apps/engine/src/checks/evidence.ts`), and `checks.record` carries it as `evidence`;
  `decide` attaches it as `evidence.attached`, kind `check`, of no run (`runId: null`), while the task is checking.
  The changed-line coverage measured after passing checks travels on the same `checks.record` as `coverage`
  (Test coverage of the change).
  So a change always shows the output of its checks, even when no agent attached any, and a later round of checks
  after a fix adds its own piece. A command whose output an agent already attached this round (a `test`, `check` or
  `note` piece whose lines, timings aside, hold every line of it) is left out and the detail names it; when every
  command is, nothing is attached. The reviewer's list of attached evidence leaves Shinsa's pieces out, since its
  prompt already says the checks pass.
- **Where you see it.** The Review tab's Evidence section (`docs/design.md` 34), also when the task has no work report
  and its changes cannot be read (a merged branch that was cleaned up); the Overview keeps one line pointing there,
  or shows the section itself for a task with no review (an operation).

### Review rounds escalate to you

- A review that still has blocking findings after `MAX_REVIEW_ROUNDS` (3) agent reviews, a review
  fix that repeats an earlier one (`stalled`: the same findings came back, or the tree did not
  change), or a fix budget that ran out (`exhausted`) never fails the task: it opens the review
  gate with `escalation` (reason, rounds) and the last findings. The overview says the agents
  could not settle it. Only review fixes escalate: a checks or pull request fix that stalls or
  runs out opens a failure gate (Recovery, below).
- At any review gate you can decide each finding: Fix or Dismiss (`gate.answer` with
  `verdicts`, one per finding index). Kept findings go to the Agent with the dismissed ones named
  as off-limits; dismissing all of them approves. Approving with a Fix verdict is refused.
- Request changes at a review or merge gate carries your line comments as data (`gate.answer` with `comments`,
  `docs/protocol.md` → Line comments), not as text the web wrote: core writes them into the Agent's fix prompt after your
  words, each with its path, lines and words. A comment is words only: to change the code yourself, edit it in the
  Code tab (Where agents work → Your edits). Fix N findings at an escalated review sends the drafted comments with the verdicts the same way. The
  comments are stored on `gate.answered` and on the decision's activity entry, so the task's activity lists each
  with its place. Comments with any other decision or at any other gate are refused.
- Dismissed findings are kept on the task (`dismissedFindings`, the last 30) and every later
  reviewer is told not to report them again unless the code around them changed. Your decision
  resets the round count.

### Questions

- `ask` takes optional `choices` (2 to 4, different from each other) and a `recommendation`
  that must be one of them. The gate shows them as one-click answers next to the text box.
- A message you write while an agent's question is open does not answer it: it makes the
  question historical (`gate.superseded`, `supersededBy`) and the waiting tool call returns your
  message instead of an answer ("The question was withdrawn. The human wrote this instead: …"). The message
  reaches the agent once, through that tool call; when the session was released while it waited,
  the step resumes with the question and your message, as an answer would, and when the step can
  no longer resume the message goes to the task like any other. The chat marks the question Withdrawn.

### Waits and monitors

- `wait_for {check_in_minutes, notes, timeout_minutes?, max_attempts?}` (the Agent, whatever it is doing, and the
  investigator) ends the run and arms a monitor: the next check-in (`nextCheckAt`), a timeout
  (default a day, at most a week) and a budget of check-ins (default 10, at most 100). A run that waits again
  continues the same monitor, so its check-ins and timeout carry over. The house rules forbid sleeping or polling
  in a shell.
- `MonitorClock` (`apps/engine/src/runtime/monitors.ts`) fires the earliest due monitor with
  `monitor.fire` (command id `monitor:<id>:<attempt>`, so a repeat is a receipt). A fire core
  refuses, or answers with no events, is not sent again: the receipt would answer it the same way,
  so the clock skips that entry until the monitor changes (`StateClock.refuse`; `ScheduleClock`
  does the same). A fire resumes
  the waiting run's session (same role, purpose and phase) with the notes; past its timeout it opens a
  failure gate (`cause: monitor`, "The agent’s wait ran out") instead. A wait that runs out of check-ins
  ends the same way: once they are used up the agent finishes the step with what it knows or
  asks you (the last check-in's prompt says so), and a `wait_for` it calls anyway ends its run, marks the
  monitor `exhausted` and opens the failure gate ("The agent’s wait ran out of checks"; the tool tells
  the agent the human decides now). Retry starts the step again with a fresh set of check-ins. Check in now
  (`monitor.check_in_now`, `shinsa tasks check-in-now`) fires it at once; the web counts them as "Check-in 2 of
  10" and shows a monitor between them as "Waiting to check in again".
  Any new step, message or retry clears an armed monitor.
- A task waiting on other tasks names what holds the chain up: `traceStalledLeaf` (`queue/stalls.ts`) walks the
  chain depth first and returns the first task that needs you, is paused or was cancelled, with the path to it, so
  the task says "Held up because ‹leaf› is waiting on you".

### Cost

- The provider reports usage when a session ends (`AgentSessionResult.usage`; for Claude the
  latest result's running totals). The supervisor sends that running total with the provider's
  session id (`run.meter`); the core charges the run what the session added since the total it
  last recorded for that same session (`resolveUsageDelta` in `costs/`, the last totals kept in
  `state.sessionUsage`), so a run that used two sessions never lowers the charge of the next
  resume. Token counts are whole numbers; a cost the provider cannot price stays `null` and shows
  as unknown, never as zero.
- **Codex runs carry a cost too.** Claude reports its own cost; Codex reports only tokens, so Shinsa prices them from
  one table, `CODEX_PRICES` in `agents/providers/codex/pricing.ts` (US dollars per million tokens: input, cached
  input, cache writes, output, and the long-context output rate where the model has one). `CodexMeter`
  (`codex/meter.ts`) prices what each `thread/tokenUsage/updated` added since the last one: cached input at the cached
  rate, written cache at the write rate, the rest of the input and the output at theirs; a request whose input passed
  272,000 tokens is long context (input rates doubled, the long-context output rate); a fast turn is multiplied by the
  model's fast multiplier (`FAST_MULTIPLIERS`). Model names are read through Codex's aliases and without a date suffix
  (`resolveCodexPriceModel`), and a turn Codex moves to another model (`model/rerouted`) is priced as that model. A
  model the table does not know, a fast turn on a model with no fast multiplier, or a fast long-context turn on a
  model with no rate for that, leaves the cost `null`, and it stays unknown for the rest of that session: never $0.
  Long context on a model with no long-context rate is priced at its normal rates. A resumed thread starts from what
  Shinsa already metered for it (`usageBaseline`, the session's last totals), so Codex's running totals are not
  charged twice, and the agents a Codex agent starts report their own sessions (`subagentUsage`), each metered under
  `run.meter:<attempt>:<session>`. So a Codex run counts toward Cost limit per task like a Claude run.
- `resolveTaskCost` rolls usage up per task, per role and per plan phase. The overview's facts
  show the total with the breakdown in its popover, and the review card adds what was spent.
- **What a step used of the weekly window.** For a run on a Claude account the supervisor reads the account's
  weekly window ("Weekly · All models", `resolveWeeklyPercent`) when the attempt starts, from the reading when it is
  under a minute old, and again when it ends, read fresh (`AccountBroker.readWeeklyPercent`; for a provider with a
  login of its own, Codex, `readProviderWeeklyPercent` reads its "Weekly limit" the same way), and
  sends the difference with `run.meter` as `weeklyPercent` (`resolveWeeklyUsed`; a window that reset in between
  counts from zero, and a missing reading sends nothing). The core adds it to the run (`run.weeklyPercent`) and
  rolls it up with the cost (`CostLine.weeklyPercent`). It is the account's usage over the run's time, so two
  steps running at once on one account are each charged all of it: the limit errs early, never late.
- **Limits per task** (`listTaskBudgets`), both off by default and both soft: a run never stops mid-turn, but a
  run that would start past a limit does not start, and the task pauses with a failure gate (`cause: budget`).
  Settings → Agent usage → Limits, Usage limit per task (`taskUsageLimit`, a whole percentage) counts the weekly window the
  task's steps used ("Reached its usage limit"); it is what a subscription has. Cost limit per task
  (`taskBudgetUsd`) counts dollars ("Reached its cost limit"), for API keys, where there is no weekly window, and
  for any provider whose cost Shinsa knows; Settings shows it only while it is set or when no account reports a
  weekly window, so a cost limit you set stays visible and can be switched off. The usage limit is checked first. Continuing ("Allow another
  10%" or "Allow another $5.00") acknowledges what was used of every limit it passed (`budget.acknowledged` with
  `spentPercent` and `spentUsd`, `task.usageAcknowledgedPercent` and `budgetAcknowledgedUsd`) and allows one more
  of each; raising or switching off a limit releases held tasks by itself.

### Silent runs

- `SilenceWatch` (`apps/engine/src/agents/silence.ts`) watches transcripts. A running run with no
  output for five minutes is marked (`run.silence` with the time of its last output); output
  clears the mark. `resolveSilenceLevel`: suspicious from 5 minutes, critical from 15, nothing
  for a queued or finished run or a waiting one (`isRunWaiting` in core, which the watch uses too):
  waiting on your answer, a delegated run waiting on the agent that delegated it, or a parent
  waiting on its delegated runs.
- It is informational only: it never stops, retries or reassigns anything. Snooze (30 minutes)
  and Dismiss (for the rest of that run) are `run.snooze_silence` and `run.dismiss_silence`.

### Ask mode

- Ask mode is the answer shape (Task shapes, above); `task.create` with `mode: 'ask'` still makes one. It is classified like
  any task (the repository; triage is told it is a question, so the title names what it asks about), has its repository
  verified, then an answerer runs in the repository itself, read-only (no worktree, branch, plan, checks or pull request) and
  hands over with `answer` (markdown, at most 8,000 characters, optionally `propose_change`), which sends `agent.deliver`
  with step `answer`: the answer lands on `task.result` through `task.delivered` like every other inquiry's result. The
  task is done when it answers, or waits at your OK when it proposes a change; a message afterwards asks a follow-up on
  the same session.
- Its progress is two steps (Find the repository, Answer); the overview shows the answer.

### Suggested tasks

- `suggest_tasks` (every working role) proposes up to five tasks: title, request, why
  and `after_this`. A title the task was already given (open, accepted or dismissed), the title of an
  open task, or one repeated in the call is dropped; a call that would leave more than ten open
  suggestions on the task is refused. Suggestions never start anything.
- Accepting (`suggestion.accept`, `shinsa suggestions accept`) creates the task in the same repository, waiting on
  this one when `waitsOnThis` is set, and links it; dismissing keeps it out of the way. A settled task keeps its
  suggested tasks so you can still accept them. On screen they are "Suggested tasks" ("Add the suggested task
  “‹title›”", "Dismiss the suggested task"). A follow-up is something else: a message to a finished answer,
  investigation or report.

### Setup verification

- Before a task's first agent, the task stage reads "verifying the setup" (`VERIFYING_SETUP`) while
  `config.verify` (`apps/engine/src/repos/setup.ts`) checks that
  the repository folder exists and is a git repository, that the default branch exists (fetching
  it from origin before calling it missing) and that there are checks to run (configured, or
  found in `package.json`). A task whose pipeline needs no worktree (an answer, research) checks the repository only, and
  one without `build` (an investigation, an operation) skips the checks. A task with no repository whose steps need
  none never comes here; one whose steps need one finds it first (A task without a repository, above), and the
  problem when none is found is `no_repository`.
- Problems open their own `configuration` gate, not a failure: nothing ran. Its title names the problem ("The
  repository is missing", "No checks to run", or "The setup has 2 problems") and its body lists what is wrong and
  how to fix each; the web labels the task "Setup incomplete". Verify again (`approve`) verifies the setup again;
  Start without checks (`waive`, only when checks are all that is missing) sets `checksWaived` on the repository;
  Cancel ends the task. A message at the gate verifies the setup again too (`verify_setup`) and is kept for the first
  agent. The same problems twice record nothing new.

### Schedules and webhooks

Harness plan WS7, which names the sources. The rules are core (`packages/core/src/schedules/`,
`decide/schedules.ts`, `decide/secrets.ts`); the clock, the webhook receiver and the secret store are the server's
(`apps/engine/src/schedules/`, `secrets/`).

- **A schedule is a trigger that sends a message**: it starts a new task (`new_task`, or an Ask task with
  `just_answer`) in the repository it was set from, or messages a task (`task_id`, the task it was set from by
  default). Agents set
  them up: `set_schedule`, `list_schedules` and `delete_schedule` (every working role;
  `agent.set_schedule` / `agent.delete_schedule`), each changing only its own task's. You, the command line
  (`shinsa schedules write`) and any task agent (its `schedules_write` tool) write any schedule with `schedule.write` (`createdBy: you` for a
  new one; a change keeps who made it): the same trigger, message, `max_runs` and time zone, and a target that is a
  new task in a named repository (or the one triage picks) or a task to message. A webhook schedule's signing secret
  goes to the secret store through `POST /api/schedules/<id>/webhook` (`shinsa schedules webhook-secret`), never
  through a command. You see, pause, resume and delete them in Settings → Automations and ⌘K (`schedule.enable`,
  `schedule.remove`). A task keeps at most 20, Shinsa 100 live.
- **Kinds** (`packages/core/src/schedules/time.ts`): once (`in_minutes` or `run_at`, at most a year out; a `run_at`
  more than a minute in the past is refused), every N minutes (1 minute to a week), daily at `HH:MM` on chosen
  weekdays, and webhook. Daily runs follow the wall clock in the schedule's time zone (IANA, checked; `time_zone`, else the
  server's for a new schedule and the schedule's own for a change),
  so a daylight-saving change keeps 09:00 at 09:00; a time the clocks skip moves on by the gap (02:30 runs
  at 03:30), and a time that occurs twice runs once, at the first.
- **Firing** (`ScheduleClock`, `apps/engine/src/schedules/clock.ts`): one timer for the earliest `nextRunAt` (at most an
  hour, so a sleeping machine re-checks), re-armed on every state change. Each due schedule is re-read just before it
  fires and dispatched as `schedule.fire {dueAt}` with command id `schedule:<id>:<dueAt>`, so a restart that fires
  the same slot again replays the receipt. Core ignores a fire whose `dueAt` is not the schedule's `nextRunAt`, and
  the clock treats a fire answered with no events like a refusal: it skips it until the schedule changes.
- **Missed runs fire once.** The next run is always computed from the time of firing, never from the slot that was
  due, so a machine that slept through six hourly slots runs once on wake. A schedule whose previous task is still
  open (or whose previous message's run is still live) records a `skipped` run instead; skipped runs do not count
  against `max_runs`. A once schedule, or one that reached `max_runs`, finishes; one whose task is gone or closed
  (marked done or cancelled) or whose repository was removed stops (`target_gone`). A task resting after a merge is
  still messaged, which starts its next round (Rounds, above). Each schedule keeps its last 20 runs (sent, skipped, failed, with
  the task, the delivery and why).
- **Failure is recorded, never lost.** A fire core refuses (a `DomainError`) or that throws is written as a `failed`
  run through `schedule.fail`, and the schedule moves to its next slot, so a broken schedule cannot spin. Editing a
  schedule (`schedule_id`) keeps its next run unless the trigger changed or it is being resumed.
- **Webhooks** (`apps/engine/src/schedules/webhook.ts`): each webhook schedule has a URL with a 24-byte token
  (`/api/hooks/<id>/<token>`, `secrets.json`), outside the host guard so services can reach it. The token is
  created when the schedule is written (and for any webhook schedule without one, on every state change), so
  showing the URL never writes. The URL is this machine's own address (`http://<host>:<port>`, from `SHINSA_HOST`
  and `SHINSA_PORT` or `config.json`), so a service on the internet cannot reach it as it is: run a tunnel to that
  port (`cloudflared`, `ngrok`, Tailscale Funnel) and give the sender the tunnel's address with the same
  `/api/hooks/<id>/<token>` path. A path that is not a hook, including one with a broken `%` escape, is 404. The
  request is checked in order: the token (constant time), a rate limit (60 a minute per schedule, 429), paused
  (409), the body (1 MB, 413), then an optional HMAC-SHA256 signature over the raw body (`webhook.signature
  {header, prefix, encoding, secret_ref}`, 401). Then the prompt template (the schedule's message) is filled:
  `{{body}}` and `{{body.path}}`, `{{headers}}` and `{{headers.name}}`, `{{query}}` and `{{query.name}}`, and
  `{{request}}` (the whole request as text); a part the request does not have is left out. Values are wrapped in a
  nonce-tagged `<webhook-data-…>` element and the prompt ends with a note that the tagged text is untrusted data,
  never instructions (at the end, so the message's own first line stays the task's title). Credential-like
  headers and query values (authorization, cookies, anything naming a token, secret, key, signature or password)
  are redacted whether the template names one or takes them all. An optional `replay_key` template, which reads
  the values as they are because only its hash is kept, dedupes deliveries for a week (500 keys per schedule): a
  repeat answers 202 `duplicate` and starts nothing. A delivery is `schedule.deliver` with command id
  `webhook:<id>:<delivery>`; the answer is 202 with the delivery id.
- **Secrets are one-use refs** (`request_secret {label, reason}`, `agent.request_secret`): the agent's run waits on a
  question gate with `secret: {label}`; you paste the value into a password field that posts to
  `/api/secrets/<gate>` (never a command), and the server keeps it in `secrets.json` (mode 600) and answers the gate
  with `secret-ref:<32 hex>`. Core refuses any other answer to a secret gate, so a value typed into the chat or ⌘K
  never lands in the log. The ref is fixed per request, so pasting again before the gate is answered (after a
  crash, say) replaces the value it holds. The agent gets the ref, which `set_schedule` spends once (it expires in a day); the value
  never reaches the transcript or the model.

## Delegation

A working step can hand self-contained work to other agents and gets the results pushed back into
its turn, never by polling. Delegation is for context that must stay apart (Agents, above): a review or a test of
what the Agent built, which its own reasoning would bias, or work that is truly independent and runs in parallel,
whose context can be thrown away. It is never a way to split a round by step or by problem type: no agent per phase,
no separate fixer. The house rules (`resolveOrchestrationRules`) and the `delegate_task` description say so. Ported from T3 Code's orchestration v2, Kanna's sub-chats and Paperclip's structure
(harness plan WS6 names the sources). The rules live in `packages/core/src/decide/delegations.ts`
and `couriers.ts`, the projection in `state/delegations.ts`, the tools in
`apps/engine/src/agents/tools/orchestration.ts` and the delivery in `agents/delegations.ts`, `agents/deliveries.ts`
and the run supervisor.

- **A delegation is a sub-run, not a sub-task.** It is a `Run` of the same task with a
  `delegation` (parent run, depth, title, brief, mode, wake policy, isolation, delivery, an open
  question). A sub-task would bring a worktree, a branch, triage, a plan, checks, gates and a pull
  request: everything a delegated review or survey must not have. A sub-run shares the task's
  worktree, budget, cost and transcript store, ends with a reply instead of a hand-over, and never
  moves the task's stage. Work that should become its own change is a new task (couriers, below).
- **Tools.** Every working role gets `delegate_task`, `delegation_status`, `delegation_cancel` and
  `delegation_answer`; the last three name a delegation by `delegation_id`. `delegate_task` takes the `brief`, a title, a `role` (`planner`
  to investigate without changing files, `reviewer` to review or test without changing files, `builder` to change
  files; by default a builder for the Agent, a planner while it plans or for a read-only agent), `mode` (`async`, the default, returns at
  once; `wait` blocks until the result, a question or `timeout_minutes`, 10 by default and 60 at
  most), `isolation`, `client_request_id`, `provider` and `model`. A delegated agent gets `ask`,
  `attach_evidence`, `find_tasks`, `read_task` and `note`, and the delegation tools until it is three
  deep; it has no hand-over tools, and its final reply is its result (`docs/protocol.md` → Agent
  tools).
- **A child starts from its brief alone.** Its prompt names the task and repository it works in
  and its role, then the brief; never the parent's conversation, plan or notes. The tool tells the
  agent to make each review round a fresh delegation with the earlier findings in its brief; nothing
  enforces it.
- **Deterministic ids.** The same `client_request_id` under the same step returns the delegation already
  started (`requestKey`) and never starts a second one or a second checkout. The tool names its
  command `agent:<run>:<attempt>:delegate:<id>`, so a repeat inside one attempt is answered by its
  command receipt, and a different brief under the same id is refused with `command_id_conflict`.
- **Limits.** Delegation nests three deep (`DELEGATION_LIMITS.depth`), a fixed guard against runaway nesting. How
  many delegations run at once under one step, at any depth, has no limit by default; the human may set one in
  Settings → Agents → Engine, Delegations at once (`delegationLimit`, a whole number of 1 or more, or `null` for no
  limit; human-only). The orchestration rules never mention it, so the system prompt stays the same when the setting
  changes (Caching): only the refusal (`delegation_limit`) names the limit and the setting, and says what to do
  instead. Lowering it never stops a delegation already running; it refuses new ones until the count is below it.
- **A child is never broader than its parent.** The Agent while it plans (`isReadOnlyRun`), a reviewer, answerer,
  researcher or delegated planner cannot change files, so it can only delegate to a planner or reviewer, checked again
  on every request ("While you plan you cannot change files, so the agents you delegate to cannot either."). A
  read-only child runs only on a provider that keeps it read-only (`planning.readOnly`): Claude by
  withholding its edit tools, Codex by its `read-only` sandbox, so a Claude parent can delegate a
  review to Codex and back. One that shares the checkout is never followed by a reset of it.
  Approvals stay with you: a child has no gate of its own. A child takes the provider the parent
  names, else the one its role runs on, and that provider's model for the role; it works in its
  parent's round and on its parent's account.
- **Isolation.** `isolation: "worktree"` gives the child a detached checkout of the parent's last
  commit under `worktrees/delegations/<task>/<run>` (uncommitted edits are not in it). Its result
  says how many files it changed and where, for the parent to bring over; the checkouts go with
  the task's worktree. Without it the child shares the task's worktree.
- **Delivery.** A finished child's result, or its question, is claimed for the parent in a
  *cohort generation*: a claim names its generation, its items and how it goes, `steer` into a
  live turn (when the provider can steer) or `wake` a parent whose turn ended. Items that arrive
  while a claim is in flight join it; a claim the session did not take is released and claimed
  again under the next generation, deferred until the turn ends when the session cannot be
  steered. A delivered report counts once (`delegation.delivered`), and reading a finished result
  with `delegation_status` counts as receiving it, even while a report carrying it is on its way: a step
  that ends its turn waits only for what has not reached it yet (a live child, an unread result, a
  queued message), never for a claim whose items it already read. A question goes out at once; a
  `wait` call's own result is held back while the wait is still listening.
- **A wait that times out wakes instead.** The call returns `wait_timed_out` and the child switches
  to waking the parent. Ending a turn releases every wait.
- **A parent waiting on its children says so.** A step whose turn ends while its delegations
  run does not finish: it becomes `waiting`, records what it waits on (`waitingOn`) and puts
  "waiting for 2 delegations" on the task, a typed wait that keeps the task live. Hand-over
  tools refuse while a child still runs. The next result wakes it on its own session. A message
  you send to a waiting step is queued into that wake.
- **Questions route to the parent agent.** A child's `ask` never opens a gate: the parent gets it,
  answers with `delegation_answer` (asking you first with its own `ask` when only you can decide), and
  the child carries on in the same session, or in a new turn if its own ended. That ceiling is intended: a
  delegation never asks you directly.
- **Cancel cascades.** Stopping a delegation (`delegation_cancel`, or Stop in the chat, the
  `delegation.cancel` command) stops everything it delegated. A step that ends, is stopped or the
  task settles stops its children.
- **Adoption.** A step that fails and is restarted at once (a nudge or a fresh session) adopts its
  predecessor's delegations, running ones and finished results not yet delivered: they report
  to the new run, whose prompt lists the ones still running. A step that pauses instead (a usage
  limit, a sign-in, a failure gate) stops them, since they would run on the same spent account or
  unattended until you decide, and the step that resumes later starts without them.
- **Restart recovery.** On boot `delegations.recover` releases every claim in flight and every
  wait (no process is listening any more), then claims again, so results reach a resumed parent by
  steer or wake exactly once.
- **Couriers and decomposition (Paperclip).** `create_task` makes a self-contained task for work
  that belongs elsewhere (its `request`), optionally in another repository, with `this_task_waits` making this
  task wait on it (a blocker, not just a parent link; only an Agent run that builds or fixes may wait, others are
  refused with `cannot_wait`); it is exactly-once per `client_request_id`.
  `split_task` (the Agent) turns the accepted plan into one to eight tasks (`tasks[].request`), exactly once per plan
  version, recorded on the task (`splits`, `planVersion`); a second call returns the same tasks. These are the only
  ways a task agent files a task: its management tools leave out `tasks create`, which stays for you and the command
  line.
- **In the web.** Delegated runs show in their parent's turn (spawn, report, Stop, the child's own
  conversation nested inside) and in the Overview's Delegations panel (`docs/design.md`).

## The command surface

Everything you can do in Shinsa is one list of specs, `SURFACE` in `apps/engine/src/surface/`, and both the command
line and every task agent's management tools are generated from it, so neither can fall behind the other. The full reference is
`docs/cli.md`, whose reference half is written from the same specs by `bun run --cwd apps/engine docs:cli`
(`replaceReference`, `serializeReference`); a test fails when the file and the specs differ.

- **A spec** (`surface/spec.ts`) has a path (`['tasks', 'create']`, the words after `shinsa`), a summary, typed fields
  (`surface/fields.ts`: text, number, integer, boolean, choice, list, JSON; positional or a flag), whether it reads or
  writes, the user command it sends (`command`), whether it is yours alone (`humanOnly`: no agent gets it as a tool,
  and an agent's shell may not run it; Agents manage Shinsa, below), the agent tool a task agent uses instead
  (`agentTool`: `tasks create` names `create_task`, so it is not a management tool), and `run(client, values)`, which reads and sends
  through a `SurfaceClient` (`read`, `post`, `send`). The same fields give the command line's arguments and `--help`,
  and each agent tool's JSON schema (snake_case keys) with read-only, destructive and idempotent hints.
- **Derived from core's parser.** `USER_COMMAND_TYPES` is the list `parseUserCommand` accepts. Every one of them has
  at least one spec (`listUncoveredCommands()` is empty, and a test fails the day core gains a command without a
  command-line path), and `shinsa command <type> --fields '{…}'` sends any of them by type, so a new command is
  reachable before it has a friendly path. Specs build commands only from ids they read first (a task by its id,
  the start of its id, its exact title or its handle, `SW-142`; an account by id or email; a repository by name or
  id; a project by id, key or name), and the server still runs every one through `parseUserCommand` and `decide`.
- **What is not a command.** Reads (`GET /api/tasks`, `/api/tasks/<task>`, `/api/tasks/<task>/chat`, `/api/settings`,
  `/api/repos`, `/api/projects`, `/api/schedules`, `/api/delegations`, `/api/activity`, in
  `apps/engine/src/http/reads.ts`, and `/api/repos/local`, in `projects/routes.ts`), Claude accounts and usage
  (`/api/accounts/*`), folders (`/api/onboarding/setup`), secrets and webhook signing secrets, the health check and
  the providers, and the Code tab's reads (below). `/api/tasks/<task>` takes an id, a handle, the start of an id or an exact title (more than one match
  is `task_ambiguous`) and answers the task's view, plan, findings, open gates, what it waits on, runs, suggested
  tasks, recent activity and the same text `read_task` gives an agent. `/api/tasks/<task>/chat` pages the transcripts of the
  task's runs: the last `limit` entries (50), or the ones after the `after` index, filtered by `kinds` (`user`,
  `agent` and `error` unless you ask for `tool_call`, `tool_result`, `status` or `notice`) and `run`.
- **The command line** (`apps/engine/src/cli/surface.ts`): `shinsa <group> <action> [arguments]` against the server
  at `SHINSA_HOST` or `config.json`'s `hostname` (loopback when it listens on every address) and `SHINSA_PORT` or
  `config.json`'s `port`. `--help`, `--json` and the refusal shape are `docs/cli.md`. Commands carry an idempotency
  key per invocation (Command receipts, below).
- **Yours alone** (`humanOnly`): the specs listed in Who can change Shinsa, below.
- **When the engine is down**: in the Mac app's bundle, a command the engine does not answer asks launchd to start it
  (`launchctl kickstart`) and waits up to 20 s for it, then tries once more; otherwise it says to open the Shinsa app
  (`apps/engine/src/cli/api.ts`, `createWakeEngine`; Configuration and data → The engine in the background).
  `shinsa status` and `shinsa version` only report, and never start it.
- **Around the surface** (`apps/engine/src/cli`): the everyday commands (`shinsa [folder]`, `open`, `do`, `import`,
  `status`) and the engine's controls (`start`, `stop`, `restart`, `logs`, `version`) are the top level, one table in
  `cli/help.ts` that the help, each command's `--help` and `docs/cli.md` are written from; why it is shaped like
  Tailscale's and Docker's is `docs/cli.md` → How it is shaped. `shinsa engine` runs the engine itself, for the
  launchd job and `bun dev`; it is left out of the help, and an agent's shell may not run it, `stop` or `restart`
  (`HUMAN_ONLY_ENGINE_COMMANDS`, `agents/policy.ts`). `docs/cli.md` is hand-written above its marker and generated
  below it (`replaceReference`).
- **Not here at all**: what only the browser keeps (the layout, the theme, notifications and sounds) and the setup
  chat, which `shinsa folders` and `shinsa settings` cover.

## The Code tab's reads

The web's Code tab reads a task's code over HTTP (`apps/engine/src/http/code.ts`, on `git/files.ts`,
`git/task-refs.ts`, `git/diff.ts` and `git/read.ts`). Every route takes the task's id or its handle (`SW-142`, through
core's `selectTaskByReference`, as `POST /api/tasks/<id>/open` does) and reads only the repository the task is
registered to (`task.repoId`); a task with none, or no such task, is `404 code_unavailable`. The one write, saving a
file you edit, is `POST /api/tasks/<id>/file` (Where agents work → Your edits).

| Route | Answers | How |
|---|---|---|
| `GET /api/tasks/<id>/refs` | `TaskRefs`: the head commit, the base, the branch, the default branch, whether a working copy exists and has uncommitted edits, and the commits between base and head (100 at most) | the worktree's `HEAD`; without a worktree the branch, then the pull request's head, then the last pushed commit; a task without a branch reads the default branch (`origin` first). The base is the merge base with the round's base branch or the default branch; once the branch is merged, the merge base with the commit before the merge, so a merged task keeps its diff |
| `GET /api/tasks/<id>/paths?ref=` | `RepoPaths`: every file path (200,000 at most, `truncated`) | `git ls-tree -r`; the working copy `git ls-files --cached --others --exclude-standard` without the deleted ones |
| `GET /api/tasks/<id>/tree?ref=&dir=` | `RepoTree`: one folder's entries, folders first | the folder's tree object through the same long-lived reader as `blob` (`info <commit>:<dir>`, `contents`, then `info` for each file's size), kept in the cache by commit and folder (a cold folder of paywall-next went from about 27 ms to 2 to 10 ms); a path git cannot take on one line falls back to `git ls-tree --long`; the working copy from its paths |
| `GET /api/tasks/<id>/blob?ref=&path=` | `FileContent`: the text, or `binary` (a NUL in the first 8 KB, with the image type for an image), `tooLarge` (over 2 MB) or `missing` | one long-lived `git cat-file --batch-command` per repository (`git/blobs.ts`, `CatFilePool`): `info <commit>:<path>` for the object and its size, then `contents <object>`, so a file costs no process (a cold read went from about 40 ms, three `git` processes, to 1 to 2 ms); the reader stops after 30 s idle or a 5 s stall and starts again on the next read; a path git cannot take on one line falls back to `git ls-tree` and `git cat-file blob`; the working copy through `resolveInside` |
| `GET /api/tasks/<id>/raw?ref=&path=` | an image's bytes, with `default-src 'none'` and `nosniff`; anything but an image is refused | as `blob` |
| `GET /api/tasks/<id>/search?ref=&q=&regex=1&case=1&word=1&glob=` | `SearchResult`: up to 2,000 matches with path, line, column and text, `truncated` and `timedOut`; asked with `Accept: application/x-ndjson` (the web does), a stream of `SearchLine`s instead: `matches` lines as git finds them, then one `done` line with how it ended (or one `failed` line), `no-store` | `git grep -n -I --column`: a plain search that ignores case is `-E` with each letter folded into a class (`[cC][oO]…`, the rest escaped; `-i` made git grep up to twenty times slower), a case-sensitive one `-F`, `regex=1` is `-E` with `-i` unless `case=1`, `-w` with `word=1`, the glob as a `:(glob)` pathspec (`**/` in front when it names no folder); the working copy adds `--untracked`. git is stopped at the 2,001st line, so a common word answers at once |
| `GET /api/tasks/<id>/diff?base=&head=&path=&previous=` | `TaskDiff` with both ends: every changed file with its status, counts and risk, and the patch of the small ones only; the rest have `patch: ''` and `patchOmitted` (with `path`, and `previous` for a rename, the named file alone with its whole patch) | `git diff --raw --numstat -z --find-renames base head` for the list (`parseDiffSummary`), then one `git diff` over the files that fit the patch budget, in risk order (`selectPatchedFiles`, `mergeDiffPatches`: none over 2,000 changed lines or 256 KB, 20,000 lines and 1 MB in all, 400 files; a named file up to 2 MB); `head=working` diffs the working copy through a copy of its index (below). Without both ends it is the task's base against its working copy, or its head once the worktree is gone (what `shinsa tasks diff` reads) |

- **Where agents work.** The working copy is the task's own only in a worktree or a main checkout. A GitButler task
  shares its checkout with every applied branch, so its head is its branch and its `working` ref is assembled: the
  files the task owns in the ledger (its agent's uncommitted edits once a run's claim ended, and every edit you made in
  the Code tab) are read from disk, and every other file from the branch (Where agents work → Your edits). Its refs
  say `working: true`, and `dirty` when it owns any file; a search reads the branch and the owned files from disk;
  the diff is the branch's against the base with each owned file's working-copy diff in its place
  (`resolveWorkingDiff` with those paths).
- **Refs.** A `ref` is a full commit id that `git cat-file -t` says is a commit of that repository, or `working` for
  the task's working copy while its checkout exists; nothing else is passed to git (`ref_invalid`, `ref_unknown`). A
  commit once found is remembered per repository (`assertCommit`), so later reads at it start no process. Leaving `ref` out
  reads the head and is never cached.
- **Paths.** Relative, without an empty, `.` or `..` segment, a leading `/` or a NUL (`path_invalid`); they reach git
  after `--` and with `GIT_LITERAL_PATHSPECS`, and the working copy is read through `resolveInside`, so a symlink
  cannot leave it. A search glob may not start with `-` or `:`, and the query is at most 500 characters.
- **Limits.** Each read runs with argv only, in its own process group, for 5 s (30 s for a diff) and stops when the
  client goes away; output is capped (64 MB for listings and diffs, 4 MB or 2,000 lines for a search, 2 MB for a
  file), and a search that runs out of time answers with what it found and `timedOut`. A diff answer stays small
  however large the change: measured on a throwaway clone of paywall-next diffed across 400 commits (4,503 files,
  449,198 lines added and 116,097 removed), the diff is 1.9 MB (it was 32 MB with every patch) and takes 0.9 s cold and
  35 ms cached; on a synthetic 100,000-file repository with a 50,000-line file, a 5 MB one-line bundle and binaries, a
  search for a word in every file answers in under 100 ms (it timed out at 5 s with no result before).
- **Caching.** A read named by a commit is immutable: it carries an `ETag` and `Cache-Control: private,
  max-age=31536000, immutable`, a matching `If-None-Match` is a 304, and the server keeps file contents (by object id),
  path lists, folders and diffs in a 64 MB least-recently-used cache. Working-copy reads are `no-store`. The web keys every
  read by commit, so a task event (a chat line, a new priority) reads nothing again; it reads the refs again only when
  what pins the code changes (the stage, the branch, the worktree, a push, a phase or a fix), and the working copy
  with each task update. The web keeps its last 300 reads (`CODE_READ_LIMIT`, least recently used first), shows
  a read's last answer while a newer version of it loads, and reads most of them before they are asked for
  (`docs/design.md`, 36).

## Terminals

Shinsa has a real terminal per project (`apps/engine/src/terminals/`, the web's `routes/terminal.tsx`,
`components/terminal/` and `lib/terminal/`), for what agents leave to you: running your own dev server, signing in
somewhere interactive, or a command an agent asked you to run. The engine owns every shell, so a terminal keeps
running when the window closes or the app quits, and a page that comes back finds it as it was.

- **A shell in a pseudo-terminal, in the engine.** `pty.ts` starts your login shell (`$SHELL`, else the account's
  shell from `os.userInfo()`, else zsh) as `<shell> -l` with `Bun.spawn`'s `terminal` option, Bun's own PTY, so the
  compiled engine needs no native module (the compiled bundle was run with a PTY before this was built on it). It
  gets the engine's environment, which `shinsa engine` already filled in from the login shell (Configuration and data
  → The login shell environment), without what another terminal or the engine set (`TERM_PROGRAM*`,
  `TERM_SESSION_ID`, `GHOSTTY_*`, `ITERM_*`, `SHINSA_SERVICE`, `COLUMNS`, `LINES`), plus `TERM=xterm-256color`,
  `COLORTERM=truecolor`, `TERM_PROGRAM=Shinsa`, its version, and `LANG=en_US.UTF-8` when no locale is set, so wide
  characters measure right. A shell whose rc file hands off to fish (a `.zshrc` that execs it) ends up in fish, as it
  does in any terminal.
- **The engine keeps the screen.** Every terminal has a headless xterm.js mirror (`mirror.ts`: `@xterm/headless` with
  the serialize and Unicode 11 addons, 5,000 lines of scrollback), fed every byte the shell writes. A page that
  attaches gets the mirror serialized (colours, modes, the alternate screen of `vim` or `htop`, the cursor), plus the
  bytes it has not parsed yet, then the output as it comes; that is how a reload, a second window or the app opening
  again shows the terminal exactly as it is. Memory is bounded by the scrollback, not by how long a server has run.
- **The engine answers the terminal's questions.** A program that asks the terminal something (device attributes,
  the cursor position, a mode, the background colour: fish asks several before its first prompt) gets its answer
  from the mirror, once, even with no window open or with two. The page's xterm.js is told to leave those to the
  engine (`lib/terminal/replies.ts`), and the page sends its colours (`colors`) so a question about the background
  is answered with the one you see.
- **One socket per terminal.** `GET /ws/terminals/<id>` upgrades past the same guard as `/ws` (loopback Host, a
  same-site Origin, required). The server sends text frames for control, `reset { cols, rows }` before the screen and
  `live` after it, and binary frames for output, batched every 4 ms or 256 KB. The page sends binary frames for what
  you type and paste and text frames for `resize { cols, rows }` and `colors` (`parseTerminalClientFrame` in core, at
  most 1000 × 500). A page that falls behind (more than 4 MB buffered, or a frame dropped) is sent nothing more until
  it drains below 512 KB, and then the whole screen again, so a flood of output never piles up in the engine. The
  last page to resize sets the size; the shell gets `SIGWINCH` from the PTY. The page's `clear` frame (⌘L) clears the
  mirror's scrollback too, keeping the line the cursor is on, so a reload does not bring it back.
- **The list.** `Terminals` (`index.ts`) keeps the terminals in `data/terminals/terminals.json`, in your order, each
  with its project, folder, the name you gave it, the shell's title (OSC 0/2, 200 characters at most), its status
  (`running`, `exited` with its code, or `stopped`), the service it runs (`serviceId`, below) and times, and pushes
  the list to every page as `terminals` on the main socket whenever it changes (coalesced over 50 ms), with your
  services and your home folder. Each
  terminal's screen is saved to `data/terminals/<id>.screen` (its last 1,000 lines, serialized) two seconds after it
  last printed and when Shinsa stops. At most 32 terminals.
- **When the engine stops.** `stop()` hangs up every shell (`SIGHUP` and the PTY closed, as closing a terminal window
  does, then `SIGKILL` after 3 s), so nothing it started outlives the engine, and saves each screen. A restarted
  engine cannot have the shell back: a terminal that was running shows as `stopped`, with its last screen and Start
  again, which starts a new shell in the same folder below the old output. Closing a terminal hangs it up and deletes
  its screen.
- **Where it may open.** `POST /api/terminals { projectId, path, command? }` opens one only in a place of the
  project (`listTerminalPlaces` in core: its repositories, its folders and the worktrees of its open tasks), or your
  home folder for a project with none, and only in a folder that exists. With `command`, the command is typed into
  the new shell followed by Return. The rest: `POST /api/terminals/<id>/rename { name }` (60 characters, null for
  none), `/restart`, `/close`, `POST /api/terminals/order { projectId, ids }`, `GET /api/terminals` (the list,
  `shinsa terminals list`) and `GET /api/terminals/<id>/foreground` (below). Inspect mode refuses every change.
- **What runs in front.** `GET /api/terminals/<id>/foreground` answers `{ program }`: the name of the program in the
  terminal's foreground process group when it is not the shell itself, else `null` (`readForegroundProgram` in
  `pty.ts`: `ps -o tpgid=` of the shell gives the group that owns the PTY, the way Terminal.app decides whether to ask,
  and `ps -o comm=` names it). The page asks it before closing a running shell and closes an idle one at once; a
  running service always counts as busy and answers its own name. `test/terminals/routes.test.ts` checks it against a
  real shell running `sleep`.
- **Your terminals are yours.** No agent tool reaches a terminal; every write route needs a browser's Origin
  (`browser_only` otherwise, so `curl` and the command line cannot type into one); `shinsa terminals` is human-only;
  and `agents/policy.ts` refuses a shell command that names `/api/terminals` or `/ws/terminals`. As everywhere in Who
  can change Shinsa, this keeps an agent from doing it by accident, not one set on it.
- **An agent that needs you to run something** asks (`ask`) with the command in a ```` ```bash run ```` block in
  its context, as the tool's description says; the house rules (`prompts/rules.ts`) and the `handover` and `review`
  skills teach every role the `run` mark, and a plain ```` ```bash ```` block is an example with Copy alone. The
  question card shows Run in terminal in that block's corner (as every block marked `run` on a task's pages does), which opens a terminal in the task's worktree, or its repository, and runs it. Nothing runs until you press it.
  Running types like a person (`TerminalSession.type`): it waits until the shell has printed and then been quiet for
  150 ms (its prompt; at most 5 s, so a busy program cannot hold it), types the command, and presses Enter 30 ms later
  as a key of its own. A shell such as fish does not run a line whose Enter arrives in the same read as the text, and a
  command written before the shell's first prompt is lost or mangled, so both waits matter.
- **The look is Shinsa's.** The engine sends no appearance: the page draws every terminal in the `--terminal-*` tokens (the Code tab's colours)
  and the Code tab's mono font (`docs/design.md`, 37). Reading Ghostty's config was removed on 2026-10-26.

### Services

A service is a command you keep running for a project, such as `bun run dev` in `apps/api`: started with one press,
then only watched (`docs/design.md`, 37). It is a terminal under the hood, so everything above holds for it.

- **What one is.** `ServiceDefinition` (core's `protocol/services.ts`): an id, its project, a name (40 characters, one
  per name in a project), the folder it runs in (one of the project's repositories or folders, or a folder inside one;
  not a task worktree, which goes away; `resolveServicePlace` in `routes.ts`), the command (4,000 characters) and
  variables added to your environment (50 at most, names a shell can export). It runs as `<login shell> -l -c
  <command>` in its own terminal tab (`TerminalInfo.serviceId`), with the terminal's environment and its variables
  over it, so the shell that started it is the program: it ends when the command ends.
- **Kept beside the terminals, not in the event log.** The definitions are in `data/terminals/services.json` (mode
  600: a variable can be a secret). They are not events because nothing `decide` reads depends on them, no agent may
  change them (an event would need a user command, and every user command has a surface spec that agents' tools are
  generated from), and they describe this machine: folders and commands that only mean something here, like the MCP
  servers you add (`extensions.json`) and the terminals themselves. They are written whenever they change and read
  once at start; a broken file is logged and read as empty.
- **States.** `resolveServiceState` (core) reads the service's terminal: none or `stopped` is stopped; running is
  starting for its first 3 s (`SERVICE_LIMITS.startingMs`) and running after; exited with 0 is exited; exited with
  130 or 143 (an interrupt or a terminate you sent) is stopped; any other code, or none, is failed. `resolveServiceView`
  adds how long it has been so, `resolveServicesSummary` the counts the header shows.
- **Start, stop, restart.** `POST /api/services/<id>/start` opens the service's terminal the first time and starts its
  command again in the same tab after that, below the old output (a start of a running one does nothing). `/stop`
  hangs it up as closing a terminal window does (`SIGHUP` and the PTY closed, `SIGKILL` 3 s later): the whole
  process group, so a dev server and the watchers it started end together, and the tab stays with its last screen.
  `/restart` stops and starts. `POST /api/services/start-all { projectId }` starts every service of a project that is
  not running. Closing a service's tab stops it and forgets the tab; the service stays.
- **Across a restart of the engine.** `Terminals.stop()` saves a service that was running as running, and the next
  engine starts it again (`resumeServices`, from `serve.ts`), where its folder is still one of its project's; plain
  shells come back as `stopped`, as before. Inspect mode starts nothing.
- **Found for you.** `GET /api/services/suggestions?projectId=` (`detect.ts`, `listServiceSuggestions`) reads each of
  the project's repositories and folders, fast enough to run when the Services popover turns to Add services (a few file reads,
  no process): the run script of every workspace the root `package.json` names (`workspaces` as a list or
  `{ packages }`, and `pnpm-workspace.yaml`; `dir/*` patterns and exact folders, `!` patterns skipped), or of
  `apps/*`, `packages/*` and `services/*` when it names none (Turbo and Nx layouts), named after its package without
  the scope (`@shop/api` is "api"); the run script is `dev`, else `start`, else `serve`. The root's own script is
  "all" when there are workspaces and the package's name otherwise. Then a `deno.json` task (when there is no
  `package.json`), `bin/dev`, else each `Procfile.dev` line, else each `Procfile` line; each Docker Compose service
  as `docker compose up <name>` (`docker compose up` when none is read); `cargo run` for a crate with
  `src/main.rs` (not a Cargo workspace); `go run .` and `go run ./cmd/<name>` for a Go module; `python manage.py
  runserver` for Django; and `make dev` (or `run`, `serve`, `start`) only when nothing else was found there. The
  package command uses the package manager the lockfile names (`bun.lock`, `pnpm-lock.yaml`, `yarn.lock`,
  `package-lock.json`, `npm-shrinkwrap.json`), else `packageManager`, else npm. Each suggestion says whether it is
  `recommended`: everything is, but the root script that runs all the workspaces ("all", which would start them
  twice) and a workspace under `packages/`, `libs/` or `lib/` (a library's watcher, not a server). Two of one name
  are told apart by their folder. It leaves out what you already added (a service of the project with the same
  folder and command, or with the same name, which could not be added again) and offers 24 at most. Nothing is
  added or started until you press it.
- **Adding and changing.** `POST /api/services { projectId, name, path, command, env }`, `POST /api/services/batch
  { projectId, services: [{ name, path, command, env }…] }` (what Add services sends for the suggestions you tick:
  every one is checked, names unique among them too, and the limit counted, before any is added; the answer is
  the snapshot with the new ones as `added`), `/api/services/<id>/update`
  (the same fields; a running service keeps its old command until it restarts, and its tab takes the new name)
  and `POST /api/services/remove { ids }` (what Manage sends for the ones you tick, one id or many: every id is found
  before any is removed, each running one stopped and its tab closed, and the answer is the snapshot) need a
  browser's Origin, like every terminal change: a definition is a
  command that runs as you. Start, stop and restart do not, so `shinsa services start|stop|restart` work from your own
  terminal.
- **Agents.** No tool reaches a service, `shinsa services` is human-only, and `agents/policy.ts` refuses a shell
  command naming `/api/services` as it does `/api/terminals`.

## Agents manage Shinsa

There is no separate conversation with Shinsa. Every task agent can do what you can do in Shinsa, and a task is how
you talk to it: an Answer task (no repository work) is a conversation, and any task's chat is a place to ask its
agent to change a priority, suggest tasks, pause a schedule or finish. Ported from Kanna's delegator and orchestration
tools and T3's MCP toolkits.

- **The tools.** Every task run (not a delegated run, not an idle compaction) gets, besides its role's tools
  (`listToolNames`), one tool per surface spec but the ones that are yours alone and `tasks create`, whose
  `agentTool` is `create_task` (`tasks_list`, `tasks_show`, `tasks_done`, `tasks_prioritize`, `tasks_message`…;
  `apps/engine/src/agents/manage/tools.ts`), with read-only, destructive and idempotent hints. A call runs the spec
  with an in-process client: reads go to the server's own HTTP API, commands go through the same router as yours
  (`createCommandRouter`) to `Engine.dispatch` with `onBehalf` and `byTask` (the run's task), under the tool call's id
  (`agent:<run>:<attempt>:call:<request>:<n>`). Adding a repository or a folder to a project runs in process too, on
  your behalf (`createProjectChanges`, the work the project routes do). A message an agent sends to a task
  (`tasks_message`) goes through the message classifier like yours unless it sets `as` (Rounds, above). Every role's
  house rules carry `MANAGE_RULES` (`packages/core/src/prompts/manage.ts`).
- **Its own task.** An agent may mark its own task done (`tasks_done`) when nothing is left to hand over and nothing
  is open (core refuses it while a round waits to start, a pull request is open or any gate is open: Rounds,
  above), change its
  priority and suggest tasks. Completing it settles the task, which ends the agent's run as cancelled; nothing
  opens a gate. Both show on the task's own activity as yours, on your behalf ("Set the priority to high", "Marked
  done"): `task.prioritized` and `task.staged` carry `by: 'you'` when you (or an agent for you) sent them, and
  triage's own choice of priority records nothing.
- **Other tasks.** Allowed, and never invisible: a command sent on behalf stamps every event it emits with
  `onBehalf: true` and `byTask`; activity those events record as yours shows as "‹handle› agent (on your behalf)"
  (`Activity.onBehalf`, `Activity.byTask`), and for a user command `decide` adds one `on_behalf.acted` event
  (command, task, a sentence, `byTaskId`) that `state.onBehalfActions` keeps as `OnBehalfAction` records, the last
  100: `shinsa activity`. A command that changes nothing records nothing, and a system command sent for you
  (`repo.register` when an agent adds a repository to a project) is stamped but records no action.
- **Decisions only you make** have no tool (the list is Who can change Shinsa, below). `MANAGE_RULES` tells an agent
  that is asked in chat to merge or approve to reply that you do it at its gate in Shinsa, with a link to the task. A
  message it sends to a task with an open gate is kept for that task's next agent, never delivered into the gate
  (Gates → What a message does, above).

## Who can change Shinsa

Shinsa is a local server for one person, and every agent runs as that person, on that machine, with a shell. There
are no keys, codes or cookies: a key an agent's shell can read (or unset its way around) protects nothing, and an
agent with a shell can already run `gh pr merge` or `git push` without asking Shinsa at all. So the server says
plainly what protects what.

- **The address.** `shinsa engine` binds to `127.0.0.1` (`SHINSA_HOST` changes it), so nothing off the machine
  reaches it.
- **Other websites.** `http/guard.ts` refuses a Host that is not loopback, `SHINSA_HOST` or `SHINSA_ALLOWED_HOSTS`
  (DNS rebinding), an Origin from anywhere else and `Sec-Fetch-Site: cross-site`, an `/api` request other than a GET
  or HEAD that is not `application/json` (so no cross-site form or `text/plain` post is ever "simple"; 415) and a
  WebSocket without an Origin. A request with no Origin header (the command line, `curl`) or a loopback Origin (the web
  app) is taken. A page in your browser on another site therefore cannot change anything. Two routes skip part of the
  guard: the webhook URL (`/api/hooks/<schedule>/<token>`) skips all of it, let in by its token, a rate limit and an
  optional signature; the MCP sign-in callback (`GET /api/mcp/oauth/callback`) checks only the Host, since the
  provider's page sends you there.
- **Decisions only you make.** These are human-only:
  - closing any gate: a plan, review, merge or operation, your OK on a proposal, an agent's question or secret request,
    a failure, setup or Sign in gate, in any way (`plans *`, `reviews *`, `merges *`, `operations *`, `questions
    answer`, `gates answer`, `command`, which can send any gate answer);
  - giving or declining a secret (`gates secret`, `gates decline-secret`, `schedules webhook-secret`);
  - the settings that spend money, merge or decide for you (`HUMAN_ONLY_SETTINGS` in `domain/settings.ts`:
    `approvePlans`, `mergeMethod`, `taskBudgetUsd`, `taskUsageLimit`, `autoResume`, `snoozeLimited`,
    `accountSwitchAt`, `fastMode`, `agentFastModes`, `delegationLimit`) and a repository's checks, workspace and coverage
    (`HUMAN_ONLY_REPO_FIELDS`: `checkCommands`, `checksWaived`, `workspace`, `coverage`); agents keep the rest (models,
    providers, fix rounds, attention, compaction);
  - signing in and the accounts Shinsa runs on (`accounts sign-in`, `sign-in-code`, `import`, `remove`);
  - MCP servers, plugins and skills (`mcp check`, `add`, `remove`, `sign-in`, `sign-out`, and every on and off switch);
  - updating Claude Code or Codex (`versions update`, Versions and updates, below);
  - opening a worktree in an editor (`tasks open`);
  - your terminals: listing them (`terminals list`), and opening, typing into, renaming or closing one, which has no
    command at all (Terminals, above);
  - your services: `services list`, `start`, `stop` and `restart`, and adding, changing or removing one, which only
    the page does (Terminals → Services, above);
  - stopping, restarting or running the engine (`shinsa stop`, `restart`, `engine`: `HUMAN_ONLY_ENGINE_COMMANDS` in
    `cli/engine.ts`, refused in an agent's shell like the rest, since the engine is what runs the agent).

  They are decisions only you make, need you at the keyboard, or would put a secret through a model. Their surface
  specs are `humanOnly`, so `listAgentSpecs` leaves them out of every agent's tools, the prompt says they wait for you
  at their gate, and `agents/policy.ts` refuses in an agent's shell (Claude through its PreToolUse hook, Codex through
  its command approvals) `shinsa <path>` for each of them, `shinsa settings set` naming a human-only setting and
  `shinsa repos update` with `--checks`, `--no-checks`, `--waive-checks` or `--no-waive-checks`. Nothing checks words
  or keys: the first lock is that no agent tool exists for them. Core is the second lock: a command sent on your
  behalf is refused with `human_only` and records nothing when it is a `gate.answer` (`assertHumanDecides`), when a
  gate that was open before it is no longer open after it (`assertGatesStayOpen`, run at the end of `decide`, so
  retry, complete, cancel, wait-on, keeping a split-off and the rest cannot step past an open gate; both in
  `decide/gates.ts`), or when a `settings.change` or `repo.update` touches a human-only field (`decide/settings.ts`).
  A message sent on your behalf to a task with an open gate is kept for the next agent instead (Gates, above). So
  even a tool that reached the command could not decide a gate or step past it.
- **What a shell can still do.** Anything your account can. An agent that sets out to could post a command to
  `localhost:5180/api/commands` itself, or run `gh pr merge` or `git push` directly, and Shinsa would not know.
  `agents/policy.ts` refuses the obvious ones (`gh pr merge|create`, `git commit|push|rebase|reset --hard`, a
  `git pull` without `--no-rebase`, the default branch, every `but` command but the reads and the in-place conflict
  resolution, the human-only `shinsa` commands) so an agent does not do them by accident, but a policy over
  command text is a guard rail, not a lock. **The real safeguard for merges is GitHub's branch protection:** require
  a pull request review (from someone other than the account agents run as, or a code owner) and passing checks on
  the default branch, so a merge cannot happen without you whatever runs on your machine. Shinsa recommends it for
  every repository it works in.
- **Reads and the socket.** Every route and the socket (`/ws`) are open to whatever passes the guard; a command on
  the socket or `POST /api/commands` is yours. An agent's management tools dispatch in process, recorded on your
  behalf from its task (`onBehalf`, `byTask`), so their effect on other tasks stays visible.

## Projects and task identity

**Projects** replaced areas, which only grouped repositories for the focus. A project is `{ id, name, color, key,
description, folders }` (`packages/core/src/domain/types.ts`; the rules in `domain/projects.ts` and
`decide/settings.ts`), and its repositories are the ones whose `Repo.projectId` names it.

- **What belongs to a project.** Repositories you add to it (Settings → Projects, `shinsa projects add-repo`,
  `POST /api/projects/<id>/repos`), and every git repository one level inside one of its folders
  (`shinsa projects add-folder`, `POST /api/projects/<id>/folders`, which expands `~/` and checks the folder). A
  folder belongs to one project; writing a project moves the registered repositories inside its folders into it.
  A repository you add goes to that project. One triage registers on first use goes to the project whose folder
  holds it (the longest folder wins), else the task's project while that project has no repository yet (every
  repository was offered), else the project named after its GitHub owner (`Personal` for your own, `Local` without an
  `origin`), created on first use as areas were (`resolveRepoProject` in `triage/index.ts`). So a repository outside
  the task's project that the request names never joins the task's project.
- **A task is scoped to a project.** `task.create` takes `projectId`; left out, the task takes its repository's
  project, else the focus project (Home's composer shows that default and lets you change it, or pick No project).
  Triage then picks the repository among the project's own (registered ones and those in its folders, `listLocalRepos`
  over the folders), one outside the project that the request names (A task without a repository, above), or none,
  and names the project in its prompt; a project with neither falls back to every repository. A task without a
  project gets one from the repository triage picks, and keeps none when triage picks none; a task with a project
  keeps it, whichever repository it binds.
- **Agents know the project.** Every fresh task run's brief (not a resumed session, not a delegated run) ends with
  the project: its name and key, description, every
  repository with its path (the task's own marked) and its folders, and the repository the task works in when it is
  outside the project (`resolveProjectContext`, appended in `Decider.startRun`), so you never have to say which
  repository "the server" is.
- **The focus is a project** (`focus.change` `projectId`, or none for all work). It filters: `resolveQueue` keeps only
  the focus project's decisions and tasks, and every list built on it (Home, the queue button, the guide, ⌘K's
  decisions, the tab count and notifications) shows nothing from other projects. To see other work, you switch the
  focus.

**Task identity.** Every id Shinsa makes for the log (tasks, runs, gates, schedules, projects) is a UUIDv7 from the
engine (`Bun.randomUUIDv7()` behind `DecideContext.newId`); accounts use 8 hex characters and webhook deliveries
their own UUIDv7.

- *Two names per task*, with different jobs:
  - The **id** stays a UUIDv7: immutable, unique without coordination, ordered by creation, the only key in events,
    receipts, references (`shinsa://task/<id>`), transcripts and the effect outbox. Nothing ever re-keys it.
  - The **handle** is for people: `<project key>-<number>`, `SW-142`. The key is the project's (2 to 6 capital letters
    or digits starting with a letter, derived from its name, editable; lower case is upper-cased), or `T` for a task
    with no project. It is given once and never changes: on `task.created` when the task has a project, else on
    `task.triaged` (the repository's project). The counters live in the log (`state.taskNumbers`, one per key), so
    replay gives every task the same handle.
    Changing a project's key keeps every old handle; new tasks count from the new key's own counter, and changing the
    key back carries on where it left off, so a handle is never handed out twice. A task that moves projects keeps its
    handle.
  - *Where each is used.* The web's task URL is `/tasks/SW-142` (`/tasks/<uuid>` still opens, and is replaced by the
    handle URL); the command line and `/api/tasks/<ref>` take an id, a handle (any case), the start of an id or an
    exact title; agents see the handle in their brief and in `find_tasks`; events and references keep the id.
- *Sharing later* (not built). Tasks, their runs (sessions) and chats are already addressed by UUIDv7s that need no
  central authority, so a shared link would only need a namespace in front: `shinsa://<instance>/task/<uuid>`, and a
  run or chat `…/task/<uuid>/run/<uuid>`, where `<instance>` would be a UUIDv7 made once per Shinsa install (there is
  none yet). Handles are local labels: a project shared between machines would need one writer for its counter, and
  a handle shown off its own machine would be qualified with the instance's name (`chroxify/SW-142`). Nothing in the
  log would have to change for that: the handle is display and lookup, never a key.

## The briefing

The guide at the top of Home. `Briefings` (`apps/engine/src/briefing`) rewrites it 4 s after
the last command that asks for one (a gate opening or closing, a task finishing), so a burst of
changes costs one call.

- **Shape.** `Briefing` in `packages/core/src/briefing/types.ts`: `now` (a task id and why to take it
  first), `next` (up to three more, each with a why), `running` (one line on what agents are
  doing) and `note` (a heads-up, or null). It is stored beside a plain `text` rendering, which
  `shinsa status` prints.
- **Kept beside the log, not in it.** Only the newest guide per focus project matters and the writer rewrites it
  after every gate change, so it is not an event: `Engine.writeBriefing` keeps it in the `briefings` table of
  `shinsa.sqlite` (one row per project, `*` for the whole queue) and puts it into the state as `state.briefings`
  (the state's shape is unchanged), and every socket gets a `state.patch` at the same log position (`from` equal to
  `to`), which the page applies like any other. On boot the engine reads the table after the events, so a snapshot's
  older guide never wins. Inspect mode writes none.
- **The writer** gets every open decision with its id, title, what the gate really is (a review
  is built and checked, not ready to merge), its age, what it unblocks, priority and repository,
  plus what agents are working on. It answers with JSON against a schema in which `now.task` and every
  `next[].task` is a choice among the listed decisions' ids (Quick calls, in The agent loop).
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
  Used when the model is off, fails or answers badly. A task is paused when its gate is a failure,
  a setup to fix or a sign-in (`isPausingGate`); the fallback, the ranking and `shinsa status`
  (`Paused`) all read that one predicate.
- **Only the focus.** The queue the guide is written from (`resolveQueue`) holds only the focus project's decisions
  and tasks, so the writer is never told about others.
- **Showing it** (`reconcileBriefing`): Home checks the stored guide against the live queue.
  A `now` that no longer needs you means the plain guide until the next write; `next` drops
  decisions that are gone; `running` is always recomputed. Briefings stored as text only, before
  the guide had a shape, replay with `briefing: null` and show the plain guide.

## Guarantees

- **One commit for events, effects, cancellations and the receipt.** `EventLog.commitCommand`
  writes the events, the effect outbox, the cancellations the decision asked for and the
  command's receipt in one SQLite transaction, so a crash can never keep one and lose another.
- **Every command has an id, and a repeat is answered, not applied** (Command receipts, below).
- **Durable, ordered effects** (The effect outbox, below). Each effect has a key and a lane
  (`resolveEffectLane`; the lane of every kind is `docs/protocol.md` → Effects): one per task, a side lane per task
  for the cheap pull request watch, one for the briefing, and separate lanes per run for its session, its cancel and
  its steers, so a cancel is never stuck behind the session it cancels. Effects in a lane run in order. A failed replay-safe effect retries
  after 100 ms × 2ⁿ (capped at 30 s), up to 5 attempts; a process-bound one fails on its first error.
  An effect that gives up opens a failure gate on its task when its kind has one (triage, setup
  verification, the worktree, checks, opening, pushing or merging the pull request); the others are logged.
  Effects report back only by dispatching commands.
- **Stale output is dropped.** Agent commands carry their run id. A run that has ended, a
  finished task, or the wrong role is rejected with a message telling the agent to stop.
- **Liveness.** After every command each open task must have something moving it: a gate, an
  active run, an armed wait (a monitor on something outside the repository, or a usage limit),
  a typed wait on other tasks, or Shinsa itself (triage, checks, pull request). A task stuck in an
  agent stage with none of these gets a failure gate instead of hanging silently (`isTaskLive`). A
  task waiting on other tasks names the stalled leaf of its chain (Waits and monitors, above).
- **One wait at a time.** A monitor and a usage wait both restart a step later; a task has at most
  one of them armed. Every path that starts a step, pauses, settles or sends the task back to
  waiting on another task clears them through one call (`Decider.clearWaits`), and a due check or
  a reset that arrives for a task no longer in an agent stage starts nothing.
- **No agent cap.** Every queued run is dispatched in the command that created it (see
  Scheduling), unless the task is past its usage or cost limit: then the run is not started and the task
  pauses instead (Cost, above).

## Recovery

- A run that ends without handing over, or fails, is resumed once on its own session with a
  nudge. A second stop opens a failure gate. Any progress resets that budget. How a failed run
  recovers depends on its failure class, in the table in The agent loop (below): another account, a
  usage wait, a Sign in gate, a fresh session told to read the worktree, a resume of the same
  session, or a failure gate at once.
- **The round's Agent survives a restart and a lost session.** A restart mid-round resumes the Agent's session
  (restart continuation, The agent loop). A session that cannot go on (lost, overflowed, or on another provider) gets a
  fresh one with a handoff brief instead of the short instruction: `resolveRunBrief` in core writes the house rules, the
  round as it stands (the request, the goal, the plan, the approved version and your answers, every phase done with
  its summary, the earlier work) and the instruction for the step it is on, and the server adds the transcript
  handoff (Resume fallback, The agent loop). Core does the same when it starts an Agent run with no session to resume
  (a fresh-class failure), so `run.prompt` holds the brief and `run.rolePrompt` the short form.
- A fix loop stops with "not making progress" when the same failures come back after two fix
  rounds (checks by failing check names, the pull request by the names of its failing checks, the
  ids of its unresolved review threads and a conflict). New comments alone key nothing: they have
  their own limit, ten updates in a row that bring only comments (The pull request watch, below).
  `maxFixRounds` caps the automatic rounds; "until clean" keeps going, up to 12, while each round
  changes something. The agent review never fails this way: it escalates to your review instead
  (Review rounds escalate to you, above).
- Retrying a task, and asking for changes yourself, start a fresh automatic budget. Changes you
  ask for never use it up.
- **Recovery budgets are keyed to durable state, never to prose** (`resolveRecoveryFingerprint`).
  A recovery records the fingerprint of the task's stage, plan version, finished phases, the tree
  of its last commit, its failing checks, the files of its blocking findings and its pull
  request's checks, comments, conflicts and head. Progress only resets the budget when that
  fingerprint changed: an agent that writes a hopeful summary and changes nothing does not buy
  itself another round. A fix round records its reason, signature and tree (`fixFingerprints`);
  a fix that left the tree unchanged counts as a repeat even when the failures read differently.
- A message that reaches a session just as it ends is not lost: it is delivered to whatever
  runs next (`message.deliver`).
- A run that goes two hours without handing over is stopped as failed. Time spent waiting on your
  answer does not count, however many questions are open at once.
- On restart, effects bound to a dead process are cancelled, effects that were running and are safe
  to run again are requeued (The effect outbox, below) and queued runs are dispatched. Runs that
  were working come back through restart continuation (The agent loop, below).
- So every effect that touches the outside world is safe to run twice. A worktree's path depends only on the task
  and the branch it asked for, so a second `worktree.create` finds the first one and reuses it (a half-made folder
  is cleared first); a GitButler branch already applied is reused and an unapplied one applied again, and a main
  checkout already on the task's branch is kept (Where agents work, above). Opening a pull request reuses an open one for the branch. Merging asks GitHub first and never
  asks it to merge a pull request that is already merged or queued; one GitHub still shows as open (and not queued)
  after the merge fails the effect, which retries and
  then opens a failure gate, so a task can never sit in "merging" with nothing moving it. A commit after a crash
  finds nothing new and makes none. Git writes in a worktree wait out another process's `index.lock` for about
  1.5 s instead of failing (an editor or a terminal running git at the same moment).

## State in memory

The engine holds the state in memory and changes it only by adopting what `decide` worked out; the log stays the
truth, and a snapshot only saves replaying it.

- **No copy of the state per command.** `decide` works on a draft (`createDraft`, `packages/core/src/state/draft.ts`):
  the state's top level is copied, and a record of it (tasks, runs, gates and the rest, `STATE_RECORDS`) only the first
  time an event writes to it (`writeEntry`, `removeEntry`, the only way the folds write a record). Entities are never
  changed in place, a fold writes a new one, so everything else is shared with the state the command started from. The
  decision carries the new state and the ids it wrote (`Decision.state`, `Decision.changes`), and the engine adopts
  that state after the commit instead of applying the events again: it is the state replaying the events gives, which
  the random walks check after every command (`invariants.test.ts`), and the state before stays as it was, which is
  what a listener gets as `previous`. A refused command leaves its draft behind and nothing else.
- **Liveness and the queue in one pass.** Which tasks have an open gate or a run (`resolveMovingTasks`,
  `resolveActiveRunTasks`) is worked out once per command and once per queue, not once per task, and how many tasks
  wait on each is counted once per queue.
- **Snapshots.** `EventLog` keeps one snapshot of the state in its `snapshots` table: the state as JSON, the log
  position it was taken at, the problems found up to there, the state version, a checksum of the JSON and the anchor,
  a hash of the newest event row at or before that position. On boot the engine reads the snapshot and replays only the events after it
  (`readEvents(after)`, `replayEventLog(events, from)`). The snapshot is used only when its version is this code's, its
  anchor matches the row in the log and its checksum its JSON; otherwise the whole log is replayed (logged with the
  reason: `version`, `anchor`, `checksum` or `unreadable`) and a new snapshot written. The version is a hash of every
  source file of `@shinsa/core` and the snapshot format (`resolveStateVersion`, `apps/engine/src/store/snapshot.ts`),
  so a change to how events fold into state never reads an old snapshot; where those files cannot be read the version
  is null and the engine replays the whole log every boot and writes no snapshot. A snapshot is written 3 s after a
  boot that replayed events past it, 3 s after the last of 2,000 events since the last one (so a burst of work is never
  stalled by the write), and when the engine stops. `shinsa engine` builds its engine with the version, so every
  server keeps one; inspect mode never writes one, and an engine without a version (most tests) neither. A snapshot is
  only a shortcut: one that cannot be written is logged and left for the next. Anchoring on the newest row at or
  before its position lets a log whose last rows were moved out (below) still take one.
- **Older events in the user's log are rewritten once, on start.** Code never reads an old shape; when a change would
  leave one in a user's log, `store/legacy.ts` gets its rules and `LOG_VERSION` goes up by one. Logs written before
  the task Agent kept runs as
  `planner`, `builder`, `fixer`, `shipper` or `operator`, answers as `task.answered`, `specFirst` on `task.created`,
  the removed `worktreesDirectory` setting and worktrees without a `workspace`. Before it replays anything, a writable
  engine runs `EventLog.replaceLegacyEvents` (the rules are `store/legacy.ts`): a top-level run of one of those roles
  becomes the `agent` with the matching purpose (`plan`, `build`, `fix`, `fix`, `operate`), an `agent` run without one
  takes its task's stage at the time (else `build` for a phase, `plan` otherwise), a delegated run keeps a helper role
  (`builder` when its role is not one), no other run keeps a purpose, `task.answered` becomes `task.delivered` with
  step `answer`, and the rest take the current field. Logs from before the guide moved out of the log (above, The
  briefing) have their `briefing.written` rows moved: the newest per project goes to the `briefings` table with its
  row's time, every such row and the receipts of `briefing.write` are deleted, and the log position they reached is
  kept in `seq_floor`, so the next event never takes a position an earlier event had (server ids such as `boot:<seq>`
  name it). Logs from before the walkthrough's guide for testing (log version 3) have a `testing` list of strings in
  `phase.completed`, `work.submitted` and `walkthrough.revised`; it becomes `{ automated: <the list>, manual: [] }`.
  A pass that changes a row drops the snapshot, and SQLite's `user_version` (`LOG_VERSION`, now 3) marks the log so
  each pass runs once: a log at 1 or 2 only has its briefings moved and its testing lists rewritten
  (`listLegacyEventTypes`). A role it does not know stays as written:
  the run fold refuses a run whose role or purpose the current model does not have (`run_role_unknown`,
  `run_purpose_unknown`, `run_purpose_unexpected`), so it shows in `/api/health` problems instead of reaching a page.
  Inspect mode writes nothing: it runs the same rules in memory on its read-only view instead
  (`EventLog.applyLegacyView`), so an old log reads in the new shape with no false problems, its `briefing.written`
  rows are hidden from the events and their newest guide per project shown over the `briefings` table, and its
  snapshot is skipped (the whole log replays); the file on disk keeps its old rows and `user_version`.

## Command receipts

From T3 Code's orchestration v2 (harness plan WS4 names the sources). The engine
(`apps/engine/src/runtime/engine.ts`) checks and records every command against a `receipts` table the event log
keeps beside its events (`store/event-log.ts`).

- **Every command has an id.** `Engine.dispatch(command, { id })` takes the caller's; without one
  the engine makes a fresh `server:<uuid>`. The receipt stores the id, the command type, its
  target (`taskId:…`, `runId:…`, `gateId:…`, `repoId:…`, `projectId:…`, or `*`), a fingerprint of the
  whole command, whether it was accepted or rejected, and the range of events it committed.
- **A repeat is answered, not applied.** The same id with the same command returns the events the
  first dispatch committed (read back from the log) and changes nothing, across restarts too. A
  refused command is remembered: the same id gets the same refusal, with its code and message,
  even if the command would pass now.
- **An id is never reused for something else.** The same id with another type, target or payload
  is refused with `command_id_conflict` and leaves the first command's result alone.
- **What is recorded.** Every accepted command that committed something, every rejection, and
  every command whose id the caller chose (so a repeat of a no-op is still answered). A no-op under
  a fresh server id leaves nothing: nobody can repeat an id nobody knows. Receipts older than
  seven days are pruned at boot, like effects that finished or were cancelled (failed effects are kept).
- **The command line and agents.** Every `shinsa <group> <action>` invocation sends its commands with one
  `Idempotency-Key`, `cli:<uuid>` (`cli:<uuid>:1` for a second command in the same invocation), or the one given
  with `--idempotency-key`, so running the same invocation again with that key is answered from its receipt. An
  agent's management tool names each command after the tool call that sent it, like every other agent tool call.
- **Ids from outside.** A socket command's `id` (the one its `ack` carries) becomes
  `client:<id>`; `POST /api/commands` takes an optional `Idempotency-Key` header (200 characters
  at most). The web client keeps every command it has not had an answer for and resends it under
  the same id after a reconnect, so a command that reached Shinsa just before the connection
  dropped is applied once. It gives up, with "Lost the connection to Shinsa.", after the
  connection drops a third time under it.
- **Deterministic server ids.** Every command the server sends is named after what caused it: two different causes
  never share an id, and the same cause sent again gets the same id, so it is answered from its receipt instead of
  applied twice. An effect that reports back names its command after itself: `<effect key>:task.triage`,
  `:checks.record`, `:config.record`, `:worktree.ready`, `:worktree.gone`, `:pull_request.record_push:<sha>`,
  `:task.commit_edits:<tree>`, `:task.record_workspace_update`, and `<effect key>:effect.fail` when it gives up, and a repository triage or the setup check registers
  `<effect key>:repo.register`. The
  clocks name theirs after what they fire (`monitor:<id>:<attempt>`, `schedule:<id>:<dueAt>` and
  `schedule:<id>:<dueAt>:fail` for a fire that failed, `usage-resume:…`). The files two open tasks both change go
  under `overlaps:<task>:<hash of the overlaps>` (Other work in the repository).
  - A run (`agents/supervisor.ts`): its attempt ids are `<run>:<n>`, and the attempt's commands are
    `run.attempt:<attempt>`, `run.link:<attempt>:<session>`, `run.meter:<attempt>` (and `run.meter:<attempt>:<session>`
    for each agent a Codex agent started) and `run.end:<attempt>`
    (`run.end:<run>` when it ended before any attempt); `run.record_lost_session:<run>:<session>`; the messages it never
    took, delivered after it ends, `message.deliver:<attempt>:<index>` (`<run>:0` before any attempt); a message too
    late to steer `<effect key>:message.deliver`. A shutdown marks a run under `run.interrupt:<attempt>`, or
    `run.interrupt:<run>:0:<continuations>` before its first attempt of this boot. A boot sends everything under the
    log position it started from: `boot:<seq>:run.continue:<run>`, `boot:<seq>:runs.dispatch`,
    `boot:<seq>:delegations.recover`. Idle compaction uses `idle-compact:<run>:<session>`, and its cost
    `idle-compact:<run>:<session>:run.meter`.
  - Reports and questions: `delegation.record_delivery:<run>:<generation>`, `delegation.release:<run>:<generation>`,
    steered reports the session never took `delegation.release:<attempt>:steered`; an answer that reaches the
    task as a message `question:<gate>:message.deliver`; the silence watch `run.silence:<run>:<since>`, and
    `run.silence:<run>:<since>:heard` when output clears it.
  - Agent tool calls: `agent:<run>:<attempt>:call:<MCP request id>:<command type>` (`:<n>` added when one call sends a
    command type more than once); `delegate_task` and `create_task` with a `client_request_id` keep
    `agent:<run>:<attempt>:delegate:<id>` and `agent:<run>:<attempt>:create_task:<id>`. A call that comes without a
    request id (only tests) gets a fresh id.
  - The accounts service: `login:<sign-in>:account.signed_in`, `account.removed:<account>`, and
    `provider-login:<provider>:<gates>` for `provider.record_sign_in` when a provider's own sign-in is back. A secret pasted or declined at its
    gate: `secret:<gate>:saved`, `secret:<gate>:declined`. A repository added to a project (`POST
    /api/projects/<id>/repos` or `/folders`, or an agent's tool): `repo:<path>:<seq>` (the log position, so
    registering a path again after `repo.remove` is a new command); the project change it makes gets a fresh id.
    Webhook deliveries: `webhook:<schedule>:<delivery>`, and `webhook:<schedule>:<delivery>:fail` for one core
    refused. A setup answer:
    `setup:<run>:<step>:<n>`, `n` the answers that run saved before it. `POST /api/onboarding/setup` has no cause to name and gets a
    fresh id, like any request without an `Idempotency-Key`.

  A pull request read (`pull_request.record`, `pull_request.read_failed`) carries no fixed id: each read is new
  information. A command sent without an id (a test) gets a
  fresh `server:<uuid>`.

## The effect outbox

From T3 Code (harness plan WS4 names the sources), on `EventLog` and `Engine`.

- **Recovery class per kind.** `EFFECT_RECOVERY` (core) puts every effect kind in one of two
  classes, and the type checker refuses a new kind without one: `process_bound` (the ones that talk to a live
  session) or `replay_safe` (`docs/protocol.md` → Effects lists each kind's). On boot
  (`EventLog.reconcileAfterRestart`) process-bound effects that were pending or running are
  cancelled; replay-safe effects that were running are requeued at once; an effect of a kind this
  version does not know is failed so it cannot block its lane. Effects that were only pending keep
  their place.
- **Cancellable effects.** A decision can cancel open effects of a task by kind
  (`Decider.cancelEffects`; the `cancellations` of a `Decision`). They are cancelled in the same
  transaction, before the decision's own effects are added. Settling a task cancels its triage,
  setup verification, worktree setup, checks, pull request open, push and watch (and its merge when it was
  not merged); starting a round of checks cancels the round it replaces. A cancelled effect that is
  running is aborted at once: its `AbortSignal` fires (a running check command, push or `gh` call is
  killed; a merge that has not reached GitHub stops; an open or push that has not pushed yet pushes
  nothing and opens nothing) and its lane is free. Whatever it does afterwards is
  ignored: settling, retrying and failing only change an effect that is still `running`, and a
  late failure is only logged.
- **A side lane for cheap work.** The pull request watch runs in `side:<taskId>`, so a read never
  waits behind a long merge or a push backing off in `task:<taskId>`. Every decision it feeds is
  guarded already (a push in flight, a merge running, a run active). It is the only per-task effect
  that belongs there: the others in `task:<taskId>` (triage, setup verification, the worktree, checks,
  opening, pushing, merging, removing the worktree and the scratch folder) must run in that order, and the briefing is not
  per task, so it keeps its own `briefing` lane.
- **Nothing waits for one effect.** Shutdown waits for every running effect and its handler at once (`Engine.settle`)
  and a step waits for the runs before it, not for an effect, so the engine has no per-effect waiter
  (T3's `awaitSettled`). Tests wait for an effect's row to settle (`awaitEffect` in
  `apps/engine/test/helpers`).
- **Damaged rows.** A stored effect that is not JSON, or whose payload does not match its kind,
  is failed when it is claimed and the next effect in its lane runs in the same claim.
- **No gap between claim and cancel.** A claimed effect registers its abort controller in the
  same synchronous step that claims it, and commits run on the same thread, so a cancellation can
  never land between the two (T3 re-reads the row for this; one process with one connection does
  not need to).

## The pull request watch

From T3 Code (harness plan WS4 names the sources). The evaluation is pure
(`evaluatePullRequestWatch`, `packages/core/src/decide/watch.ts`); its
state lives on the task (`task.pullRequestWatch`, changed only by `pull_request.watched`); the
server reads GitHub (`apps/engine/src/github`) and reports with `pull_request.record`, which now
carries the comments it read (`remarks`) and who is reading (`viewer`).

- **What a read holds.** `gh pr view` for the pull request, then one GraphQL read for each check
  by name (with whether it is required and its link), every comment, every review with a body or
  a verdict, every review thread with its comments, the reader's login, the merge queue entry, the
  auto-merge request and the last merge queue removal. Each read is compared with the last one and
  dispatched only when the pull request changed, a comment is new, or the watch would move; a read
  the watch effect asks for, or the one right after an open or a push, is always dispatched.
- **Per-check diff.** A check reported failed is not reported again until the head moves or it
  passes and fails again. A read with no checks keeps the last state (a host can answer with an
  empty list when its check read fails).
- **Required-gate growth.** "All checks passed" counts only the required checks when there are
  any, otherwise every check. It is reported again when a new required check shows up already
  passed (created and finished between two reads), never for another passing advisory check.
- **The comment watermark** (`remarksThrough`, `remarkIds`). GitHub times are per second, so
  comments at the boundary second are told apart by id. A comment edited after the watermark
  counts again, once. Comments by the reader (the GitHub user Shinsa acts as, falling back to the
  pull request's author) never count.
- **An incomplete read never moves the watermark.** A read that could not list every comment,
  review, thread or thread reply reports `remarks: null`; the watermark stays where it was and
  the comments count on the next complete read.
- **`unknown` never clears a conflict.** GitHub answers `unknown` while it recomputes after a
  push; only a clean answer clears a conflict, so a conflict is reported once, not again after
  every push.
- **Ten comment-only updates in a row stop the watch** (`PULL_REQUEST_WATCH_WAKE_LIMIT`). A head
  that moves, or any check or conflict news, resets the count, so this only stops a chatty bot
  looping a fix. The watch stops (`stopped: 'comment_limit'`) and a failure gate says so.
- **One read of a task at a time.** The watch effect, the periodic sync and the sync after a push
  queue behind each other per task, so an older read is never recorded after a newer one. A read
  stopped by a cancel or a shutdown records nothing and does not count as failed.
- **Eight failed reads in a row stop the watch** (`PULL_REQUEST_READ_FAILURE_LIMIT`, core). Each
  failed read is `pull_request.read_failed` and the count is in the log (`task.pullRequestReadFailures`,
  `pull_request.read_failed` events, capped at eight), so a restart keeps it. A good read resets it: the
  server records a read whenever the count is above zero, and `pull_request.record` clears it
  (`pull_request.read_failures_cleared`), as does restarting a stopped watch. A read GitHub refuses for its
  rate limit is logged and not counted, since waiting is the fix. At eight the watch stops (`stopped:
  'unreadable'`) and a failure gate says how often and why. It is not acted on while an agent works on the
  task or while the merge gate is open; the count stays at eight and the next failed read acts once it can.
- **A stopped watch** is not read by the periodic sync. Retry restarts it (the push or the
  recheck it starts), and so does a read that finds the pull request clean: that one opens the
  merge gate and withdraws the failure gate.
- **The head Shinsa pushed.** A read whose head is not the commit Shinsa last pushed is not
  judged while GitHub has not shown that commit yet ("waiting for GitHub to see the push"). Once
  it has, a different head is someone else's push (`pull_request.head_moved`): the merge gate is
  withdrawn, the new head becomes the one Shinsa follows, and it is judged like any read, so the
  merge gate only comes back for a head whose checks passed.
- **What the Agent is told.** "New since Shinsa last looked" lists the checks that newly failed
  (with their links), the new comments (author, file, the first 200 characters, link) and a new
  conflict, ten of each at most and how many more; "Where it stands" lists the standing problems.
  The watch's changes also land in the task's activity.
- **Conflicts.** A pull request GitHub reports as not mergeable (`mergeable: false`, CONFLICTING), whether
  the default branch moved, a stacked round's or a stacked GitButler task's base merged (a squash merge leaves
  the base's commits on the branch) or was force-updated, is fixed like any other problem: at the merge gate
  or while waiting for CI, the merge gate is withdrawn and the Agent takes a fix turn in its own session
  (`purpose: 'fix'`, resuming `Decider.taskSession`). Before recording such a read the watch fetches the pull
  request's base (`git fetch origin -- <base>`; the base is the one the watch just retargeted to, so a
  stacked pull request whose base merged is merged with the default branch), and the prompt names it: merge
  it in with `git merge origin/<base>`, resolve every conflict, `git add` the files and leave the merge
  uncommitted. Shinsa never rebases: the shell policy refuses `git rebase` and a `git pull` without
  `--no-rebase`, and nothing Shinsa runs force-pushes a worktree or main checkout. On `complete_fix` the
  commit concludes the merge even when the resolution changes no file (`commitWorktree` commits whenever
  `MERGE_HEAD` exists), refuses while a path is still unmerged (the agent is told which), and an undone
  hand-over puts the merge back in progress, its message with it; the push then makes the pull request
  mergeable again. The merge commit carries git's own message, not the fix's: the subject git prepared in
  `MERGE_MSG`, with a merge of a remote-tracking branch named as the branch ("Merge branch 'main' into
  fix/login", as GitHub's own update writes it), and the fix's subject only when git left no message. In a
  GitButler workspace `git merge` would take the checkout out of GitButler, so there the watch opens the Update
  the workspace gate instead of starting a fix (Where agents work → GitButler, above). A conflict the Agent
  leaves twice stops at "Fixing is not making progress", as any fix does.

## Merge queues

A pull request GitHub puts in its merge queue, or on auto-merge, is waiting, not failed.

- The merge effect reads the pull request first and never asks GitHub to merge one that is already
  queued or merged. After `gh pr merge` it reads again: merged settles the task, queued (or
  auto-merge) is recorded and the effect succeeds, and only open and not queued fails (and is
  retried, then becomes a failure gate).
- While the merge runs, each read updates the stage: "waiting in GitHub’s merge queue (position
  3)", "in GitHub’s merge queue, waiting for its checks", "waiting for GitHub to merge it
  automatically". The merge gate stays closed.
- A read that finds the pull request out of the queue and not merged is a rejection. The task
  goes back to shipping and is judged like any other read: a clean pull request reopens the merge
  gate with GitHub's reason first in the body ("GitHub’s merge queue took the pull request out
  without merging it: failed checks."); one that now fails goes back to the Agent with the same line.
  The queue's own checks run on a merge group, not on the pull request, so a rejection usually
  finds the pull request clean and the decision is yours.

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
| `notice` | `notice` (keyed by `kind`) | Something about the run rather than the conversation: `interrupted`, `compaction` (`trigger`: `auto`, `manual` or `fold`, `preTokens`, the `summary` once the agent writes it, and `by: 'eunoe'` when eunoe compacted or folded on the wire), `proxy` (`proxy: 'eunoe'`, `status: 'unavailable'`, `detail`: eunoe could not be reached, so the run went direct), `fast_mode` (`status`: `unavailable` or `cooldown`, `reason`: fast mode was asked for and is not running), `extensions` (what the run loaded and what the optimizer left out; MCP servers, plugins and skills, below), `context` (`usedTokens`, `maxTokens`, `totalProcessedTokens`), `account` (`email`, `organization`, `plan`), `rate_limit` (`status`, `limit`, `resetsAt`, `utilization`), `account_switched` (`email`, `previous`, `reason`: `usage_limit`, `signed_out`, `headroom` or `bound`; written by the supervisor when an attempt runs on another account than the task's last one), `delegation` (`event`: `started` or `reported`, `runIds`; written when the step delegates a task and when reports reach it) and `handoff` (`reason`, `fromProvider`, `toProvider`, entry counts) |

`agent`, `tool_call` and `tool_result` carry `parentCallId` when a subagent produced them: the
`callId` of the `task` call that started it. Such entries are never a final reply
(`isSubagentEvent`, `markFinalReplies`), the web leaves them out of the main timeline, and a handoff
leaves them out because the `task` result already carries the subagent's report.

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

**The Claude adapter** is `apps/engine/src/agents/providers/claude/`: `map.ts` (tools, results, prompts), used live
by `createClaudeRecorder` in `recorder.ts` and offline by `convertClaudeSession` in
`import.ts` (the seed). `Read`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Bash`, `BashOutput`,
`KillShell`, `Grep`, `Glob`, `LS`, `WebFetch`, `WebSearch`, `Task`, `TodoWrite` map to their kinds;
`mcp__<server>__<tool>` maps to `shinsa` for Shinsa's own server, `browser` for `browser_*` tools
and `mcp` otherwise. A subagent's text, calls and results are recorded with `parentCallId` (the
SDK runs with `forwardSubagentText`), `<tool_use_error>` becomes an error result, and wrapper tags
(`<system-reminder>` and the like) are stripped; `<kanna-attachments>` become attachments. The
recorder also writes the `notice` entries: compaction boundaries and summaries, rate-limit changes
(once per change, not per repeat), and, at the end of each turn, the context window as
`getContextUsage` measures it (5 s, falling back to the last main-thread step's usage).

A transcript line that is not a chat entry of the current protocol version reads as one unreadable-line error
entry.

**The Codex adapter** is `apps/engine/src/agents/providers/codex/map.ts` (`createCodexRecorder`, used live by the
session). It reads `item/started` and `item/completed` on the run's own
thread: `commandExecution` → `command` (the `zsh -lc '…'` wrapper taken off, a nonzero exit or a declined command an
error result), `fileChange` → one call per file (`write` for an added file, `edit` with one hunk per `@@` block, a
removal as an edit to nothing, a move under its new path), `mcpToolCall` → `shinsa`, `browser` or `mcp` through the
same `mcp__<server>__<tool>` naming as the Claude adapter, `webSearch` → `fetch`, `collabAgentToolCall` (a spawned
Codex agent) → `task`, `imageView` → `read`, `dynamicToolCall` → `other`, and `turn/plan/updated` → `todo`. An
`agentMessage` is held until the next event, like the Claude recorder, and the turn's end makes the last one `final`.
A `contextCompaction` item (or the older `thread/compacted`) is one `compaction` notice per turn, a rate-limit push a
`rate_limit` notice per change, and the end of each turn a `context` notice.

*Agents a Codex agent starts* show in the step's turn the way Claude's subagents do (after Kanna's
`codex-app-server.ts`, which follows the threads of the agents a chat spawned). A `collabAgentToolCall` with tool
`spawnAgent` and its `receiverThreadIds` is the `task` call, and the session follows each receiver thread: its
`item/started` and `item/completed` map through the same recorder with `parentCallId` set to that call, so a
command, an edit or a message of the agent nests under it (a nested agent under its own spawn call), and its
`turn/completed` ends the call, with the agent's last message as the result (an error when the turn did not
complete, "The agent stopped before it finished." without a message). An agent Codex reports only through
`subAgentActivity` items (`started`, `completed`, `interrupted`, with its `agentPath`) gets a call of its own,
`agent:<thread>`, named after the last part of its path. Events of a thread that arrive before the call that
starts it are held (500 at most) and replayed once it does; threads nobody started stay out of the transcript. A
step that ends with an agent still open closes its call as failed ("The agent was still working when the step
ended."). Agent text is never a final reply (`isSubagentEvent`), each agent's tokens are metered on its own thread
(Cost, above), and a compaction inside an agent writes no notice. Nothing in `packages/core`, the run supervisor or
the web is provider-specific.

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
too. The follower also checks the file every second, so a change the file watch missed (a busy
machine) or a watch that failed (out of file handles) never leaves it quiet.

## Providers

Every agent run goes through one interface, `AgentProvider` in `apps/engine/src/agents/providers/types.ts`. The run
supervisor resolves the provider for the run's role (`resolveAgentProvider`: Settings → Agents, else
`settings.defaultProvider`) through the `ProviderRegistry` (`agents/providers/index.ts`; an unknown id falls back to
Claude with a warning) and never names one. A delegated run uses the provider it was delegated on (`run.provider`),
and a session is resumed only by the provider that owns it. Two providers are registered: Claude (the Agent SDK,
`providers/claude/`) and Codex (`codex app-server`, `providers/codex/`, below).

| Member | Contract |
| --- | --- |
| `id`, `label` | `claude` / `Claude`, `codex` / `Codex`. The id is what `settings.defaultProvider` and `settings.agentProviders` store |
| `startSession(input)` | Starts a run in `input.cwd` with `input.prompt`, or resumes the provider's own session when `input.resume` is set (Shinsa stores it from `onSession`). `input.account` names the leased account and its folder; `input.compaction` and `input.fastMode` carry the compaction setting and the role's speed (Compaction and fast mode, below); `input.onActivity` is called for everything the session does, so the idle timer restarts. `input.readOnly` says the run must not edit files (`isReadOnlyRun` in core: the Agent while it plans, the reviewer, answerer and researcher, a delegated planner), and `input.role` still picks its tools; a provider that cannot keep a run read-only (`planning.readOnly`) fails every such run as `setup_failed`. The role's Shinsa tools arrive as `input.tools`: an MCP `Server` and its `handle` function; the provider exposes them to its agent however it can. `input.extensions` carries the MCP servers, skills and plugins the run loads (MCP servers, plugins and skills, below), which the provider hands over its own way and records as an `extensions` notice; `input.usageBaseline` is what Shinsa already metered for a resumed session; `input.onEntry` receives everything the session does, mapped into the chat protocol (above) and nothing else, and the supervisor writes the transcript and the `status` entries. Every command the agent runs is checked against `agents/policy.ts` (no commits, pushes, rebases, `git pull` without `--no-rebase` or `reset --hard`, no PR creation or merges, no checkout of the default branch, no `but` command beyond reads and in-place conflict resolution) |
| `capabilities` | What the provider can do: `sessions` (`resume`, `inspect`), `turns.steering`, `approvals` (it can block a tool call before it runs), `planning.readOnly`, `contextHandoff`, `structuredOutput`, `accounts` (it runs on a leased account folder), `compaction` (it can compact an idle session) and `fastMode` (it can run at a faster, pricier speed). Policy branches on these flags, never on the provider's name; a provider that declares none gets `MINIMAL_CAPABILITIES` (all off) |
| `inspectSession({ cwd, sessionId })` | Optional. Whether the provider still has a session: `present`, `missing`, `empty` (metadata only, so it can neither be resumed nor recreated) or `unknown` |
| `AgentSession.done` | Resolves to `{ outcome: completed \| failed \| cancelled, summary, failure?, undelivered?, usage?, subagentUsage?, context? }` when the run ends: `failure` is the classified `RunFailure`, `undelivered` the steered messages the agent never answered, `usage` the session's running totals (metered with `run.meter`), `subagentUsage` the totals of each agent it started on its own thread (Codex), `context` the tokens in use, when the prompt cache expires and whether background work is pending (idle compaction reads it) |
| `AgentSession.steer(text)` | Delivers a message into the running turn; returns false when it no longer can, and the supervisor hands the message to the next run instead (`message.deliver`) |
| `AgentSession.cancel()` | Stops the session; `done` then resolves as `cancelled` |
| `AgentSession.hasPendingBackgroundWork()` | Optional: whether work the agent started in the background is still running, which pins an idle session |
| `AgentSession.loadMcpServers(servers, abandoned)` | Optional: adds servers the optimizer left out to the live session (Claude; Loading what was left out, below) |
| `compactSession(input)` | Optional: resumes `input.resume` only to compact it (idle compaction, below) |
| `listModels()` | The provider's models as `AgentModel`s labelled like `KNOWN_AGENT_MODELS`; `GET /api/models` serves it |
| `complete({ system, prompt, model, fastMode })` | One call with no tools and no thinking, for triage and the briefing (`agents/quick`) |
| `completeStructured({ system, prompt, model, schema, timeoutMs })` | Optional. The same call with JSON-schema output (20 s by default); `agents/quick` tries it first and falls back to `complete` |
| `readLogin()` | Optional. The provider's own sign-in as a `ProviderLogin` (`signed_in`, `signed_out`, `not_installed`, `outdated` or `unknown`, with the method, version and the fix). Codex has it; Claude's accounts have their own service (Accounts and usage limits, below) |
| `readUsage()` | Optional. The usage windows of the provider's own login (Codex; Codex usage, below) |

What each provider declares:

| Capability | Claude | Codex |
| --- | --- | --- |
| `sessions.resume` / `inspect` | yes / yes (session files) | yes / no: a resume Codex refuses comes back as `session_lost` |
| `turns.steering` | yes (prompt ids) | yes (`turn/steer`) |
| `approvals` | yes (the PreToolUse hook) | yes (a writing role runs `approvalPolicy: untrusted`, every unknown command asked; a read-only role `never`, in the `read-only` sandbox) |
| `planning.readOnly` | yes (no Edit or Write tools) | yes (the `read-only` sandbox) |
| `contextHandoff`, `structuredOutput` | yes, yes | yes, yes (`outputSchema` on an ephemeral thread) |
| `accounts`, `compaction` | yes, yes | no, yes: one Codex login (Accounts and usage limits, below); `thread/compact/start` compacts an idle thread |
| `fastMode` | yes (`settings.fastMode` in the flag-settings layer) | yes (`serviceTier: 'fast'`) |

Both providers also report usage windows (Claude per account, Codex through `readUsage`), price their runs (Claude's
own cost, Codex's from `CODEX_PRICES`), show the agents they start in the step's turn, write a `context` notice for
the context meter, take your messages mid-turn, hand a session over to the other provider, and stop at a Sign in
gate when signed out. What is still Claude-only, and why: several accounts with rotation and Run on account (one
Codex login), eunoe (a proxy in front of the Anthropic API), Claude Code's plugins as a whole and its PreToolUse hook
(Codex gets a plugin's MCP servers and the skills' paths, and asks for approval per command instead), checking a session file before a resume (Codex
has no file to check, so a refused resume is `session_lost`), background work pinning an idle session, and `shinsa
import` (it reads Claude Code sessions).

Provider-agnostic pieces stay outside `providers/`: the tool schemas and MCP server (`agents/tools`), hand-over
validation (`agents/handover.ts`), transcripts, the run clock, the command policy and the house instructions every
provider gives its agent (`providers/instructions.ts`). A further provider is a folder `agents/providers/<id>/` that
implements the interface and one entry in the registry. The provider is chosen per turn, not per run: each execution
of a run that is not delegated uses the role's current provider and records it (`run.attempted`, with the model:
the run's own when the provider is the one the run started on, else that provider's model for the role), and a
session is only ever resumed by the provider that owns it (`run.sessionProvider`, set by `run.linked`). Moving a role
to another provider while its run is paused or between turns hands the conversation over at the next execution,
Claude to Codex and back alike (The agent loop, below).

### Versions and updates

Settings → Agents → Versions shows each agent program Shinsa runs, Claude Code and Codex, and offers to update it
(`apps/engine/src/versions/`, after Kanna's `provider-auth.ts`, its latest-version check at 539-586 and its install at
592-668, and `claude-executable.ts:13-16`, 59-65). A newer Claude Code or Codex brings new features, and the Agent
SDK is built against one Claude Code (`claudeCodeVersion`; SDK 0.3.N pairs with Claude Code 2.1.N), so the program
must keep up with the SDK, never the other way round.

- **The snapshot** (`GET /api/versions` → `VersionsSnapshot`, `packages/core/src/protocol/versions.ts`): per
  program its path, the installed version (`--version`, read through the same mtime cache the providers use), the
  latest, the minimum (the SDK's `claudeCodeVersion` for Claude Code, `CODEX_MINIMUM_VERSION` for Codex), the
  updater it would run and whether an update is running, and a status: `outdated` below the minimum (runs refuse it,
  so the web warns), `update_available` below the latest, `current`, `not_installed`, or `unknown` when the version
  cannot be read or `CLAUDE_EXECUTABLE` / `CODEX_EXECUTABLE` names a wrapper (trusted as is: no version read and no
  update, as for runs). Then the Agent SDK: its version, the latest published and its `claudeCodeVersion`.
- **The latest versions** come from the `latest` dist-tag on the npm registry (`GET <package>/latest`:
  `@anthropic-ai/claude-code`, `@openai/codex`, `@anthropic-ai/claude-agent-sdk`), all three at once, cached for 3
  hours (`LATEST_TTL_MS`) and coalesced; `POST /api/versions/refresh` (Check for updates) reads them again. A lookup
  that fails is logged and keeps the last known value.
- **Updating** (`POST /api/versions/update {program}`, `shinsa versions update <program>`, human-only) runs the
  program's own updater (`updaters.ts`): `claude update` for Claude Code; for Codex, from where the binary really
  lives: `brew upgrade codex` under a Homebrew `Cellar` or `Caskroom`, `bun add -g @openai/codex@latest` under
  `.bun`, `npm install -g @openai/codex@latest` under `node_modules` (the npm or bun beside the `codex` on the PATH
  first, with its folder first on the PATH, so the update lands in the install that runs; Kanna
  `provider-auth.ts:647-668`), and `codex update` otherwise, the standalone install included. It runs argv only,
  with `NO_COLOR`, a 10 minute limit and the server's stop signal. With `Accept: application/x-ndjson` the answer is
  a stream of `UpdateStreamLine`s: each non-blank output line as it arrives (escape codes stripped, secrets
  redacted), then `done` with `{ ok, message, versions }`; without it, that outcome as JSON. A refusal comes before
  anything runs: an unknown program, inspect mode, one already updating, one not installed, or one set by an
  override. After a successful run Shinsa checks the provider sign-ins again (`syncProviderLogins`, so Codex's
  `outdated` login clears) and reads the version: a new one is "Updated Claude Code to 2.1.310.", the same one at
  the latest is "Claude Code is up to date.", and one still behind the latest is a failure ("The update finished, but
  Claude Code still reports …"; Kanna `provider-auth.ts:618-624`). A failed updater's message is its last line.
- **The Agent SDK is not updated at runtime.** `@anthropic-ai/claude-agent-sdk` is a dependency of
  `apps/engine`; Shinsa takes a newer one by bumping it in `package.json` (and the minimum Claude Code with it), so
  the Versions row only says a newer one is published.
- **Tests never run an updater.** The service takes `locate`, `readVersion`, `minimum`, `sdk`, `latest`, `updater`
  and `run` (`VersionsOptions`, `startShinsa`'s `versions`); the one test of the default runner points it at the fake
  `claude` in `test/helpers/bin`, whose `update` does nothing.

## MCP servers, plugins and skills

Agents load what you have set up, the same for Claude and Codex, and Settings → Integrations shows all of it with
what it costs at the start of every run, so you can turn off what you do not use. You never need Claude Code's
`/mcp`. The service is `Extensions` (`apps/engine/src/extensions/`); the wire types are core's
`protocol/extensions.ts`.

- **Where they come from** (`discover.ts`, read on every snapshot, never written): your Claude Code servers
  (`~/.claude.json` `mcpServers`, or `$CLAUDE_CONFIG_DIR/.claude.json`), its per-project servers (`projects.<path>
  .mcpServers`, used only in that repository), each repository's `.mcp.json` (only there), Codex's
  `~/.codex/config.toml` `[mcp_servers.*]` (`$CODEX_HOME`), every installed Claude Code plugin's `.mcp.json` or
  manifest (`${CLAUDE_PLUGIN_ROOT}` filled in), and the servers you add in Shinsa. `${VAR}` and `${VAR:-default}` are
  filled from the environment when an agent starts, and Codex's `bearer_token_env_var` becomes an `Authorization`
  header. Skills come from Shinsa's plugin, `~/.claude/skills`, each plugin, each repository's `.claude/skills` (only
  in that repository) and `~/.codex/skills`; plugins from `~/.claude/plugins/installed_plugins.json`. A file that
  cannot be read is a problem in the snapshot, and the rest still loads. Shinsa's own skills (review, evidence,
  handover) are always on: the snapshot still carries them, but `/skills/choose` refuses them (`skill_built_in`) and
  Settings does not list them.
- **One server, one row** (`catalog.ts`). The same server defined in several places (Claude Code's user servers,
  per-project servers, a `.mcp.json`, Codex, a plugin, Shinsa) is one group, keyed by what it runs: the URL without a
  trailing slash for a web server, the command and its arguments for one on this machine (`resolveServerKey`). Its
  lead is the member that ranks first by source (the order under Scope); the snapshot has one `McpServerSummary` per
  group with the lead's id and every member in `definedIn` (id, source, origin, scope, switch). It is on while any
  member is on, used everywhere while any member that is on is; turning it on or off, or choosing where it is used,
  applies to every member, so Maple defined in `~/.claude.json`, two projects and Codex is turned off once. It is
  checked once, its status kept under the lead's id (a member's older status is read when the lead has none), a
  sign-in on any member counts for the group, and a run loads it once.
- **Everything starts on.** Every server, skill and plugin you set up is loaded unless you turn it off here. The
  only exceptions are what you already turned off in the tool it comes from: a Codex server with `enabled = false`, a
  project's `disabledMcpServers` and `disabledMcpjsonServers` in `~/.claude.json`, and a plugin Claude Code's
  `enabledPlugins` does not turn on. Turning a plugin off takes its skills, agents, commands, hooks and servers with
  it. A server added in Shinsa is on and used everywhere.
- **Scope.** A server is used everywhere, in one project, or in one repository (`isScopeMatch`; a project's and a
  `.mcp.json`'s servers start scoped to their repository). When two servers that are on share a name, one wins:
  Shinsa's own, then a repository's `.mcp.json`, Claude Code's per-project, Claude Code's, Codex's, then a plugin's;
  the others show "Overridden by" it. Shinsa's server is always `shinsa`, a name nobody else may take.
- **What each choice changes** lives in `extensions.json` beside `config.json` (written atomically, mode 600): the
  servers you added, your switches and scopes for the others (by id: `claude:<name>`, `claude_project:<path>:<name>`,
  `project:<repo>:<name>`, `codex:<name>`, `plugin:<plugin id>:<name>`, `shinsa:<name>`), your skill and plugin
  switches, each server's last check, so its health and tools survive a restart, the context optimizer's settings
  (`optimizer`) and when Shinsa first saw each server and skill (`seen`, below). It describes this machine, so it
  is not an event. Environment values and headers are never sent to the web: the snapshot lists their names, and an
  edit that leaves one empty keeps the saved value. Editing a server from another tool copies it into Shinsa under the
  same name, and Shinsa's copy wins; only Shinsa's own servers can be removed.
- **How a run gets them** (`resolveSession`, called by the supervisor for every attempt with the task's repository
  and project). Claude runs with `strictMcpConfig`, so it reads no MCP config of its own: the servers that are on and
  match the place, plus `shinsa`, are handed to the session with `setMcpServers` before the brief goes in, so tokens
  and environment values never appear on a command line. Skills are `skills: 'all'` with Claude Code's
  `skillOverrides: { name: 'off' }` for each one turned off (a plugin's as `plugin:skill`), so Claude Code's own bundled
  skills stay; `enabledPlugins` names every installed plugin on or off in the flag settings. Codex skills reach Claude
  as a list of files to read. Codex gets the same servers as `config["mcp_servers.<name>"]` on the thread, its own
  servers that are off as `mcp_servers.<name>.enabled = false`, and every skill but its own as files to read in its
  developer instructions (it loads `~/.codex/skills` itself, so turning a Codex skill off only keeps it from Claude). A
  Claude plugin does not load in Codex as a plugin, but its MCP servers and skills reach Codex like any other. Turning a server off changes only what Shinsa's agents load: Shinsa never
  writes `~/.claude.json`, `~/.codex/config.toml` or a plugin, so Claude Code and Codex keep their own settings.
- **The context optimizer** (Settings → Integrations, on by default; `POST /api/extensions/optimizer {enabled?,
  days?, skills?}`, days a whole number from 1 to 365, 14 by default; `skills` on by default, so out of the box it
  leaves out MCP servers and skills unused for 14 days; core's `createContextOptimizer`). While it is on, a run leaves out every server agents have not used for `days` (and,
  with `skills`, every skill but Shinsa's own), and gets tools to load what it left out and instructions to use them
  (below). Unused is core's `isUnused`: the last use is older than the window, or there is none and Shinsa
  has watched for at least the window. A server or skill present the first time Shinsa looked is counted from the
  start of the history it read (`seen` stores it as 0), one added later from when Shinsa first saw it, so a server
  you add today is never left out today. Until the history has been read once, nothing is left out.
- **Usage** (`usage.ts`, `UsageIndex`) is read from your Claude Code sessions (`<Claude config dir>/projects/**/*.jsonl`:
  every `tool_use` named `mcp__<server>__…`, and `Skill` with its `skill`) and Shinsa's own transcripts (`mcp` tool
  calls by server, `Skill` calls, and `load_mcp_server` / `call_mcp_tool` by the server they name). Only files
  changed in the last 90 days are read, each from where the last read stopped (whole lines only, so a session still
  being written is finished next time), and the result is kept in `data/extension-usage.json`, so a restart reads only
  what is new. It runs in the background when Shinsa starts and when the snapshot is more than ten minutes old, and
  stops with the server. Claude Code's server names are matched as it writes them (`plugin_<plugin>_<server>`, other
  characters as `_`); Shinsa's chat keeps only the last part of a server's name, so that part is matched too. Each
  snapshot row carries `lastUsedAt` and `deferred` (the optimizer would leave it out now), and the snapshot `usage`
  (`readAt`, and `since`, the start of the history read), which the web turns into "Not used in 30 days · ~4k
  tokens".
- **The snapshot Settings reads is cached** (`Extensions.readSnapshot`). Building one reads every config, plugin
  and skill file (15 to 100 ms with a few hundred skills), so `GET /api/extensions` answers the last snapshot at once
  and builds it again on a zero-delay timer (`syncSnapshot`, one at a time), whose result the next read gets. Every
  change (`/servers/*`, `/skills/choose`, `/plugins/choose`, `/optimizer`, `/check`) answers a fresh one, which
  becomes the cache. Shinsa builds it once after it starts and again whenever a usage read finishes, and `stop()`
  clears the timer, so the first visit to Settings is as fast as the next.
- **Loading what was left out** (`loader.ts`, `ExtensionLoader`, made by `Extensions.createLoader` for a run that left
  something out; the supervisor adds its tool specs to the run's Shinsa tools and routes their calls to it). The
  tools exist only in such a run: `load_mcp_server {name}` (its description names each left-out server with its tool
  count), `call_mcp_tool {server, tool, arguments}` and, when skills were left out, `load_skill {name}` (answers the
  skill's `SKILL.md` without its front matter). `load_mcp_server`, `call_mcp_tool` and `load_skill` take a name in
  any form: exactly (`maple`, `plugin:docs:context`, `mcp__maple`, any case), else loosely, the way the human said it
  ("the Maple MCP", "Maple MCP server", "the release skill"): the words of the name, leaving out "the", "a", "an",
  "mcp", "server", "skill", "plugin" and "tools", must all be in what was asked for, and exactly one entry must
  match (two matches are refused, never guessed). `load_mcp_server` refuses one already loaded or not left out (a
  server turned off stays off), and then:
  - **Claude** (the session has `loadMcpServers`): the Agent SDK's `Query.setMcpServers` replaces the session's
    dynamically added servers, so the session adds the server to the set it already handed over (Shinsa's own and the
    loaded ones) and calls it again on the live query. Claude Code connects it and its tools reach the model from the
    next request, in the same turn, with no restart; the reply names them (`mcp__maple__<tool>`). A server that
    refuses, an error or no answer within 20 s falls back to the next path, and the session drops it from the
    servers it hands over (the loader aborts the `abandoned` signal, so a late answer drops it too): only Shinsa's
    connection serves it.
  - **Codex, and the fallback**: `codex app-server` has no request that adds a server to a running thread
    (`config/mcpServer/reload` only rereads `config.toml`, which Shinsa never writes), and restarting the thread to
    add one would end the turn. So Shinsa connects to the server itself (the same MCP client the health check uses),
    answers the server's tools with their input schemas, and the agent calls them with `call_mcp_tool`, which Shinsa
    forwards (two minutes at most; an error result becomes the tool's error). The connections close when the attempt
    ends.
  A load is recorded in the transcript like any Shinsa tool call, so it counts as a use: every run reads the new
  usage before it chooses what to leave out (once the history has been read once), so the server is not left out of
  the next run. The tools work the same on Codex, which reaches them through Shinsa's own server.
- **What the run is told** (`resolveDeferredInstructions` in `session.ts`). A run that left something out gets a
  "Left out until needed" section in its instructions (Claude's appended system prompt, Codex's developer
  instructions): the left-out servers by name with their tool counts, that the left-out skills are the ones
  `load_skill` lists (not repeated, so hundreds of skills cost nothing), and the rule that when the human names a
  server or a skill the agent does not have, in any form, it loads it with `load_mcp_server` or `load_skill` and uses
  it, and never says it is not available before it tried. The tool descriptions say the same.
- **What a run loaded.** Each provider records an `extensions` notice when a session starts with a set
  (`LoadedExtensions`: each server, skill and plugin by name with its token estimate, and in `deferred` what the
  optimizer left out; no plugins for Codex), and the chat shows it as one quiet row ("Loaded 3 MCPs · ~12k tokens · 2 left out"). It is said once
  per session: a turn that resumes a session says it again only when the set changed (`announceExtensions`, decided
  by the supervisor with `isSameExtensionSet`, which compares names only). A delegated run is a session of its own, so
  its row is in its own conversation, nested under its card in the parent's turn.
- **A resumed session keeps its set.** `resolveSession(place, pin)` takes the set the session last ran with (the
  supervisor's `SessionExtensionSets`, `agents/extension-sets.ts`: remembered per session id, and read back from the
  last `extensions` notice in the session's transcripts after a restart). With a pin, what the session loaded stays
  loaded and what it left out stays left out, whatever the optimizer would choose now (time passing, a server used in
  another task or loaded mid-run), so the system prompt and the tool list do not change between its turns. Only what
  is new to the pin is chosen by the optimizer. Your own changes still apply at once: a server or skill you turned off
  is gone, and turning the optimizer off loads everything (The agent loop → Sessions and the prompt cache).
- **Token estimates** are characters over four (`resolveTokenEstimate`): a skill's listing line (name and description,
  the description cut at Claude Code's 1,536 characters), a plugin's agents and commands plus its skills that are on,
  and a server's tool definitions as it listed them at its last check (nothing until it was checked). Claude Code may
  defer the schemas of a large tool set, so a server can cost less than its estimate.
- **Health** (`health.ts`): `POST /api/extensions/check` connects to every server that is on (or one), lists its tools
  and keeps the result: connected with its tools, needs sign-in (a 401 or the SDK's `UnauthorizedError`) or failing
  with the error and the last 400 characters a command printed; 15 s at most each. Nothing is probed until asked;
  the web asks once when Settings opens. A server is measured only by a check that lists its tools, so the web says
  why one has no estimate: "Sign in to measure", "Can’t measure while failing", "Checking…", or "Not measured while
  off" for one that is off and was never checked.
- **Sign-in** (`oauth.ts`, the MCP SDK's `auth` with PKCE and dynamic client registration). Connect
  (`/api/extensions/servers/sign-in`) answers the server's authorization URL, which the web opens in a new tab; the
  server sends you back to `/api/mcp/oauth/callback` on Shinsa's own address (outside the Origin guard, Host still
  checked), which finishes the exchange, checks the server and answers a page that tells the Settings tab on a
  `BroadcastChannel` and through `window.opener` (`{ channel: 'shinsa-mcp', ok }`; the channel only reaches the same
  origin, and under `bun dev` the app is on :5181 while the callback is on :5180) and closes itself. The tab watches
  until the server reads as signed in and no longer needs sign-in (every 2 s for 2 minutes, at once on either message,
  and whenever the window gets focus or becomes visible again); Settings → Integrations also rereads the snapshot on
  focus. A sign-in is good for 10 minutes and matched by its `state`. The client
  registration, tokens, verifier and discovery state live in `secrets.json` under `mcp` (mode 600, never in the log
  or the snapshot), are refreshed a minute before they expire, and go to agents as an `Authorization` header. Sign
  out forgets them. Shinsa never reads or writes Claude Code's or Codex's own stored sign-ins.

| Route | Does |
| --- | --- |
| `GET /api/extensions` | The snapshot: servers, skills, plugins, problems (statuses as last checked) |
| `POST /api/extensions/check {serverId?}` | Checks one server, or every one that is on |
| `POST /api/extensions/servers/add {server}`, `/update {serverId, server}`, `/remove {serverId}` | Shinsa's own servers; `server` is `McpServerInput` |
| `POST /api/extensions/servers/choose {serverId, enabled?, scope?}` | On or off, and where it is used |
| `POST /api/extensions/servers/sign-in {serverId}`, `/sign-out {serverId}` | `{ authorizationUrl, snapshot }`; signs in through a member already signed in when the group has one, and `authorizationUrl` is null when its sign-in still holds |
| `POST /api/extensions/skills/choose {skillId, enabled}`, `/plugins/choose {pluginId, enabled}` | A skill or a plugin on or off (Shinsa's own skills are refused) |
| `POST /api/extensions/optimizer {enabled?, days?, skills?}` | The context optimizer's settings |

## The agent loop

How one run executes, from the supervisor (`agents/supervisor.ts`, `agents/turns.ts`) down to the Claude adapter
(`agents/providers/claude/`). Harness plan WS1 names the T3 Code and Kanna sources.

**Attempts and conditional writes.** Every execution of a run is an attempt with its own id, `<run>:<n>` numbered
after the attempts the log already holds (so a restart never reuses one). The supervisor records
it first (`run.attempt` → `run.attempted`: provider, model, whether it resumed, and any handoff), and every command
the attempt sends carries the id: `run.link`, `run.end` and every `agent.*` hand-over. Core ignores a `run.end` or
`run.link` from an attempt that is no longer current and refuses a hand-over from one ("A newer attempt of this
step has taken over. End your turn."); the supervisor checks the same before it commits, so a stale attempt never
touches the worktree. `run.attempts` keeps every attempt.

**Classification.** The Claude adapter classifies each turn's result (`classify.ts`) from `terminal_reason`,
`api_error_status`, the error text, rate-limit events and the assistant's own error, and `run.end` carries the
result as `failure: { class, message, code, retryable, resetAt }`:

| Class | From | Recovery |
| --- | --- | --- |
| `usage_limit` | 429, a rejected rate-limit window (overage aside), a gateway's 503 wrapping a 429; `resetAt` is the latest reset of every spent window, or unknown | Another account, else a usage wait until the reset; a failure gate when the reset is unknown or past |
| `auth` | the assistant's `authentication_failed` and other account errors, 401, or a failed turn whose text asks to log in or reports a dead token (login wins over quota) | Another account, else a Sign in gate for the account; a failure gate when the account is unknown |
| `setup_failed` | `turn_setup_failed`, a startup failure, a missing or outdated `claude`, a provider that cannot block forbidden commands | Failure gate at once |
| `context_window_full` | `prompt_too_long`, `blocking_limit` without limit evidence, `rapid_refill_breaker`, a handoff too large to send | Fresh session |
| `image_error` | `image_error` | Fresh session |
| `session_lost` | the CLI cannot find the session to resume | Restored in place once, then a fresh session |
| `overloaded` | 529 or the assistant's `overloaded` | Resume |
| `aborted` | `aborted_tools` / `aborted_streaming` reported as success (an interruption, never "done"), or a restart loop | Resume |
| `budget_exhausted`, `malformed_tool_use`, `model_error`, `provider_error` | the CLI's own reasons, the budget subtypes, anything else | Resume |
| `transport_error` | the process crashed, or the stream ended with no result for the prompt | Resume |

A stream that ends without a terminal result fails the run explicitly. During a shutdown the supervisor has
cancelled the session first, so it ends as cancelled and nothing is recorded.

**Steering by prompt id.** Every prompt the adapter sends carries a uuid, and a turn is matched to its prompts by the
ids the CLI echoes on its result (`user_message_uuids`), never by counting. A result that answers none of our prompts
(a background task, a scheduled wake-up, a task notification) never ends the run; an error or interrupt result
without ids still ends the oldest prompt, so a failed turn cannot hang. A CLI that never echoes (a
`CLAUDE_EXECUTABLE` wrapper) answers oldest first, and a steer folded into its running turn counts as delivered after
a 60 s pause. A steer that cuts the running segment short does not end the turn. A steer goes on the wire behind a
`<system-message>` notice (`resolveSteerPrompt`; a slash command stays first) and into the transcript as typed.
Too late to steer (the session is closing or its provider cannot steer): the message is delivered as the next turn
(`message.deliver`). Sent while the run waits to start: it is held and steered in once the session exists. Sent in
the stop window (the run has ended in core or is being stopped): it goes to the next turn, never into the dying
session. Steers the agent never answered come back in `undelivered` and are delivered as the next turn after
`run.end`. A run whose attempt is on an account another run just found spent is treated as too late to steer until
its next attempt (Accounts and usage limits → Rotation on a rejection).

**Sessions and the prompt cache.** Each turn is a new attempt, and for Claude a new `claude` process (the SDK
session ends after the turn's result), but it resumes the task's provider session whenever the role and provider allow
it (Agents, above; Resume fallback, below). The provider's prompt cache is keyed on the exact prefix of every request,
so a resumed turn reads the whole conversation from the cache only while that prefix is byte-identical; Caching, below,
has the rules that keep it so and what still changes it. Measured on a three-turn answer task (Claude, eunoe on),
each follow-up turn's first request reads the whole earlier conversation from the cache (106,288 tokens read and 2,889
written on turn 2; 109,402 read and 2,983 written on turn 3); what is written is that turn's new brief.

**The house rules go to a session once.** Every role's brief opens with its house rules (`resolveHouseRules`, about
7,000 characters: the voice, the worktree rule, the tools, references, delegation and the command surface). A session
that already has them does not need them again, so a resumed turn sends only the instruction after them
(`resolveTurnPrompt` in `agents/turns.ts`, `splitHouseRules` in core). It sends the full brief whenever the session
might not have these exact rules: a fresh session, a handoff (a provider switch, a lost session restored on a new one,
an account whose session cannot be resumed, which the CLI reports as lost), a session whose earlier briefs never
carried the same text (a follow-up answerer resuming the Agent's session gets the answerer's rules), and a session
compacted since it last got them (a compaction notice from Claude, Codex or eunoe after the brief, since a summary
keeps no rules). The check reads the session's transcripts newest first, so it works the same for Claude and Codex and
across a restart. Measured on a two-turn answer task (Claude, Sonnet, the e2e harness run live): the follow-up turn
sent 8,989 characters and wrote 3,389 cache tokens with the full brief, and sends 1,277 characters and writes 709 with
the instruction alone.

**The task's Agent across turns.** Every run of a task's Agent resumes one session (Agents, above), so after the
planning brief each turn is a short instruction: "Phase 1 is committed. Now build phase 2 of 3: …", a fix prompt, or
"Now run the operation in the plan". The house rules travel with it as usual, and the full brief replaces the short
one exactly where the house rules would be sent again: a fresh session, a handoff, or a session compacted since its
last brief, since a summary or a fold may have dropped the plan. That full brief is core's `resolveRunBrief(state,
run)`: the house rules, the round as it stands (the request and your later messages, the goal, the plan, the approved
version and your answers, each finished phase with its summary, the earlier work), the run's own instruction and the
project. The prompt-cache rules (Caching, below) hold across the whole task: the session's tools are one list for
every purpose and kind of work, and its appended system prompt never changes, so each turn reads the conversation so
far from the cache and writes only its new instruction. Compaction (Compaction and fast mode, below) keeps a long task
inside the window: eunoe folds finished turns on the wire and the session goes on;
Claude Code's compaction summarises, and the next turn then gets the full brief again.

**Read-only while planning, answering and researching.** The Agent plans read-only and builds with edits on the same
session, and an answer or research round on that session reads only, so Shinsa runs one provider process per turn and
the switch happens between turns: the planning run, the answerer and the researcher are read-only (`isReadOnlyRun`),
the build, fix and operate runs and the investigator are not, and each resumes the same session id.
- *Claude.* The Agent SDK has `Query.setPermissionMode` (streaming input only) and `permissionMode: 'plan'`, but plan
  mode adds Claude Code's own plan-mode reminder with its `ExitPlanMode` protocol, which competes with `propose_plan`,
  and with no one to approve a prompt it refuses the shell commands planning needs. Withholding the edit tools per
  turn (`disallowedTools`, what the reviewer and a delegated planner still use, each on a session of its own) would
  keep the context, since the session file is the same, but it changes the tools block, the first thing in the
  prompt-cache prefix, so the first build turn would read the whole planning conversation uncached. So a run on the
  task's session always has the same tools (`disallowedTools: []`, `resolveDisallowedTools`), and while it only reads a
  PreToolUse hook (`listReadOnlyHooks` in `providers/claude/guard.ts`, one matcher each for `Edit`, `Write`,
  `NotebookEdit` and `MultiEdit`) denies any edit, naming the hand-over: "You are planning: Shinsa refuses edits until
  the plan is in. Hand the plan over with `propose_plan`.", or "You are answering: this step only reads…". Hooks are
  client-side, so the prefix stays byte-identical; the
  permission mode stays `bypassPermissions`. A planning turn can still run shell commands, and edits it leaves in the
  worktree are set aside after the turn.
- *Codex.* Each run is its own `codex app-server` resuming the thread by id (`thread/resume`), and the sandbox is a
  thread setting of that call: a planning run gets `sandbox: read-only` and `approvalPolicy: never`, a build, fix or
  operate run the writing settings (`danger-full-access` with Shinsa approving each command). Codex records the new
  permissions in the thread instead of rewriting its start, so the context and the cache hold.
- Verified by `test/e2e/rounds-session.test.ts` (eight rounds through the real Claude adapter with a restart: every
  Agent turn on one session id, planning turns carrying the edit-denying hooks, build turns without them),
  `providers/claude/session.test.ts` (a planning and a build turn compared), `providers/codex/session.test.ts` and
  `e2e/codex.test.ts` (plan read-only, then build on the same thread with write access).

**Executable discovery** (`executable.ts`). Runs use the user's `claude`, never the SDK's bundled copy:
`CLAUDE_EXECUTABLE` (with `~` expanded) wins and is trusted as is; otherwise `claude` on the `PATH`, whose
`--version` is read once per binary and again only when the file changes. A `claude` older than the SDK's
`claudeCodeVersion` is refused with "Update it from Settings → Agents, or run `claude update`" (the Update there
is Versions and updates, below); an unreadable version is let through. Finding the binary (`locateClaude`, and
`locateCodex` for Codex) is `locateProgram` in `providers/versions.ts`, which the updates read too.

**Codex** (`agents/providers/codex/`; harness plan WS1 item 10 names the Kanna and T3 sources). A Codex run is one
`codex app-server` process speaking JSON-RPC over NDJSON on stdin and stdout (`client.ts`), in its own process group
so stopping it stops the commands it ran. Each session sends `initialize` and `initialized`, then `thread/start` or,
to resume, `thread/resume` with the stored thread id, and runs Shinsa's brief as a turn (`turn/start`):

- **Instructions and tools.** The thread carries Shinsa's house instructions and the paths of the plugin's skills
  as `developerInstructions` (Codex reads them with a shell command; it cannot load a Claude plugin). Shinsa's MCP
  tools reach it over a localhost HTTP endpoint started per session (`mcp.ts`, after Kanna's `kanna-mcp.ts`): port 0
  on 127.0.0.1, a random bearer token Codex gets in the thread's `config["mcp_servers.shinsa"]` with
  `tool_timeout_sec` of a day and `default_tools_approval_mode: approve` (without it a read-only role's call is
  refused for want of an approval nobody can give; found in a live run on codex 0.153.4), a 401 without the token, a 403 for any request with an Origin header (no browser can reach
  it), a 404 off `/mcp`. Each request gets a stateless MCP server; an `initialize` starts a new request-id scope, so a
  client that reconnects never reuses a command id. A streaming answer flushes at once and beats every 10 s while a
  tool call is open (a progress notification when the call asked for progress, an SSE comment otherwise), so `ask`
  and `delegate_task` can wait for hours. Closing the endpoint stops the calls in flight.
- **Approvals and the sandbox.** A writing role runs with `approvalPolicy: untrusted` and `sandbox:
  danger-full-access`: Codex asks before every command it does not know to be safe, Shinsa declines the ones
  `agents/policy.ts` forbids (and steers the reason into the turn, since a decision carries none) and accepts the
  rest, and accepts file changes. A read-only run (the Agent while it plans, a reviewer, answerer, researcher or delegated planner;
  `isReadOnlyRun`) runs with `approvalPolicy: never` and
  `sandbox: read-only`: nothing it runs can write or reach the network, so a commit, a push or `gh pr merge` fails in
  the sandbox and a patch is rejected. Elicitations from Shinsa's own MCP server are accepted, others declined;
  anything that needs a person (`item/tool/requestUserInput`, a permissions request) is refused, since no one is there to answer it mid-turn.
- **Steering and stopping.** A message steers the running turn with `turn/steer` against its turn id. When Codex
  refuses (the turn just ended, or a kind of turn it cannot steer) the message runs as the next turn once this one
  ends; one sent before the first turn starts is queued the same way. A turn that fails leaves its queued messages
  in `undelivered`. Cancelling sends `turn/interrupt` (5 s at most) and then stops the process.
- **Classification** (`classify.ts`, after T3's `CodexAdapterV2`), from the turn's error or the last `error`
  notification without `willRetry` (a `willRetry` error is Codex retrying on its own and is only kept as the cause):

  | `codexErrorInfo` | Class |
  | --- | --- |
  | `usageLimitExceeded`, `rateLimitExceeded`, `responseTooManyFailedAttempts` with HTTP 429 | `usage_limit`; the session leaves `resetAt` unknown and the accounts service fills it in (Accounts and usage limits, below) |
  | `unauthorized`, or any HTTP 401 | `auth` ("Run `codex login`"); with no leased account this is a failure gate |
  | `contextWindowExceeded` | `context_window_full` |
  | `sessionBudgetExceeded` | `budget_exhausted` |
  | `serverOverloaded` | `overloaded` |
  | `sandboxError` | `setup_failed` |
  | `cyberPolicy`, `misalignmentPolicyViolation` | `model_error` |
  | `httpConnectionFailed`, `responseStream*`, `responseTooManyFailedAttempts` (not 429) | `transport_error` |
  | anything else | `provider_error` |

  A turn Codex ends as `interrupted` by itself is `aborted`; the app server exiting mid-turn is `transport_error`
  with the last line it printed; a codex that cannot start is `setup_failed`; a `thread/resume` Codex answers with
  "no rollout found" (or not found, no such thread) is `session_lost`, so the supervisor restores the step on a fresh
  thread with the context handoff (Kanna falls back to `thread/start` silently; Shinsa hands the transcript over).
- **Usage, context and compaction.** `thread/tokenUsage/updated` on the run's thread gives the running totals the
  session reports for `run.meter` (cached input as cache reads, written cache as cache writes, the rest as input,
  priced by `CodexMeter`; Cost, above) and the last request's tokens and the model's window for the `context` notice.
  The prompt cache of a Codex thread lasts 5 minutes after its last request, 30 for GPT-5.6 and later
  (`resolveCacheLifetimeMs`), which idle compaction reads. Compaction follows Settings → General → Context, Compaction: with
  Off the thread gets `model_auto_compact_token_limit` set past any window, so Codex never summarises and a full
  context fails the turn as `context_window_full` (a fresh session with the handoff, as for Claude); with any other
  choice Codex summarises on its own at its limit, since eunoe sits in front of the Anthropic API only. An idle
  compaction is `thread/compact/start` on the resumed thread (`compactSession`): its `contextCompaction` item writes
  one `compaction` notice (`trigger: 'manual'`), and the session ends when the compaction turn completes, or 5 s after
  the item when Codex runs it without a turn.
- **Executable discovery** (`executable.ts`): `CODEX_EXECUTABLE` (with `~` expanded), else `codex` on the `PATH`; its
  `--version` (`codex-cli 0.153.4`) is read once per binary and again when the file changes. Older than
  `CODEX_MINIMUM_VERSION` (0.153.0, the version this adapter was built and checked against: `turn/steer`,
  `outputSchema` and thread `config` overrides) is refused with "Update it from Settings → Agents, or run `codex
  update`"; a missing codex says how to install it.
- **One-shot calls** (`complete.ts`): an ephemeral read-only thread with `approvalPolicy: never`, the system prompt as
  its instructions, one turn at low effort with the schema as `outputSchema`, the last agent message as the answer.
- **Models and sign-in.** `model/list` on a short-lived app server (paged, hidden models left out; the built-in list
  when it fails), and `codex login status` for the sign-in (`login.ts`, like Kanna's provider check).

**Resume fallback** (`turns.ts`). Before resuming, the supervisor checks the session: a session owned by another
provider is handed over; one marked lost (`run.session_lost`, recorded for every run that used it, so no retry or
recovery resumes it again) or a provider without resumable sessions is restored; otherwise the provider inspects it.
Claude looks for `<id>.jsonl` under `$CLAUDE_CONFIG_DIR/projects` (relative to the worktree when relative,
`~/.claude` otherwise): a file with no user or assistant line counts as empty, a file gone from a project Claude has
used is missing, and anything it cannot tell is left to the CLI. Missing or empty: the session is marked lost and the
step starts fresh with a context handoff. A resume the CLI refuses anyway is retried once the same way. The handoff
(`resolveHandoff` in `packages/core/src/prompts/handoff.ts`) renders the transcripts of every run that used the
session: briefs, messages, replies and tool activity, subagents and plumbing left out. It keeps tool input and output
from the last 100,000 characters verbatim, replaces older ones over 2,000 characters with a pointer to the
transcript entry, and drops whole older turns at a prompt boundary to fit 400,000 characters, saying how many it left
out and where the full record is. It never silently drops everything: when even the latest turn does not fit it
refuses, and the run fails as `context_window_full`.

**Restart continuation.** `startShinsa().stop()` calls `RunSupervisor.interruptForShutdown` before anything else:
every live run is marked (`run.interrupt` → `run.interrupted`, skipped for a run waiting on your answer) and its
session cancelled, and no `run.end` is sent, so the run stays open. Then it stops the pull request syncs and every
running effect (their `AbortSignal` fires, so a check, push or `gh` command is killed, not left running beside the one
the next boot requeues) and waits for them before it closes the log. On boot `RunSupervisor.recover` asks core to
continue each running run, oldest first (`run.continue`). Core declines a run waiting on your answer (the answer
restarts it), clears the mark in the same event that records the continuation (`run.continued`, reason `shutdown`
or `crash`), so one shutdown earns one resume, and caps the chain: a fourth continuation within five minutes ends the
run as `aborted` (`restart_loop`) and hands the step to bounded recovery (one nudge, then a failure gate). A
continued run with a session resumes it with the carry-on prompt, which tells the agent to re-check any file it was
editing and any command it had running; one without a session starts its step again. A shutdown continuation is free.
A crash leaves no mark, and its continuation spends the task's recovery budget (Recovery, above): the first crash is
continued as the one nudge, and a second crash before the task makes progress ends the run as `aborted`
(`crash_loop`) and opens the failure gate. Progress (a changed recovery fingerprint) resets the budget as it does for
any other recovery, so a run that keeps crashing the server is never resumed forever, while a single crash costs the
work nothing.

**Quick calls** (`agents/quick`). One-shot calls go through `createQuickCalls(registry, readSettings, readFastMode)`,
bound to the server's `ProviderRegistry` (there is no other registry and no default: every caller is handed its
call), which gives two: `classify` on the classifier's model (triage and the message classifier) and `write` on the
writer's (the briefing).
`requestQuickStructured` walks every registered provider, the one the role runs on first and the others in
registry order, and asks each for schema-checked output (`completeStructured`, 20 s) and then for a text answer with
the schema spelled out; a provider without `completeStructured` or the `structuredOutput` capability is asked in text
only. The first answer its parser accepts wins, with every failure's reason logged. The model is read at each call
for each provider: the one chosen in Settings → Agents on the role's own provider (Sonnet by default; no role
defaults to Haiku, though it can be picked; a Sonnet triage call answers in about 4 s, well inside the 20 s), and
that provider's default for the role on a fallback (GPT-5.6-Luna on Codex), so a Claude model name never reaches
Codex.
Judgements are typed decision questions (`quick/decide.ts`, after Paperclip's decision models): a `choice` (exactly
one option) or `choices` (any subset of the options, empty allowed). One helper set gives the schema property (a
string `enum` of the options, or an array of them with `uniqueItems`), the prompt line naming every option with what
it means, and the parser, which refuses an answer with anything outside the options so the caller falls back. They
are used for triage's `size` (`small` or `large`), `shape` (the six task shapes, each with what it means), `priority`
and `waits_on` (the open tasks triage offers, Automatic options, each by its id with its title as its meaning;
refused whole, it waits on nothing), the last three asked only for what the task left on Auto and each with a short why (Task shapes → Automatic
options), the briefing's `now.task` and every `next[].task` (a
choice among the listed decisions' ids; `parseBriefing` still validates), and each setup question that takes one
option (`model`, `merge`, `plans`, `accounts`, `prerequisites`: its option values plus `unclear`).

**Idle release and idle compaction** (harness plan WS7). A session left waiting on your
answer is released after 30 minutes (`IdleRelease`, `agents/idle.ts`, driven by `agents/questions.ts`): the session
is stopped, the run stays open, and your answer, or a message that supersedes the question, resumes the same session
(`resolveQuestion` waits for the release to finish first). Only a step waiting on you is released: a delegated run
waiting on the agent that delegated it keeps its session. Work the agent
started in the background (a Claude background task) pins the session for up to 4 hours; any activity, and every new
wait, resets the timer; each arm carries a generation and the session it belongs to, so a stale timer never releases
a newer session. A Claude session's prompt cache expires 1 hour or 5 minutes after the result that last wrote it, whichever
bucket that result wrote (`resolveCacheExpiry` reads `cache_creation.ephemeral_1h/5m_input_tokens`; neither means
the lifetime is unknown). When the Agent, an answerer, investigator or
researcher finishes near its context limit (at least 80% of its window, `COMPACTION_NEAR_LIMIT`, from the
context usage Claude reports at the end of the turn), `IdleCompaction` (`agents/compaction.ts`)
sends `/compact` to that session 2 minutes before the cache expires (Settings → General → Context, Compact idle
sessions: never, the default, or 1 to 30 minutes before), so the next step resumes a small context instead of
re-reading a cold large one. It exists only where the provider summarises itself (`hasNativeCompaction`,
`resolveIdleCompaction(settings, providers)`): for Claude only with Claude Code's compaction, since `/compact` is
Claude Code's summary; for Codex under every choice but Off (its `thread/compact/start`, Codex adapter above). With
eunoe and only Claude agents, or with compaction off, the row is hidden and nothing is compacted early.
It never compacts a compaction, a delegated or subtask run, a session with an open question or background work, a
session another step already moved past, a large session that still has room in a larger window, or one whose cache
lifetime, size or window is unknown. The compaction is recorded first
(`run.compact` → `run.compacted`, command id `idle-compact:<run>:<session>`), so a restart cannot compact twice; it
runs on the account the run used, only its compaction notice is kept in the transcript, its cost is metered to the
run, and a new step on the task waits for a compaction in flight. Shutdown stops a compaction in flight and waits
for it, so its `claude` never outlives the server.

**Compaction and fast mode.** Shinsa does not use Claude Code's own summary by default: eunoe
(`@chroxify/eunoe`, a local proxy between Claude Code and the Anthropic API) compacts instead. Settings → General →
Context, Compaction (`settings.compaction`, a `settings.change` event because replay must reproduce it):

| Setting | eunoe mode | What happens |
| --- | --- | --- |
| `eunoe_compact`, "Eunoe compaction" (default) | `compact` | The context grows as usual; at `compactAt` (0.9) of the model's window eunoe folds every finished turn to your message, the output lines that mattered and the reply, instead of Claude Code's summary |
| `eunoe_default`, "Eunoe always fold" | `default` | eunoe also folds as the session grows: once older detail passes 100,000 tokens every turn but the last 3 folds in one step, and it still cuts at the limit |
| `claude`, "Claude Code's compaction" | none | Direct to Anthropic, Claude Code's auto-compact on; the only mode where idle compaction exists |
| `off` | none | Direct to Anthropic, auto-compact off: a full context fails the turn as `context_window_full` and the step starts a fresh session with the handoff |

*Why a managed proxy.* Four ways were weighed. Copying eunoe's source into Shinsa would fork it: every fix and
benchmark result in eunoe would need porting by hand, and Shinsa would carry code it does not test. Pointing at an
eunoe already running (the user's own, on `eunoe
start`'s port) would tie Shinsa's sessions to that instance's single global mode and to `~/.eunoe`, which Shinsa must
not edit, and its watchdog adds itself to `~/.claude/settings.json` and takes itself out again on its own schedule. Importing eunoe in
process is not possible cleanly: the package exports no API (only `bin`), reads `EUNOE_DIR` once at import and keeps
module-wide caches, and a proxy bug would take the server down with it. So Shinsa depends on the package (pinned,
`apps/engine/package.json`) and runs its CLI as a separate process it owns: `bun <package>/src/cli/main.ts serve`
(or `$SHINSA_EUNOE serve`), with `EUNOE_DIR` set to `data/eunoe`, so its config, request log, thread state and
transcripts live beside Shinsa's data and never touch `~/.eunoe`. Taking a new eunoe is a version bump there.

*The proxy* (`apps/engine/src/eunoe/`). `EunoeProxy` starts eunoe lazily, the first time a Claude session needs it,
on a port of its own: `SHINSA_EUNOE_PORT` when set, else the one `data/eunoe/config.json` remembers, else a free one.
Shinsa writes that `config.json` (atomically; eunoe re-reads it on every request): `port`, `mode` (from the setting,
so a change applies to the next request), `upstream` (`https://api.anthropic.com`) and `claudeConfigDirs`, every
account folder a session has run on, so eunoe finds each session's file under whichever account it used (its own
`~/.claude` is always included). Auth headers pass through untouched, so every leased account's token reaches the API
as is, and rotation needs nothing: eunoe keys a thread on the session id and its first turn, so a session resumed on
another account keeps its folds. A healthy proxy is reused for 5 s without asking; after that `GET /_eunoe/health`
answers whether it is up and its pid. A proxy whose pid matches `data/eunoe/serve.pid` (a crash of an earlier
Shinsa) is adopted; another eunoe on the port is never used: with `SHINSA_EUNOE_PORT` that fails the start, otherwise
a new port is picked. Its output goes to `data/eunoe/serve.log`. Shutdown kills its process group and waits for it.

*Routing a session* (`providers/claude/route.ts`). Each Claude session and idle compaction resolves a route before it
starts and passes it both as process environment and in the Agent SDK's flag-settings layer, which outranks the
user's `settings.json` (where `eunoe start` writes its own address): `ANTHROPIC_BASE_URL` (eunoe's URL, or Anthropic
directly), `autoCompactEnabled` (off in both eunoe modes and in `off`), `CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE`
(`1000000000` in eunoe modes, as `eunoe start` sets it, so Claude Code never refuses a prompt eunoe will shrink; empty
otherwise, which Claude Code reads as its default) and `EUNOE_DIR` (so the agent's own `eunoe load` and `eunoe peek`
read Shinsa's transcripts). Quick calls stay direct: they carry no history to compact. Every `claude` Shinsa starts
gets the server's environment without `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE` and `EUNOE_DIR`
(`resolveClaudeProcess`), so a Shinsa started from inside a Claude Code session that routes through the user's own
eunoe never sends a quick call, or anything else, through it.

*When eunoe is down.* A proxy that will not start (it exits, does not answer within 15 s, cannot be run, is not
found at `SHINSA_EUNOE`, or the bundled package is missing, in which case Shinsa still starts and `resolveEunoeCommand`
logs it) is not retried for a minute; meanwhile, and whenever it is down, the session runs directly with Claude Code's compaction on
and writes a `proxy` notice with the reason (the chat's "Eunoe unavailable · Claude Code compacts this run"). A
proxy that dies mid-turn makes Claude Code's requests fail; the turn ends as a transport or provider failure, the
run resumes as a new attempt, and that attempt starts eunoe again or falls back. Nothing hangs on a dead proxy.

*Notices.* eunoe compacts on the wire, so Claude Code reports nothing; Shinsa tails `data/eunoe/requests.jsonl` (one
line per request, `thread` = `<session id>-<first turn>`) while a session runs and writes a `compaction` notice with
`by: 'eunoe'` for each request eunoe marks `compacted`: `trigger: 'auto'` for a cut at the limit, `'fold'` for a
budget fold. Claude Code's own compactions keep their `compact_boundary` notice.

*Fast mode* (`settings.fastMode`, Settings → Agents, the speed select on each role, default Standard). Each
role can differ from it: `settings.agentFastModes` holds a true or false per agent role, written whole by
`settings.change` like `agentModels`, and core's `resolveAgentFastMode(settings, role)` reads the role's own value,
else the global switch. The supervisor passes the run's role's value (`RUN_AGENT_ROLE`) to every session of a provider whose capabilities include `fastMode`, delegated children (their own role) and
idle compactions (the run's role) included (`resolveSessionOptions`, which also carries the compaction setting,
takes the role, or none for the global value);
and quick calls pass it per provider, the classifier's for triage, the writer's for the
briefing. Claude gets `settings.fastMode` in the flag-settings layer, true or
false: the CLI allows fast mode in Agent SDK sessions only when that layer says true, and an explicit false keeps a
user-level `settings.json` from turning it on unseen (Kanna's `agent.ts`). Claude Code's own subagents run inside
that session and follow it. When the session's init reports `fast_mode_state` other than `on` while fast mode was
asked for, the session writes a `fast_mode` notice (`unavailable` with `fast_mode_disabled_reason`, or `cooldown`)
and carries on at standard speed. Codex gets `serviceTier: 'fast'` on `thread/start` and `thread/resume`, or an
explicit `null` for standard speed (an omitted tier would inherit `service_tier` from `config.toml`); a thread that
comes back without the fast tier writes the same notice with reason `tier_not_offered`.

*Fast mode never spends what the account does not have.* On a subscription, fast mode is paid for from usage credits
(Claude's extra usage, Codex's credits), so Shinsa checks before every run, delegated runs, idle compactions and quick
calls included, and never turns extra usage on itself. The usage reading says it (`AccountUsage.fastMode`:
`available`, `needs_credits` or `unknown`): for Claude, the usage answer's `extra_usage` (`is_enabled` with credits
left under `monthly_limit`; turned off, spent, or `null` needs credits; no `extra_usage` at all is unknown,
`resolveClaudeFastMode`); for Codex, the `credits` of `wham/usage` or of `account/rateLimits/read` (`has_credits` or
`unlimited`; `resolveCodexFastMode`), and an API-key login, which pays per token, is available. The supervisor asks
the broker for the leased account, or for the provider's own login (`AccountBroker.readFastMode`, the reading
refreshed when older than a minute); quick calls ask for your own Claude Code login or the provider
(`createQuickCalls`' `readFastMode`). Anything but `available` runs at standard speed (`fastMode: false`, which for
Claude is the explicit false above) and the run's chat says why with a `fast_mode` notice, `needs_credits` or
`credits_unknown`. Without a broker (tests) the setting is taken as it is. Settings shows the same reading
(`resolveFastModeAvailability` in core: Claude is available when any account that takes work has credits, Codex
from its own reading): where it needs credits the speed select shows Standard and its Fast option disabled,
"Unavailable: needs usage credits" (`docs/design.md`, 26).

**The rejection seam.** `SupervisorOptions.onRejection` (and `ShinsaOptions.onRejection`) receives every classified
failure before the run ends: `{ runId, taskId, provider, attemptId, accountId, tried, failure }`, `accountId` being
the account the attempt was leased and `tried` the accounts of every rejected attempt of this execution, this one
included. The handler owns the only retry budget: the supervisor runs the same turn again as a new attempt for as
long as it answers `{ retry: true }`, and ends the run with the verdict's `failure` when there is one (the accounts
module fills in the account and the pool's reset); a handler that throws ends the run with the failure. The one
retry the supervisor makes on its own is restoring a lost session once (session restore), which costs the handler
nothing. Messages and delegated reports a retried attempt never answered are steered into the next attempt, and what
the last one never answered goes back as usual. `SupervisorOptions.onNotice`
receives every notice the provider emits (rate-limit windows, the account); the notices the supervisor writes itself
(`account_switched`, `handoff`, `delegation`) go straight to the transcript. `SupervisorOptions.accounts` is the account broker (below).

## Caching

Every task runs on one long session (Agents, above), so what it costs is mostly what the provider's prompt cache
reads and writes. A cache read costs a tenth of fresh input; a write costs more than fresh input. A turn that keeps
the prefix reads the whole conversation and writes only its own new text; a turn that changes the prefix writes the
whole conversation again. These rules are hard rules (CLAUDE.md), each held by a test:

- **The cached prefix never changes within a session.** For Claude it is the tools (Claude Code's built-in tools
  minus `disallowedTools`, Shinsa's tools in `SHINSA_TOOL_NAMES` order, the command surface's tools, the loader tools
  and the MCP servers the session loads), then the system prompt (Claude Code's preset with
  `excludeDynamicSections: true`, so the working directory, memory path and git status move into the first user
  message, and `snapshot: true`, so the CLI records the prompt with the session; then Shinsa's appended
  `SHINSA_INSTRUCTIONS` and the extension set's instructions), then the conversation. For Codex it is the thread's
  developer instructions (the same `SHINSA_INSTRUCTIONS`, the skill paths, the left-out list) and its tools; the
  sandbox and approval policy of a turn are thread settings Codex records without rewriting the start. The same for
  planning, building, fixing, operating, answering, investigating and researching, and for every round:
  `providers/claude/session.test.ts` ("the cached prefix of a task's session") compares every kind of turn, and
  `test/e2e/prompt-cache.test.ts` runs a change, an answer and a change after a merge through the real Claude adapter.
- **Nothing variable goes into the system prompt or a tool spec.** No time, stage, round number, account, setting,
  task list, id, port or token. Everything that changes between turns goes into the user turn, at its tail, or, during
  a turn, into a steer, which is a user message appended to the conversation: the brief or the short instruction,
  your edits (`describeHumanEdits`), the overlap note (Other work in the repository, steered into a running Agent),
  the adoption note of delegations, and the note that the session now works in another directory (`resolveMovedNote`,
  when a round after a merge runs in a new worktree or an answer runs in the repository itself: the directory the
  conversation started in stays in its first message, so the model is told once where it works now).
- **One tool list for the task's session.** The four task-session roles are served the same tools (`listToolNames`);
  what a role may call is checked in `decide`, never by leaving a tool out. Read-only turns (planning, answering,
  researching) are enforced by client-side PreToolUse hooks, never by `disallowedTools` (Read-only while planning,
  answering and researching, above).
- **The extension set is decided once per session.** The context optimizer chooses which MCP servers and skills a
  session loads when the session starts, and every later turn keeps that set (`SessionExtensionSets`, MCP servers,
  plugins and skills → A resumed session keeps its set). A server loaded mid-run (`load_mcp_server`) is hot-loaded
  through the SDK's `setMcpServers`, which replaces the session's dynamically managed servers; the CLI then lists
  the new server's tools to the model. Where Claude Code defers MCP tool schemas (its tool search, which Shinsa's own
  tools opt out of with `anthropic/alwaysLoad`), the new tools reach the model in a message after the conversation, so
  the cache holds; where they are not deferred they join the tools block, and the next request of that run writes the
  conversation once from the top. The pin is not changed by a mid-run load, so the system prompt (whose "Left out
  until needed" list names the server) never changes; the next turn starts with the pinned set again and the agent
  loads the server again if it needs it.
- **The house rules go to a session once** (The agent loop, above): a resumed turn sends only its instruction, and a
  role switch on the session (an answer round after a change) sends that role's rules once, at the tail.
- **One reviewer session per task.** The reviewer resumes its own session for every review of every round (never the
  Agent's, so its judgement stays apart from the head that wrote the work), and keeps a stable prefix of its own: it
  reads the code it already read from the cache and sees its earlier findings, which is what checking that blocking
  findings were fixed needs. The bias this could add is anchoring on an earlier verdict, so a resumed review is told
  to judge the new commits as closely as the first time and never pass something because it passed it before
  (`REVIEW_AGAIN` in `resolveReviewerPrompt`); its scope stays the round's own commits.
- **Delegated agents** start a session of their own (that is why they exist: isolated context). Their system prompt
  and tools are as stable as any session's, and the brief is the user turn.
- **Quick calls** (triage, the message classifier, the briefing) have fixed system prompts
  (`TRIAGE_SYSTEM`, `MESSAGE_SYSTEM`, `ROUND_SHAPE_SYSTEM`, `REPOSITORY_SYSTEM`, `BRIEFING_SYSTEM`) with everything about the call in the user prompt, and no tools but a structured-output schema. Each is
  one request well under the provider's minimum cacheable prompt, so nothing is cached and nothing is lost; they are
  kept static-first anyway so a longer one would cache.
- **What still changes the prefix**, each once: a session that starts (the first turn of a task, of a reviewer, of a
  delegated agent); a fresh session after a context overflow or an image error; a lost session restored from the
  transcripts; a provider you changed; a model you changed, or another kind of work on another model (the Answerer's
  after the Agent's): the session is resumed and keeps its context, but a provider caches per model, so the first
  turn on the new model writes the whole conversation once, and turns after it read it again; a server, skill or plugin you turned on or off; a change of route
  (eunoe down) or of fast mode between turns; an account whose Claude folder has other settings; a compaction by
  Claude Code (the summary replaces the conversation).

**Measured.** `test/e2e/prompt-cache.test.ts` models the provider's cache from what the adapter actually sends (the
listed tools, the system prompt, the tools left out, the settings) and meters each turn through the real pipeline
(`run.meter`): across a change round with a failed check and its fix, an answer round and a change round after a
merge, the only turns that write the whole prefix are the first turn of the task's session and the reviewer's first
review; every other turn writes only its new brief, and the metered cache writes equal the modelled ones. From a real
data directory (Claude, Opus, before one session per task): fresh sessions wrote 60,000 to 364,000 cache tokens on
their first turn, and resumed turns 1,000 to 98,000. Three runs started fresh only because the kind of work changed
(a planner and an operator after an answer, a researcher after an answer) and wrote 73,044, 73,220 and 72,413 cache
tokens their resumed counterparts would not have.

## Accounts and usage limits

Shinsa manages its Claude logins itself instead of shelling out to claude-swap (harness plan WS2, which names the
claude-swap, Kanna, T3 and Paperclip sources). The server side is `apps/engine/src/accounts/`; the rules that replay
(bindings, waits, the Sign in gate) are core (`decide/accounts.ts`), and so is the picker (`accounts/pick.ts`).

Several accounts with rotation are Claude-only (`capabilities.accounts`). Codex runs on the one login `codex login`
made, in `~/.codex` (or `CODEX_HOME`), and Shinsa supports that one Codex account for now (Settings says so under
it): a Codex run gets no lease, no account binding and no rotation, and its usage limit takes the plain wait below (a
`usage_limit` failure, the wait naming Codex). The Codex session leaves the reset unknown; the accounts service fills
it in with the latest reset of every window at 100% (`resolveSpentUntil`), first from the limits Codex pushed during
the run and else from a fresh usage read, so auto-resume works for Codex as for Claude. Codex's
sign-in is read by `codex login status` (exit 0 and "Logged in using ChatGPT" or "an API key" is signed in, exit 1
"Not logged in" signed out; a missing or outdated codex says how to install or update it) and rides along in the
accounts snapshot as `providers` (refreshed with the accounts, a failed read logged and the last one kept). Settings →
Agent usage shows it under the Claude accounts with the sign-in command, and onboarding's tools check lists codex
and its sign-in as optional. A Codex run Codex signs out stops at a Sign in gate like a Claude one: the failure
arrives as `RunFailure.login` (`{ provider: 'codex', email }`, the email the usage reading found, no account), the gate
names the provider (`Gate.provider: 'codex'`, `Gate.account: null`), its title "Sign in to Codex as ‹email›", and
every sign-in check that finds Codex signed in again (the 5-minute refresh, or Check the Codex sign-in again in
Settings, on the card or in ⌘K) sends `provider.record_sign_in { provider: 'codex' }` under
`provider-login:codex:<gates>`, which answers every open Sign in gate of that provider and retries those tasks. The
web reads the gate's provider (`resolveSignInProvider(gate)`: anything but `claude` is a provider's own login). Rotation
across several Codex logins would need a `CODEX_HOME` per account, which Codex supports; it is left until someone
runs Codex enough to hit its limits.

**Codex usage** (`agents/providers/codex/usage.ts`, `readUsage` on the provider), read the way CodexBar reads it
(https://github.com/steipete/CodexBar, MIT: `docs/codex-oauth.md` and `CodexOAuthUsageFetcher.swift`). Shinsa reads
the access token and account id Codex keeps in `$CODEX_HOME/auth.json` and never refreshes or writes it (Codex owns
the refresh), and asks `GET <chatgpt_base_url>/wham/usage` (`https://chatgpt.com/backend-api` unless `config.toml`
names another; a base without `/backend-api` uses `/api/codex/usage`, as Codex does) with `Authorization: Bearer`,
`ChatGPT-Account-Id` and `Accept: application/json`, 10 s at most. `rate_limit.primary_window` and `secondary_window`
(`used_percent`, `limit_window_seconds`, `reset_at` or `reset_after_seconds`) are the "5-hour limit" (`five_hour`,
the session window) and the "Weekly limit" (`seven_day`); other lengths are named by their length, and each of
`additional_rate_limits` is a model window named by its `limit_name` (or `metered_feature`). The answer also gives the
email, the plan and `credits` (fast mode, above). A 429 backs off with its `Retry-After`, another status or an
unreadable answer is a failed read that keeps the last reading. Without a token, or when the endpoint refuses it
(401, 403), Shinsa asks Codex itself on a short-lived app server: `account/read` (signed out; an API key, which has
no windows; a ChatGPT login) then `account/rateLimits/read` (`rateLimits` and every other `rateLimitsByLimitId` entry,
`windowDurationMins`, `resetsAt` in seconds). The reading goes through the same `UsageLimits` as Claude's (cached 60 s,
`data/provider-usage.json`, pushed `account/rateLimits/updated` windows merged as `rate_limit` notices from Codex runs,
a failed read never erasing data) and rides along on the provider's `ProviderLogin` in the snapshot (`email`, `plan`,
`usage`). It feeds usage waits and auto-resume (above), the usage limit per task (Cost, above), fast mode and the
Agent usage glance in the top bar, which shows every connected provider (`docs/design.md`, 26).

- **An account is a Claude config folder** (`accounts/store.ts`). Claude Code keys its login, its keychain entry and its
  `.claude.json` on `CLAUDE_CONFIG_DIR`, so each account Shinsa adds lives in `~/.config/shinsa/accounts/<id>` (under
  `SHINSA_HOME` or `SHINSA_DATA_DIR` when set) and every run on it gets that folder. Different runs use different
  accounts at the same time; nothing global is swapped. Your own Claude Code login is the one account without a
  folder (`origin: 'claude'`, `configDir: null`): runs on it keep the environment Shinsa started with, so its login
  is never copied and its single-use refresh token never forks. The list is `accounts.json` beside the folders
  (`{ version, defaultAccountId, accounts: [{ id, configDir, email, organization, plan, origin, addedAt, paused,
  switchAt }] }`, written atomically, mode 600; a file that cannot be read is copied aside and an empty list is used).
  Every command Shinsa runs for an account (a run, a sign-in, a status check) gets its environment from
  `resolveAccountEnv` (`accounts/paths.ts`).
- **Shared settings.** A new folder gets a `.claude.json` with `mcpServers`, `projects`, `theme`, `autoUpdates`,
  `installMethod`, `hasCompletedOnboarding`, `lastOnboardingVersion` and `githubRepoPaths` copied from yours when you
  have them, and `hasCompletedOnboarding: true` when you do not (an existing one is never overwritten), and a symlink to every other
  entry of your Claude folder except the ones an account owns (`.claude.json`, `.config.json`, `.credentials.json`,
  `.oauth_refresh.lock`, `backups`, `statsig`, `stats-cache.json`, `.DS_Store`). The links are refreshed before every
  attempt and sign-in, and a folder that went missing is made again first (mode 700, with a fresh `.claude.json`),
  so signing in again never starts `claude` in a folder that is not there. Because `projects/` is shared, a session
  started on one account resumes on another.
- **Signing in** (`accounts/login.ts`). `claude auth login --claudeai` runs in a PTY (`Bun.spawn` with `terminal`,
  200×50, `xterm-256color`) with the account's `CLAUDE_CONFIG_DIR`. Claude opens the browser itself; the sign-in link
  is read from the output (an OSC-8 link first, then plain text containing `oauth` and `authorize`) and shown, and a
  code the page shows is pasted back (`code\r`). After 5 s without a link Shinsa presses Enter once (a menu), after
  30 s it gives up with the keychain hint, after 16 minutes the whole sign-in stops. When `claude` exits,
  `claude auth status --json` must report the account signed in, or the sign-in fails; a new account whose first
  sign-in fails, or whose login is already an account (One login, one account, below), is removed again. Claude Code writes the keychain entry
  itself, named `Claude Code-credentials-<first 8 hex of sha256(NFC(config dir))>`. Success dispatches
  `account.signed_in`.
- **Importing.** `GET /api/accounts` offers your Claude Code login while it is signed in and no account is your
  login yet (`origin: 'claude'`; the email is not compared), and every claude-swap account (`cswap list --json`, or
  `claude-swap` when `cswap` is missing, cached 10 minutes) whose email is not an account. Importing your login only
  records it. Importing from claude-swap reads `cswap export - --account <email>`, writes `{ claudeAiOauth }` to the
  new folder's `.credentials.json` (mode 600) and `oauthAccount` into its `.claude.json` (Claude Code moves it into
  its keychain entry on first use), and keeps the account only if `claude auth status` then reports that email; a
  login that is already an account, your Claude Code login included, is refused (`account_exists`). The
  web tells you to take it out of claude-swap (or turn off its auto-switch): refresh tokens are single-use, so two
  tools refreshing one login break it. The first start with no account list adds your signed-in Claude Code login as
  the default account.
- **One login, one account** (`isSameIdentity`, `AccountStore.resolveDuplicates` in `accounts/store.ts`). A login is
  its email and organization, compared without case; an organization that is not known yet matches any, and the same
  email in another organization is another login. Your Claude Code login follows whatever `~/.claude` is signed in
  as, so switching it (with claude-swap, or `claude auth login`) can make it the same login as an account Shinsa
  already has, or the other way round. Two accounts with one login are never two rows and never two candidates:
  their refresh token is single-use, so two copies refreshing sign each other out, and their usage is one quota
  counted twice. Shinsa keeps one, worked out on every read from `accounts.json` as it stands (nothing is rewritten or
  removed): your Claude Code login first, since its token never forks, then the default account, then the one listed
  first. The other is a duplicate. It is left out of the snapshot's `accounts` and listed in its `duplicates`
  (`{ id, email, keptId }`, a line under the accounts in Settings → Agent usage and an info log the first time), its
  usage is not read, and leasing never picks it: a task or run bound to it, or a previous attempt on it, gets the
  kept account, and the kept account is the default when the duplicate is. Shinsa never signs a duplicate out,
  which could revoke the login it shares. Once the logins differ again (your Claude Code login switched back), both
  are accounts as before, with their own settings.
- **Usage** (`accounts/usage.ts`, `accounts/limits.ts`). `GET https://api.anthropic.com/api/oauth/usage` with the
  account's OAuth token (from the keychain through `/usr/bin/security find-generic-password -w`, else
  `.credentials.json`) and `anthropic-beta: oauth-2025-04-20`. The `limits` array wins: `session` is "5-hour
  limit" (Codex's label for the same window), `weekly_all` "Weekly · All models", a `weekly_scoped` entry with a model is "Weekly · ‹model›" (the Fable
  window); the keyed `five_hour`, `seven_day`, `seven_day_opus` and `seven_day_sonnet` fill in, and rotating
  codenames are dropped. A model window has one id whatever reports it, `weekly:<model slug>` (the keyed
  `seven_day_opus` is `weekly:opus`, `seven_day_sonnet` `weekly:sonnet`), so one reading never holds two windows with
  one id (the `limits` entry wins), and a pushed notice naming `seven_day_opus` updates `weekly:opus`. Shinsa never refreshes a token itself (Claude Code does, under its own lock): an expired
  token keeps the last reading and says the login refreshes on the next run. Readings are cached for 60 s and kept
  in `data/usage-limits.json` (read back marked `source: 'cache'`); a failed read never erases a reading, only
  replaces its detail; a 429 backs off at least 5 minutes. Pushed rate-limit notices from a run land on the account
  its attempt ran on (a rejected window counts as 100%). Usage is read at start, every 5 minutes, on a lease that
  finds a stale reading, at each attempt's start (a reading under a minute old is used as is) and end (fresh), on
  every fast mode check, and fresh after a sign-in, an import or a refresh.
- **Leasing an account** (`pickAccount` in core `accounts/pick.ts`, so the web's usage glance names the same account
  the server picks, through `selectNextAccount`). Before each attempt the supervisor asks the broker for an account,
  only for a provider whose capabilities include `accounts`. A run bound to an account always gets it, and so does
  a task bound to one (`task.account`, `task.bind_account`); the run's binding wins: neither moves. A run is bound
  when you run its step again on an account you choose (`task.retry` with `account`, only on a step an agent works
  on: planning, building, review, a fix or an answer; `run.account`), and the step's own recovery, usage-limit
  resume and monitor wakes keep it, while the next step goes back to the task's binding or the pool. Otherwise the candidates are the accounts that are not left
  out of new work, not known to be signed out and not spent (a rejection's reset, or a window at 100% that has not
  reset), minus the ones this execution already tried (`exclude` on the lease request). Among those below their
  switch threshold (the account's own `switchAt`, else `settings.accountSwitchAt`, default 90%, any whole
  percentage; an account with no reading counts as below it) the task's last account stays, then the default
  account, then the most headroom; above the threshold, the most headroom. Headroom is 100 minus the highest
  relevant window: the session and weekly windows, and a model window for runs on that model family or on an
  unknown model; an account with no reading ranks after every account that has one. When nothing qualifies the
  least spent account is tried anyway, so a stale reading cannot strand work. The attempt records its account
  (`run.attempted` `account`), and an attempt on another account than the task's last one writes an
  `account_switched` notice.
- **Rotation on a rejection** (`accounts/rotation.ts`). A usage limit marks the account spent until its reset (15
  minutes from the rejection when the reset is unknown; the snapshot shows that guess as `spentUntil` too); a
  signed-out account is marked signed out. The spent marks are kept in `data/account-marks.json` (written on every
  mark and every sign-in that clears one; read at start without the marks that have run out, and an unreadable file
  is logged and starts empty), so a restart still skips a spent account. An unbound run then retries the same turn on
  another usable account, one try per account and three accounts at most per execution, counted from the rejection's
  `tried`; this is the only retry budget (The rejection seam, above). Every other run's next attempt skips the spent
  account, and the runs already live on it are moved off at their next turn (Kanna's
  `markClaudeSessionsRateLimited`): the supervisor flags every other live run whose current attempt is leased on that
  account, so a message for it is delivered as its next turn instead of into the doomed session, a delegated report
  for it waits for its turn to end and wakes it then, and a run waiting on your answer has its session let go at once
  (idle release), so the answer resumes it as a new attempt on another account. The flag belongs to the attempt; the
  next attempt leases afresh. When no account qualifies, the run ends with the failure, its account, and for a usage
  limit the earliest reset of the pool (or of the bound account).
- **Usage waits** (core `waitForUsageReset`). A usage-limit failure with a reset later than now arms `task.usageWait`
  (`usage_wait.armed`: the run, role, phase, account, `resetAt` and `autoResume` frozen from `settings.autoResume`,
  default on) instead of a gate; the stage reason is "waiting for the usage limit to reset" ("paused until the usage
  limit resets" without auto-resume) and the task counts as working, not as needing you. `UsageResumeClock` (engine)
  dispatches `usage_wait.resume` 5 s after `resetAt` with the id `usage-resume:<task>:<run>:<resetAt>:<wait>`, so a
  repeat is answered from its receipt; a resume that leaves the wait armed (the dispatch failed) is tried again every
  minute under that id with `:<n>` added, `n` the minute slot since the reset (2, 3…), so a retry is a new command and
  not the first one's receipt (core ignores a resume for a wait that is no longer armed); restart needs nothing, the
  clock reads the state. The resume starts the step again on the same session with the original brief and "Your
  previous turn stopped because the usage limit was reached. The limit has reset. Continue where you left off and
  finish the step with the hand-over tool." A wait without auto-resume (Settings → Agent usage → Limits, After a usage
  limit, with `settings.snoozeLimited` on) opens a failure gate at the reset instead; with both off the limit opens
  the failure gate at once. Loop guards: no wait for an unknown or past reset, and a resumed step that hits a window
  no later than the one it waited for opens the failure gate. `usage_wait.change` (auto-resume on or off) replaces the
  wait under a new id, so a resume already on its way does nothing; `usage_wait.resume_now`, a retry, a message,
  cancelling or any new step end the wait.
- **The Sign in gate.** An `auth` failure with a known account opens a `sign_in` gate naming its provider
  (`Gate.provider`, `claude`) and the account (`Gate.account`), "Sign in to Claude as ‹email›". Its body says what stopped (the classifier's reason when it is
  more than signed out: on hold, verification, billing) and that signing in starts the step again; its activity
  entry is Shinsa's, like a failure gate's. It is answered like a failure gate (approve retries anyway, `reply`
  retries with your words as guidance, reject cancels; a message is a `reply`), only by you, and `account.signed_in` (a
  successful sign-in) answers every open Sign in gate of that account and retries those tasks. `account.removed` releases the tasks bound to a removed account and retries its
  Sign in gates on the pool.
- **The API** (`accounts/routes.ts`): `GET /api/accounts` → `AccountsSnapshot` (`{ accounts, login, imports, duplicates,
  providers }`, `packages/core/src/protocol/accounts.ts`), also pushed on every socket as `{ type: 'accounts' }` on connect and
  on every change. `POST /api/accounts/refresh`, `/login` (`{ accountId? }`; none signs in a new account),
  `/login/code` (`{ loginId, code }`), `/login/cancel` (`{ loginId }`; on a finished sign-in it clears it), `/import`
  (`{ origin: 'claude' | 'cswap', email }`), `/update` (`{ accountId, patch: { isDefault?: true, paused?, switchAt?,
  position? } }`, `position` the 0-based place in the list) and `/remove` (`{ accountId }`; signs a folder account out
  with `claude auth logout` and deletes the folder, never touching your own Claude Code login) all answer with the
  snapshot; errors are `{ error: { code, message } }`. Under `SHINSA_INSPECT=1` the accounts service reads no login,
  keychain or usage at start, and signing in, importing, refreshing, updating and removing are refused with
  `inspect_read_only` (Inspect mode, below), so a seeded copy never touches the keychain or deletes a folder; the
  list as stored stays.

## Configuration and data

Shinsa keeps everything in one folder, `~/.config/shinsa` (`$XDG_CONFIG_HOME/shinsa` when that is set):

```
~/.config/shinsa/
├── config.json      This machine's settings, written by Shinsa (atomically, mode 600)
├── extensions.json  The MCP servers you added, your server, skill and plugin switches, each server's last check,
│                    the context optimizer's settings and when each server and skill was first seen
│                    (MCP servers, plugins and skills, above)
├── accounts.json    The Claude accounts Shinsa runs on (Accounts and usage limits, above)
├── accounts/<id>/   One Claude config folder per account Shinsa signed in or imported
└── data/
    ├── shinsa.sqlite  The event log, the effect outbox, the command receipts, the latest state snapshot and the
    │                  Home guide per project (`briefings`)
    ├── worktrees/     One git worktree per task (`<repo>/<branch>-<id>`), and the checkouts of isolated
    │                  delegations (`delegations/<task>/<run>`)
    ├── scratch/       The working folder of each task with no repository (`<task id>`), where its answerer runs;
    │                  removed when the task settles (`scratch.remove`)
    ├── workspaces/    One ledger per GitButler repository (`<repo id>.json`): which uncommitted paths belong to which
    │                  task (Where agents work → GitButler, above)
    ├── transcripts/   One JSONL chat transcript per run
    ├── evidence/      What agents attached as evidence, per task and round (`<task id>/round-<n>/`), and the
    │                  chat's tool images at the top (Evidence, above)
    ├── terminals/     Your terminals (`terminals.json`), each one's last screen (`<id>.screen`), so a restarted
    │                  engine shows how each ended, and your services (`services.json`, mode 600; Terminals, above)
    ├── usage-limits.json  The last usage reading per account
    ├── provider-usage.json  The last usage reading of each provider with a login of its own (Codex)
    ├── account-marks.json The accounts a usage limit marked spent, until they reset
    ├── extension-usage.json  When agents last used each MCP server and skill, and how far each session was read
    ├── eunoe/         eunoe's own folder (`EUNOE_DIR`): config.json, the request log, thread state, transcripts,
    │                  serve.pid and serve.log (The agent loop → Compaction and fast mode)
    ├── secrets.json   Webhook tokens and signing secrets, one-use secret refs and MCP sign-ins (mode 600; never in
    │                  the log)
    ├── onboarding.json  The run of setup so far, so a reload or a restart picks it up on the same step
    ├── serve.lock     Which server holds this data directory: pid, port, URL, version, commit, install path, start
    │                  and boot time (One server per data directory, below)
    └── engine.log     The bundled engine's output under launchd (The engine in the background, below)
```

One folder instead of XDG's config and data split on purpose: it is one thing to back up, move or delete, a seeded or
scratch copy is one directory, and the event log, worktrees and config.json only make sense together.

- **Overrides.** `SHINSA_HOME` moves the whole folder (tests use it). `SHINSA_DATA_DIR` is a flat layout:
  that directory is the data directory, and `config.json`, `accounts.json` and `accounts/` live inside it; scratch
  directories and the seeded copy (`SHINSA_DATA_DIR=~/.shinsa-seed/data`) use it. `SHINSA_WORKTREES_DIR` moves only the worktrees. `SHINSA_EUNOE` runs another eunoe (a path to its
  command) instead of the bundled one, and `SHINSA_EUNOE_PORT` pins the port it listens on. `SHINSA_WEB_DIR` serves
  the web app from another built folder and `SHINSA_PLUGIN_DIR` loads the agents' plugin from another folder (both
  default to the checkout's own, beside `apps/engine`), for a bundle that lays the files out differently.
- **Inspect mode.** `SHINSA_INSPECT=1` serves a data directory for looking at it (a seeded copy, say), read-only: no
  effect runs (no agent, check, git or `gh`), no schedule or clock fires and no run is recovered, and every command
  is refused with `inspect_read_only` ("Shinsa is in inspect mode and only shows this data. Start it without
  SHINSA_INSPECT to change anything."): the engine refuses any dispatch (`Engine.readOnly`), the socket answers a
  `command` with that error in its ack, and HTTP answers 403 to every request under `/api/` that is not a `GET`, to a
  schedule's webhook and to an MCP sign-in's callback. Setup shows its first step without writing
  `onboarding.json` and imports no account. It lists the Claude accounts without reading their logins or usage (Accounts and usage limits,
  above). It takes no lock on the data directory (One server per data directory, below), so it can serve the data of
  a Shinsa that is running, on another port; it shows the log as it was when it started.
- **The seeded copy.** `bun run seed` writes a data folder full of tasks to look at to `~/.shinsa-seed`
  (`SHINSA_SEED_DIR` moves it): `data/` and the throwaway repositories under `repos/`, then prints the command that
  serves it in inspect mode. It covers tasks across shapes and stages, Codex runs, actions on your behalf, evidence, a review
  that is revised and then fixed, and operation-gate notes. The evidence (`scripts/seed-evidence.ts`) is real files in
  `scripts/seed-media/`: before and after screenshots of a settings page in dark mode at 1280px and 390px and of a
  crowded tab row, a WebM recording of it scrolling, a reviewer's own dark-mode shot and contrast note, screenshots of
  Shinsa's own Review tab for SMP-2, and test output for five tasks, each attached shortly before its run ended. The
  pages are rendered by `bun scripts/seed-media/generate.ts [origin]` (`shots.ts` lists every file and what it shows,
  `shots.test.ts` checks each checked-in file is listed): it drives Chromium over CDP (`scripts/perf/shell-cdp.ts`)
  through the fixture pages in `scripts/seed-media/fixtures/` (the settings page, the tab row), records the tab row
  with a screencast that ffmpeg encodes to WebM, and takes the SMP-2 shots from a running seeded copy at `origin`
  (skipped without one; `SEED_MEDIA_ONLY` picks files by name). It also writes the `/ui` showcase's evidence samples
  to `apps/web/public/samples/evidence/`. Transcripts are synthetic; `SHINSA_SEED_SESSION`, a Claude
  Code session `.jsonl`, replaces one task's transcript with that real session.
- **The sample repository.** For the code views the seed also builds `repos/shinsa-sample` offline from Shinsa's own
  tree at a pinned commit, `3590252` (`SOURCE_COMMIT`; `git archive`, about 1,250 files, imported as eight commits
  with `git fast-import`), and files it under a Sample project (`scripts/seed-code.ts`, helpers in `seed-code-kit.ts`, transcripts in
  `seed-code-transcripts.ts`). Four tasks use it: SMP-2 at your review, on a branch with three phase commits, a fix
  commit and one uncommitted edit, twelve changed files (a rename with edits, a deletion, two additions, a PNG,
  `bun.lock` and a 5,000-line fixture), a report of 40 points (18 spots, the key ones explained, one in a file outside the diff; 10 judgement calls with
  their alternatives, two disputed by the reviewer; 7 risks) with the Agent's walkthrough, findings of both
  severities, one Agent chat (planning, three phases and a fix on one session) and a reviewer chat
  whose tool calls carry the real lines;
  SMP-1 merged through a `--no-ff` merge commit with its worktree gone and its branch kept, so its code is read from
  commits alone; SMP-4 with its Agent still building phase 2 over uncommitted edits; and SMP-3, an answer with no code. The
  edits anchor on text in the pinned commit's files, so later renames in Shinsa leave the seed working; moving the pin
  can break an anchor, and the seed then stops with the file's name.
- **Repositories.** Nothing is set up by hand. Triage picks a git repository from the folders that hold
  repositories (`config.json`'s `roots` plus `SHINSA_ROOTS`; until either names one, the folders discovery
  suggests, `repos/roots.ts`), or the one `shinsa do` ran in. A repository is registered the first time Shinsa
  works in it (`repo.register`, `repos/index.ts`) and filed into a project by the rule in Projects and task identity,
  above.
- **config.json versus events.** `config.json` holds what belongs to this machine and nothing replay needs: `roots`
  (the folders that hold repositories), `port`, `hostname`, `editor`, `terminal` and `onboardedAt`.
  The environment wins over it (`SHINSA_PORT`, `SHINSA_HOST`, `SHINSA_EDITOR`, `SHINSA_TERMINAL`; `SHINSA_ROOTS` adds
  folders). Everything `decide` reads stays domain state, changed by `settings.change` events: the default model,
  the merge method, the model per role, plan approval, fix rounds. The rule: if replaying the log on another
  machine must reproduce it, it is an event; if it only describes this machine, it is `config.json`.
- **A broken config.json** never stops Shinsa: the server reads it once at start, copies unreadable JSON to
  `config.json.unreadable-<time>` once and uses the defaults; a field of the wrong type is dropped. Each problem is
  logged once. `shinsa do`, `import`, `status`, `open` and the engine's controls only read the port and never copy
  the file. An unreadable
  `secrets.json` (or one without its salt) is kept aside the same way as `secrets.json.unreadable-<time>`, logged, and
  an empty store is used.

### One server per data directory

Two servers on one data directory would both run every effect: two agents per run, two pushes, two merges. So
`shinsa engine` takes `data/serve.lock` before it opens the event log (`apps/engine/src/instance/lock.ts`). The lock
is created atomically (written to a draft file, then hard-linked into place, which fails when the lock exists) and
records the holder: pid, port, URL, version, commit, install path, when it started and when the machine booted. A
second server finds a live holder and refuses to start with `server_running`, naming it: "Shinsa is already running
on ~/.config/shinsa/data: http://127.0.0.1:5180 (pid 4242, version 0.0.0 (1a2b3c4)). Stop it first, or set
SHINSA_HOME to another folder." The port and URL are written again once the server listens (a port of 0 becomes the
real one). A clean stop removes the lock, after the log is closed, and only when it is still this server's; a
server that could not listen gives it back at once.

A server that crashed leaves its lock behind, and the next one takes it over (with a warning in the log) when the
holder is not live: its pid is gone, the lock was written before the last reboot (the boot time differs by more than
a minute, so a pid reused after a reboot never keeps the lock), it is this process's own pid without this process
holding it, or the file is not a lock at all. A takeover removes the old file only when it still reads the same, and
gives up with `server_lock_contended` after three tries, so two servers racing for a stale lock never both win. A
lock it cannot read (permissions) stops the start instead of being taken over. Inspect mode takes no lock at all.

An engine launchd started (its job sets `SHINSA_SERVICE=1`) that finds a live holder does not fail: it logs a
warning naming the data directory and the holder's pid, URL and version, and exits 0. launchd's `KeepAlive` restarts
only a failed exit, so the engine stays stopped instead of starting again every 5 s while the other Shinsa runs; the
app's Start engine (or Shinsa → Restart Engine) starts it once that one has stopped. From a terminal the refusal stays an error and
exit code 1. `shinsa engine` removes `SHINSA_SERVICE` from its own environment as it starts, so nothing it runs (an
agent starting a Shinsa of its own) inherits it.

### The login shell environment

An app opened from the Dock and a launchd service start with a bare environment (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`,
none of the variables the shell profile sets), so the agents would not find `gh`, `claude`, `codex` or Homebrew's
`git`. `shinsa engine` reads the user's login shell once at start (`apps/engine/src/shell/login.ts`): `$SHELL -lic`
(zsh when `SHELL` is unset) printing a marker and `env -0`, in the home folder, with a 5 s timeout that kills the
shell's whole process group and `DISABLE_AUTO_UPDATE=true` so oh-my-zsh does not prompt. Whatever the profile prints
before the marker is ignored. An interactive shell that prints no marker is read again as a plain login shell,
`$SHELL -lc` (the profile and `.zshenv` but no `.zshrc`), and the server logs that it did: a `.zshrc` that hands
interactive shells to another shell (`exec fish`) leaves `-lic` with nothing to say and exit 0, since stdin is
`/dev/null`. When the interactive shell handed off to fish (`fish` is on the PATH that `-lc` read, or the shell's rc
file, `.zshrc` under `ZDOTDIR` or the home folder, or `.bashrc` for bash, has `exec …fish`), Shinsa also reads
`fish -lc` the same way (a marker, then `env -0`, which fish runs as is), so what only `config.fish` adds (a
`fish_add_path`) is not lost; the two are merged with the plain login shell's values first and fish's `PATH` entries
appended after them, and either one alone is enough. Each attempt gets its own 5 s. The result is cached for the process and merged into the server's own environment,
which every command it runs inherits (git, gh, the checks, Claude Code, Codex, eunoe): a variable the server already
has is kept, one it lacks is added, and `PATH` keeps the server's own entries first and appends the shell's others.
When neither attempt can be read (missing, hung, failed, no marker) the server logs both and starts anyway, with
`~/.bun/bin`, `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin` appended to `PATH` where they exist. A
server started from a terminal (stdin or stdout is a TTY, `isStartedFromTerminal`) skips the shell and logs that it
did: the terminal already has the user's environment. Only the `shinsa engine` command does this; `startShinsa`
(tests, the soak child) never runs a shell.

### The engine in the background

The Mac app carries the engine and runs it as a launchd job, `studio.overclock.shinsa.engine`, so it lives through
closing the window, quitting the app, a crash and a reboot (`docs/plans/app-plan.md`; the app's side is
`apps/desktop/CLAUDE.md`). Nobody installs or starts it by hand.

- **The bundle.** `apps/engine/scripts/build-engine.ts` compiles `scripts/engine-main.ts` with `bun build --compile`
  into one executable, `Shinsa.app/Contents/Resources/engine/bin/shinsa`, the engine and the command line in one;
  beside it `plugin/` (the plugin agents load) and `web/` (the built interface it serves). The build bakes in the
  version, the commit, the state version and the Agent SDK's versions (`process.env.SHINSA_BUILD_*`, read by
  `instance/bundle.ts` as `BUNDLE`, null when running from source): a compiled engine cannot read core's sources or
  the SDK's `package.json`. `shinsa eunoe …` runs Eunoe from the same executable, so the proxy needs no second Bun.
  Claude Code and Codex stay the user's own installs, found on the login shell's `PATH`.
- **The job.** `Contents/Library/LaunchAgents/studio.overclock.shinsa.engine.plist` runs `shinsa engine` from the bundle
  (`BundleProgram`), with `SHINSA_SERVICE=1`, `RunAtLoad`, `KeepAlive` with `SuccessfulExit: false` (a crash or a
  restart exit brings it back, a clean stop stays stopped), `ThrottleInterval` 5 s and `ProcessType` `Interactive`. The
  app registers it as a login item (`SMAppService`), so macOS lists it under Login Items as Shinsa; where that is
  refused it writes the same job, with the program's full path, to `~/Library/LaunchAgents` and loads it with
  `launchctl bootstrap`.
- **The log.** A static plist cannot name a log path in the home folder, so a bundled engine started by launchd writes
  its own stdout and stderr to `data/engine.log`, trimmed to its last half past 8 MB (`writeOutputTo`).
- **Its PATH.** After reading the login shell, a bundled engine puts its own `bin/` first on `PATH`, so agents find the
  `shinsa` command.
- **Restarting.** A restart (`POST /api/engine/restart`, below) stops the engine cleanly and exits with 75
  (`EX_TEMPFAIL`, `EXIT_RESTART`); launchd starts the bundle's program again, which after an app update is the new
  version.
- **By hand** (`apps/engine/src/cli/engine.ts`, `docs/cli.md` → The engine). `shinsa start` is `launchctl
  kickstart` on the job, `shinsa stop` is `launchctl kill SIGTERM` (a clean stop exits 0, so `KeepAlive` leaves it
  stopped until a start, the app, a command that needs it or the next login), `shinsa restart` is `launchctl
  kickstart -k` and `shinsa restart --when-idle` is `POST /api/engine/restart` with `when: idle`; each waits up to
  20 s for the engine to answer, stop answering or answer with a new pid. All three refuse, with
  `engine_unmanaged`, from a `shinsa` that is not a bundled build, with `engine_not_installed` when launchd has no
  job, and with `engine_not_this_app` from any bundled `shinsa` other than the one the job runs: `launchctl print`
  names the program, either by full path (the job the app writes itself, compared after following links) or relative
  to the app with its bundle id (the job `SMAppService` registered, so this `shinsa` must sit at that path inside an
  app with that id, read with `plutil`). So a build in a scratch folder or a test copy of the app never stops or
  restarts your engine; the wake before a command that needs the engine checks the same before `kickstart`.
  `shinsa logs` prints the end of `data/engine.log`, each JSON line as its UTC time, level, message and fields
  (`--json` as written). `shinsa status` and `shinsa version` read `/api/health` without starting anything.
- **Folders macOS keeps private.** The engine is a background process, so it cannot answer macOS's consent prompts
  well: discovery in the bundle skips `~/Desktop`, `~/Documents` and `~/Downloads` (`createDiscoverer`), and a folder
  chosen at setup that the engine may not read is refused with `roots_unreadable`, which says to give Shinsa Full Disk
  Access (`resolveChosenRoots`).

Developing Shinsa itself keeps `bun dev`: the engine runs from source in a terminal, and nothing above applies.

## Onboarding API

The server works before onboarding: with no folders chosen and no `SHINSA_ROOTS`, triage uses the folders discovery
suggests. Onboarding makes the choice explicit. Every endpoint is JSON under the usual guard (loopback Host,
same-site Origin, `application/json` bodies; a refusal there is 403 or 415). Errors are `{ error: { code, message }
}` with status 400 and a message the UI can show as is.

**`GET /api/onboarding`**: where onboarding stands.

```ts
{
  completed: boolean;
  completedAt: number | null;
  roots: {
    source: 'configured' | 'environment' | 'discovered'; // what triage uses right now
    configured: string[];      // config.json
    fromEnvironment: string[]; // SHINSA_ROOTS
    effective: string[];       // what triage searches
  };
  defaults: { model: string | null; mergeMethod: 'squash' | 'merge' | 'rebase' };
  paths: { home: string; configPath: string; dataDir: string; userHome: string };
}
```

**`GET /api/onboarding/roots`** (`?refresh=1` to scan again; results are kept for ten minutes): the folders that hold
git repositories, most first. Discovery walks the home folder four levels deep and at most 20,000 folders, never
into hidden folders, `node_modules`, `Library`, caches, build output or media folders, and never into a repository.

```ts
{
  suggestions: { path: string; repoCount: number; repos: string[] /* up to 8 names */; chosen: boolean }[];
  truncated: boolean; // the folder limit was reached
}
```

**`POST /api/onboarding/setup`** with `{ roots: string[]; defaultModel?: string | null; mergeMethod?: 'squash' |
'merge' | 'rebase'; approvePlans?: boolean }`: saves the folders to `config.json` and the defaults as a
`settings.change` event, then answers like `GET /api/onboarding`. Folders may start with `~/`; each must be an
existing folder, 1 to 50 of them, duplicates dropped. Codes: `body_invalid`, `roots_invalid`, `model_invalid`,
`merge_method_invalid`, `plans_invalid`. It may be called again to change the folders later (Settings → Projects → Repository folders).

**`GET /api/onboarding/prerequisites`**: the tools Shinsa needs, checked on this machine (each with a 15 second
limit).

```ts
{
  ready: boolean; // every check passed or is optional
  checks: {
    id: 'git' | 'gh' | 'gh_auth' | 'claude' | 'claude_auth' | 'codex' | 'codex_auth' | 'bun';
    label: string;      // "GitHub CLI", "Signed in to Claude"
    ok: boolean;
    detail: string;     // the version, "Signed in as octo.", or what went wrong
    fix: string | null; // one sentence with the command that fixes it
    optional?: true;    // codex and codex_auth
  }[];
}
```

**`POST /api/onboarding/complete`** with `{}`: marks onboarding done (`onboardedAt`), once; answers like
`GET /api/onboarding`. Refused with `roots_required` until folders are saved.

### The setup steps

The web's setup is a short run of steps the server keeps (`apps/engine/src/onboarding/flow.ts`), over a fixed,
ordered list defined in code (`steps.ts`): `roots` (the repository folders, "Where do you keep your repositories?";
discovered folders with their repository counts, several at once, and any other folder by its path), `model` (the
default model, from the provider's catalog, or each role's own), `merge` (the merge method), `plans` (plan approval
for large tasks), `accounts` (the Claude accounts agents work under) and `prerequisites` (git, gh and its login,
claude and its login, bun, and optionally codex and its login, each with its fix). Each step has a short label for
the steps along the top (Folders, Model, Merging, Plans, Accounts, Tools), a title and a one-line description.
Nothing you send can add, drop or reorder a step: a reply only ever answers the step on screen or opens one you
have reached.

- **Answering** (`{ type: 'answer', stepId, values }`) is checked against the step on screen and saved at once:
  `roots` takes paths (each validated like `POST /setup`, `~/` allowed), `model`, `merge` and `plans` exactly one of
  their options (`model`'s `:roles` saves no default model, so each role keeps its own), and `accounts` and
  `prerequisites` take `continue`. A saved answer moves to the next step; the last one completes setup. An answer
  the step refuses (a folder that is not there, one macOS keeps private, an option that is not listed) stays on the
  step with the reason as its `problem`, which the next reply clears. There are no free answers to read and no
  model call: an answer is a pick, or for folders a path.
- **Going back** (`{ type: 'open', stepId }`) opens any step up to the furthest one you reached (`furthest`), so
  you can change an answer you gave: a step you have answered lists that answer `chosen`, a new answer replaces it
  (with a command id of its own, so going back to the first answer saves it again), and you carry on from the step
  after it. The later steps keep their answers, shown again `chosen` when you get to them, and the steps along the
  top carry each answered step's summary ("~/Developer and 1 more", "Opus 5.5", "Squash", "Plan first", "2
  accounts"). A step you have not reached is refused with `step_unreached`, and an answer for a step that is not the
  one on screen with `step_stale`.
- **Nothing is chosen for you on a step you have not answered**, a saved or default setting included: the options
  carry no `chosen` until you answer the step, and `merge`'s Squash and `plans`' Show me the plan first are marked
  `recommended` instead. `roots` is the exception, as it picks several at once: the folders already in
  `config.json` start chosen, and with none, the found folder with the most repositories does.
- **Accounts are imported, not asked about.** When the `accounts` step is shown, setup imports every login
  `AccountActions.listImports` offers (your Claude Code login and each claude-swap account, Accounts and usage
  limits above) whose email is not already one of your accounts, through the same import Settings uses. An email
  counts as the same account whatever its organization says, as `AccountStore`'s identity rule does when one side
  has none, so setup never adds a second copy. Each login is tried once per run of setup (`tried`, by origin and
  email): one you remove afterwards is not imported again when you come back to the step. The step lists what it
  imported (`imported`) and why an import failed (`notes`, the import's own message); the accounts themselves, with
  removing one, signing in again and adding another, are the web's (`/api/accounts/*`). Under `SHINSA_INSPECT`
  nothing is imported. With no account signed in the step's button says Skip for now.
- **Saving** goes through the same code as the endpoints above: each answer is `POST /setup`'s `applySetup`
  (folders to `config.json`, the rest as `settings.change`), and the last step is `complete`. The `settings.change`
  carries an id from the answer it saves (`setup:<run>:<step>:<n>`, the run's id kept in `onboarding.json` and new
  on a restart, `n` the count of answers saved so far), so the same answer sent again after a crash is answered from
  its receipt while a later answer to the same step is not.
- **Persistence.** The run of setup lives in `data/onboarding.json` (version 2, written atomically: the step on
  screen, the furthest step reached, the answers saved, the logins tried and imported, the last problem), so a
  reload or a server restart resumes it on the same step. A file that cannot be read or is not one this version
  wrote, or a finished run while `onboardedAt` is empty, starts a new one. Replies run one at a time.
- **Run setup again** (`{ type: 'restart' }`, what Settings → General → Setup and ⌘K's Run setup again send before
  opening `/onboarding`) starts a new run. When setup was done before, the run is a revisit (`revisit: true`): every
  step is reached and shows the current settings `chosen`, so you can open any of them, and the web offers Close
  setup.

**`GET /api/onboarding/flow`**: the run of setup, started on the first call. A finished run (`step: null`) stays
finished while setup is done, so the web goes Home when it opens one; a restart reopens it. The step on screen is
read fresh on every call (the folders, the model catalog, the accounts, the tool checks), so reading it again is
how the tools are checked again.

```ts
{
  steps: { id: StepId; label: string; summary: string | null; reached: boolean }[];
  index: number;                   // the step on screen; steps.length once setup is done
  step: {                          // null once setup is done
    id: 'roots' | 'model' | 'merge' | 'plans' | 'accounts' | 'prerequisites';
    title: string;
    description: string;
    multiple: boolean;             // roots: pick several
    options: { value: string; label: string; detail: string | null; chosen: boolean; recommended: boolean }[];
    checks: Check[];               // prerequisites
    ready: boolean;                // prerequisites: every required tool is there
    imported: AccountImport[];     // accounts: what this run imported
    notes: string[];               // accounts: imports that failed
    problem: string | null;        // why the last answer was refused
    submitLabel: string;           // "Continue", "Skip for now", "Finish setup", "Finish anyway"
  } | null;
  revisit: boolean;                // setup was done before this run
}
```

**`POST /api/onboarding/flow`** with a reply (`answer`, `open` or `restart`): answers with the run. Codes:
`body_invalid`, `step_invalid`, `values_invalid`, `reply_invalid`, `step_stale`, `step_unreached`,
`setup_finished`. A problem with the answer itself is not an error: it comes back as the step's `problem`.

## The socket

Every page holds one WebSocket on `/ws` (`apps/engine/src/http/socket.ts`, the web's `lib/connection/socket.ts`;
the messages are `ClientMessage` and `ServerMessage` in `packages/core/src/protocol/messages.ts`, listed in
`docs/protocol.md` → The socket). On connect the server sends the state without the runs' prompts (`serializeState`), the
accounts, `surfaces` and `terminals` (Terminals, above); then every change of state goes to every socket as a patch, every change of the accounts
and of the terminals whole, and a transcript only to the sockets following its run. Each terminal has a socket of
its own on `/ws/terminals/<id>`. The page's
first message on each socket is `hello` with its surface, `desktop` in the Mac app (it has `window.shinsaDesktop`)
and `browser` anywhere else, Floaty included. The server keeps each socket's surface and tells every socket, with
`surfaces { desktop }`, whether at least one desktop surface is connected: on connect, and again only when that
changes (a desktop says hello, or the last one closes). A page that is not the desktop stays quiet while one is
(`isQuietSurface`): it plays no sound and shows no notification, so a decision never rings twice, and keeps its
count in the title and Floaty's tags (`docs/design.md`, 31). A message the
server does not recognise, including a `hello` with an unknown surface, is logged and ignored; a socket that never
says hello counts as no desktop.

- **Patches, not the state.** A command changes a few entries, so the server sends only those
  (`state.patch { patch }`, `StatePatch` in `packages/core/src/protocol/patch.ts`). `decide` reports which entries its
  events wrote (`Decision.changes`: ids per record of the state), the engine hands each listener the state before the
  command and those changes (`StateChange`), and `resolveStatePatch` turns them into the patch once per command for
  every socket: per entry `put` (new or replaced), `remove`, or `fields` (only the fields whose value changed, and
  `unset` for the ones that went away); a list that only grew at its end, such as a task's activity, goes as
  `{ drop, append }`. `focus`, `settings` and `onBehalfActions` go the same way. A patch names the log position it
  applies to and the one it reaches (`from`, `to`); `applyStatePatch` refuses one whose `from` is not the state's
  `seq`. The page then asks for the whole state again (`state.sync`), ignores patches until it arrives and skips a
  patch it already has (`to` below its `seq`, or at it for a patch that moved the position). A patch whose `from` and
  `to` are equal changes the state without an event (a new Home guide, The briefing) and is applied like any other. A patch copies only what it changes: every entry, list and record
  it leaves alone keeps its identity, so a component that selects one task does not render again when another changes.
- **Runs without their prompts.** A run's `prompt` and `rolePrompt` stay in the event log and in the engine's state,
  where recovery, a usage resume and a resumed session's brief read them, and never go to the page: the state on
  connect, after `state.sync` and in every patch holds each run as a `WireRun` (`serializeRun`), which leaves them out
  and adds `fixFocus`, what a fix is for (`resolveFixFocus`, from the first words of its instruction), the one thing
  the page read from them. A run's wire form is kept per run object, so a run is converted once and a connect after
  that only copies the record. No command the page decides for itself reads a prompt (only a recovery and a usage
  resume do, and neither is optimistic), and the page converts what it decides the same way, so a fix it starts
  shows its focus at once. The CLI and agents read through the HTTP routes and `read_task`, which use the engine's
  state and are unchanged.
- **One render per frame.** The page queues what arrives (the state, patches and transcript entries) and applies it
  once per animation frame (`Connection.flush`), with a 32 ms timer beside it so a hidden page, which gets no frames,
  still follows Shinsa (its title, Floaty's tags, sounds and notifications). An answer to a command (`ack`) applies what
  is queued at once, so a command's own change is shown before its promise settles.
- **Clicks show at once.** A command that settles the same way however often it is applied, or is refused when
  applied again (answering a gate, priority, cancel, complete, waiting on tasks, how a round ships, dismissing a
  suggestion or a quiet run, the usage wait, settings and the focus: `OPTIMISTIC_COMMANDS` in
  `lib/connection/optimistic.ts`), is decided in the page too, by the same `decide`, on the last state the server
  sent, and shown at once. Runs it starts get ids of their own (`optimistic-<n>`) until the server's patch names
  them. Every new state from the server is decided over again with the commands still waiting, and the command leaves
  the page's guess when its answer arrives: on success the server's own change is already in, on a refusal the guess
  is taken back and the refusal shown. A command that creates something (a task, a project) or goes through the
  classifier (a message) is never guessed.
- **Transcripts stream.** `transcript.subscribe { runId, from }` asks for the entries from position `from`, the number
  the page holds, so a reconnect or a second look at a run sends only what is new; the server answers in pages of 500
  (`TRANSCRIPT_PAGE`), each `transcript { runId, entries, start }` with the position of its first entry, and every new
  entry follows with its own. The page appends an entry at its position, skips one it has, starts over at position 0
  and asks again from what it holds when a page would leave a gap (for a run it no longer follows it drops the page
  instead). The page keeps every run it follows and the 24 others read or let go of last
  (`TRANSCRIPT_CACHE_LIMIT`, least recently used first out), so a run dropped is read again from 0. The server keeps the entries of every followed run
  and of the eight runs read last in memory (`Transcripts`) and reads only the bytes appended since, so a long
  transcript is parsed once, not on every line, and every `listEntries` caller gets its own copy.
- **Selectors.** `useShinsaSelector(select)` (`lib/connection/selectors.ts`) gives a component the part of the state it
  reads and renders it again only when that part changes; `useTask`, `useRun` and `useGate` read one entry, and
  `useShinsaState` the whole state.

## Health

`GET /api/health` answers `{ ok, seq, problems, version, protocol, busy, restart, commit, installPath, dataDir, pid, startedAt, uptimeMs }`
(`resolveHealth`, `apps/engine/src/instance/install.ts`), so a desktop app, a script or `shinsa health` can tell
which Shinsa answered: `version` is the engine package's version, `commit` the checkout's `HEAD` (null outside a git
checkout), `installPath` the folder holding `apps/engine`, and `startedAt` and `uptimeMs` count from when the server
started. `problems` lists every event row the engine skipped at boot:
`{ seq, type, kind: 'unreadable' | 'unappliable', error }` (a payload that is not JSON or does not match its type,
or an event `applyEvent` threw on). Replay never stops at a damaged row: every later event is still applied, the
problem is logged as an error, and new events are numbered after the last row in the table. The web reads it on
start and after every reconnect (`lib/connection/health.ts`) and, while `ok` is false, shows a banner saying how many
entries were skipped, each listed under Details, until it is dismissed for the session (`docs/design.md`, 27). A
transcript line torn by a crash is shown as an error entry,
and the next line is never glued onto it (`readChatEntries`).

`protocol` is `ENGINE_PROTOCOL` (`packages/core/src/protocol/engine.ts`), raised only when the contract between the
interface and the engine breaks; `busy` is whether an agent run is mid-turn (`isEngineBusy`: a live run with status
`running`), and `restart` is `idle` while the engine waits for that to end before restarting. **`POST
/api/engine/restart`** `{ when: 'now' | 'idle' }` restarts the engine: at once or once no agent is mid-turn, it stops cleanly and exits with
75 for launchd to start it again, and answers `{ restarting }` before it goes; it refuses with `restart_unsupported`
unless launchd started this process (`createLaunchdRestarter`, `apps/engine/src/instance/restart.ts`). The desktop app's page calls it when the app is newer than the engine
(`docs/plans/app-plan.md` → Versions and updates); it has no surface spec, so no agent has a tool for it.

## Where the rules live

`packages/core/src` has one folder per domain, each with an `index.ts` barrel; the package's `index.ts` re-exports
them, and other packages import only `@shinsa/core`. The folder table and the invariants `decide` keeps are in
`packages/core/CLAUDE.md`; the server's layout is in `apps/engine/CLAUDE.md`.

## Testing

How tests are written (fakes, waiting on conditions, the coverage floor) is in `apps/engine/CLAUDE.md` and
`packages/core/CLAUDE.md`. This is what covers the engine.

- **`decide`, case by case.** `packages/core/test/decide/` runs every path through `decide` with a fixed clock and id
  source (`test/harness.ts`), one test file per `decide/` module (the lifecycle, fixes, pull requests and the watch,
  T3's `pullRequestWatch.test.ts` case for case, runs and recovery, gates, messages, dependencies, rounds, shapes,
  accounts, schedules, secrets, delegations, on-behalf commands and the rest). `test/prompts/handoff.test.ts` covers
  the handoff budget, eliding, cutting at a prompt and refusing; `test/schedules/time.test.ts` intervals and daily
  weekdays across both 2026 daylight-saving changes in New York.
- **`decide` at random.** `packages/core/test/decide/invariants.test.ts` drives `decide` with random user, agent,
  system, stale and invalid commands and checks the invariants after every step. Its walks: the main one (attempts,
  interrupts, continuations, lost sessions, classified failures, accounts, usage waits, sign-ins and bindings), failed
  pull request reads, steps rerun on chosen accounts, tasks of every shape (`shape-invariants.ts`), delegation
  (`delegation-invariants.ts`), rounds (`round-invariants.ts`), schedules (`schedule-invariants.ts`), projects and
  handles (`project-invariants.ts`), and the round agent (`agent-invariants.ts`: no top-level planner or builder, a
  purpose on every Agent run that matches its stage, and every new Agent run resuming the task's last Agent session
  unless that one ended with a fresh-class failure). Every walk also checks that `decide` leaves its input alone, that
  the state it decided equals its events replayed, and that its patch rebuilds the state on a copy kept on the side.
  What each walk checks is listed once, in `packages/core/CLAUDE.md`.
- **The engine and the outbox.** `apps/engine/test/runtime/engine.test.ts` and `test/store/event-log.test.ts` run them
  on SQLite: retries and backoff, failure gates, lane ordering and the side lane, restart recovery per class, effect
  keys, cancellation (a running effect aborted, its late result ignored), damaged effect and event
  rows, and command receipts (a repeat answered, a reused id refused, a refusal remembered, receipts across a restart
  and pruned after a week). `test/runtime/snapshots.test.ts` and `test/store/snapshot.test.ts` cover snapshots: a boot
  that replays only the events after one, one of another version, of a log changed under it or with a damaged payload
  replaced by a full replay, problems kept across one, none written read-only or without a version, a write once
  quiet after a boot or a burst, a failed write logged, the Home guide kept beside the log and back after a boot, and
  the state version following the source (`test/serve.test.ts`: a real server keeps one and its next start reads it);
  `test/store/legacy.test.ts` the one-time rewrite and the move of briefings out of the log; and that a
  listener's state before and changes patch one state into the next. `test/agents/transcripts` covers a transcript
  line torn by a crash, reading from a position, the entries kept in memory and each new entry's position;
  `test/http/server.test.ts` the socket's patches, `state.sync` and transcript pages.
- **Agents.** `apps/engine/test/agents/providers/claude/` covers every `terminal_reason` and failure class
  (`classify.test.ts`), executable discovery, session files under `CLAUDE_CONFIG_DIR`, prompt ids and echo matching,
  steering windows, context usage, the account, the compaction route and fast mode (`route.test.ts`, the
  `compaction and fast mode` block of `session.test.ts`), and the Claude mapping for every tool;
  `test/agents/supervisor.test.ts` attempts, capability policy (compaction and each role's fast mode on every
  session, fast mode only where the provider declares it and the account has usage credits, with the notice when it
  does not), the agents' own sessions metered, every resume fallback, the rejection seam, shutdown and boot.
  `test/agents/providers/codex/` runs the Codex adapter against the fake `codex` (`test/helpers/bin/codex`): pricing
  and metering (`pricing.test.ts`, `meter.test.ts`), usage read like CodexBar from a scratch `CODEX_HOME` and a fake
  endpoint, with the app-server fallback (`usage.test.ts`), the agents a Codex agent starts nested in the turn, held
  and replayed, a compaction turn and compaction off (`session.test.ts`); `test/accounts/index.test.ts` the Codex
  reading in the snapshot, its weekly window, fast mode, its usage wait and its Sign in gate.
  `test/eunoe/` runs `EunoeProxy` against a fake eunoe (`test/helpers/bin/eunoe`: health, a request log line per
  message, and a `fake.json` that makes it fail or hang): starting on a free port, the config it writes, restarting a
  proxy that died, the retry pause, a start that times out, an eunoe that is missing or cannot be run, a Shinsa
  without the bundled package, another eunoe on the port, adopting an orphan, stopping mid-start, and folds reaching
  the session that watches them. `packages/core/test/chat/`
  covers references and `markFinalReplies`.
- **The whole server.** `apps/engine/test/e2e/` runs the engine, outbox, effects, run supervisor, real checks and real
  git with a bare `origin` against scripted agents (`FakeAgents`) and the fake `gh`. `World` (`e2e/harness.ts`)
  restarts it two ways: `restartGracefully()` as a shutdown does, and `restart()` as a crash, which stops the old
  daemon's agent sessions before the new one boots. The files:
  - `lifecycle.test.ts` and `edges.test.ts`: request to merge with the planning run, every phase and the checks fix on
    one session (only Agent and reviewer runs), every fix loop, questions, steering, recovery, cancel,
    three tasks planning at once, waiting on other tasks, plan approval, evidence, protocol rejections, restarts mid-run,
    mid-checks and mid-question; `process.test.ts` the process-and-structure features;
  - `agent-loop.test.ts`: the real Claude adapter over a scripted SDK through each failure class, a graceful restart,
    a crash loop, a dead session and a provider switch; a round's session lost mid-round, restarted on a handoff that
    holds the full brief (the plan, the finished phases with their summaries, the current phase), and a session
    compacted after its brief getting the full brief again;
  - `eunoe.test.ts`: the real Claude adapter over a scripted SDK and the fake eunoe: a run routed through Shinsa's
    eunoe in compact mode and fast mode, with eunoe's compaction in its transcript; eunoe always fold running eunoe in
    its `default` mode, each budget fold a quiet line; a proxy that cannot start, so the run goes direct with a
    `proxy` notice; an eunoe that is missing, so the run goes direct, and a run a minute later that goes through it;
    Claude Code's compaction and standard speed, and off, picked in Settings;
  - `shapes.test.ts`: one task of each kind: a question answered in the repository itself and a follow-up on the same
    session; an investigation that reports and leaves no worktree; one whose fix you approve, planned and opened as a
    pull request without its scratch edits; an operation that waits for its plan and opens no pull request; research
    in the repository itself; a change you chose, to its pull request; a task left on Auto, classified as an
    investigation at high priority through the typed decision questions, each with its why; and the Agent composing
    investigate, your OK, then an operation;
  - `accounts.test.ts`: rotation across three accounts, a spent pool waiting for its first reset, a bound task waiting
    for its own account, a resume sent once however often the clock fires, a still-spent window pausing instead of
    looping, the Sign in gate and a signed-out account handing over to another;
  - `orchestration.test.ts`: async delegation and delivery, a repeated client request id, a wait that times out, a
    question routed to the parent, the read-only ceiling, the depth limit, a restart mid-delegation, a cancel cascade
    and an isolated checkout;
  - `triggers.test.ts`, with a moved system clock: a schedule set by an agent fires, a five-hour sleep catches up with
    one run, a run is skipped while its task is open; `request_secret` → the secret store → a signed webhook starts a
    task while a forged signature, a replay and a tampered body do not, and the secret's value appears nowhere in the
    data folder but `secrets.json`;
  - `idle.test.ts`: a session waiting on an answer is released and the answer resumes it; a finished Agent's large
    session is compacted once, two minutes before its cache expires;
  - `codex.test.ts`: a task planned, built, reviewed and merged with every agent on Codex against the fake `codex`; a
    message steering its turn; a cancel stopping its app server; a graceful restart resuming the same thread and a
    lost thread restored on a fresh one; a usage limit, a sign-out and a crashed app server; a role moved from Claude
    to Codex mid-step, and delegation across the two providers both ways;
  - `compositions.test.ts`: a change then an operation, run or declined after the merge; plans refused for a missing
    verification plan, compositions without checks or an agent review, and the plan's evidence and checks;
  - `extensions.test.ts`: MCP servers and skills found, checked over stdio and HTTP, signed in inside Shinsa and handed
    to the agent; one server defined in three places as one row; the context optimizer leaving one out and the agent
    loading it, mid-run where the session can take it;
  - `cli.test.ts`: the command line against the whole server over HTTP: a task created, listed, read, its changes
    approved and merged, settings changed, a plan revised and approved, a gate the task does not have refused as
    JSON, the same idempotency key creating one task, schedules written, paused and deleted, a project and the focus,
    the health check and the help;
  - `manage.test.ts`: agents managing Shinsa through their surface tools: an agent marks its own task done (no gate,
    nothing left running, the activity names the acting task); an agent asked to merge and approve lists its tools and
    finds none for a decision only you make, calling each of them is an unknown tool, the Bash guard refuses every
    human-only `shinsa` command, and the merge and review gates stay open; an agent changes another task's priority
    and that task's activity names it;
  - `rounds.test.ts`: a mono-chat with three rounds onto one pull request (six phase commits on one branch, one merge
    merges every round, every step of every round resumes the first Agent session); a round shipped as a stacked pull request
    (its own branch and pull request based on the first, the stack merged top down); a new round after a merge from
    fresh main on a new branch; feedback steering the agent and a new idea queued, through the typed decision; a
    split-off the classifier suggests, declined and kept in the chat as the next round; a restart mid-round that
    resumes the round's Agent on its session;
  - `prompt-cache.test.ts`: the real Claude adapter over a scripted SDK that models the provider's prompt cache from
    what the adapter sends (tools listed, system prompt, settings): a change round with a failed check and its fix,
    an answer round and a change round after a merge on one session with one prefix, the reviewer on one session of
    its own, the whole prefix written only by each session's first turn, the moved note where a turn runs in another
    directory, and the metered cache writes equal to the modelled ones (Caching);
  - `rounds-session.test.ts`: the real Claude adapter over a scripted SDK that calls Shinsa's tools, through the fake
    eunoe: eight rounds onto one pull request, every Agent turn (planning, each phase) resuming the first session (one
    eunoe thread), planning turns read-only through the edit-denying hooks and build turns with edits on the same tools,
    the first review fresh and every later one resuming the reviewer's own session, a fold or cut every turn shown in
    the chat, and a graceful restart in the middle that changes none
    of it;
  - `projects.test.ts`: a task scoped to a project whose first agent's brief carries the project, its description and
    every repository's path, with the handle `<KEY>-1`; and triage across a project's three repositories found
    through its folder, which offers only those three and registers the one it picks into the project.
- **The crash test.** `apps/engine/test/e2e/soak.test.ts` runs the real `startShinsa` in a child process
  (`test/e2e/soak/child.ts`) with scripted agents, the fake `gh` and an automatic human who approves every gate, on
  two tasks, and SIGKILLs it at a seeded random moment (60 to 960 ms into each life) up to `SOAK_KILLS` times (10),
  then lets one last life run to the end. It replays the log and checks: both tasks merged, no failure gate ever
  opened, no open gate or run, no failed or pending effect, at most one completed run per step, one pull request per
  task, each branch on origin with exactly its two phase commits, no extra branches, only the main worktree left. The
  automatic human writes each command to a durable outbox before sending it under a fixed id and resends it at the
  start of each life, and a third task is cancelled at a seeded stage: every command in the outbox has a receipt, a
  command the client saw fail was really refused, no gate was answered twice, and the cancelled task ended with no
  worktree, pull request or open effect. `SOAK_SEEDS` (3) and `SOAK_FIRST_SEED` widen it.
- **Fuzzing.** `apps/engine/test/http/fuzz.test.ts` sends seeded random requests (wrong types, unknown commands and
  fields, prototype keys, 20,000-character strings, broken JSON, wrong methods and content types, path tricks) to the
  HTTP API and the socket. Every answer must be 200, 400, 403, 404 or 415; a refused command commits nothing; the state stays well-formed; the log replays to the same state; and
  the server still takes a valid command at the end. `FUZZ_SEEDS` (3) and `FUZZ_STEPS` (150) widen it.
- **Who can change Shinsa.** `test/http/server.test.ts` covers the guard (a foreign Host or Origin, a cross-site
  fetch, a `text/plain` post and a socket from another site or without an Origin are refused; no Origin or a
  loopback one is taken); `test/agents/providers/claude/guard.test.ts` the shell policy, human-only `shinsa`
  commands included.
- **Configuration and setup.** `test/config/` covers the layout and `config.json`; `test/onboarding/`
  and `test/repos/` the onboarding endpoints, discovery, the prerequisite checks and the setup steps.
- **Running in the background.** `test/instance/lock.test.ts` covers the lock (a live holder refused, each kind of
  stale lock taken over, a contended takeover, an unreadable lock) and `test/serve.test.ts` the same through
  `startShinsa`; `test/e2e/lock.test.ts` runs real `shinsa engine` processes on one data directory (the second is
  refused with the first's address, a clean stop frees the lock, a `kill -9` leaves one the next server takes over).
  `test/shell/login.test.ts` reads the environment from a fake login shell (`test/helpers/bin/login-shell`, which
  every test's `SHELL` points at) that prints noise, hangs or fails on request, and a fake fish
  (`test/helpers/fish/fish`, off the `PATH`, found through the login shell's `PATH` or a `.zshrc` that execs it).
  The fish hand-off was also checked by hand with no terminal and a bare environment (`env -i HOME=$HOME
  SHELL=/bin/zsh PATH=/usr/bin:/bin:/usr/sbin:/sbin`) on a machine whose `.zshrc` runs `exec fish`: the merged `PATH`
  held the folders only `config.fish` adds. The bundled engine and its launchd job are checked by hand on a test
  copy of the packaged app (another bundle id, its own label and a scratch `SHINSA_HOME`, `apps/desktop/CLAUDE.md` →
  Testing the packaged app): it registers and starts the engine, quitting the app leaves it running, `kill -9` brings
  it back within seconds, `POST /api/engine/restart` exits 75 and comes back, and a taken port shows the app's
  status screen until the port is free.
- **Real agents.** `bun run --cwd apps/engine test:live` runs a change, an Ask task, an investigation and a support
  question through real Claude agents on a throwaway repository (GitHub stays faked). It costs real tokens, so it is not part of `bun test`. The real eunoe is
  checked by hand: `shinsa engine` on a throwaway `SHINSA_HOME` with `SHINSA_EUNOE_PORT` on a spare port, one task, and
  `data/eunoe/requests.jsonl` showing the run's requests.

Not covered by automated tests: GitHub's real JSON (the fake `gh` mirrors its shape) and the real Claude Agent SDK
process, which only the live run exercises.
