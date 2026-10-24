# The Shinsa protocol

Every object Shinsa keeps, its schema and its name, read from the code (`packages/core/src`), for review. When this
file and the code disagree, the code wins and this file is wrong. Behaviour lives in `docs/engine.md`; this file is the
nouns, the fields and who may send what.

Sections: Glossary · Naming decisions for you · The task · Rounds · Lifecycle · Projects and handles · Runs, attempts and
roles · Steps and gates · Verification · Composing · Messages · Commands · Events · Effects · Agent tools · Where it lives ·
Open protocol questions · Settled protocol questions.

## Glossary

One definition per term. **Code** is the name in `packages/core`; **UI** is the word on screen when it differs.

| Term | Definition | Code | UI |
| --- | --- | --- | --- |
| task | The conversation about one goal you asked for, worked in rounds; the only object with a lifecycle. A small task is a task with one round | `Task` | task |
| round | One unit of work inside a task, with its own steps, plan, build, review and pull request; numbered within the task (`SW-14 · round 3`). One is active at a time | `Round`, `Task.rounds` | round |
| request | What you wrote when you created the task (round 1), or the message that started a later round; the first line becomes the title | `Task.intent`, `Round.request` | request |
| shipping | How a round's commits reach GitHub: onto the task's open pull request (the default), or as its own pull request stacked on it | `RoundShipping` (`onto_pull_request`, `stacked`) | "Onto #12", "As a stacked pull request" |
| resting | A task whose last round finished on its own (merged, answered, ran): open, holding no run or gate, and a message starts its next round | `isTaskResting` | Merged, Done |
| closed | A task you (or an agent, once nothing is open) marked done, or cancelled; it takes no message | `isTaskClosed`, `Task.closedAt` | Done, Cancelled |
| project | A named group of repositories and folders with a key and a description; scopes tasks, triage and the focus | `Project` | project |
| repository | A git repository Shinsa registered, inside at most one project | `Repo` | repository |
| handle | A task's name for people, `<project key>-<number>` (`SW-142`), given once, never reused, never a key | `Task.handle` | the handle |
| id | A UUIDv7, the key of everything stored (events, receipts, references, transcripts) | `id` | not shown |
| focus | The one project whose work Home, the queue and the guide show, or none for all work | `Focus` | Focus |
| run | One agent working one step of a task (or a delegated piece of it), from start to end | `Run` | a run, "the agent" |
| attempt | One execution of a run; a resume, a retry on another account or a restart is a new attempt | `RunAttempt`, `attemptId` (`<run>:<n>`) | not shown |
| session | The provider's own conversation a run executes in; several runs and attempts can share one | `Run.sessionId` | not shown |
| role | What an agent run does (planner, builder…); picks its prompt, tools, model and where it works | `RunRole` (runs), `AgentRole` (settings) | planner, builder… |
| step | One fixed building block of a task's path (`answer` … `merge`); a task's pipeline is a list of steps | `PipelineStep` | step |
| pipeline | The ordered steps one task takes | `Task.pipeline` | "the steps a task takes" |
| phase | One part of an approved plan's build, built by its own builder run and committed on its own | `SpecDocument.plan[i]` (`PlanStep`), `PhaseProgress` | phase |
| stage | Where a task is right now, one value of 20; each working stage belongs to a step | `TaskStage` | the status line |
| shape | A named pipeline preset (answer, investigate, research, change, fix, operation), or the shape a pipeline reads as | `TaskShape` | kind of task |
| plan | What the planner hands over: goal, phases, approach, files, verification plan, and for an operation its steps and impact | `Spec`, `SpecDocument` | plan |
| operation | One-off work run in the repository (a backfill, a migration, a cleanup) by an operator from an approved plan, opening no pull request | step `operate`, role `operator` | operation |
| gate | A durable decision record that holds a task until it is decided | `Gate` | the decision ("Review", "Merge"…) |
| hard gate | A gate only you decide (plan, review, merge, question, secret, your OK, operation, failure, setup, sign-in) | `HardGateDefinition` | Needs you |
| soft gate | An automatic check a step must pass (checks, agent review, CI); it passes, fails to a fixer, or escalates to a hard gate | `SoftGateDefinition` | not a gate on screen |
| decision | Your answer to a hard gate: approve, revise, reject, or answer (with words) | `GateDecision` | Approve, Ask for changes, Reject… |
| evidence | A file or link an agent attached to prove something (screenshot, recording, test, check, note, preview) | `Evidence`, `EvidenceKind` | Evidence |
| check | A command Shinsa runs in the worktree (the repository's and the plan's own), recorded pass or fail | `ReportCheck`, step `checks` | Checks |
| review | Reading a change: the agent review (a fresh reviewer, soft gate) or your review (hard gate) | steps `agent_review`, `your_review` | Agent review, Review |
| finding | One problem the reviewer reports, blocking or a suggestion, at a file and line | `ReviewFinding` | finding |
| proposal | An inquiry's request to turn the task into a change or an operation, decided at your OK | `ChangeProposal` | "What it would change" |
| result | What an investigation, research or operation hands over (findings, report, outcome) | `TaskResult` | Findings, Report, Outcome |
| delegation | Work a running step hands to another agent: a run of the same task with a parent run, never a new task | `RunDelegation` on `Run` | Delegated work |
| courier | A new task an agent files for work that belongs elsewhere (`create_task`), optionally blocking its own task | `TaskCreator.kind: 'courier'` | a task |
| suggestion | A follow-up task an agent proposes (or Shinsa's classifier, for a split-off); it starts nothing until you accept it | `TaskSuggestion` | Suggested follow-ups |
| schedule | A trigger (once, interval, daily, webhook) that starts a task or messages one | `Schedule` | Schedules |
| monitor | An agent's armed wait (`wait_for`): its run ends and a fresh one checks again later | `Monitor` | "Waiting to check again" |
| usage wait | A step paused until a usage limit resets, then resumed on the same session | `UsageWait` | "Waiting for the usage limit" |
| account | A Claude login a run is leased on (or the Codex login, on a Sign in gate) | `RunAccount` | account |
| command | A request to change state; `decide` turns it into events and effects or refuses it | `ShinsaCommand` (`UserCommand`, `AgentCommand`, `SystemCommand`) | not shown |
| event | A past-tense fact; the only way state changes; replayed forever | `ShinsaEvent` | Activity (some of them) |
| effect | Work with I/O that a decision asks for, run from the outbox, reporting back with commands | `ShinsaEffect` | not shown |
| receipt | The stored answer to a command id, so a repeat is answered and never applied twice | `CommandReceipt` (server) | not shown |
| on your behalf | A user command an agent's management tool sent for you from its task, recorded with the acting task | `onBehalf`, `byTask`, `OnBehalfAction` | "‹handle› agent (on your behalf)" |
| message kind | What the classifier read a message to be: feedback on the current round, new work for the task (a new round), or work for another task (a split-off suggestion) | `MessageKind` (`feedback`, `new_round`, `separate_task`) | not shown |
| split-off | A suggestion that something you asked for in this chat belongs in a task of its own; you make it a task or keep it here as the next round | `TaskSuggestion.splitOff` | "Make it a task", "Keep it here" |

### Two names for one thing

| Thing | Names in use |
| --- | --- |
| The plan | `spec`, `Spec`, `SpecDocument`, `specFirst`, stage `awaiting_spec`, events `spec.*`, gate kind `spec`; versus `propose_plan`, gate type `plan`, UI "plan", CLI `plans` |
| The kind of task | `TaskShape`, `shape`, `reshape_task`, `task.reshaped`; UI "kind of task"; `mode: 'ask'` for an answer task asked for as one (`tasks create --ask`, a schedule's `just_answer`) |
| Your request | `intent` (task, `create_task`, suggestions); UI and docs "request"; CLI `tasks create <request...>` |
| Waiting on another task | `blockedBy`, `task.block`, `task.blocked`, stage `queued`; triage's `dependsOn` / `depends_on`; UI "Waits on", "Wait for another task"; docs "dependencies" |
| Your OK | step `your_ok`; gate type `change`, purpose `change`; stage `awaiting_change`; UI "Your OK", "Change to approve", "Make it a change" |
| Ask for changes | decision `revise`; UI "Ask for changes", "Request changes"; CLI `plans revise`, `reviews revise`; message effects `revise_plan`, `request_changes`, `send_back` |
| The classifier | run role `triage`, agent role `classifier`, effect `task.triage`, UI "Quick jobs" |
| A gate's type | three axes: `GateKind` (4 values), `GatePurpose` (7), `GateType` (13, derived by `resolveGateType`) |
| Suggested follow-ups | `TaskSuggestion`, `suggest_tasks`, `suggestion.*`; CLI `followups` |
| A task's agent output | `Task.answer` for an answer, `Task.result` for findings, a report or an outcome |
| Creating a task as an agent | `create_task` (courier tool) and `tasks_create` (management tool) |

### One name for two things

| Name | Meanings |
| --- | --- |
| finding | a reviewer's `ReviewFinding`; an investigation's result (`report_findings`, `TaskResult` step `investigate`, UI "Findings") |
| round | a task's round (`Round`); a fix round (`fixRounds`, "Fix round 2"); a review round (`MAX_REVIEW_ROUNDS`) |
| phase | a plan phase (`PhaseProgress`, `phase.completed`); a section of the work report's walkthrough, one per plan phase (`ReportPhase`) |
| step | a pipeline step (`PipelineStep`); a plan phase (`PlanStep` in `SpecDocument.plan`); an operation's numbered steps (`SpecDocument.operation`) |
| check | a repository check (`checks` step, `ReportCheck`); a CI check on the pull request (`PullRequestCheck`, `ChecksState`); a monitor's next look (`monitor.check_now`, "Check 2 of 10"); the setup check (`config.verify`, "Check again"); the evidence kind `check` |
| wait | a monitor (`wait_for`); a usage wait; a run waiting on its delegated runs (`RunStatus 'waiting'`, `RunWait`); a task waiting on other tasks (stage `queued`) |
| queued | the stage of a task waiting on other tasks; the status of a run created but not yet dispatched |
| answer | the step and tool `answer`; `Task.answer`; the decision `answer` (any reply with words: an answer, notes, guidance, "start without checks"); the delegation tool `task_answer`; CLI `questions answer` |
| decision | `GateDecision`; gate purpose `decision` (plan, review, merge); `ReportDecision` (a builder's judgement call); "decisions" in Needs you |
| task | a task; a delegated run ("delegated task", tools `task_status`, `task_cancel`, `task_answer`) |
| follow-up | a suggested task (UI "Suggested follow-ups"); a message to a finished inquiry (`acceptsFollowUp`, message effect `follow_up`) |
| change | the change shape; the change gate (your OK); "Changes to review"; a proposal "to change" |
| fix | the fix shape (investigate, then a change); a fixer run; a fix round; the review verdict `fix` |
| account | a Claude account; on a Sign in gate, the Codex login (`account.id: 'codex'`) |
| review | the agent review; your review; the gate kind `review`; the Code tab's review view |

## Naming decisions for you

Proposals only; nothing below is renamed yet. Persisted strings (event types, stage values, decisions) keep replaying
under their old names whatever is chosen, through an alias where a value changes.

1. **Plan, not spec.** Rename `Spec`, `SpecDocument`, `SpecRevision`, `specFirst`, `specHistory`, `specAnswers` and
   `GateKind 'spec'` to plan names (`Plan`, `PlanDocument`, `planFirst`…); keep `spec.*` events and the stage value
   `awaiting_spec` on the wire, or add `awaiting_plan` with a replay alias.
2. **Shape in code, "kind of task" on screen**, written down as the one mapping, since `kind` is already the
   discriminant of gates, effects, triggers, targets and tool calls. Drop "shape" from all UI copy and "kind" from
   all code names for tasks. Alternative: rename `TaskShape` to `TaskKind` and accept the overload.
3. **Request, not intent.** Rename `Task.intent` and the `intent` fields of `task.create`, `create_task`,
   `split_task` and suggestions to `request`; keep `intent` in stored events.
4. **One gate type.** Store `type: GateType` on every new gate and read `kind` and `purpose` only to replay old
   ones; `resolveGateType` becomes the fold.
5. **Name the change gate after what it decides**: the proposal gate (stage `awaiting_proposal`, gate type
   `proposal`), keeping the step `your_ok` and the UI's "Your OK". Today it opens with and without a `your_ok` step.
6. **Delegation tools say delegation.** `task_status`, `task_cancel`, `task_answer` act on delegated runs and sit
   next to `tasks_cancel` (a real task): rename them `delegation_status`, `delegation_cancel`, `delegation_answer`,
   and call the thing a delegation, never a "delegated task".
7. **One way for an agent to file a task**, or two names that say why: `create_task` (exactly once per
   `client_request_id`, can make its own task wait) versus `tasks_create` (the surface, on your behalf). Proposal:
   keep `create_task` as the hand-over-safe one and leave `tasks_create` out of task agents' tools.
8. **Findings are the reviewer's.** Call an investigation's result its diagnosis (`report_diagnosis`, UI
   "Diagnosis"), so "finding" means one thing.
9. **Phases are phases.** Rename `PlanStep` to `PlanPhase` and `SpecDocument.plan` to `phases`; rename `ReportPhase`
   to `ReportSection` ("walkthrough section").
10. **Checks are the repository's.** CI's are "CI runs" (`PullRequestCheck` → `CiRun`); a monitor's look is a
    "check-in" (it already takes `check_in_minutes`); the setup check is "setup verification".
11. **Waits on.** Rename `blockedBy`, `task.block` and triage's `dependsOn` to `waitsOn` / `task.wait_on`, and the
    stage `queued` to `waiting_on_tasks`, so `queued` is a run status only.
12. **One role list.** Drop `RunRole 'triage'` (no run ever has it; triage is a quick call on the classifier) and
    mark `shipper` legacy in the type; say in one table which agent role's settings each run role uses
    (`RUN_AGENT_ROLE`).
13. **Judgement calls.** Rename `ReportDecision` to `JudgementCall`, so "decision" is a gate decision only.
14. **Reply, not answer, as the words-taking decision.** `GateDecision 'answer'` covers answering, notes, guidance
    and "start without checks"; call it `reply`, keep `answer` on the wire.
15. **One result field.** Fold `Task.answer` into `Task.result` (step `answer`), so every inquiry hands over the same
    way.
16. **Commands are imperative.** Rename the system commands that read as events and share an event's name
    (`pull_request.pushed`, `run.session_lost`, `delegation.delivered`, `delegation.undelivered`) to
    `pull_request.record_push`, `run.record_lost_session`, `delegation.record_delivery`, `delegation.release`.
17. **Suggested tasks, not follow-ups**, for `TaskSuggestion` (CLI `suggestions`, UI "Suggested tasks"), so a
    follow-up is only a message to a finished inquiry.
18. **The on-your-behalf event.** `manager.acted` was renamed `on_behalf.acted` (record `OnBehalfAction`,
    `state.onBehalfActions`) in this pass: no log or commit carried the old name. Confirm the new name.
19. **Sign in names a provider.** Give the Sign in gate a `provider` field instead of putting `codex` in
    `account.id`.

## The task

`Task` in `domain/types.ts`. Optional fields (`?`) were added after the first logs; a missing one reads as its empty
value. The fields under Triage and shape, Plan and build, Checks, review and fixes, Pull request and Inquiry and
operation results hold the **current round's** work: a new round archives them into its `Round` and starts them empty
(Rounds, below).

**Identity and request**

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | UUIDv7, the key |
| `handle?` | string \| null | `SW-142`, set on `task.created` (with a project) or `task.triaged` |
| `projectId?` | string \| null | the project, else none |
| `intent` | string | your request, as written |
| `title` | string | from triage (the request's first line until then) |
| `origin` | string \| null | the folder `shinsa do` or `shinsa import` ran in, a hint for triage |
| `mode?` | `build` \| `ask` | `ask` reads as the answer shape: `tasks create --ask`, a schedule's `just_answer` target, older logs |
| `createdAt`, `updatedAt`, `stageChangedAt` | number | times (ms) |

**Triage and shape**

| Field | Type | Meaning |
| --- | --- | --- |
| `repoId` | string \| null | the repository, from triage |
| `size` | `small` \| `large` \| null | from triage; a large plan can wait for approval |
| `branch` | string \| null | the task's branch, once its worktree exists |
| `proposedBranch?` | string \| null | triage's branch for a task with no worktree step yet |
| `pipeline?` | `PipelineStep[]` | the steps; absent means change (or answer for `mode: 'ask'`) |
| `auto?` | `{ shape, start, priority }` booleans | which parts you left to Shinsa |
| `triageDecisions?` | `{ shape, start, priority }` each `{ value, why }` \| null | triage's choice and why, per Auto part |
| `shapeChanges?` | `ShapeChange[]` (last 20) | each pipeline change: from, to, by (`you`, `agent`, `shinsa`), reason |
| `proposal?` | `ChangeProposal` \| null | an inquiry's proposal: request, why, status (`open`, `accepted`, `declined`) |
| `specFirst` | boolean | plan first: the plan always waits at a gate |

**Lifecycle and scheduling**

| Field | Type | Meaning |
| --- | --- | --- |
| `stage` | `TaskStage` | where it is (Lifecycle, below) |
| `stageReason` | string | a few lower-case words: "waiting for CI" |
| `priority` | `urgent` \| `high` \| `normal` \| `low` | how high its decisions sit in Needs you; never what runs |
| `blockedBy` | string[] | task ids it waits on |
| `baseTaskId` | string \| null | older logs: the task it was stacked on |
| `note` | string \| null | the latest `note` an agent kept |
| `activity` | `Activity[]` | what happened, newest last |

**Plan and build**

| Field | Type | Meaning |
| --- | --- | --- |
| `spec` | `Spec` \| null | the current plan: version, body, document, change summary, changes, feedback, `approvedAt` |
| `specHistory?` | `SpecRevision[]` (last 10) | earlier versions |
| `specAnswers` | string \| null | your words when you approved the plan, for the builders |
| `phases` | `PhaseProgress[]` | per plan phase: `pending`, `active`, `done`, `skipped` |
| `phaseReports` | `PhaseReport[]` | per finished phase: summary, code spots, judgement calls |
| `summary` | string \| null | the work's summary |
| `report` | `WorkReport` \| null | the review walkthrough built from every phase |
| `worktreePath` | string \| null | the task's worktree |
| `treeHash?` | string \| null | the tree of the last commit Shinsa made |

**Checks, review and fixes**

| Field | Type | Meaning |
| --- | --- | --- |
| `checkResults` | `ReportCheck[]` \| null | the last round of checks |
| `findings` | `ReviewFinding[]` | the last agent review |
| `dismissedFindings?` | `ReviewFinding[]` (last 30) | findings you dismissed, never reported again |
| `fixRounds` | number | automatic fix rounds used |
| `fixFor` | `checks` \| `review` \| `you` \| `pull_request` \| null | what the current fix is for |
| `fixSignature`, `stalledFixes`, `fixHistory?`, `fixFingerprints?` | | repeat detection: the same failures after the same tree |
| `recoveries`, `recoveryFingerprint?` | number, string | the recovery budget and the durable state it is keyed to |

**Pull request**

| Field | Type | Meaning |
| --- | --- | --- |
| `pullRequest` | `PullRequest` \| null | number, url, state, checks, comments, mergeable, head, merge queue, merge commit |
| `pullRequestWatch?` | `PullRequestWatch` \| null | the watch's memory: per-check states, comment watermark, conflict, stop reason |
| `pullRequestReadFailures?` | number | failed reads in a row (stops at 8) |
| `pushedSha?`, `pushedFrom?`, `pushPending?` | | the push Shinsa made and whether GitHub has shown it |

**Inquiry and operation results**

| Field | Type | Meaning |
| --- | --- | --- |
| `answer?` | string \| null | the answerer's answer |
| `result?` | `TaskResult` \| null | step (`research`, `investigate`, `operate`), body, run, time |

**Waits, cost and accounts**

| Field | Type | Meaning |
| --- | --- | --- |
| `monitor?` | `Monitor` \| null | an agent's armed wait |
| `usageWait?` | `UsageWait` \| null | a step waiting for a usage reset |
| `account?` | `RunAccount` \| null | the account the task is bound to |
| `budgetAcknowledgedUsd?`, `usageAcknowledgedPercent?` | number | what you allowed past the cost and usage limits |
| `configProblems?` | `ConfigProblem[]` | the setup check's problems |

**Agents and other tasks**

| Field | Type | Meaning |
| --- | --- | --- |
| `suggestions?` | `TaskSuggestion[]` | follow-ups agents suggested |
| `parentTaskId?` | string \| null | the task whose agent filed this one |
| `createdBy?` | `TaskCreator` \| null | `courier` (`create_task`) or `split` (`split_task`), with the run and request key |
| `splits?` | `TaskSplit[]` | tasks `split_task` made, once per plan version |
| `scheduleId?` | string \| null | the schedule that started it |

**Rounds**

| Field | Type | Meaning |
| --- | --- | --- |
| `rounds?` | `Round[]` | every round, in order; round 1 is made on `task.created`, so a log from before rounds replays into one round |
| `closedAt?` | number \| null | when you (or an agent for you) marked it done or it was cancelled; a closed task takes no message |

## Rounds

`Round` in `domain/rounds.ts`, the folds in `state/rounds.ts`, the decisions in `decide/rounds.ts`.

```ts
export type RoundShipping = 'onto_pull_request' | 'stacked';

export type RoundStatus = 'queued' | 'active' | 'shipped' | 'merged' | 'finished' | 'cancelled';

export type MessageKind = 'feedback' | 'new_round' | 'separate_task';

export interface RoundPullRequest {
  number: number;
  url: string;
  state: PullRequest['state'];
  base: string | null;
}

export interface RoundOutcome {
  goal: string | null;
  phases: string[];
  headline: string | null;
  result: string | null;
}

export interface Round {
  number: number;
  title: string;
  request: string;
  why: string | null;
  shipping: RoundShipping;
  status: RoundStatus;
  pipeline: PipelineStep[];
  branch: string | null;
  base: string | null;
  pullRequest: RoundPullRequest | null;
  queuedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  outcome: RoundOutcome | null;
}
```

| `Round` field | Meaning |
| --- | --- |
| `number` | 1, 2, 3… within the task; the key commands use (`round.ship`) |
| `title`, `request`, `why` | the classifier's title, the message that started it (the task's request for round 1), why it is new work |
| `shipping` | onto the task's open pull request, or its own stacked one; changeable while the round waits, and while it is active until it goes to its pull request |
| `status` | `queued` (waits for the current round to rest), `active` (the one being worked), `shipped` (its commits sit in an open pull request while a later round works), `merged`, `finished` (an inquiry or operation ended, or the task was marked done), `cancelled` |
| `pipeline` | its steps; the task's `pipeline` while it is active, archived when it ends |
| `branch`, `base` | the branch it pushes to; for a stacked round, the branch it stacks on |
| `pullRequest` | the pull request its commits went to |
| `outcome` | what it kept when it ended: plan goal, phase titles, the work's headline, an answer or result |

`Run.round`, `Gate.round`, `Evidence.round` and `Activity.round` name the round a step, a gate, a piece of evidence or an
activity entry belongs to; they are set only from round 2 on, so a missing one is round 1.

## Lifecycle

Settled stages are `merged`, `done`, `cancelled` (`isTaskSettled`). A gate stage holds a hard gate; a working stage
holds an active run; Shinsa's own stages hold an effect.

| Stage | Step | Who moves it | Leaves for |
| --- | --- | --- | --- |
| `triage` | none | Shinsa: classify, setup check, worktree | `queued`, the first step, or a setup gate (stays `triage`) |
| `queued` | none | Shinsa, when every task it waits on merged or is done | `triage` (worktree), then the first step |
| `answering` | answer | answerer | `done`, `awaiting_change` |
| `researching` | research | researcher | `done`, `awaiting_change` |
| `investigating` | investigate | investigator | `done`, `awaiting_change`, `triage` (the worktree reset, fix shape) then `planning` |
| `awaiting_change` | your OK (no step owns it) | you | `triage` (setup again) then `planning`; `done` (veto); the inquiry again (message) |
| `planning` | plan | planner | `awaiting_spec`, `building`, `operating` |
| `awaiting_spec` | plan | you | `building`, `operating`, `planning` (revise), `cancelled` |
| `operating` | operate | operator | `done`, `building` (operation before the build) |
| `building` | build | builder, one run per phase | `checking`, or `awaiting_review` for an older pipeline without checks |
| `checking` | checks | Shinsa | `reviewing`, `fixing`, a failure gate |
| `reviewing` | agent review | reviewer | `awaiting_review`, `fixing` |
| `fixing` | build | fixer | `checking`, `shipping` (a pull request fix) |
| `awaiting_review` | your review | you | `shipping`, `fixing`, `cancelled` |
| `shipping` | pull request | Shinsa and the watch | `awaiting_merge`, `fixing` |
| `awaiting_merge` | merge | you, then the merge effect | `merged`, `awaiting_operation`, `shipping`, `fixing` |
| `awaiting_operation` | operate | you | `operating`, `done` |
| `merged`, `done`, `cancelled` | merge / none | | settled |

Any working or gate stage can also hold a failure gate (paused), a monitor or a usage wait; `task.cancel` and
`task.complete` settle from anywhere open.

**Rounds and the lifecycle.** A task's stage belongs to its active round. `merged` and `done` reached on their own
leave the task **resting**: settled (no run, gate or worktree) but open, and a message starts its next round. A new
round starts from rest, or from the merge gate (the round's pull request is clean and waiting for you), and goes
through `triage` (the setup check and the worktree) to its first step. `task.complete` on a resting task, or anywhere
open, **closes** it (`done`, `closedAt`); `task.cancel` closes it as `cancelled`. Queued rounds of a closed task are
cancelled.

| From | A new round starts | Its branch | Its pull request |
| --- | --- | --- | --- |
| the merge gate, onto the open pull request | at once | the same branch and worktree | the same one; the merge gate comes back when the round reaches it |
| the merge gate, stacked | at once | a new branch on top of the open one (`<branch>-round-<n>`) | its own, with the open one's branch as its base; the merge merges the stack |
| rest after a merge | at once | a new branch from the freshly fetched default branch | a new one |
| rest after an inquiry or an operation | at once | the task's branch, or the one triage proposed | a new one, if the round ships code |
| any other stage | waits (`queued`) | | |

A round with no pull request step (an answer, research, an investigation, an operation) waits for rest rather than
the merge gate, so an open pull request is never left without one.

## Projects and handles

| `Project` field | Type | Meaning |
| --- | --- | --- |
| `id` | string | UUIDv7 |
| `name` | string | at most 80 characters |
| `color` | string | the project dot; the web offers the eight of `PROJECT_COLORS` (`blue` … `red`) |
| `key` | string | 2 to 6 capitals and digits (`/^[A-Z][A-Z0-9]{1,5}$/`), derived from the name, editable |
| `description` | string | at most 1,000 characters, given to every fresh run |
| `folders` | string[] | at most 20; every repository one level inside belongs to the project |

| `Repo` field | Type | Meaning |
| --- | --- | --- |
| `id`, `name`, `path` | string | |
| `defaultBranch` | string | |
| `remote` | string \| null | `origin`'s URL |
| `projectId` | string \| null | its project |
| `checkCommands` | string[] | configured checks; empty means read from `package.json` |
| `checksWaived?` | boolean | "Start without checks" |

A `previewCommand` in an older `repo.registered` event is dropped on replay.

- **Handle**: `<key>-<n>`; `T-<n>` for a task with no project (`NO_PROJECT_KEY`). Counters per key live in the log
  (`state.taskNumbers`); a key change starts the new key's counter and never reuses a handle. Parsed by
  `parseTaskHandle` (any case). Core finds a task by id or handle (`selectTaskByReference`); the server's reads also
  take the start of an id or the exact title.
- **Focus**: `{ projectId, until }`; `until` ends it at a time.

## Runs, attempts and roles

| `Run` field | Type | Meaning |
| --- | --- | --- |
| `id`, `taskId`, `role` | | |
| `status?` | `queued` \| `running` \| `waiting` | `waiting`: its turn ended while delegated runs work |
| `phaseIndex?` | number \| null | the plan phase a builder builds |
| `prompt?`, `rolePrompt?`, `resume?` | | the brief; the brief before Shinsa appended the project and any adoption note, which a recovery or a usage resume starts from; whether it resumes an earlier session |
| `provider`, `model` | string, string \| null | where it started |
| `sessionId`, `sessionProvider?`, `sessionLost?` | | the provider session, who owns it, whether it is gone |
| `startedAt`, `endedAt`, `outcome`, `summary` | | `completed`, `failed`, `cancelled` |
| `attemptId?`, `attempts?` | | the current attempt and every attempt |
| `failure?` | `RunFailure` | class (13), message, code, retryable, `resetAt`, account |
| `resumePending?`, `continuations?` | | restart continuation and its loop guard |
| `monitorId?`, `usageWaitId?` | | the wait it was woken from |
| `feedback?` | string \| null | your words it carries |
| `usage?`, `weeklyPercent?` | | tokens and cost; share of the weekly window it used |
| `silence?` | `RunSilence` | the quiet-run mark, snooze and dismissal |
| `account?` | `RunAccount` | the account this run is bound to |
| `delegation?`, `cohort?`, `waitingOn?` | | set on a delegated run; its parent's delivery state and what it waits on |
| `compactions?` | string[] | sessions compacted while idle |
| `round?` | number | the round it works for (Rounds, above) |

`RunAttempt`: `attemptId`, `provider`, `model`, `resumed`, `handoff` (`provider_switch` or `session_restore`, entry
counts), `startedAt`, `account`.

| Run role | Settings role | Read-only | Works in | Hands over with |
| --- | --- | --- | --- | --- |
| `planner` | planner | yes | worktree | `propose_plan`, or `reshape_task` |
| `builder` | builder | no | worktree | `complete_phase` |
| `reviewer` | reviewer | yes | worktree | `report_review` |
| `fixer` | fixer | no | worktree | `complete_fix` |
| `shipper` | fixer | no | worktree | `complete_fix` (older logs; no step starts one) |
| `answerer` | answerer | yes | the repository itself | `answer` |
| `investigator` | answerer | no (scratch) | worktree | `report_findings` |
| `researcher` | answerer | yes | worktree when there is one, else the repository | `submit_report` |
| `operator` | builder | no | worktree | `report_outcome` |
| `triage` | classifier | | never a run | |

The classifier (triage) and the writer (the Home guide) are quick calls with no tools, not runs. A delegated run takes
`planner`, `builder`, `reviewer` or `fixer` (`DelegateRole`) and no hand-over tool.

## Steps and gates

### `STEP_SCHEMA` (`domain/steps.ts`)

`STEP_SCHEMA: Record<PipelineStep, StepDefinition>`. Every step declares:

| `StepDefinition` field | Meaning |
| --- | --- |
| `step`, `title` | the name and its title on screen |
| `class` | `inquiry`, `consent`, `planning`, `code`, `operation`, `verification`, `review` or `shipping`; the verification rules key on it |
| `actor` | `{ by: 'agent', role }`, `{ by: 'shinsa' }` or `{ by: 'you' }` |
| `inputs` | what it reads (the request, the inquiry's result, the approved plan, the diff, the merged code) |
| `outputs` | what it hands over: `{ name, tool, evidence }`, `tool` null when Shinsa records it |
| `exit` | when the step is done, one sentence; `reshape_task` shows it to the planner |
| `gate` | `{ strength: hard \| soft \| none, types, when }`: the gate types it can open, and when a conditional one opens |
| `placement` | `canonical` (the order of `PIPELINE_ORDER`) or `after_plan_or_last` (`operate`) |
| `needs` | `{ steps, match: any \| all, where: before \| anywhere, rule }`; `validatePipeline` reports `rule` word for word |
| `worktree` | whether it works in the task's worktree, so the setup check and `worktree.create` run first |
| `stages` | the task stages that belong to it; the invariants check a task's stage belongs to a step it has |

`PIPELINE_ORDER`: answer, research, investigate, your_ok, plan, operate, build, checks, agent_review, your_review,
pull_request, merge. `operate` is placed right after `plan` or last, after `merge`.

| Step | Class | Actor | Outputs (tool) | Gate | Needs | Worktree | Stages |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `answer` | inquiry | answerer | the answer (`answer`) | none, can open `change` | | no | answering |
| `research` | inquiry | researcher | the report (`submit_report`) | none, can open `change` | | no | researching |
| `investigate` | inquiry | investigator | findings (`report_findings`), evidence | none, can open `change` | | yes | investigating |
| `your_ok` | consent | you | your decision | hard: `change` | an inquiry; a plan | no | none |
| `plan` | planning | planner | the plan (`propose_plan`) | hard: `plan`, when it operates, is plan first, asks for approval, or Approve plans is on for a large or revised plan | build or operate | yes | planning, awaiting_spec |
| `operate` | operation | operator | the outcome (`report_outcome`), evidence | hard: `plan`, `operation` | plan | yes | operating, awaiting_operation |
| `build` | code | builder | phase reports (`complete_phase`), evidence | none | plan; your review, pull request and merge | yes | building, fixing |
| `checks` | verification | Shinsa | check results (evidence) | soft: `checks` | build | no | checking |
| `agent_review` | verification | reviewer | findings (`report_review`, evidence) | soft: `agent_review` | build | no | reviewing |
| `your_review` | review | you | your decision | hard: `review` | build | no | awaiting_review |
| `pull_request` | shipping | Shinsa | pull request, CI, bot verdicts (evidence) | soft: `ci` | build; your review before it | no | shipping |
| `merge` | shipping | you | the merged commit (evidence) | hard: `merge` | build; pull request before it | no | awaiting_merge, merged |

`validatePipeline` refuses: no steps; a step twice; steps out of order; an operation not right after the plan or
last; more than one inquiry; any unmet need (its `rule` word for word); no step that does the work (an inquiry, a
build or an operation).

### `GATE_SCHEMA` (`domain/steps.ts`)

`GATE_SCHEMA: Record<GateType, GateDefinition>`. A hard gate (`HardGateDefinition`) declares the `kind` and `purpose`
of the `Gate` it opens, its `title`, what you see (`shows`), its `decisions` and what each does, the `refusal` for any
other decision and whether it `pauses` the task; `gate.answer` and `isPausingGate` read them, so a gate cannot drift
from its definition. A soft gate (`SoftGateDefinition`) declares who decides it, what it `shows` and its `outcomes`:
`pass`, `fail`, `escalate`.

Hard gates, decided by you. `Gate.kind` and `Gate.purpose` are what is stored; `resolveGateType` reads the type. The
plan, your OK, review and merge gates open as `STEP_SCHEMA` says (the plan step's `when`; your OK after an inquiry
proposes a change or at a `your_ok` step; review after the checks and the agent review; merge on a clean pull request);
the operation gate opens when a task that operates after the merge merges; the others as `docs/engine.md` → Gates says.

| Type | Kind / purpose | Shows | Decisions | Refusal | Pauses |
| --- | --- | --- | --- | --- | --- |
| `plan` | spec / decision | the plan, its version and changes, the operation and impact | approve (records the version, starts work) · revise · reject (cancels) | "Approve it, ask for changes or reject it." | no |
| `review` | review / decision | the report, the diff by risk, evidence and checks, findings | approve (push, open the pull request) · revise (a fixer) · reject | same | no |
| `merge` | merge / decision | the final diff, CI and bots, what changed since review | approve (merge) · revise (a fixer) · reject | same | no |
| `question` | question / agent_question | the question, context, choices, recommendation | answer | "Answer the question." | no |
| `secret` | question / agent_question + `secret` | what it is for, why | answer (a secret ref only) · reject | "Paste the secret into the secret field." | no |
| `change` | question / change | the inquiry's result, the proposal | approve (plan it) · reject (keep the inquiry, finish) | "Approve the change or keep the task as it is." | no |
| `operation` | question / operation | the merged commit and pull request, the steps, the impact, your notes | approve (run) · answer (run with your words) · reject (finish without it) | "Run the operation or finish the task without it." | no |
| `failure` | question / failure | what stopped, why, what Retry does | approve (retry) · answer (retry with guidance) · reject (cancel) | "Retry or cancel the task." | yes |
| `configuration` | question / configuration | each setup problem and its fix | approve (check again) · answer (start without checks) · reject | "Check the setup again, continue without checks, or cancel the task." | yes |
| `sign_in` | question / sign_in | the account | approve (retry) · reject | "Sign in, retry or cancel the task." | yes |

Soft gates, decided by Shinsa or the reviewer:

| Type | Decided by | Pass | Fail | Escalate |
| --- | --- | --- | --- | --- |
| `checks` | Shinsa | agent review | a fixer with the output, then checks again | a failure gate (out of rounds or stalled) |
| `agent_review` | reviewer | your review | a fixer on the blocking findings, then checks and a new reviewer | your review with the findings (3 rounds, a stall, the budget) |
| `ci` | Shinsa | the merge gate | a fixer told exactly what is new | a failure gate (the watch stopped or ran out) |

| `Gate` field | Type | Meaning |
| --- | --- | --- |
| `id`, `taskId`, `runId` | | `runId`: the run that asked (questions) or failed |
| `kind`, `purpose` | `GateKind`, `GatePurpose` | see above |
| `status` | `open` \| `answered` \| `withdrawn` | |
| `title`, `body` | string | what is decided; the body in markdown |
| `openedAt`, `answeredAt`, `decision`, `response` | | your answer and its words |
| `planVersion?` | number | the plan version a plan gate is for |
| `choices?`, `recommendation?` | | a question's one-click answers |
| `cause?` | `budget` \| `monitor` | why a failure gate opened, when not plain recovery |
| `escalation?` | reason (`rounds`, `stalled`, `exhausted`), rounds | an escalated review |
| `verdicts?` | `{ index, verdict: fix \| dismiss, note }[]` | your per-finding decisions |
| `supersededBy?` | string \| null | the message that withdrew a question |
| `account?` | `RunAccount` | the account a Sign in gate names |
| `secret?` | `{ label }` | makes a question a secret request |
| `commit?` | string \| null | the merged commit an operation gate shows |
| `notes?` | string \| null | your messages at the operation gate, joined in order; each one updates the open gate (`gate.noted`), and the operator starts with them |
| `round?` | number | the round it belongs to (Rounds, above) |

## Verification

`VERIFICATION_RULES` (`domain/verification.ts`) apply exactly when a composition contains work of their class.

| Rule | Class | Scope | Checked by | Requirement |
| --- | --- | --- | --- | --- |
| `code.verification_plan` | code | `always` | `propose_plan` | the plan says up front how the change is proven (`verification`) |
| `code.evidence` | code | `always` | the last `complete_phase` | the evidence kinds the plan asks for are attached (`evidence_missing`) |
| `code.checks` | code | `always` | the composition | `checks` follows `build` |
| `code.agent_review` | code | `always` | the composition | `agent_review` follows `checks` |
| `code.shipping` | code | `always` | the guards | your review, a pull request, the merge |
| `code.ci` | code | `always` | the pull request watch | the merge gate opens only on a clean pull request |
| `operation.plan_approved` | operation | `always` | the plan gate | an operation runs only from a plan you approved |
| `operation.impact` | operation | `always` | `propose_plan` | `impact`: what changes and how much, a dry run or why none, how to undo |
| `operation.steps` | operation | `with_code` | `propose_plan` | the operation's steps in `operation`, apart from the phases |
| `operation.confirm_after_merge` | operation | `after_merge` | the operation gate | you confirm again on the merged commit |

`validateComposition` = `validatePipeline` + the `step` rules + two rules about the task as it stands (an inquiry that
ran stays; an inquiry that leads to a plan needs `your_ok` unless it already ran). `validatePlanRules` = the `plan`
rules + "`evidence` and `checks` are for a code change". `listMissingEvidence` names the kinds still missing.

## Composing

The planner composes steps and sets plan parameters; it cannot add a step kind or a gate.

- **Steps**: `reshape_task` with `shape` (answer, investigate, research) or `steps` (an enum of `PIPELINE_ORDER`),
  before it plans, once per task, never for a kind you chose. A refusal is `pipeline_invalid` with every problem;
  the run carries on.
- **Plan parameters** in `propose_plan` (`SpecDocument`): `verification` (required for code), `evidence`
  (`screenshot`, `recording`, `test`, `note`, `preview`), `checks` (at most 6 extra commands), `impact` (required for an
  operation), `operation` (its steps, required with code), `approval` (asks for the plan gate). A refusal is
  `plan_invalid`.
- The only hard gates an agent can add: your OK (`your_ok`, after an inquiry) and plan approval (`approval`).

Examples:

| Request | Steps | What applies |
| --- | --- | --- |
| A question | `answer` | no class with rules: no plan, checks, review or pull request |
| A fix | `investigate`, `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge` | every code rule; the worktree is reset before the plan |
| A change, then an operation | `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge`, `operate` | code rules, `operation.impact`, `operation.steps`, the plan gate, the operation gate after the merge |
| Investigate, your OK, then a change | `investigate`, `your_ok`, `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge` | your OK first; leaving out `your_ok`, `checks` or `agent_review` is refused with the rule's message |

## Messages

`task.message` never approves a plan, a review, a merge, your OK or an operation; at a failure or Sign in gate it
retries the step with your words. Sent on your behalf, a message that would retry at a Sign in gate is refused
(`human_only`). `resolveMessageEffect` (`decide/messages.ts`) says what it does; `decide` delivers by it and every
composer's hint reads it (`apps/web/src/lib/tasks/messages.ts`). The table is in `docs/engine.md` → Gates → What a
message does. Values: `steer`, `wake`, `retry`, `supersede_question`, `revise_plan`,
`request_changes`, `send_back`, `fix`, `decline_change`, `operation_notes`, `restart_step`, `kept`, `follow_up`,
`new_round`, `closed`.

`task.message` carries an optional `kind` (`MessageKind`), with the classifier's `title`, `why` and `shape` for new
work. Without one the effect above decides, and a resting task's message is `new_round`. `feedback` is delivered by the
effect; `new_round` queues the next round (`round.queued`), which starts when the current one rests (Rounds, above);
`separate_task` records a split-off suggestion instead (a new round when the task already has ten open suggestions).
The server sets `kind` from the classifier before a message reaches `decide`, yours or an agent's `tasks_message`, unless
it already carries one (`--as`) (`triage/message.ts`, `docs/engine.md` → Rounds).

## Commands

Every command has an id; a repeat is answered from its receipt. `parseUserCommand` checks a user command field by field
before `decide` sees it; `decide` throws `DomainError` (nothing emitted) for anything not allowed.

### User commands

Sent by you (the web over the socket, `POST /api/commands`, the command line) or by a task agent's management tool on
your behalf (`onBehalf`, `byTask`), unless every path to it is human-only. **Human** = only through a `humanOnly`
spec; **agent** = a task agent has a tool for it.

| Command | Does | Command line | Who |
| --- | --- | --- | --- |
| `task.create` | creates a task (request, project, priority, plan first, waits on, mode, shape, account) | `tasks create` | agent |
| `task.message` | your message; what it does: Messages, above; `kind` says whether it is feedback, a new round or work for another task | `tasks message [--as]` | agent |
| `round.ship` | how a round ships: onto the open pull request or stacked | `rounds ship` | agent |
| `task.prioritize` | sets the priority | `tasks prioritize` | agent |
| `task.block` | replaces the tasks it waits on | `tasks block`, `tasks unblock` | agent |
| `task.retry` | restarts the current step with a fresh budget, optionally on an account | `tasks retry`, `tasks rerun` | agent |
| `task.cancel` | cancels it | `tasks cancel` | agent |
| `task.complete` | marks it done without merging | `tasks done` | agent |
| `task.bind_account` | binds it to an account, or any | `tasks bind` | agent |
| `gate.answer` (plan, review, merge, operation, failure, setup, sign-in, change, secret) | decides a gate | `gates answer`, `plans *`, `reviews *`, `merges *`, `operations *`, `command` | **human** |
| `gate.answer` (an agent's question) | answers a question | `questions answer` | agent |
| `suggestion.accept` | adds a suggested task, optionally waiting on this one | `followups accept` | agent |
| `suggestion.dismiss` | dismisses one | `followups dismiss` | agent |
| `suggestion.keep` | keeps a split-off in this task as its next round | `followups keep` | agent |
| `monitor.check_now` | fires a monitor's next check now | `tasks check-now` | agent |
| `usage_wait.change` | turns a usage wait's auto-resume on or off | `tasks auto-resume` | agent |
| `usage_wait.resume_now` | resumes a usage wait now | `tasks resume-now` | agent |
| `run.snooze_silence` | snoozes a quiet-run warning | `runs snooze` | agent |
| `run.dismiss_silence` | dismisses it for the run | `runs dismiss` | agent |
| `delegation.cancel` | stops a delegated run and what it delegated | `delegations stop` | agent |
| `schedule.write` | creates or changes a schedule | `schedules write` | agent |
| `schedule.enable` | pauses or resumes one | `schedules enable`, `schedules disable` | agent |
| `schedule.remove` | deletes one | `schedules delete` | agent |
| `project.write` | creates or changes a project | `projects write` | agent |
| `project.remove` | removes one | `projects remove` | agent |
| `repo.update` | changes a repository's fields | `repos update` | agent |
| `repo.remove` | forgets a repository | `repos remove` | agent |
| `focus.change` | sets or clears the focus | `focus set`, `focus clear` | agent |
| `settings.change` | changes settings (`SETTINGS_KEYS`) | `settings set` | agent |

Core refuses three commands sent on your behalf while the task waits at a human-only gate (`human_only`,
`assertNoHumanOnlyGate`): `task.retry`, `task.complete` (which on your behalf also needs no queued round and no open
pull request) and a `task.message` that would retry at a Sign in gate. A `gate.answer` on your behalf to a human-only
gate is refused the same way (`assertAgentMayAnswer`).

Not commands, human-only all the same: `gates secret` and `gates decline-secret` (`/api/secrets`), `schedules
webhook-secret`, `accounts sign-in`, `sign-in-code`, `import` and `remove`, `mcp check|add|remove|on|off|sign-in|sign-out`,
`skills on|off`, `plugins on|off`, `tasks open`.

### Agent commands

Sent only by Shinsa's MCP tools, carrying the run and attempt; refused from a run that ended, a stale attempt or a
role without the tool (`hasTool`).

| Command | Tool | Does |
| --- | --- | --- |
| `agent.propose_plan` | `propose_plan` | hands over a plan (checked by `validatePlanRules`) |
| `agent.complete_phase` | `complete_phase` | hands over a phase; Shinsa commits it (the last one needs the evidence) |
| `agent.complete_fix` | `complete_fix` | hands over a fix; Shinsa commits and pushes when shipping |
| `agent.report_review` | `report_review` | hands over the findings |
| `agent.answer` | `answer` | hands over an answer, optionally a proposal |
| `agent.deliver` | `report_findings`, `submit_report`, `report_outcome` | hands over findings, a report or an outcome, optionally a proposal |
| `agent.reshape` | `reshape_task` | recomposes the steps before planning |
| `agent.ask` | `ask` | asks you (or, from a delegated run, its parent) |
| `agent.attach_evidence` | `attach_evidence` | attaches evidence |
| `agent.note` | `note` | keeps a note on the task |
| `agent.wait_for` | `wait_for` | ends the run and arms a monitor |
| `agent.suggest_tasks` | `suggest_tasks` | suggests up to five follow-up tasks |
| `agent.request_secret` | `request_secret` | opens a secret gate |
| `agent.delegate` | `delegate_task` | starts a delegated run |
| `agent.cancel_delegation` | `task_cancel` | stops one |
| `agent.answer_delegation` | `task_answer` | answers a delegated run's question |
| `agent.acknowledge_delegation` | `task_status` | marks a finished result read |
| `agent.create_task` | `create_task` | files a courier task, optionally waiting on it |
| `agent.split_task` | `split_task` | splits the approved plan into tasks |
| `agent.set_schedule` | `set_schedule` | writes one of its task's schedules |
| `agent.delete_schedule` | `delete_schedule` | deletes one |

Reads with no command: `find_tasks`, `read_task`, `list_schedules`, and `task_status` for a run still working.

### System commands

Sent by the server, each under an id named after its cause (`docs/engine.md` → Command receipts).

| Command | Sender | Does |
| --- | --- | --- |
| `task.triage` | `task.triage` effect (`triage/`) | records title, repository, size, branch, waits on, and the Auto parts |
| `repo.register` | `repos/index.ts` | registers a repository on first use |
| `config.record` | `config.verify` effect | records the setup check's problems |
| `worktree.ready`, `worktree.gone` | worktree effects | the worktree exists, or is gone |
| `checks.record` | `checks.run` effect | records a round of checks |
| `pull_request.record` | open, merge and watch effects | records a pull request read |
| `pull_request.read_failed` | the watch effect | counts a failed read |
| `pull_request.pushed` | open and push effects | records a pushed commit |
| `effect.fail` | the engine and effects | an effect gave up: a failure gate when its kind has one |
| `run.attempt`, `run.link`, `run.meter`, `run.end` | the run supervisor | an attempt starts, links its session, is metered, ends |
| `run.interrupt`, `run.continue` | the supervisor at shutdown and boot | marks a run for restart continuation, continues it |
| `run.session_lost` | the supervisor | marks a session that cannot be resumed |
| `run.compact` | the supervisor (idle compaction) | records an idle compaction |
| `runs.dispatch` | the supervisor at boot | starts queued runs |
| `run.silence` | `agents/silence.ts` | marks or clears a quiet run |
| `message.deliver` | the supervisor, `agents/questions.ts` | redelivers a message a session never took |
| `monitor.fire` | `MonitorClock` | wakes a monitor |
| `usage_wait.resume` | `UsageResumeClock` | resumes a step after the reset |
| `account.signed_in`, `account.removed` | the accounts service | answers Sign in gates, releases bound tasks |
| `briefing.write` | `briefing/` | stores the Home guide |
| `delegation.delivered`, `delegation.undelivered` | `agents/deliveries.ts` | a delivery claim was taken, or released |
| `delegation.wake_policy` | `agents/tools/orchestration.ts` | a `wait` call that timed out switches to waking |
| `delegations.recover` | the supervisor at boot | releases claims and waits, claims again |
| `schedule.fire`, `schedule.fail` | `ScheduleClock`, the webhook | fires a slot, or records a failed one |
| `schedule.deliver` | the webhook receiver | starts the schedule's work from a delivery |

## Events

`ShinsaEvent` = a body + `seq`, `at`, and `onBehalf`, `byTask` when sent on your behalf. Only `decide` emits them;
`applyEvent` folds them. Never removed or redefined.

| Event | Recorded when |
| --- | --- |
| `repo.registered`, `repo.updated`, `repo.removed` | a repository is registered, changed, forgotten |
| `project.written`, `project.removed` | a project is written, removed |
| `area.written`, `area.removed` | older logs only: projects under their old name |
| `focus.changed` | the focus changes |
| `settings.changed` | settings change (the whole settings object) |
| `briefing.written` | the Home guide is stored (`projectId`; older logs `areaId`) |
| `task.created` | a task is created (with its handle when it has a project) |
| `task.triaged` | triage set title, repository, size, branch, handle, pipeline, decisions |
| `task.reshaped` | the pipeline changed (`by` you, agent or Shinsa, with a reason) |
| `task.staged` | the stage and its reason changed |
| `task.prioritized` | the priority changed |
| `task.blocked` | the tasks it waits on changed |
| `task.messaged` | you (or a schedule) sent a message; `kind` and `round` when it was new work |
| `round.queued` | a new round waits to start (number, title, request, why, shipping, steps) |
| `round.started` | a round became the active one (`branch`, `base`, `onto`: the pull request it ships onto); the round before it, if any, is archived as shipped |
| `round.shipping_changed` | how a round ships changed; for an active round also its `branch`, `base` and `onto` |
| `round.pull_request_merged` | an earlier round's pull request merged outside Shinsa while a later round works: that round is merged, and the active round takes a new `branch` from the default branch for its own pull request |
| `task.noted` | an agent kept a note |
| `task.recovered` | the recovery count changed |
| `task.answered` | the answerer answered |
| `task.delivered` | findings, a report or an outcome were handed over |
| `task.change_proposed`, `task.change_approved`, `task.change_declined` | a proposal was made, approved, declined |
| `task.suggested`, `suggestion.settled` | a follow-up was suggested (`splitOff` for a split-off); accepted or dismissed (`keptRound` when it was kept here as a round) |
| `task.account_bound` | the task's account changed |
| `task.split` | `split_task` made tasks |
| `config.verified` | the setup check ran |
| `budget.acknowledged` | you allowed more past a usage or cost limit |
| `worktree.created`, `worktree.removed` | the worktree was made, removed |
| `spec.proposed`, `spec.answered`, `spec.approved` | a plan version was proposed; you answered it; approved |
| `phase.updated`, `phase.completed` | a phase's status changed; a phase was handed over |
| `work.submitted` | the work report was assembled |
| `work.committed` | Shinsa committed (the tree hash) |
| `checks.recorded` | a round of checks finished |
| `review.reported`, `review.escalated` | a reviewer reported; the review escalated to you |
| `fix.started` | a fix round started (reason, signature, tree) |
| `evidence.attached` | evidence was attached |
| `gate.opened`, `gate.answered`, `gate.withdrawn`, `gate.superseded` | a gate opened, was answered, withdrawn, or replaced by your message |
| `gate.noted` | your message added to an open operation gate's notes (the same gate, no new notification) |
| `run.started`, `run.dispatched` | a run was created; it started |
| `run.attempted`, `run.linked` | an attempt began; it linked its session |
| `run.ended` | a run ended (outcome, failure) |
| `run.interrupted`, `run.continued` | marked at shutdown; continued after a restart |
| `run.session_lost`, `run.compacted` | a session is gone; an idle session was compacted |
| `run.metered` | usage and cost were charged |
| `run.silenced`, `run.silence_snoozed`, `run.silence_dismissed` | a run went quiet; the warning snoozed or dismissed |
| `run.waiting` | a step's turn ended while its delegated runs work |
| `monitor.armed`, `monitor.fired`, `monitor.ended` | a monitor was armed, fired, ran out or was cleared |
| `usage_wait.armed`, `usage_wait.ended` | a usage wait was armed; resumed, reset or cleared |
| `pull_request.opened`, `pull_request.updated` | the pull request was opened; a read changed it |
| `pull_request.push_requested`, `pull_request.pushed`, `pull_request.head_moved` | a push was asked for, made; someone else moved the head |
| `pull_request.read_failed`, `pull_request.read_failures_cleared` | a read failed; the count reset |
| `pull_request.watched` | the watch's memory changed (with what changed) |
| `delegation.asked`, `delegation.answered` | a delegated run asked its parent; was answered |
| `delegation.acknowledged` | the parent read a finished result |
| `delegation.wake_changed`, `delegation.adopted` | a wake policy changed; a restarted step adopted its children |
| `delegation.claimed`, `delegation.delivered`, `delegation.released` | a delivery cohort was claimed, delivered, released |
| `delegation.message_queued` | your message was queued for a waiting step |
| `schedule.written`, `schedule.removed`, `schedule.fired` | a schedule was written, removed, fired (with its run) |
| `on_behalf.acted` | a command sent on your behalf changed something (command, task, sentence, acting task) |

## Effects

`ShinsaEffect` (`effects/index.ts`), run by `EffectRunner` (`apps/server/src/runtime/effects.ts`) from the outbox.
`process_bound` effects are cancelled on boot; `replay_safe` ones are requeued and must be safe to run twice.

| Effect | Recovery | Lane | Reports back with |
| --- | --- | --- | --- |
| `task.triage` | replay_safe | `task:<id>` | `task.triage`, `repo.register` |
| `config.verify` | replay_safe | `task:<id>` | `config.record` |
| `worktree.create` | replay_safe | `task:<id>` | `worktree.ready` |
| `worktree.remove` | replay_safe | `task:<id>` | `worktree.gone` |
| `checks.run` | replay_safe | `task:<id>` | `checks.record` |
| `pull_request.open` | replay_safe | `task:<id>` | `pull_request.pushed`, `pull_request.record` |
| `pull_request.push` | replay_safe | `task:<id>` | `pull_request.pushed` |
| `pull_request.merge` | replay_safe | `task:<id>` | `pull_request.record` |
| `pull_request.watch` | replay_safe | `side:<id>` | `pull_request.record`, `pull_request.read_failed` |
| `briefing.request` | replay_safe | `briefing` | `briefing.write` |
| `run.execute` | process_bound | `run:<id>` | `run.attempt`, `run.link`, `run.meter`, `run.end`, agent commands |
| `run.wake` | process_bound | `run:<id>` | as `run.execute`, on the waiting step's session |
| `run.cancel` | process_bound | `cancel:<id>` | `run.end` |
| `run.steer` | process_bound | `steer:<id>` | `message.deliver` when it is too late to steer |
| `question.resolve` | process_bound | `gate:<id>` | none: releases the waiting `ask` call |
| `delegation.steer` | process_bound | `steer:<id>` | `delegation.delivered`, `delegation.undelivered` |
| `delegation.reply` | process_bound | `reply:<id>` | none: answers the child's question |

Any effect that gives up sends `effect.fail`; it opens a failure gate when its kind has a title in `FAILURE_TITLE`.

## Agent tools

Per role, from `listToolNames` (`domain/tools.ts`); this table is the one list, and other docs link here. Every
non-delegated task run also gets one management tool per surface spec that is not `humanOnly` (`tasks_list`,
`tasks_message`, `settings_set`…; `agents/manage/tools.ts`).

| Tool | planner | builder | reviewer | fixer | shipper | answerer | investigator | researcher | operator | delegated, depth 1–2 | depth 3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `propose_plan` | ✓ | | | | | | | | | | |
| `reshape_task` | ✓ | | | | | | | | | | |
| `complete_phase` | | ✓ | | | | | | | | | |
| `complete_fix` | | | | ✓ | ✓ | | | | | | |
| `report_review` | | | ✓ | | | | | | | | |
| `answer` | | | | | | ✓ | | | | | |
| `report_findings` | | | | | | | ✓ | | | | |
| `submit_report` | | | | | | | | ✓ | | | |
| `report_outcome` | | | | | | | | | ✓ | | |
| `ask` | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `attach_evidence` | | ✓ | ✓ | ✓ | | | ✓ | | ✓ | ✓ | ✓ |
| `find_tasks`, `read_task`, `note` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `wait_for` | | ✓ | | ✓ | ✓ | | ✓ | | ✓ | | |
| `suggest_tasks` (`split_off`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `delegate_task`, `task_status`, `task_cancel`, `task_answer` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `create_task` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `split_task` | | ✓ | | | | | | | | | |
| `set_schedule`, `list_schedules`, `delete_schedule` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `request_secret` | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |

Hand-over tools (the first nine rows, `isHandOverTool`) end the step. The reviewer cannot ask you anything.

Three more tools come from the server, not from `listToolNames`, and only in a run the context optimizer left
something out of (`apps/server/src/extensions/loader.ts`), any role, delegated runs too:

| Tool | When it is there | Does |
| --- | --- | --- |
| `load_mcp_server` | an MCP server was left out | loads the server into the session; its tools then appear as `mcp__<server>__<tool>` |
| `call_mcp_tool` | an MCP server was left out | calls a tool of a server Shinsa connected itself, when the session could not load it (Codex, or a failed load) |
| `load_skill` | a skill was left out | returns the skill's text |

### Hand-overs

The fields each hand-over tool takes, checked by `validate*` in `packages/core/src/report/validate.ts` (types in
`report/types.ts`). Every limit is a number in `PROTOCOL_LIMITS` or `SHAPE_LIMITS` and is published in the tool's schema.

| Tool | Fields (required in bold) | Limits |
| --- | --- | --- |
| `propose_plan` | **`goal`**, **`plan`** (phases: **`title`**, **`detail`**), **`behaviour`**, **`approach`**, **`files`** (**`path`**, **`change`**), **`out_of_scope`**, **`verification`**, **`questions`** (**`question`**, **`options`**, `recommendation`); `impact`, `evidence`, `checks`, `approval`, `operation`, `change_summary` | goal 300; 2 to 8 phases (title 60, detail 160); behaviour 8 × 200; approach 700; files 20 (change 140); out of scope and verification 6 × 200; questions 4 (question 200, 2 to 4 options of 100); impact 1,000; checks 6 × 200; operation 8 × 200; change summary 240 |
| `complete_phase` | **`summary`**, **`spots`** (**`file`**, **`start`**, **`end`**, **`attention`**: critical, high or normal, **`why`**), **`decisions`** (**`decision`**, **`reason`**, `file`, `line`) | summary 240; 6 spots (why 180); 5 decisions (decision 120, reason 240) |
| `complete_fix` | **`summary`** | 240 |
| `report_review` | **`findings`** (**`severity`**: blocking or suggestion, **`message`**, `file`, `line`, `end`) | 12 findings, message 280 |
| `answer` | **`answer`**; `propose_change` (**`request`**, **`why`**) | answer 8,000; request 2,000, why 240 |
| `report_findings` | **`findings`**; `propose_change` | 12,000 |
| `submit_report` | **`report`**; `propose_change` | 40,000 |
| `report_outcome` | **`outcome`** | 8,000 |
| `reshape_task` | **`reason`**; `shape` (answer, investigate, research) or `steps` (`PIPELINE_ORDER` names) | reason 240 |

Shinsa assembles the work report you review (`WorkReport`: headline, phases, checks, decisions) from the plan's goal,
every `complete_phase` and the checks it ran (`assembleReport`); no agent hands over a whole report. The other tools'
limits are `PROTOCOL_LIMITS` (`ask`, `wait_for`, `suggest_tasks`), `DELEGATION_LIMITS` and `SCHEDULE_LIMITS`.

## Where it lives

| What | Code |
| --- | --- |
| Task, Run, Gate, Repo, Project, Evidence, stages, roles | `packages/core/src/domain/types.ts` |
| Rounds, shipping, resting and closed | `packages/core/src/domain/rounds.ts`, `state/rounds.ts`, `decide/rounds.ts` |
| The message classifier and routing | `apps/server/src/triage/message.ts` |
| Human-only gates | `packages/core/src/domain/gates.ts` (`isHumanOnlyGate`), `decide/gates.ts` (`assertAgentMayAnswer`, `assertNoHumanOnlyGate`) |
| Steps, gates, `validatePipeline` | `packages/core/src/domain/steps.ts` |
| Verification rules | `packages/core/src/domain/verification.ts` |
| Shapes, presets, `validateComposition` | `packages/core/src/domain/shapes.ts` |
| Tools per role | `packages/core/src/domain/tools.ts` |
| Projects, keys, handles | `packages/core/src/domain/projects.ts` |
| Delegations, accounts, schedules, pull request watch, settings | `packages/core/src/domain/{delegations,accounts,schedules,pull-requests,settings}.ts` |
| On your behalf record | `packages/core/src/domain/on-behalf.ts`, `decide/on-behalf.ts`, `state/on-behalf.ts` |
| Plan document, reports, findings, `PROTOCOL_LIMITS` | `packages/core/src/report/` |
| Commands and the parser | `packages/core/src/commands/` |
| Events | `packages/core/src/events/` |
| Effects, recovery, keys, lanes | `packages/core/src/effects/index.ts` |
| Decisions | `packages/core/src/decide/` (`messages.ts` for `resolveMessageEffect`) |
| State folds | `packages/core/src/state/` |
| Chat protocol | `packages/core/src/chat/protocol.ts` |
| Event log, receipts, outbox | `apps/server/src/store/event-log.ts`, `apps/server/src/runtime/engine.ts` |
| Effect handlers | `apps/server/src/runtime/effects.ts` |
| Agent tools (MCP) | `apps/server/src/agents/tools/`; the loader tools `apps/server/src/extensions/loader.ts` |
| Management tools | `apps/server/src/agents/manage/` |
| Command surface and `humanOnly` | `apps/server/src/surface/`, reference `docs/cli.md` |
| Shell policy | `apps/server/src/agents/policy.ts` |
| Composer hint | `apps/web/src/lib/tasks/messages.ts` |

## Open protocol questions

1. **Agents can answer agents' questions.** `questions answer` is not human-only, yet `GATE_SCHEMA.question` says
   `decidedBy: 'you'`. Can one task's agent answer a question another task's agent asked you?
2. **A message is a decision too.** Agents have `tasks_message`: at a plan gate it revises the plan, at a review or
   merge gate it sends the work back, at a failure gate it retries, at a question it withdraws the question, at the
   operation gate it adds notes. None of these approve anything, but each closes a gate meant for you (only the retry
   at a Sign in gate is refused on your behalf).
3. **Two ways to retry with words.** A failure gate takes `answer` (retry with guidance), but a message retries it
   with `approve` and a response, and a Sign in gate takes no `answer` at all. One decision should mean one thing.
4. **Two places for operation notes.** Notes from messages go on `Gate.notes`; "Run with these notes" sends
   `response`. Both feed the operator's guidance. Should the gate's notes be the only place?
5. **Operation notes only grow.** Each message adds to them; nothing replaces or clears them short of finishing.
6. **`task.create` still takes `shape`**, though the kind is never yours to choose; only a raw command sends it.
   Remove it, or document it as the escape hatch?
7. **The change gate has no step and two schemas.** Inquiry steps declare `gate: none` with `types: ['change']`, yet
   the gate is hard; `your_ok` declares it hard; the stage `awaiting_change` belongs to no step (`your_ok.stages` is
   empty), so the stage-fits-pipeline invariant skips it.
8. **Soft gates do not list where they escalate.** `checks` and `ci` escalate to a failure gate and `agent_review` to
   the review gate, but `StepGate.types` names only the soft gate.
9. **The plan gate rule is written twice**: as prose in `STEP_SCHEMA.plan.gate.when` and as code in
   `needsPlanApproval`. Only the code is checked.
10. **Evidence for operations.** `operate` lists evidence among its outputs, but `validatePlanRules` refuses
    `evidence` in a plan without `build`, so an operation can never require evidence.
11. **Dead combinations.** `GateKind 'question'` with purpose `decision` maps to type `question` and nothing opens it;
    `RunRole 'triage'` is never a run; `shipper` is never started.
12. **A message at a setup gate does nothing** (`kept`): the stage is `triage`. Should it check the setup again, the
    way a message retries a failure gate?
13. **`Task.answer` and `Task.result`** hold the same kind of thing for different inquiries (naming decision 15).
14. **Who decides a delegated question.** A delegated reviewer gets `ask` (routed to its parent) though a reviewer
    cannot ask you; the parent may then ask you with its own `ask`. Is that the intended ceiling?

## Settled protocol questions

1. **Human-only decisions are locked in core too.** Beside the tool list, core refuses a human-only decision sent on
   your behalf (`human_only`, recording nothing): `isHumanOnlyGate` in `domain/gates.ts`, checked by
   `assertAgentMayAnswer` and `assertNoHumanOnlyGate` (User commands, above). Which decisions are yours alone is
   `docs/engine.md` → Who can change Shinsa. Tests: `packages/core/test/decide/gates.test.ts` → decisions only the
   human makes.
2. **`tasks diff` reads.** Its spec is marked a read, so agents see it with the read-only hint.
