# The Shinsa protocol

Every object Shinsa keeps, its schema and its name, read from the code (`packages/core/src`), for review. When this
file and the code disagree, the code wins and this file is wrong. Behaviour lives in `docs/engine.md`; this file is the
nouns, the fields and who may send what.

Sections: Glossary · Naming decisions · The task · Rounds · Lifecycle · Projects and handles · Runs, attempts and
roles · Steps and gates · Verification · Composing · Messages · Commands · Events · Effects · Agent tools · Where it lives ·
Open protocol questions · Settled protocol questions.

## Glossary

One definition per term. **Code** is the name in `packages/core`; **UI** is the word on screen when it differs.

| Term | Definition | Code | UI |
| --- | --- | --- | --- |
| task | The conversation about one goal you asked for, worked in rounds; the only object with a lifecycle. A small task is a task with one round | `Task` | task |
| round | One unit of work inside a task, with its own steps, plan, build, review and pull request; numbered within the task (`SW-14 · round 3`). One is active at a time | `Round`, `Task.rounds` | round |
| request | What you wrote when you created the task (round 1), or the message that started a later round; the first line becomes the title | `Task.request`, `Round.request` | request |
| shipping | How a round's commits reach GitHub: onto the task's open pull request (the default), or as its own pull request stacked on it | `RoundShipping` (`onto_pull_request`, `stacked`) | "Onto #12", "As a stacked pull request" |
| resting | A task whose last round finished on its own (merged, answered, ran): open, holding no run or gate, and a message starts its next round | `isTaskResting` | Merged, Done |
| closed | A task you (or an agent, once nothing is open) marked done, or cancelled; it takes no message | `isTaskClosed`, `Task.closedAt` | Done, Cancelled |
| project | A named group of repositories and folders with a key and a description; scopes tasks, triage and the focus | `Project` | project |
| repository | A git repository Shinsa registered, inside at most one project | `Repo` | repository |
| handle | A task's name for people, `<project key>-<number>` (`SW-142`), given once, never reused, never a key | `Task.handle` | the handle |
| id | A UUIDv7, the key of everything stored (events, receipts, references, transcripts) | `id` | not shown |
| focus | The one project whose work Home, the queue and the guide show, or none for all work | `Focus` | Focus |
| run | One agent working one step of a task (or a delegation of it), from start to end | `Run` | a run, "the agent" |
| attempt | One execution of a run; a resume, a retry on another account or a restart is a new attempt | `RunAttempt`, `attemptId` (`<run>:<n>`) | not shown |
| session | The provider's own conversation a run executes in; several runs and attempts can share one | `Run.sessionId` | not shown |
| role | Which agent a run is (the round's agent, a reviewer, an answerer…); picks its prompt, tools, model and where it works | `RunRole` (runs), `AgentRole` (settings), `RUN_AGENT_ROLE` (which settings a run role uses) | Agent, Reviewer… |
| purpose | What one run of the round's agent does: plan, build a phase, fix or run the operation; picks its instruction, its hand-over and whether it may edit | `RunPurpose`, `Run.purpose`, `PURPOSE_HAND_OVERS` | planning, phase 2 of 3, fixing… |
| step | One fixed building block of a task's path (`answer` … `merge`); a task's pipeline is a list of steps | `PipelineStep` | step |
| pipeline | The ordered steps one task takes | `Task.pipeline` | "the steps a task takes" |
| phase | One part of an approved plan's build, built by its own run of the round's agent, on the session that planned it, and committed on its own | `PlanDocument.phases[i]` (`PlanPhase`), `PhaseProgress` | phase |
| stage | Where a task is right now, one value of 20; each working stage belongs to a step | `TaskStage` | the status line |
| shape | A named pipeline preset (answer, investigate, research, change, fix, operation), or the shape a pipeline reads as | `TaskShape` | kind of task |
| plan | What the round's agent hands over while it plans: goal, phases, approach, files, verification plan, and for an operation its steps and impact | `Plan`, `PlanDocument` | plan |
| operation | One-off work run in the repository (a backfill, a migration, a cleanup) by the round's agent from an approved plan, opening no pull request | step `operate`, purpose `operate` | operation |
| gate | A durable decision record that holds a task until it is decided | `Gate` | the decision ("Review", "Merge"…) |
| hard gate | A gate only you decide (plan, review, merge, question, secret, proposal, operation, failure, setup, sign-in) | `GateType`, `HardGateDefinition` | Needs you |
| soft gate | An automatic check a step must pass (checks, agent review, CI); it passes, fails back to the round's agent, or escalates to the hard gate it names | `SoftGateType`, `SoftGateDefinition` | not a gate on screen |
| decision | Your answer to a hard gate: approve, revise, reject, reply (with words) or waive (start without checks) | `GateDecision` | Approve, Ask for changes, Reject… |
| evidence | A file or link an agent attached to prove something (screenshot, recording, test, check, note, preview), with the width, theme and stage (before or after) it was captured at, or the output of Shinsa's own checks (a `check` of no run) | `Evidence`, `EvidenceKind`, `EvidenceTheme`, `EvidenceStage` | Evidence |
| evidence item | What you review as one piece of evidence: a comparison (one view before and after, or in several states, its parts sharing an `itemId`) or a single piece of its own kind | `EvidenceItem`, `EvidenceItemKind`, `listEvidenceItems` | a comparison, a recording, a screenshot, a test run… |
| check | A command Shinsa runs in the worktree (the repository's and the plan's own), recorded pass or fail | `ReportCheck`, step `checks` | Checks |
| CI run | One CI check GitHub reports on the pull request | `CiRun`, `CiState` (stored as `PullRequest.checkRuns`, `PullRequest.checks`) | CI |
| check-in | A monitor's next look at what it waits for | `Monitor.nextCheckAt`, `monitor.check_in_now` | "Check in now", "Check-in 2 of 10" |
| setup verification | Shinsa verifying the repository, the default branch and the checks before a task's first agent | `config.verify`, `VERIFYING_SETUP`, gate type `configuration` | "Setup incomplete", "Verify again" |
| review | Reading a change: the agent review (the reviewer, on its own session, soft gate) or your review (hard gate) | steps `agent_review`, `your_review` | Agent review, Review |
| finding | One problem the reviewer reports, blocking or a suggestion, at a file and line | `ReviewFinding` | finding |
| diagnosis | What an investigation hands over: what it found and why | `report_diagnosis`, `TaskResult` step `investigate` | Diagnosis |
| judgement call | A choice the agent made in a phase, with its reason and the alternatives it rejected | `JudgementCall` | Judgement call, "Judgement calls" |
| disagreement | A judgement call the reviewer would have made differently, with why | `ReviewDisagreement`, `report_review`'s `disagreements`, `Task.reviewDisagreements` | Disputed, "The agent review disagrees" |
| spot | A line range the work report points you at, ranked critical, high or normal; a key piece of code also has a title and an explanation | `CodeSpot` | spot, "Key code" |
| walkthrough | The Agent's technical account of the whole change on its last phase: approach, flow, risks, testing (what the tests cover and a guide to try it by hand) and the steps around the merge; a fix revises the parts it changes | `ReportWalkthrough`, `complete_phase`'s `walkthrough`; `ReportWalkthroughRevision`, `complete_fix`'s | Approach, How it works, Risks and edge cases, How to test, Pre-merge, Post-merge |
| merge step | Something you must do around the merge that needs a person or production access (a variable or secret to set, a migration or deploy to run, a config or flag to change), before it or after it; you tick each one, and the merge waits for every one before it | `MergeStep` (`when`, `kind`, `title`, `detail`, `command`), `walkthrough.steps`, `MergeStepView` (a `ChecklistItem` with `round` and `due`), `Task.mergeStepsDone`, `Task.carriedMergeSteps`, `merge_step.tick`, the steps `pre_merge` and `post_merge`, the gate `post_merge` | Pre-merge, Post-merge, "Post-merge · 2 steps left" |
| point | Anything the Review tab marks for you to read: a spot, a judgement call, a risk or a finding | `ReviewItem` (web, `lib/review/report.ts`) | point, "Every point" |
| ref | The commit the Code tab reads at: the head of the branch, the base, a commit between them, or the working copy (`working`) while the worktree exists | `TaskRefs`, `WORKING_REF` | "Head of the branch", "Working copy", "Base" |
| line comment | A comment you leave on a line or range of the new or the removed side, sent with Request changes | `ReviewComment` (`gate.answer`'s `comments`), `LineComment` in the web's draft (`lib/review/draft.ts`, adds its id and commit) | Your comments |
| your edits | A file you change in the Code tab: saved to the task's working copy as you type, committed with the round's next commit, and named to the agent's next turn | `FileWrite`, `Task.editedPaths`, `Task.untoldEdits`, `task.record_edit`, `task.edited` | "Edited ‹path›", "Saving…" |
| proposal | An inquiry's request to turn the task into a change or an operation, decided at your OK | `ChangeProposal`, gate type `proposal` | "Your OK", "What it would change" |
| result | What an answer, an investigation, research or an operation hands over (the answer, the diagnosis, the report, the outcome) | `TaskResult` | Answer, Diagnosis, Report, Outcome |
| delegation | Work a running step hands to another agent: a run of the same task with a parent run, never a new task | `RunDelegation` on `Run` | Delegations |
| courier | A new task an agent files for work that belongs elsewhere (`create_task`), optionally making its own task wait on it | `TaskCreator.kind: 'courier'` | a task |
| suggested task | A task an agent proposes (or Shinsa's classifier, for a split-off); it starts nothing until you accept it | `TaskSuggestion` | Suggested tasks |
| follow-up | A message to a finished answer, investigation or report, answered on the same session | message effect `follow_up`, `acceptsFollowUp` | follow-up |
| waits on | The tasks a task waits for before it starts (or before its merge gate opens) | `Task.waitsOn`, stage `waiting_on_tasks` | "Waits on", "Wait for another task" |
| schedule | A trigger (once, interval, daily, webhook) that starts a task or messages one | `Schedule` | Schedules |
| monitor | An agent's armed wait (`wait_for`): its run ends and a fresh one checks in again later | `Monitor` | "Waiting to check in again" |
| usage wait | A step paused until a usage limit resets, then resumed on the same session | `UsageWait` | "Waiting for the usage limit" |
| account | A Claude login a run is leased on | `RunAccount` | account |
| provider sign-in | A provider's own login (Codex), named on a Sign in gate with no account | `ProviderSignIn`, `Gate.provider` | "Sign in to Codex as ‹email›" |
| command | A request to change state; `decide` turns it into events and effects or refuses it | `ShinsaCommand` (`UserCommand`, `AgentCommand`, `SystemCommand`) | not shown |
| event | A past-tense fact; the only way state changes; replayed forever | `ShinsaEvent` | Activity (some of them) |
| effect | Work with I/O that a decision asks for, run from the outbox, reporting back with commands | `ShinsaEffect` | not shown |
| receipt | The stored answer to a command id, so a repeat is answered and never applied twice | `CommandReceipt` (engine) | not shown |
| on your behalf | A user command an agent's management tool sent for you from its task, recorded with the acting task | `onBehalf`, `byTask`, `OnBehalfAction` | "‹handle› agent (on your behalf)" |
| message kind | What the classifier read a message to be: feedback on the current round (a follow-up on a finished one), a message that needs nothing (thanks, "ok"), new work for the task (a new round), or work for another task (a split-off) | `MessageKind` (`feedback`, `acknowledge`, `new_round`, `separate_task`) | not shown |
| split-off | A suggested task saying something you asked for in this chat belongs in a task of its own; you make it a task or keep it here as the next round | `TaskSuggestion.splitOff` | "Make it a task", "Keep it here" |

### Two names for one thing

| Thing | Names in use |
| --- | --- |
| The kind of task | `TaskShape`, `shape`, `reshape_task`, `task.reshaped`; UI "kind of task"; `mode: 'ask'` for an answer task asked for as one (`tasks create --ask`, a schedule's `just_answer`) |
| Your request | `request` everywhere new; the refusal code for an empty one is still `intent_required` (`decide/tasks.ts`) |
| Waiting on another task | `waitsOn`, `task.wait_on`, `task.waits_on_changed`, stage `waiting_on_tasks`, triage's `waits_on`; the rules in `decide/dependencies.ts` (`resolveDependencies`, `listPendingDependencies`); UI "Waits on" |
| A round that waits to start | `RoundStatus 'waiting'`; event `round.queued`, `Round.queuedAt`, `ROUND_LIMITS.queued` |
| Your OK | step `your_ok`; gate type `proposal`; stage `awaiting_proposal`; `ChangeProposal`, `task.change_proposed|approved|declined`, `propose_change`; UI "Your OK", "Change to approve" (also for an operation), "Make it a change" |
| Ask for changes | decision `revise`; UI "Ask for changes", "Request changes"; CLI `plans revise`, `reviews revise`; message effects `revise_plan`, `request_changes`, `send_back` |
| Answering a question | decision `reply`, command `gate.answer` (which takes every decision), CLI `questions answer`; a parent answering its delegation: `delegation_answer`, `agent.answer_delegation` |
| CI on the pull request | `CiRun`, `CiState`; stored on `PullRequest` as `checkRuns` and `checks` |
| The classifier | agent role `classifier`, command and effect `task.triage`, stage `triage`; UI "Quick jobs" |

### One name for two things

| Name | Meanings |
| --- | --- |
| round | a task's round (`Round`); a fix round (`fixRounds`, "Fix round 2"); a review round (`MAX_REVIEW_ROUNDS`) |
| step | a pipeline step (`PipelineStep`); an operation's numbered steps (`PlanDocument.operation`); a step around the merge (`MergeStep`, `walkthrough.steps`), which you do, not an agent |
| check | a repository check (`checks` step, `ReportCheck`); CI on the pull request as stored (`PullRequest.checks`, `checkRuns`); the evidence kind `check` |
| wait | a monitor (`wait_for`); a usage wait; a run waiting on its delegations (`RunStatus 'waiting'`, `RunWait`); a task waiting on other tasks (`waiting_on_tasks`); a round waiting to start (`RoundStatus 'waiting'`) |
| queued | the status of a run created but not yet dispatched; GitHub's merge queue; a round waiting to start, in the event `round.queued` |
| answer | the step, the tool and the result step `answer`; the command `gate.answer`, which takes every decision (the words-taking one is `reply`); CLI `questions answer`; the delegation tool `delegation_answer` |
| decision | `GateDecision` (any answer to a hard gate); `isDecisionGate` (only plan, review and merge); `Task.triageDecisions` (triage's choices); "decisions" in Needs you |
| change | the change shape; the proposal (`ChangeProposal`, `task.change_*`, `propose_change`, "Change to approve", even when it proposes an operation); "Changes to review" |
| fix | the fix shape (investigate, then a change); an agent run with purpose `fix`; a fix round; the review verdict `fix` |
| review | the agent review; your review; the gate type `review`; the Code tab's review view |
| spec | a command-surface spec (`apps/engine/src/surface`, `humanOnly`) |

## Naming decisions

All nineteen are decided and in the code. Shinsa has never shipped, so nothing reads the old names: every event,
command, stored shape and route uses the current one. Old shapes already in the user's log are rewritten once on start
(`apps/engine/src/store/legacy.ts`, `docs/engine.md` → State in memory), so code never reads them.

1. **Plan, not spec**: `Plan`, `PlanDocument`, `PlanRevision`, `PlanFile`, `PlanQuestion`, `Task.plan`, `planFirst`,
   `planHistory`, `planAnswers`, stage `awaiting_plan`, events `plan.*`, activity kind `plan`, `shinsa do --plan-first`.
2. **Shape in code, "kind of task" on screen**: no "shape" in any UI string, no `kind` in code names for a task's
   shape. Nothing stored changed.
3. **Request, not intent**: `Task.request`, `task.create.request`, `TaskSuggestion.request`, `create_task` and
   `suggest_tasks` `request`, `split_task` `tasks[].request`.
4. **One gate type**: `Gate.type: GateType`; `kind`, `purpose` and `resolveGateType` are gone.
5. **The proposal gate**: gate type `proposal`, stage `awaiting_proposal`, owned by the step `your_ok`; the UI keeps
   "Your OK".
6. **Delegation tools say delegation**: `delegation_status`, `delegation_cancel`, `delegation_answer` with
   `delegation_id`, `delegate_task` with `brief`; never "delegated task" in any string. No event carries a tool name.
7. **One way for an agent to file a task**: `create_task`; task agents no longer get the management tool
   `tasks_create` (`shinsa tasks create` stays for people and the command line).
8. **Diagnosis**: `report_diagnosis` with `diagnosis`, `SHAPE_LIMITS.diagnosis`; "finding" is the reviewer's only.
   Stored results keep `task.delivered` step `investigate`.
9. **Phases**: `PlanPhase`, `PlanDocument.phases`, `ReportSection`, `WorkReport.sections`.
10. **Checks are the repository's**: `CiRun`, `CiState` (the stored `PullRequest.checks` and `checkRuns` keep their
    names); a monitor's look is a check-in (`monitor.check_in_now`, `tasks check-in-now`); the setup check is setup
    verification (`VERIFYING_SETUP`, "Verify again").
11. **Waits on**: `waitsOn`, `task.wait_on`, `task.waits_on_changed`, triage's `waits_on`, `releaseWaiting`, stage
    `waiting_on_tasks`, `RoundStatus 'waiting'`, `tasks wait-on` and `tasks stop-waiting`.
12. **One role list**: `RunRole` has no `triage` and no `shipper`; `RUN_AGENT_ROLE` is the one table. A round has one
    agent (`agent`, "Agent"), whose runs differ by `purpose`; there is no `fixer` or `operator` role, and `planner`
    and `builder` name delegated agents only (`docs/engine.md` → Agents).
13. **Judgement calls**: `JudgementCall { title, call, reason, file, line, end?, alternatives? }`, `judgementCalls`,
    `complete_phase` `judgement_calls`; a decision is only your answer at a gate.
14. **Reply**: `GateDecision` is `approve | revise | reject | reply | waive`; the command stays `gate.answer`.
15. **One result field**: `Task.answer`, `agent.answer` and `validateAnswer` are gone; the `answer` tool sends
    `agent.deliver` with step `answer` into `Task.result`.
16. **Commands are imperative**: `pull_request.record_push`, `run.record_lost_session`, `delegation.record_delivery`,
    `delegation.release`. The events keep their names (`pull_request.pushed`, `run.session_lost`,
    `delegation.delivered`, `delegation.released`).
17. **Suggested tasks**: `TaskSuggestion` is a suggested task on every screen; CLI group `suggestions`. A follow-up is
    only a message to a finished answer, investigation or report.
18. **The on-your-behalf event** stays `on_behalf.acted` (record `OnBehalfAction`, `state.onBehalfActions`).
19. **Sign in names a provider**: `Gate.provider` on every Sign in gate (`claude` for a Claude account) and
    `Gate.account` (null for a provider with its own login); a Codex sign-out is `RunFailure.login`, and
    `provider.record_sign_in` answers that provider's open Sign in gates.

## The task

`Task` in `domain/types.ts`. An optional field (`?`) is one a fold sets only once it has something to hold; a missing
one reads as its empty value. The fields under Triage and shape, Plan and build, Checks, review and fixes, Pull request and Results hold the
**current round's** work: a new round archives them into its `Round` and starts them empty (Rounds, below).

**Identity and request**

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | UUIDv7, the key |
| `handle?` | string \| null | `SW-142`, set on `task.created` (with a project) or `task.triaged` |
| `projectId?` | string \| null | the project, else none |
| `request` | string | your request, as written |
| `title` | string | from triage (the request's first line until then) |
| `origin` | string \| null | the folder `shinsa do` or `shinsa import` ran in, a hint for triage |
| `mode?` | `build` \| `ask` | `ask` reads as the answer shape: `tasks create --ask`, a schedule's `just_answer` target |
| `createdAt`, `updatedAt`, `stageChangedAt` | number | times (ms) |

**Triage and shape**

| Field | Type | Meaning |
| --- | --- | --- |
| `repoId` | string \| null | the repository, from triage |
| `size` | `small` \| `large` \| null | from triage; a large plan can wait for approval |
| `branch` | string \| null | the task's branch, once its worktree exists |
| `proposedBranch?` | string \| null | triage's branch for a task with no worktree step yet |
| `pipeline?` | `PipelineStep[]` | the steps; absent means change (or answer for `mode: 'ask'`) |
| `auto` | `{ shape, start, priority }` booleans | which parts you left to Shinsa; `shape` is true unless `mode` was given |
| `triageDecisions?` | `{ shape, start, priority }` each `{ value, why }` \| null | triage's choice and why, per Auto part |
| `shapeChanges?` | `ShapeChange[]` (last 20) | each pipeline change: from, to, by (`you`, `agent`, `shinsa`), reason |
| `proposal?` | `ChangeProposal` \| null | an inquiry's proposal: request, why, status (`open`, `accepted`, `declined`) |
| `planFirst` | boolean | plan first: the plan always waits at a gate |

**Lifecycle and scheduling**

| Field | Type | Meaning |
| --- | --- | --- |
| `stage` | `TaskStage` | where it is (Lifecycle, below) |
| `stageReason` | string | a few lower-case words: "waiting for CI" |
| `priority` | `urgent` \| `high` \| `normal` \| `low` | how high its decisions sit in Needs you; never what runs |
| `waitsOn` | string[] | task ids it waits on |
| `note` | string \| null | the latest `note` an agent kept |
| `activity` | `Activity[]` | what happened, newest last; a gate's entry names its `gateType`, and a decision sent with line comments keeps them (`comments`); a message of yours that needed nothing is `noted`, and one dropped from the inbox keeps its `undelivered` text and reason |

**Plan and build**

| Field | Type | Meaning |
| --- | --- | --- |
| `plan` | `Plan` \| null | the current plan: version, body, document, change summary, changes, feedback, `approvedAt` |
| `planHistory?` | `PlanRevision[]` (last 10) | earlier versions |
| `planAnswers` | string \| null | your words when you approved the plan, for the agent as it builds |
| `phases` | `PhaseProgress[]` | per plan phase: `pending`, `active`, `done`, `skipped` |
| `phaseReports` | `PhaseReport[]` | per finished phase: summary, code spots, judgement calls (`judgementCalls`), and the last phase's `walkthrough?` |
| `summary` | string \| null | the work's summary |
| `report` | `WorkReport` \| null | the review built from every phase: headline, sections, checks, judgement calls, `walkthrough?` |
| `mergeStepsDone?` | string[] | the steps around the merge you ticked, by key (`resolveMergeStepKey`: `when:` and a hash of the step's kind, title, detail and command, so any change to a step clears its tick); the steps themselves are the latest walkthrough's `steps` (`listMergeSteps`); a new round starts it empty |
| `carriedMergeSteps?` | `CarriedMergeStep[]` (`MergeStep` with `round`, `done`) | the open steps a new round carried over from the round before it: every step after the merge, and the steps before the merge of a round still shipping onto the next one's pull request; ticks of a carried step land here; done ones are dropped at the next round |
| `worktreePath` | string \| null | the task's worktree; for a GitButler or main-checkout task, the repository itself |
| `workspace?` | `WorkspaceMode` | where the task works, taken from its repository when it set up (`worktree.requested`) and kept |
| `returnBranch?` | string | main checkout: the branch the checkout was on when the task took it, where it goes back when the task settles |
| `stackedOn?` | `TaskStack` (`taskId`, `branch`) | GitButler: the other task whose branch this task's branch is stacked on (`task.stack`); its pull request targets that branch while that task's pull request is open (`resolvePullRequestBase`); while that task is open the dependency on it cannot be removed (`dependency_stacked`), and cleared by `task.unstacked` when it settles without a merge |
| `editedPaths?` | string[] | files you changed in the Code tab that no commit has taken yet (`task.edited`; cleared by `work.committed` and `task.edits_committed`) |
| `approvedEdits?` | `review` \| `merge` \| null | you approved that gate while `editedPaths` had files: the checks run again before the push (`review`), or CI before the merge (`merge`); `task.edits_approved`, dropped by a real fix turn |
| `heldConflict?` | string \| null | a branch GitButler left conflicted while the task could not take a fix (planning, reviewing, checking, merging); told to the Agent at its next build, fix or operation turn (the note at the end of its prompt), else the fix starts where its next review or merge gate would open (`task.conflict_held`) |
| `untoldEdits?` | string[] | those of them no agent has been told about; the next run's prompt names them (`task.edits_told`) |
| `overlaps?` | `TaskOverlap[]` (`taskId`, `paths`, `untold`) | per other open task of the repository, the files both change (`task.overlapped`), and those the Agent has not been told yet; its next run's prompt names them (`task.overlaps_told`) |
| `treeHash?` | string \| null | the tree of the last commit Shinsa made |

**Checks, review and fixes**

| Field | Type | Meaning |
| --- | --- | --- |
| `checkResults` | `ReportCheck[]` \| null | the last round of checks |
| `coverage?` | `Coverage` \| null | the tests' coverage of the task's changed lines, measured after the last passing checks (`checks.recorded`); cleared by checks without it and by a new round |
| `reviewSummary` | string \| null | the last agent review's summary: what the reviewer checked and its view of the change |
| `findings` | `ReviewFinding[]` | the last agent review's findings, each with an optional `title` and `fix` |
| `reviewDisagreements?` | `ReviewDisagreement[]` | the judgement calls the last agent review would have made differently: the call's text and why |
| `dismissedFindings?` | `ReviewFinding[]` (last 30) | findings you dismissed, never reported again |
| `fixRounds` | number | automatic fix rounds used |
| `fixFor` | `checks` \| `review` \| `you` \| `pull_request` \| `conflict` \| null | what the current fix is for (`conflict`: commits GitButler left conflicted on the task's branch) |
| `fixSignature`, `stalledFixes`, `fixFingerprints?` | | repeat detection: the same failures after the same tree |
| `recoveries`, `recoveryFingerprint?` | number, string | the recovery budget and the durable state it is keyed to |

**Pull request**

| Field | Type | Meaning |
| --- | --- | --- |
| `pullRequest` | `PullRequest` \| null | number, url, state, CI (`checks: CiState`, `checkRuns: CiRun[]`), comments, mergeable, head, merge queue, merge commit |
| `pullRequestWatch?` | `PullRequestWatch` \| null | the watch's memory: per-check states, comment watermark, conflict, stop reason |
| `pullRequestReadFailures?` | number | failed reads in a row (stops at 8) |
| `pushedSha?`, `pushedFrom?`, `pushPending?` | | the push Shinsa made and whether GitHub has shown it |

**Results**

| Field | Type | Meaning |
| --- | --- | --- |
| `result?` | `TaskResult` \| null | step (`answer`, `research`, `investigate`, `operate`), body (the answer, the report, the diagnosis, the outcome), run, time |

**Waits, cost and accounts**

| Field | Type | Meaning |
| --- | --- | --- |
| `monitor?` | `Monitor` \| null | an agent's armed wait |
| `usageWait?` | `UsageWait` \| null | a step waiting for a usage reset |
| `account?` | `RunAccount` \| null | the account the task is bound to |
| `budgetAcknowledgedUsd?`, `usageAcknowledgedPercent?` | number | what you allowed past the cost and usage limits |
| `configProblems?` | `ConfigProblem[]` | the problems setup verification found |

**Agents and other tasks**

| Field | Type | Meaning |
| --- | --- | --- |
| `suggestions?` | `TaskSuggestion[]` | tasks agents suggested |
| `parentTaskId?` | string \| null | the task whose agent filed this one |
| `createdBy?` | `TaskCreator` \| null | `courier` (`create_task`) or `split` (`split_task`), with the run and request key |
| `splits?` | `TaskSplit[]` | tasks `split_task` made, once per plan version (`planVersion`) |
| `scheduleId?` | string \| null | the schedule that started it |

**Rounds**

| Field | Type | Meaning |
| --- | --- | --- |
| `rounds?` | `Round[]` | every round, in order; round 1 is made on `task.created` |
| `closedAt?` | number \| null | when you (or an agent for you) marked it done or it was cancelled; a closed task takes no message |
| `inbox?` | `InboxMessage[]` (`id`, `text`, `at`) | messages you sent that Shinsa accepted and has not routed yet (Messages, below) |

## Rounds

`Round` in `domain/rounds.ts`, the folds in `state/rounds.ts`, the decisions in `decide/rounds.ts`.

```ts
export type RoundShipping = 'onto_pull_request' | 'stacked';

export type RoundStatus = 'waiting' | 'active' | 'shipped' | 'merged' | 'finished' | 'cancelled';

export type MessageKind = 'feedback' | 'acknowledge' | 'new_round' | 'separate_task';

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
| `status` | `waiting` (waits for the current round to rest), `active` (the one being worked), `shipped` (its commits sit in an open pull request while a later round works), `merged`, `finished` (an inquiry or operation ended, or the task was marked done), `cancelled` |
| `pipeline` | its steps; the task's `pipeline` while it is active, archived when it ends |
| `branch`, `base` | the branch it pushes to; for a stacked round, the branch it stacks on |
| `pullRequest` | the pull request its commits went to |
| `outcome` | what it kept when it ended: plan goal, phase titles, the work's headline, the result |

`Run.round`, `Gate.round`, `Evidence.round` and `Activity.round` name the round a step, a gate, a piece of evidence or an
activity entry belongs to; they are set only from round 2 on, so a missing one is round 1.

## Lifecycle

Settled stages are `merged`, `done`, `cancelled` (`isTaskSettled`). A gate stage holds a hard gate; a working stage
holds an active run; Shinsa's own stages hold an effect.

| Stage | Step | Who moves it | Leaves for |
| --- | --- | --- | --- |
| `triage` | none | Shinsa: classify, setup verification, worktree | `waiting_on_tasks`, the first step, or a setup gate (stays `triage`) |
| `waiting_on_tasks` | none | Shinsa, when every task it waits on merged or is done | `triage` (worktree), then the first step |
| `answering` | answer | answerer | `done`, `awaiting_proposal` |
| `researching` | research | researcher | `done`, `awaiting_proposal` |
| `investigating` | investigate | investigator | `done`, `awaiting_proposal`, `triage` (the worktree reset, fix shape) then `planning` |
| `awaiting_proposal` | your OK | you | `triage` (setup verified again) then `planning`; `done` (reject); the inquiry again (message) |
| `planning` | plan | the agent, read-only (`purpose: plan`) | `awaiting_plan`, `building`, `operating` |
| `awaiting_plan` | plan | you | `building`, `operating`, `planning` (revise), `cancelled` |
| `operating` | operate | the agent (`purpose: operate`) | `done`, `building` (operation before the build) |
| `building` | build | the agent, one run per phase on one session (`purpose: build`) | `checking` |
| `checking` | checks | Shinsa | `reviewing`, `fixing`, a failure gate |
| `reviewing` | agent review | reviewer | `awaiting_review`, `fixing` |
| `fixing` | build | the agent (`purpose: fix`) | `checking`, `shipping` (a pull request fix) |
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
through `triage` (setup verification and the worktree) to its first step. `task.complete` on a resting task, or
anywhere open, **closes** it (`done`, `closedAt`); `task.cancel` closes it as `cancelled`. Waiting rounds of a closed
task are cancelled.

| From | A new round starts | Its branch | Its pull request |
| --- | --- | --- | --- |
| the merge gate, onto the open pull request | at once | the same branch and worktree | the same one; the merge gate comes back when the round reaches it |
| the merge gate, stacked | at once | a new branch on top of the open one (`<branch>-round-<n>`) | its own, with the open one's branch as its base; the merge merges the stack |
| rest after a merge | at once | a new branch from the freshly fetched default branch | a new one |
| rest after an inquiry or an operation | at once | the task's branch, or the one triage proposed | a new one, if the round ships code |
| any other stage | waits (`waiting`) | | |

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
| `checkCommands` | string[] | configured checks; empty means read from `package.json`; only you change it |
| `checksWaived?` | boolean | "Start without checks"; only you change it |
| `workspace?` | `WorkspaceMode` | where agents work: `worktrees` (the default), `gitbutler` or `main_checkout`; only you change it (`docs/engine.md` → Where agents work) |
| `coverage?` | `CoverageSetting` | how test coverage is measured after the checks: `{ mode: 'auto' }` (the default, absent), `{ mode: 'off' }` or `{ mode: 'custom', command, report, format }` (`report` a path inside the repository, `format` `lcov` \| `cobertura` \| `go` or null to read it from the report's name, `resolveCoverageFormat`); only you change it (`docs/engine.md` → Test coverage of the change) |

`Coverage` (`packages/core/src/test-coverage/types.ts`) is either `{ status: 'measured', command, covered, executable,
files }`, where `files` lists each changed file with executable changed lines (`path`, `covered`, `executable`,
`uncovered`: the missed lines merged into `[start, end]` new-file ranges), most missed first, at most 100 files of 40
ranges each (`COVERAGE_LIMITS`; the totals count every file), or `{ status: 'unavailable', command, reason }` when the
command failed to leave a readable report. The web and the agents show only a measured result with at least one
executable changed line (`selectMeasuredCoverage`).

- **Handle**: `<key>-<n>`; `T-<n>` for a task with no project (`NO_PROJECT_KEY`). Counters per key live in the log
  (`state.taskNumbers`); a key change starts the new key's counter and never reuses a handle. Parsed by
  `parseTaskHandle` (any case). Core finds a task by id or handle (`selectTaskByReference`); the server's reads also
  take the start of an id or the exact title.
- **Focus**: `{ projectId, until }`; `until` ends it at a time.

## Runs, attempts and roles

| `Run` field | Type | Meaning |
| --- | --- | --- |
| `id`, `taskId`, `role` | | |
| `status?` | `queued` \| `running` \| `waiting` | `waiting`: its turn ended while its delegations work |
| `purpose?` | `plan` \| `build` \| `fix` \| `operate` | set on every run of the round's agent (`agent`) and no other: what this run does, which hand-over it may call (`PURPOSE_HAND_OVERS`) and whether it may edit (`plan` is read-only, `isReadOnlyRun`) |
| `phaseIndex?` | number \| null | the plan phase a build run builds |
| `prompt?`, `rolePrompt?`, `resume?` | | the brief; the brief before Shinsa appended the project and any adoption note, or before it put the round brief in front of an agent run that has no session to resume (its short instruction), which a recovery or a usage resume starts from; whether it resumes an earlier session. `resolveRunBrief(state, run)` gives the full brief of a resumed agent run for a session that cannot hold the round. Neither prompt goes to the page (The socket) |
| `provider`, `model` | string, string \| null | where it started |
| `sessionId`, `sessionProvider?`, `sessionLost?` | | the provider session, who owns it, whether it is gone |
| `startedAt`, `endedAt`, `outcome`, `summary` | | `completed`, `failed`, `cancelled` |
| `attemptId?`, `attempts?` | | the current attempt and every attempt |
| `failure?` | `RunFailure` | class (13), message, code, retryable, `resetAt`, `account` (a Claude account), `login` (a provider's own sign-in: `{ provider, email }`) |
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
counts), `startedAt`, `account`, `cwd` (the directory the attempt ran in: a resumed turn in another directory than
the session's last one is told where it works now, `resolveMovedNote`).

Which agent role's settings (provider, model, speed) each run role uses is one table, `RUN_AGENT_ROLE`
(`packages/core/src/agent-models/index.ts`):

| Run role | Settings role (`RUN_AGENT_ROLE`) | Read-only | Works in | Hands over with |
| --- | --- | --- | --- | --- |
| `agent` | agent | while it plans (`purpose: plan`) | worktree | by purpose: `propose_plan` or `reshape_task` (plan), `complete_phase` (build), `complete_fix` (fix), `report_outcome` (operate) |
| `reviewer` | reviewer | yes | worktree | `report_review` |
| `answerer` | answerer | yes | the repository itself | `answer` |
| `investigator` | answerer | no (scratch) | worktree | `report_diagnosis` |
| `researcher` | answerer | yes | worktree when there is one, else the repository | `submit_report` |
| `planner` (delegated) | agent | yes | its parent's checkout, or its own | its final reply |
| `builder` (delegated) | agent | no | its parent's checkout, or its own | its final reply |

Every run of a task's agent, answerer, investigator or researcher resumes the task's one session
(`Decider.taskSession`), so one session plans, builds, fixes, operates and answers across every round; the reviewer
resumes its own; `AgentRole` has no planner, builder or fixer, since one session runs on one provider and
one model. The classifier (triage) and the writer (the Home guide) are agent roles with quick calls and no tools,
never runs. A delegated run takes `planner`, `builder` or `reviewer` (`DelegateRole`) and no hand-over tool.

## Steps and gates

### `STEP_SCHEMA` (`domain/steps.ts`)

`STEP_SCHEMA: Record<PipelineStep, StepDefinition>`. Every step declares:

| `StepDefinition` field | Meaning |
| --- | --- |
| `step`, `title` | the name and its title on screen |
| `class` | `inquiry`, `consent`, `planning`, `code`, `operation`, `verification`, `review`, `shipping` or `handover` (your steps around the merge); the verification rules key on it |
| `actor` | `{ by: 'agent', role }`, `{ by: 'shinsa' }` or `{ by: 'you' }` |
| `inputs` | what it reads (the request, the inquiry's result, the approved plan, the diff, the merged code) |
| `outputs` | what it hands over: `{ name, tool, evidence }`, `tool` null when Shinsa records it |
| `exit` | when the step is done, one sentence; `reshape_task` shows it to the agent while it plans |
| `gate` | `{ strength: hard \| soft \| none, types, when }`: the gate types it opens (`StepGateType`), and when a conditional one opens |
| `placement` | `canonical` (the order of `PIPELINE_ORDER`) or `after_plan_or_last` (`operate`) |
| `needs` | `{ steps, match: any \| all, where: before \| anywhere, rule }`; `validatePipeline` reports `rule` word for word |
| `worktree` | whether it works in the task's worktree, so setup verification and `worktree.create` run first |
| `stages` | the task stages that belong to it; the invariants check a task's stage belongs to a step it has |
| `composable` | whether the Agent may put it in a composition (`COMPOSABLE_STEPS`, the `reshape_task` enum); false only for `pre_merge` and `post_merge`, which Shinsa adds from the work report (`resolveHandOverPipeline`) |

`PIPELINE_ORDER`: answer, research, investigate, your_ok, plan, operate, build, checks, agent_review, your_review,
pull_request, pre_merge, merge, post_merge. `operate` is placed right after `plan` or after `merge`, before only
`post_merge`.

| Step | Class | Actor | Outputs (tool) | Gate | Needs | Worktree | Stages |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `answer` | inquiry | answerer | the answer (`answer`) | none | | no | answering |
| `research` | inquiry | researcher | the report (`submit_report`) | none | | no | researching |
| `investigate` | inquiry | investigator | the diagnosis (`report_diagnosis`), evidence | none | | yes | investigating |
| `your_ok` | consent | you | your decision | hard: `proposal`, when the inquiry hands over and proposes what comes next, or the agent composed this step | an inquiry; a plan | no | awaiting_proposal |
| `plan` | planning | agent | the plan (`propose_plan`) | hard: `plan`, by `PLAN_GATE_RULE` (below) | build or operate | yes | planning, awaiting_plan |
| `operate` | operation | agent | the outcome (`report_outcome`), evidence | hard: `plan`, `operation` | plan | yes | operating, awaiting_operation |
| `build` | code | agent | phase reports (`complete_phase`), evidence | none | plan; your review, pull request and merge | yes | building, fixing |
| `checks` | verification | Shinsa | check results (evidence) | soft: `checks` | build | no | checking |
| `agent_review` | verification | reviewer | findings (`report_review`, evidence) | soft: `agent_review` | build | no | reviewing |
| `your_review` | review | you | your decision | hard: `review` | build | no | awaiting_review |
| `pull_request` | shipping | Shinsa | pull request, CI, bot verdicts (evidence) | soft: `ci` | build; your review before it | no | shipping |
| `pre_merge` | handover | you | each step ticked | hard: `merge` (Merge waits until each is ticked) | pull request before it; a merge | no | |
| `merge` | shipping | you | the merged commit (evidence) | hard: `merge` | build; pull request before it | no | awaiting_merge, merged |
| `post_merge` | handover | you | each step ticked | hard: `post_merge`, once the round rests with a step unticked | merge before it | no | |

An inquiry has no gate of its own: a proposal goes to `your_ok`. An inquiry that proposes a change on a task without
`your_ok` is reshaped by the agent to `[inquiry, your_ok, plan, build, checks, agent_review, your_review,
pull_request, merge]` (`resolveProposalUpgrade`) and waits at `your_ok`, so a proposal and a composed OK take one path.

**The plan gate rule** is data, `PLAN_GATE_RULE` (`domain/steps.ts`): `always` when the task operates, was created
plan first or the plan asks for approval (`operates`, `plan_first`, `asks_approval`); with Approve plans on, also when
the task is large or the plan is a revision (`withApprovePlans`: `large`, `revised`). `describePlanGateRule()` writes
the plan step's `when` from it and `needsPlanApproval` (`decide/lifecycle.ts`) evaluates it, so the prose and the
check cannot drift.

`validatePipeline` refuses: no steps; a step twice; steps out of order; an operation not right after the plan or
after the merge (before only `post_merge`); more than one inquiry; any unmet need (its `rule` word for word); no step that does the work (an inquiry, a
build or an operation).

### `GATE_SCHEMA` (`domain/steps.ts`)

`GATE_SCHEMA` holds every hard gate (`GateType`) and every soft gate (`SoftGateType`); `StepGateType` is either. A hard
gate (`HardGateDefinition`) declares its `type`, `title`, what you see (`shows`), its `decisions` and what each does,
the `refusal` for any other decision and whether it `pauses` the task; `gate.answer` reads them through
`resolveGateDefinition(gate)` (`GATE_SCHEMA[gate.type]`) and `isPausingGate` reads `pauses`, so a gate cannot drift
from its definition. A soft gate (`SoftGateDefinition`) declares who decides it, what it `shows`, its `outcomes`
(`pass`, `fail`, `escalate`) and the hard gate it escalates to (`escalatesTo`).

Hard gates, decided by you; the stored `Gate.type` is the key. The plan, your OK, review and merge gates open as
`STEP_SCHEMA` says; the operation gate opens when a task that operates after the merge merges; the post-merge gate
opens when a round rests with a step after the merge unticked, stays open across later rounds and is the only gate a
merged or done task keeps (`syncMergeSteps`, `docs/engine.md` → Steps around the merge); the others as
`docs/engine.md` → Gates says. `isDecisionGate` is true for plan, review and merge; `isAgentQuestion` for question and
secret.

| Type | Title | Shows | Decisions | Refusal | Pauses |
| --- | --- | --- | --- | --- | --- |
| `plan` | Plan to approve | the plan, its version and changes, the operation and impact | approve (records the version, starts work) · revise · reject (cancels) | "Approve it, ask for changes or reject it." | no |
| `review` | Review | the report, the diff by risk, evidence and checks, findings | approve (push, open the pull request) · revise (the agent) · reject | same | no |
| `merge` | Merge | the final diff, CI and bots, what changed since review | approve (merge) · revise (the agent) · reject | same | no |
| `question` | Question | the question, context, choices, recommendation | reply | "Answer the question." | no |
| `secret` | Secret | what it is for, why | reply (a secret ref only) · reject | "Paste the secret into the secret field." | no |
| `proposal` | Your OK | the answer, report or diagnosis, the proposal and why | approve (setup verified again, then planned) · reject (keeps the inquiry, finishes) | "Approve the proposal or keep the task as it is." | no |
| `operation` | Run the operation | the merged commit and pull request, the steps, the impact, your notes | approve (runs with the notes on the gate) · reply (replaces the notes with your words, then runs; empty clears them) · reject (finishes without it) | "Run the operation or finish the task without it." | no |
| `failure` | Paused | what stopped, why, what Retry does | approve (retry) · reply (retry with guidance) · reject (cancel) | "Retry or cancel the task." | yes |
| `configuration` | Setup incomplete | each setup problem and its fix | approve (verifies the setup again) · waive (starts without checks, only when checks are all that is missing) · reject | "Verify the setup again, start without checks, or cancel the task." | yes |
| `sign_in` | Sign in | the provider and the account | approve (retry) · reply (retry with guidance) · reject (cancel) | "Sign in, retry or cancel the task." | yes |
| `post_merge` | Post-merge | each step left for you after the merge, which are ticked | none: ticking the last step withdraws it (`merge_step.tick`), unticking one opens it again | "Tick each step under Post-merge once you did it; the gate closes with the last one." | no |

`reply` needs words, except at the operation gate, where empty words clear the notes.

Soft gates, decided by Shinsa or the reviewer:

| Type | Decided by | Pass | Fail | Escalate (`escalatesTo`) |
| --- | --- | --- | --- | --- |
| `checks` | Shinsa | agent review | the agent with the output, then checks again | `failure` (out of rounds or stalled) |
| `agent_review` | reviewer | your review | the agent on the blocking findings, then checks and a new reviewer | `review`, with the findings (3 rounds, a stall, the budget) |
| `ci` | Shinsa | the merge gate | the agent told exactly what is new | `failure` (the watch stopped or ran out) |

| `Gate` field | Type | Meaning |
| --- | --- | --- |
| `id`, `taskId`, `runId` | | `runId`: the run that asked (questions) or failed |
| `type` | `GateType` | which gate it is (above) |
| `status` | `open` \| `answered` \| `withdrawn` | |
| `title`, `body` | string | what is decided; the body in markdown |
| `openedAt`, `answeredAt`, `decision`, `response` | | your answer and its words |
| `planVersion?` | number | the plan version a plan gate is for |
| `choices?`, `recommendation?` | | a question's one-click answers |
| `cause?` | `budget` \| `monitor` \| `workspace_update` | why a failure gate opened, when not plain recovery; `workspace_update` is a GitButler pull request that conflicts with its base, whose approve runs `but pull` |
| `escalation?` | reason (`rounds`, `stalled`, `exhausted`), rounds | an escalated review |
| `verdicts?` | `{ index, verdict: fix \| dismiss, note }[]` | your per-finding decisions |
| `supersededBy?` | string \| null | the message that withdrew a question |
| `provider?` | string | the provider a Sign in gate is for, set on every one (`claude` for a Claude account) |
| `account?` | `RunAccount` \| null | the Claude account a Sign in gate names, or null for a provider with its own login |
| `secret?` | `{ label }` | what a secret gate asks for |
| `commit?` | string \| null | the merged commit an operation gate shows |
| `notes?` | string \| null | the notes for the operation, kept only here: a message at the operation gate replaces them (`gate.noted`, null clears them), `reply` replaces them with its words, and the agent runs the operation with them |
| `round?` | number | the round it belongs to (Rounds, above) |

## Verification

`VERIFICATION_RULES` (`domain/verification.ts`) apply exactly when a composition contains work of their class and
the rule's scope holds (`always`; `alone`: no `build`; `with_code`: with `build`; `post_merge`).

| Rule | Class | Scope | Checked by | Requirement |
| --- | --- | --- | --- | --- |
| `code.verification_plan` | code | `always` | `propose_plan` | the plan says up front how the change is proven (`verification`) |
| `code.evidence` | code | `always` | the last `complete_phase` | the evidence kinds the plan asks for are attached (`evidence_missing`) |
| `code.checks` | code | `always` | the composition | `checks` follows `build` |
| `code.agent_review` | code | `always` | the composition | `agent_review` follows `checks` |
| `code.shipping` | code | `always` | the guards | your review, a pull request, the merge |
| `code.ci` | code | `always` | the pull request watch | the merge gate opens only on a clean pull request |
| `operation.evidence` | operation | `alone` | `report_outcome` | an operation without a code change attaches the evidence its plan asks for (`evidence_missing`) |
| `operation.plan_approved` | operation | `always` | the plan gate | an operation runs only from a plan you approved |
| `operation.impact` | operation | `always` | `propose_plan` | `impact`: what changes and how much, a dry run or why none, how to undo |
| `operation.steps` | operation | `with_code` | `propose_plan` | the operation's steps in `operation`, apart from the phases |
| `operation.confirm_post_merge` | operation | `post_merge` | the operation gate | you confirm again on the merged commit |

`validateComposition` = `validatePipeline` + the `step` rules + two rules about the task as it stands (an inquiry that
ran stays; an inquiry that leads to a plan needs `your_ok` unless it already ran). `validatePlanRules` = the `plan`
rules + "`checks` are for a code change". A plan may ask for `evidence` for an operation as for a code change.
`listMissingEvidence` names the kinds still missing.

## Composing

The agent composes steps and sets plan parameters while it plans; it cannot add a step kind or a gate.

- **Steps**: `reshape_task` with `shape` (answer, investigate, research) or `steps` (an enum of `PIPELINE_ORDER`),
  before it plans, once per task, never for a kind you chose. A refusal is `pipeline_invalid` with every problem;
  the run carries on.
- **Plan parameters** in `propose_plan` (`PlanDocument`): `verification` (required for code), `evidence`
  (`screenshot`, `recording`, `test`, `note`, `preview`; for a code change or an operation), `checks` (at most 6 extra
  commands, a code change only), `impact` (required for an operation), `operation` (its steps, required with code),
  `approval` (asks for the plan gate). A refusal is `plan_invalid`.
- The only hard gates an agent can add: your OK (`your_ok`, after an inquiry) and plan approval (`approval`).

Examples:

| Request | Steps | What applies |
| --- | --- | --- |
| A question | `answer` | no class with rules: no plan, checks, review or pull request |
| A fix | `investigate`, `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge` | every code rule; the worktree is reset before the plan |
| A change, then an operation | `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge`, `operate` | code rules, `operation.impact`, `operation.steps`, the plan gate, the operation gate after the merge |
| An operation alone | `plan`, `operate` | `operation.impact`, `operation.evidence`, the plan gate |
| Investigate, your OK, then a change | `investigate`, `your_ok`, `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge` | your OK first; leaving out `your_ok`, `checks` or `agent_review` is refused with the rule's message |

## Messages

`task.message` never approves a plan, a review, a merge, your OK or an operation. `resolveMessageEffect`
(`decide/messages.ts`) says what it does; `decide` delivers by it and every composer's hint reads it
(`apps/web/src/lib/tasks/messages.ts`). The table is in `docs/engine.md` → Gates → What a message does. Values
(`MessageEffect`): `steer`, `wake`, `retry` (a failure or Sign in gate: answered `reply` with your words),
`verify_setup` (a setup gate: verified again with `approve`, the message kept for the first agent),
`supersede_question`, `revise_plan`, `request_changes`, `send_back`, `fix`, `decline_proposal`, `operation_notes`
(replaces the operation gate's notes), `restart_step`, `kept`, `follow_up` (any resting task), `closed`.

A message sent on your behalf (or by a schedule) to a task with any open gate is not delivered into the gate: core
records it (`task.messaged`) and nothing else, and the next agent's brief carries it (`resolveLaterMessages`: "Sent by
an agent on the human’s behalf: …", or "Sent by a schedule: …").

`task.message` carries an optional `kind` (`MessageKind`), with the classifier's `title`, `why` and `shape` for new
work. Without one it is `feedback`, except a schedule's message to a resting task, which is `new_round`. `feedback` is
delivered by the effect: on a resting task a follow-up in the same round (an answerer resuming the round's last session
when the round was not an inquiry, which rests again as it was; `answer` with a proposal is refused there with
`follow_up_proposal`). `acknowledge` is only recorded (`task.messaged` with `kind: 'acknowledge'`, "Sent a message"),
unless an agent's question is open, which it then answers as feedback would. `new_round` queues the next round
(`round.queued`) with the steps of its `shape` (a change without one), which starts when the current one rests (Rounds, above);
`separate_task` records a split-off suggested task instead (a new round when the task already has ten open
suggestions). The server sets `kind` from the classifier, unless the message already carries one (`--as`)
(`triage/message.ts`, `docs/engine.md` → Rounds). Yours is accepted first and classified after: the server turns it
into `message.receive`, which checks it like `task.message` (`message_required`, `task_settled`) and keeps it in the
task's `inbox` (`task.message_received`); the classifier's answer comes back as `message.route` with the same `kind`,
`title`, `why` and `shape` (`MessageRoute`) and the ids of the messages it routes (`messageIds`, every message
waiting in the inbox when it was read, in the order sent), which takes them out of the inbox (one
`task.message_routed` each) and delivers them exactly as one `task.message` with their texts joined by a blank line
would, while the chat keeps each as its own `task.messaged`. Messages the task can no longer take by then are dropped
with core's refusal (`message.drop` with `messageIds`, a `task.message_dropped` each, a failure entry in the
activity that keeps the text and the reason as `undelivered`). An agent's `tasks_message` is classified
before it is dispatched, since the agent waits for the answer.

## Commands

Every command has an id; a repeat is answered from its receipt. `parseUserCommand` checks a user command field by field
before `decide` sees it; `decide` throws `DomainError` (nothing emitted) for anything not allowed.

### User commands

Sent by you (the web over the socket, `POST /api/commands`, the command line) or by a task agent's management tool on
your behalf (`onBehalf`, `byTask`). **Human** = only you: its specs are `humanOnly` and core refuses it on your behalf;
**agent** = a task agent has a tool for it.

| Command | Does | Command line | Who |
| --- | --- | --- | --- |
| `task.create` | creates a task (request, project, priority, plan first, waits on, mode, account) | `tasks create` | you; task agents file tasks with `create_task` |
| `task.message` | your message; what it does: Messages, above; `kind` says whether it is feedback, a new round or work for another task | `tasks message [--as]` | agent |
| `round.ship` | how a round ships: onto the open pull request or stacked | `rounds ship` | agent |
| `round.update` | replaces what a round waiting to start asks for (`request`; its title becomes the request's first line); a round that started is refused (`round_started`) | `rounds update` | agent |
| `round.remove` | removes a round waiting to start; the waiting rounds after it move up one number; a round that started is refused (`round_started`) | `rounds remove` | agent |
| `task.prioritize` | sets the priority | `tasks prioritize` | agent |
| `task.wait_on` | replaces the tasks it waits on (`waitsOn`) | `tasks wait-on`, `tasks stop-waiting` | agent |
| `task.retry` | restarts the current step with a fresh budget, optionally on an account | `tasks retry`, `tasks rerun` | agent |
| `task.cancel` | cancels it | `tasks cancel` | agent |
| `task.complete` | marks it done without merging | `tasks done` | agent |
| `task.bind_account` | binds it to an account, or any | `tasks bind` | agent |
| `gate.answer` | decides a gate, any gate; at a review or merge gate, Request changes (`revise`) may carry `comments` (Line comments, below); approving a merge gate needs every step before the merge ticked (`merge_steps_open`) | `gates answer`, `plans *`, `reviews *`, `merges approve`, `merges reject`, `operations *`, `questions answer`, `command` | **human** |
| `merge_step.tick` | ticks or unticks a step around the merge (`key`, `done`); a step that is not due is refused (`merge_step_early`: one after the merge before its pull request merged, one before the merge once it merged), a step the task does not have is refused (`merge_step_not_found`), and a closed task's not at all (`task_settled`); ticking the last open step after the merge withdraws the Post-merge gate | `merges tick [--undo]` | **human** |
| `suggestion.accept` | adds a suggested task, optionally waiting on this one | `suggestions accept` | agent |
| `suggestion.dismiss` | dismisses one | `suggestions dismiss` | agent |
| `suggestion.keep` | keeps a split-off in this task as its next round (`shape` optional; the server asks the classifier when it is left out) | `suggestions keep` | agent |
| `monitor.check_in_now` | fires a monitor's next check-in now | `tasks check-in-now` | agent |
| `usage_wait.change` | turns a usage wait's auto-resume on or off | `tasks auto-resume` | agent |
| `usage_wait.resume_now` | resumes a usage wait now | `tasks resume-now` | agent |
| `run.snooze_silence` | snoozes a quiet-run warning | `runs snooze` | agent |
| `run.dismiss_silence` | dismisses it for the run | `runs dismiss` | agent |
| `delegation.cancel` | stops a delegation and what it delegated | `delegations stop` | agent |
| `schedule.write` | creates or changes a schedule | `schedules write` | agent |
| `schedule.enable` | pauses or resumes one | `schedules enable`, `schedules disable` | agent |
| `schedule.remove` | deletes one | `schedules delete` | agent |
| `project.write` | creates or changes a project | `projects write` | agent |
| `project.remove` | removes one | `projects remove` | agent |
| `repo.update` | changes a repository's fields | `repos update` | agent; **human** for `checkCommands`, `checksWaived`, `workspace`, `coverage` (`HUMAN_ONLY_REPO_FIELDS`) |
| `repo.remove` | forgets a repository | `repos remove` | agent |
| `focus.change` | sets or clears the focus | `focus set`, `focus clear` | agent |
| `settings.change` | changes settings (`SETTINGS_KEYS`) | `settings set` | agent; **human** for `approvePlans`, `mergeMethod`, `taskBudgetUsd`, `taskUsageLimit`, `autoResume`, `snoozeLimited`, `accountSwitchAt`, `fastMode`, `agentFastModes`, `delegationLimit` (`HUMAN_ONLY_SETTINGS`) |

Core refuses a command sent on your behalf with `human_only`, recording nothing, when it is a `gate.answer`
(`assertHumanDecides`), when a gate that was open before it is no longer open after it (`assertGatesStayOpen` in
`decide/gates.ts`, run at the end of `decide`, so retry, complete, cancel, wait-on, keeping a split-off and the rest
cannot step past an open gate), when it is a `merge_step.tick`, or when a `settings.change` or `repo.update` touches
a human-only field. A `task.complete` on your behalf also needs no waiting round, no open pull request and no unticked
step after the merge (`task_open`).

Not commands, human-only all the same: `gates secret` and `gates decline-secret` (`/api/secrets`), `schedules
webhook-secret`, `accounts sign-in`, `sign-in-code`, `import` and `remove`, `mcp check|add|remove|on|off|sign-in|sign-out`,
`skills on|off`, `plugins on|off`, `tasks open`, `versions update`.

#### Line comments

`gate.answer`'s optional `comments` is a list of `ReviewComment` (`domain/types.ts`), at most 100:

| Field | Type | Meaning |
| --- | --- | --- |
| `path` | string | the file, relative to the repository |
| `side` | `new` \| `old` | the head's lines, or the removed lines of the base |
| `line`, `endLine` | number, number \| null | the first line and, for a range, the last (after `line`) |
| `text` | string | your words, never empty |

`parseUserCommand` checks the shape; `decide` refuses comments anywhere but a `revise` at a review or merge gate
(`comments_invalid`, `comments_conflict`) and a comment whose range or words do not hold together. The agent's fix
prompt (`resolveHumanFixPrompt`, `resolveVerdictFixPrompt`) lists each comment with its path, lines and words. A
comment carries no code: to change the code yourself you edit it (`docs/engine.md` → Your edits).
A `revise` with verdicts (Fix N findings at a review with findings) carries them too. The comments are kept on the
`gate.answered` event (`comments`, left out when there are none) and on its decision's `Activity` entry
(`Activity.comments`), so the task's activity lists them under the decision.

### Agent commands

Sent only by Shinsa's MCP tools, carrying the run and attempt; refused from a run that ended, a stale attempt or a
role without the tool (`hasTool`).

| Command | Tool | Does |
| --- | --- | --- |
| `agent.propose_plan` | `propose_plan` | hands over a plan (checked by `validatePlanRules`) |
| `agent.complete_phase` | `complete_phase` | hands over a phase with its judgement calls; Shinsa commits it (the last one needs the evidence) |
| `agent.complete_fix` | `complete_fix` | hands over a fix (`summary`, and `walkthrough` when it changes how the change works); Shinsa commits and pushes when shipping |
| `agent.report_review` | `report_review` | hands over the review: `summary` (or null), the findings and the `disagreements` with the Agent's judgement calls |
| `agent.deliver` | `answer`, `report_diagnosis`, `submit_report`, `report_outcome` | hands over an answer, a diagnosis, a report or an outcome (step `answer`, `investigate`, `research`, `operate`), an inquiry optionally with a proposal; an operation without a code change needs its evidence first |
| `agent.reshape` | `reshape_task` | recomposes the steps before planning |
| `agent.ask` | `ask` | asks you (or, from a delegated run, its parent) |
| `agent.attach_evidence` | `attach_evidence` | attaches evidence, stored under its task and round (`validateEvidence`; `docs/engine.md` → Evidence) |
| `agent.attach_comparison` | `attach_evidence` with `kind: "comparison"` | attaches one comparison: a piece per part, sharing one `itemId` (`docs/engine.md` → Evidence) |
| `agent.note` | `note` | keeps a note on the task |
| `agent.wait_for` | `wait_for` | ends the run and arms a monitor |
| `agent.suggest_tasks` | `suggest_tasks` | suggests up to five tasks |
| `agent.request_secret` | `request_secret` | opens a secret gate |
| `agent.delegate` | `delegate_task` | starts a delegation from its `brief` |
| `agent.cancel_delegation` | `delegation_cancel` | stops one |
| `agent.answer_delegation` | `delegation_answer` | answers a delegation's question |
| `agent.acknowledge_delegation` | `delegation_status` | marks a finished result read |
| `agent.create_task` | `create_task` | files a courier task from its `request`, optionally waiting on it |
| `agent.split_task` | `split_task` | splits the approved plan into tasks (`requests`) |
| `agent.set_schedule` | `set_schedule` | writes one of its task's schedules |
| `agent.delete_schedule` | `delete_schedule` | deletes one |

The delegation tools name a delegation by `delegation_id`. Reads with no command: `find_tasks`, `read_task`,
`list_repository_work`,
`list_schedules`, and `delegation_status` for a delegation still working.

### System commands

Sent by the server, each under an id named after its cause (`docs/engine.md` → Command receipts).

| Command | Sender | Does |
| --- | --- | --- |
| `task.triage` | `task.triage` effect (`triage/`) | records title, repository, size, branch, waits on, and the Auto parts |
| `repo.register` | `repos/index.ts` | registers a repository on first use |
| `config.record` | `config.verify` effect | records what setup verification found, with the repository it found (`repoId`) for a task that had none |
| `worktree.ready`, `worktree.gone` | worktree effects | the worktree exists (with the branch a main checkout was on, `returnBranch`), or is gone |
| `task.stack` | the hand-over commit (`agents/tool-calls.ts`) | GitButler stacked the task's branch on another task's (`branch`): records it and makes the task wait on that task |
| `task.record_conflict` | the worktree removal and push effects | GitButler left commits on the task's branch (`branch`) conflicted: steers its Agent, starts a fix (`fixFor: 'conflict'`) at the review gate, the merge gate or while shipping, or holds it for the Agent's next build, fix or operation turn or the next of those gates (`task.conflict_held`) |
| `task.record_workspace_update` | the `workspace.update` effect, after `but pull` | `guidance`: your words from the gate, if any; starts the conflict fix in the Agent's session |
| `task.record_edit` | the file route after a save from the Code tab (`http/edits.ts`) | you saved `path`; `changed` says whether it now differs from the checkout's commit. Records the edit (once per file) or drops it, and steers a running agent of the task |
| `task.commit_edits` | the push effect before it pushes, and the checks effect when the review was approved with edits | Shinsa committed your uncommitted edits (`treeHash`); clears `editedPaths` |
| `task.record_overlaps` | an agent's `propose_plan`, `complete_phase` or `complete_fix`, before it dispatches (`agents/repository-work.ts`) | `overlaps`: the other open tasks of the repository and the files this task shares with each; `from`: the task whose hand-over compared them; records the ones not known yet (`task.overlapped`) and steers this task's Agent at work with them at once when `from` is another task, else they wait for its next turn |
| `checks.record` | `checks.run` effect | records a round of checks, with `evidence` (title, detail, uri) for the output the server stored, attached as Shinsa's own `check` evidence, and `coverage?` (`Coverage`) when the checks passed and the repository measures coverage |
| `pull_request.record` | open, merge and watch effects | records a pull request read |
| `pull_request.read_failed` | the watch effect | counts a failed read |
| `pull_request.record_push` | open and push effects | records a pushed commit |
| `effect.fail` | the engine and effects | an effect gave up: a failure gate when its kind has one |
| `run.attempt`, `run.link`, `run.meter`, `run.end` | the run supervisor | an attempt starts, links its session, is metered, ends |
| `run.interrupt`, `run.continue` | the supervisor at shutdown and boot | marks a run for restart continuation, continues it |
| `run.record_lost_session` | the supervisor | marks a session that cannot be resumed |
| `run.compact` | the supervisor (idle compaction) | records an idle compaction |
| `runs.dispatch` | the supervisor at boot | starts queued runs |
| `run.silence` | `agents/silence.ts` | marks or clears a quiet run |
| `message.deliver` | the supervisor, `agents/questions.ts` | redelivers a message a session never took |
| `message.receive` | `routeUserCommand`, for your `task.message` without a `kind` | accepts the message into the task's inbox |
| `message.route`, `message.drop` | `triage/inbox.ts` | delivers the messages waiting in an inbox, together, with the classifier's answer, or drops the ones core refused, with the reason |
| `monitor.fire` | `MonitorClock` | wakes a monitor |
| `usage_wait.resume` | `UsageResumeClock` | resumes a step after the reset |
| `account.signed_in`, `account.removed` | the accounts service | answers that account's Sign in gates; releases bound tasks |
| `provider.record_sign_in` | the accounts service | a provider's own sign-in is back: answers its open Sign in gates that name no account |
| `delegation.record_delivery`, `delegation.release` | `agents/deliveries.ts` | a delivery claim was taken, or released |
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
| `focus.changed` | the focus changes |
| `settings.changed` | settings change (the whole settings object) |
| `task.created` | a task is created (`request`, `planFirst`; with its handle when it has a project) |
| `task.triaged` | triage set title, repository (or none), size, branch, handle, pipeline, decisions (always) |
| `task.repo_bound` | a task with no repository got the one the setup check found (`repoId`, and `projectId` when it had none) |
| `task.reshaped` | the pipeline changed (`by` you, agent or Shinsa, with a reason) |
| `task.staged` | the stage and its reason changed |
| `task.prioritized` | the priority changed |
| `task.waits_on_changed` | the tasks it waits on changed (`waitsOn`) |
| `task.messaged` | you (or a schedule, or an agent for you) sent a message; `kind` and `round` when it was new work |
| `task.message_received`, `task.message_routed`, `task.message_dropped` | a message of yours entered the inbox, left it to be delivered, or left it undelivered (`reason`) |
| `round.queued` | a new round waits to start (number, title, request, why, shipping, steps) |
| `round.started` | a round became the active one (`branch`, `base`, `onto`: the pull request it ships onto); the round before it, if any, is archived as shipped |
| `round.shipping_changed` | how a round ships changed; for an active round also its `branch`, `base` and `onto` |
| `round.updated` | a waiting round asks for something else (`request`, `title`) |
| `round.removed` | a waiting round was removed; the waiting rounds after it took the numbers one lower |
| `round.pull_request_merged` | an earlier round's pull request merged outside Shinsa while a later round works: that round is merged, and the active round takes a new `branch` from the default branch for its own pull request |
| `task.noted` | an agent kept a note |
| `task.recovered` | the recovery count changed |
| `task.delivered` | an answer, a diagnosis, a report or an outcome was handed over (`step`) |
| `task.change_proposed`, `task.change_approved`, `task.change_declined` | a proposal was made, approved, declined |
| `task.suggested`, `suggestion.settled` | a task was suggested (`request`; `splitOff` for a split-off); accepted or dismissed (`keptRound` when it was kept here as a round) |
| `task.account_bound` | the task's account changed |
| `task.split` | `split_task` made tasks |
| `config.verified` | setup verification ran |
| `budget.acknowledged` | you allowed more past a usage or cost limit |
| `worktree.requested` | the task asked for its workspace, in this mode (`workspace`) |
| `worktree.created`, `worktree.removed` | the worktree, branch or checkout was made (with its `workspace`, and `returnBranch` for a main checkout), given back |
| `task.stacked` | the task's branch was stacked on another task's (`onTaskId`, `branch`) |
| `task.unstacked` | the task it was stacked on (`fromTaskId`) settled without a merge, so its branch left that stack; clears `stackedOn` |
| `task.edited` | you saved `path` from the Code tab (`changed`), or put it back the way it was committed; keeps `editedPaths` and `untoldEdits` |
| `task.edits_told` | a new run's prompt named the files in `untoldEdits`; clears it |
| `task.overlapped` | the task and another open one (`otherTaskId`) both change `paths`, none of them recorded before; adds them to `overlaps` and its `untold` |
| `task.overlaps_told` | a steer or a new Agent run's prompt named the untold overlaps; clears every `untold` |
| `task.edits_committed` | Shinsa committed your edits before a push or the checks; clears `editedPaths` |
| `task.edits_approved` | `gate`: the review or merge you approved with uncommitted edits (`approvedEdits`), or null once the checks or CI it waited for passed |
| `task.conflict_held` | `branch`: a conflict kept for the Agent's next build, fix or operation turn or the task's next review or merge gate, or null once an Agent at work or a new turn of it was told |
| `plan.proposed`, `plan.answered`, `plan.approved` | a plan version was proposed; you answered it; approved |
| `phase.updated`, `phase.completed` | a phase's status changed; a phase was handed over (`judgementCalls`, and the last phase's `walkthrough`) |
| `walkthrough.revised` | a fix changed how the change works (`walkthrough`: only the parts that changed, `runId`); merged into the latest phase report's walkthrough (`docs/engine.md` → The review report) |
| `merge_step.ticked` | you ticked or unticked a step around the merge (`key`, `title`, `done`); adds or removes its key in `mergeStepsDone`, or marks the carried step, and records it in the activity |
| `work.submitted` | the work report was assembled (`sections`, `judgementCalls`) |
| `work.committed` | Shinsa committed (the tree hash) |
| `checks.recorded` | a round of checks finished (`results`, and `coverage?` when it was measured; sets `checkResults` and `coverage`) |
| `review.reported`, `review.escalated` | a reviewer reported (`summary`, `findings`, `disagreements?`); the review escalated to you |
| `fix.started` | a fix round started (reason, signature, tree) |
| `evidence.attached` | evidence was attached |
| `gate.opened`, `gate.answered`, `gate.withdrawn`, `gate.superseded` | a gate opened (`type`), was answered, withdrawn, or replaced by your message |
| `gate.noted` | the open operation gate's notes were replaced (`notes`, null clears them; the same gate, no new notification) |
| `run.started`, `run.dispatched` | a run was created; it started |
| `run.attempted`, `run.linked` | an attempt began; it linked its session |
| `run.ended` | a run ended (outcome, failure) |
| `run.interrupted`, `run.continued` | marked at shutdown; continued after a restart |
| `run.session_lost`, `run.compacted` | a session is gone; an idle session was compacted |
| `run.metered` | usage and cost were charged |
| `run.silenced`, `run.silence_snoozed`, `run.silence_dismissed` | a run went quiet; the warning snoozed or dismissed |
| `run.waiting` | a step's turn ended while its delegations work |
| `monitor.armed`, `monitor.fired`, `monitor.ended` | a monitor was armed, fired, ran out or was cleared |
| `usage_wait.armed`, `usage_wait.ended` | a usage wait was armed; resumed, reset or cleared |
| `pull_request.opened`, `pull_request.updated` | the pull request was opened; a read changed it |
| `pull_request.push_requested`, `pull_request.pushed`, `pull_request.head_moved` | a push was asked for, made; someone else moved the head |
| `pull_request.read_failed`, `pull_request.read_failures_cleared` | a read failed; the count reset |
| `pull_request.watched` | the watch's memory changed (with what changed) |
| `delegation.asked`, `delegation.answered` | a delegation asked its parent; was answered |
| `delegation.acknowledged` | the parent read a finished result |
| `delegation.wake_changed`, `delegation.adopted` | a wake policy changed; a restarted step adopted its children |
| `delegation.claimed`, `delegation.delivered`, `delegation.released` | a delivery cohort was claimed, delivered, released |
| `delegation.message_queued` | your message was queued for a waiting step |
| `schedule.written`, `schedule.removed`, `schedule.fired` | a schedule was written, removed, fired (with its run) |
| `on_behalf.acted` | a command sent on your behalf changed something (command, task, sentence, acting task) |

## Effects

`ShinsaEffect` (`effects/index.ts`), run by `EffectRunner` (`apps/engine/src/runtime/effects.ts`) from the outbox.
`process_bound` effects are cancelled on boot; `replay_safe` ones are requeued and must be safe to run twice.

| Effect | Recovery | Lane | Reports back with |
| --- | --- | --- | --- |
| `task.triage` | replay_safe | `task:<id>` | `task.triage`, `repo.register` |
| `config.verify` | replay_safe | `task:<id>` | `config.record` |
| `worktree.create` | replay_safe | `task:<id>` | `worktree.ready` |
| `worktree.remove` | replay_safe | `task:<id>` | `worktree.gone` |
| `scratch.remove` | replay_safe | `task:<id>` | none: deletes `data/scratch/<id>` once the task's runs stop, if it is still settled |
| `checks.run` | replay_safe | `task:<id>` | `task.commit_edits` first when the review was approved with edits, then `checks.record` |
| `pull_request.open` | replay_safe | `task:<id>` | `pull_request.record_push`, `pull_request.record` |
| `pull_request.push` | replay_safe | `task:<id>` | `pull_request.record_push` |
| `pull_request.merge` | replay_safe | `task:<id>` | `pull_request.record` |
| `pull_request.watch` | replay_safe | `side:<id>` | `pull_request.record`, `pull_request.read_failed` |
| `workspace.update` | replay_safe | `task:<id>` | `task.record_workspace_update` once `but pull` updated the task's GitButler workspace (`guidance` is carried through) |
| `briefing.request` | replay_safe | `briefing` | none: `Engine.writeBriefing` stores the Home guide beside the log (`docs/engine.md` → The briefing) |
| `run.execute` | process_bound | `run:<id>` | `run.attempt`, `run.link`, `run.meter`, `run.end`, agent commands |
| `run.wake` | process_bound | `run:<id>` | as `run.execute`, on the waiting step's session |
| `run.cancel` | process_bound | `cancel:<id>` | `run.end` |
| `run.steer` | process_bound | `steer:<id>` | `message.deliver` when it is too late to steer; `from: 'shinsa'` steers a note of Shinsa's (an overlap, a conflict, your edits in the Code tab) instead of your words |
| `question.resolve` | process_bound | `gate:<id>` | none: releases the waiting `ask` call |
| `delegation.steer` | process_bound | `steer:<id>` | `delegation.record_delivery`, `delegation.release` |
| `delegation.reply` | process_bound | `reply:<id>` | none: answers the child's question |

Any effect that gives up sends `effect.fail`; it opens a failure gate when its kind has a title in `FAILURE_TITLE`.

## Agent tools

Per role, who may call what, from `listCallableToolNames` (`domain/tools.ts`); this table is the one list, and other
docs link here. What a session is served is `listToolNames`: the agent, answerer, investigator and researcher share
the task's one session, so each is served the union of their columns, and a served tool that is not the run's own is
refused with `wrong_step` naming the hand-over to use (`docs/engine.md` → Caching). Every
non-delegated task run also gets one management tool per surface spec that is not `humanOnly` (`tasks_list`,
`tasks_message`, `settings_set`…; `agents/manage/tools.ts`), except `tasks_create`: a task agent files a task with
`create_task`.

| Tool | agent | reviewer | answerer | investigator | researcher | delegated, depth 1–2 | depth 3 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `propose_plan` | ✓ plan | | | | | | |
| `reshape_task` | ✓ plan | | | | | | |
| `complete_phase` | ✓ build | | | | | | |
| `complete_fix` | ✓ fix | | | | | | |
| `report_review` | | ✓ | | | | | |
| `answer` | | | ✓ | | | | |
| `report_diagnosis` | | | | ✓ | | | |
| `submit_report` | | | | | ✓ | | |
| `report_outcome` | ✓ operate | | | | | | |
| `ask` | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `attach_evidence` | ✓ | ✓ | | ✓ | | ✓ | ✓ |
| `find_tasks`, `read_task`, `note` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `list_repository_work` | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `wait_for` | ✓ | | | ✓ | | | |
| `suggest_tasks` (`split_off`) | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `delegate_task`, `delegation_status`, `delegation_cancel`, `delegation_answer` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `create_task` | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `split_task` | ✓ | | | | | | |
| `set_schedule`, `list_schedules`, `delete_schedule` | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `request_secret` | ✓ | | ✓ | ✓ | ✓ | | |

Hand-over tools (the first nine rows, `isHandOverTool`) end the step. Every task-session role is served every tool of
the union in every run, since the session's tool list must not change between turns (the prompt cache); the agent
may call only the hand-over its purpose names (`PURPOSE_HAND_OVERS`, the word after ✓), and another is refused with
`wrong_step`. A delegated
`planner` or `builder` has only the delegated tools. The reviewer cannot ask you anything.

Three more tools come from the server, not from `listToolNames`, and only in a run the context optimizer left
something out of (`apps/engine/src/extensions/loader.ts`), any role, delegated runs too:

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
| `propose_plan` | **`goal`**, **`phases`** (**`title`**, **`detail`**), **`behaviour`**, **`approach`**, **`files`** (**`path`**, **`change`**), **`out_of_scope`**, **`verification`**, **`questions`** (**`question`**, **`options`**, `recommendation`); `impact`, `evidence`, `checks`, `approval`, `operation`, `change_summary` | goal 300; 2 to 8 phases (title 60, detail 160); behaviour 8 × 200; approach 700; files 20 (change 140); out of scope and verification 6 × 200; questions 4 (question 200, 2 to 4 options of 100); impact 1,000; checks 6 × 200; operation 8 × 200; change summary 240 |
| `complete_phase` | **`summary`**, **`spots`** (**`file`**, **`start`**, **`end`**, **`attention`**: critical, high or normal, **`why`**, `title`, `explain`), **`judgement_calls`** (**`title`**: a few words naming the decision, **`call`**, **`reason`**, `file`, `line`, `end`, `alternatives` (**`option`**, **`rejected`**)); `walkthrough` (**`approach`**, **`flow`**, `risks` (**`title`**: a few words naming the risk, **`risk`**, `file`, `line`, `end`), `testing` (`automated`, `manual` (**`action`**, `target` (**`kind`**: url, file, command or screen, **`value`**), **`expect`**)), `steps` (**`when`**: pre_merge or post_merge, **`kind`**: env, secret, migration, deploy, config or other, **`title`**, **`detail`**, `command`)), asked for on the last phase | summary 240; 8 spots (why 180, title 80, explain 400); 5 judgement calls (title 60, call 120, reason 240; 3 alternatives, option 100, rejected 200); walkthrough approach 1,200, flow 2,400, 8 risks (title 60, risk 280), testing automated 4 × 240 and 10 manual steps (action 240, target 400, expect 240), 8 steps (title 80, unique per `when`; detail 400; command 400) |
| `complete_fix` | **`summary`**; `walkthrough` (`approach`, `flow`, `risks` (**`title`**, **`risk`**, `file`, `line`, `end`), `testing`, `steps`), only when the fix changes how the change works, with only the parts that changed and at least one; `testing` and `steps` replace the part whole, an empty one included | summary 240; walkthrough as in `complete_phase` |
| `report_review` | **`findings`** (**`severity`**: blocking or suggestion, **`message`**: what is wrong and why it matters, `title`, `fix`, `file`, `line`, `end`); `summary`; `disagreements` (**`call`**: the judgement call's number in the brief, **`reason`**) | summary 400; 12 findings (title 80, message 280, fix 600); 8 disagreements (reason 280), each call once |
| `answer` | **`answer`**; `propose_change` (**`request`**, **`why`**) | answer 8,000; request 2,000, why 240 |
| `report_diagnosis` | **`diagnosis`**; `propose_change` | 12,000 |
| `submit_report` | **`report`**; `propose_change` | 40,000 |
| `report_outcome` | **`outcome`** | 8,000 |
| `reshape_task` | **`reason`**; `shape` (answer, investigate, research) or `steps` (`PIPELINE_ORDER` names) | reason 240 |
| `attach_evidence` | **`kind`** (comparison, screenshot, recording, test, check, note, preview), **`title`**: what it shows, the same for a before shot and its after shot; `detail`: what to look at; `width` (CSS pixels), `theme` (light, dark), `stage` (before, after); exactly one of `path`, `url` (http or https) or `text`, or for a comparison **`parts`** (each **`path`**, `stage`, `label`) | title 80; detail 280; width 1 to 7,680; text 40,000; url 2,000; path 300; 2 to 6 parts, label 40 |

Shinsa assembles the work report you review (`WorkReport`: headline, sections, checks, judgement calls and the
walkthrough) from the plan's goal, every `complete_phase` (the latest walkthrough wins, as revised by a fix's
`walkthrough`: `ReportWalkthroughRevision`, merged part by part) and the checks it ran (`assembleReport`); no agent hands over a whole report. `decide` turns each disagreement's number into the call's text
(`ReviewDisagreement { call, reason }`, kept on the task as `reviewDisagreements`, cleared by the next review and by a
new round) and refuses a number the brief never gave (`unknown_judgement_call`). Why the builder writes it and the reviewer
checks it: `docs/engine.md` → The review report. The other
tools' limits are `PROTOCOL_LIMITS` (`ask`, `wait_for`, `suggest_tasks`), `DELEGATION_LIMITS` and `SCHEDULE_LIMITS`.

How to test the change (`ReportTesting`, `report/testing.ts`) has two parts: `automated`, a line or two on what the
tests cover, and `manual`, the steps the human follows in order (`ManualTestStep { action, target, expect }`). A
target is where the step happens: a `url` (http or https only), a `file` (a repository path with `:line` or
`:start-end`, or a `shinsa://file/` reference; `parseTestFile`), a `command` or a `screen` by name; a step without one
stores `null`. A plain list of strings, the older form, is still accepted and read as `automated`.

### Checklists

A list of things to do that you tick is one shape (`packages/core/src/report/checklist.ts`): a `ChecklistItem`
`{ key, title, detail, command, done }` (`key` names it for a tick, `detail` and `command` are null when there is none)
and a `Checklist<Item> { title, items }`. `resolveChecklistProgress(items)` gives `{ done, total, complete }` (an empty
list is complete) and `listOpenChecklistItems(items)` the items left, in order. The steps around the merge are
checklist items (`MergeStepView`); the web draws every checklist, and every GFM task list in Markdown, with one
component (`docs/design.md` → Checklists).

## The socket

The web and the server talk over `/ws` in JSON messages (`packages/core/src/protocol/messages.ts`; how they flow is
`docs/engine.md` → The socket). A **surface** (`Surface`, `SURFACES`) is what a page runs in: `desktop` (the Mac app)
or `browser` (a tab, Floaty).

| Page → server (`ClientMessage`) | What it does |
| --- | --- |
| `hello { surface }` | Names the page's surface; the first message on every socket |
| `command { id, command }` | A `UserCommand`; answered by `ack` with the same id |
| `state.sync` | Send the whole state again: a patch did not fit the state the page holds |
| `transcript.subscribe { runId, from }` / `transcript.unsubscribe { runId }` | Follow a run's transcript from entry `from` (the number the page holds), or stop |

| Server → page (`ServerMessage`) | When |
| --- | --- |
| `state { state }` | On connect, and on `state.sync`: the state as the page holds it (`WireState`, below) |
| `state.patch { patch }` | After every change: a `StatePatch` from log position `from` to `to` |
| `ack { id, error }` | After a command, after its patch; `error` is `{ code, message }` or null |
| `transcript { runId, entries, start }` | On subscribing (the entries from `from`, in pages of 500) and for each new entry; `start` is the position of the first one |
| `accounts { accounts }` | On connect and after every change to the accounts |
| `surfaces { desktop }` | On connect, and when whether any desktop surface is connected changes |
| `terminals { terminals }` | On connect and after every change to your terminals or services: `TerminalsSnapshot` (the terminals in order, each with the service it runs if any, your services, your home folder) |

Each terminal has a socket of its own, `/ws/terminals/<id>` (`packages/core/src/protocol/terminals.ts`, `docs/engine.md`
→ Terminals): binary frames carry the shell's output and what you type, text frames carry `reset { cols, rows }` and
`live` (server → page, around the screen sent on attach) and `resize { cols, rows }` and `colors { colors }` (page →
server, `parseTerminalClientFrame`). A terminal (`TerminalInfo`) is in a project, at a place (`TerminalPlace`:
`repository`, `folder` or `worktree`, `listTerminalPlaces`), and `running`, `exited` or `stopped`.

`isQuietSurface(surface, desktop)` is true for a page that is not the desktop while one is connected: it plays no
sound, shows no notification and puts no count in its title or Floaty's tags.

The page never gets a run's prompts. The state on the socket is a `WireState` (`packages/core/src/protocol/runs.ts`;
`serializeState` makes one): the state with every run a `WireRun` (`serializeRun`), which is the `Run` without
`prompt` and `rolePrompt` and with `fixFocus` on a fix whose instruction Shinsa recognises. The prompts are about
14 KB per run and nothing on the page shows them: the brief a run was given is the first entry of its transcript.

| `fixFocus` | What the fix is for, from the first words of its instruction (`resolveFixFocus`, `packages/core/src/prompts/focus.ts`) |
| --- | --- |
| `checks` | The checks failed |
| `review` | The agent review found problems |
| `changes` | The human asked for changes (`revise` on the review gate, with or without verdicts on findings) |
| `pull_request` | The pull request needs work |
| `conflicts` | GitButler left conflicted commits, or the human updated the workspace for a conflicting pull request |

A **state patch** (`StatePatch`, `packages/core/src/protocol/patch.ts`; `resolveStatePatch` makes one,
`applyStatePatch` applies one, or answers null when its `from` is not the state's `seq`; a patch carries runs as
`WireRun`s too, and an entry none of whose fields changed is left out):

| Field | Holds |
| --- | --- |
| `from`, `to` | The log position the patch applies to and the one it reaches; equal for a change that is not an event (a new Home guide, `docs/engine.md` → The briefing) |
| `fields` | `focus`, `settings`, `onBehalfActions` when they changed, each a `ValueChange` |
| `records` | Per record of the state (`tasks`, `runs`, `gates`, `repos`, `projects`, `taskNumbers`, `evidence`, `briefings`, `schedules`, `sessionUsage`), the entries that changed by id, each an `EntryChange` |

An `EntryChange` is `{ put }` (a new or replaced entry), `{ remove: true }` or `{ fields, unset }` (the fields whose
value changed, each a `ValueChange`, and the ones that went away). A `ValueChange` is `{ put }` or `{ drop, append }`:
a list that lost `drop` entries at its start and gained `append` at its end, the way a task's activity grows.

## Where it lives

| What | Code |
| --- | --- |
| Task, Run, Gate, Repo, Project, Evidence, stages, roles | `packages/core/src/domain/types.ts` |
| Which settings a run role uses | `packages/core/src/agent-models/index.ts` (`RUN_AGENT_ROLE`) |
| Rounds, shipping, resting and closed | `packages/core/src/domain/rounds.ts`, `state/rounds.ts`, `decide/rounds.ts` |
| Test coverage of the change: the setting, the report and diff parsers, the measurement, the summary | `packages/core/src/test-coverage/`; detection and the run in `apps/engine/src/test-coverage/` |
| The message classifier and routing | `apps/engine/src/triage/message.ts` |
| Human-only decisions | `packages/core/src/decide/gates.ts` (`assertHumanDecides`, `assertGatesStayOpen`), `domain/settings.ts` (`HUMAN_ONLY_SETTINGS`, `HUMAN_ONLY_REPO_FIELDS`), `decide/settings.ts` |
| Gate predicates | `packages/core/src/domain/gates.ts` (`isPausingGate`, `isDecisionGate`, `isAgentQuestion`) |
| Steps, gates, `validatePipeline`, `PLAN_GATE_RULE` | `packages/core/src/domain/steps.ts`; `needsPlanApproval` in `decide/lifecycle.ts` |
| Verification rules | `packages/core/src/domain/verification.ts` |
| Shapes, presets, `validateComposition`, `resolveProposalUpgrade` | `packages/core/src/domain/shapes.ts` |
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
| Socket messages, surfaces | `packages/core/src/protocol/messages.ts`; `apps/engine/src/http/socket.ts`, `apps/web/src/lib/connection/socket.ts` |
| Terminals, their places and frames | `packages/core/src/protocol/terminals.ts`; `apps/engine/src/terminals/`, `apps/web/src/lib/terminal/` |
| Services, their states and suggestions | `packages/core/src/protocol/services.ts`; `apps/engine/src/terminals/` (`detect.ts`, `routes.ts`), `apps/web/src/lib/terminal/services.ts` |
| State patches, drafts | `packages/core/src/protocol/patch.ts`, `packages/core/src/state/draft.ts` |
| State snapshots | `apps/engine/src/store/snapshot.ts`, `apps/engine/src/store/event-log.ts` |
| Event log, receipts, outbox | `apps/engine/src/store/event-log.ts`, `apps/engine/src/runtime/engine.ts` |
| Effect handlers | `apps/engine/src/runtime/effects.ts` |
| Agent tools (MCP) | `apps/engine/src/agents/tools/`; the loader tools `apps/engine/src/extensions/loader.ts` |
| Management tools | `apps/engine/src/agents/manage/` |
| Command surface and `humanOnly` | `apps/engine/src/surface/`, reference `docs/cli.md` |
| Shell policy | `apps/engine/src/agents/policy.ts` |
| Composer hint | `apps/web/src/lib/tasks/messages.ts` |
| The Code tab's reads: `TaskRefs`, `RepoPaths`, `RepoTree`, `FileContent`, `SearchResult`, `TaskDiff`, `CODE_LIMITS` | `packages/core/src/protocol/code.ts`, `protocol/messages.ts`; served by `apps/engine/src/http/code.ts` (`docs/engine.md` → The Code tab's reads) |
| Saving a file from the Code tab: `FileWrite`, `FileWritten`, `FileChanged` | `packages/core/src/protocol/code.ts`; served by `apps/engine/src/http/edits.ts` (`docs/engine.md` → Your edits) |

## Open protocol questions

None. Every question this file raised is answered in the code; the answers are below.

## Settled protocol questions

Tests are in `packages/core/test/`.

1. **Only you close your gates.** Every hard gate is yours, an agent's question to you included. Core refuses with
   `human_only`, recording nothing, any `gate.answer` sent on your behalf (`assertHumanDecides`) and any command on
   your behalf after which a gate that was open is closed (`assertGatesStayOpen`), both in `decide/gates.ts`; the
   `questions answer` spec is `humanOnly`. Tests: `decide/gates.test.ts`, `decide/on-behalf.test.ts`.
2. **`tasks diff` reads.** Its spec is marked a read, so agents see it with the read-only hint.
3. **A message an agent sends for you is not a decision.** On your behalf (or from a schedule), a message to a task
   with any open gate is recorded and kept for the next agent's brief, never delivered into the gate
   (`messageTask` in `decide/messages.ts`, `resolveLaterMessages` in `prompts/context.ts`). Tests:
   `decide/messages.test.ts`, `decide/on-behalf.test.ts`.
4. **One way to retry with words.** `reply` is the one words-taking decision: a failure or Sign in gate takes approve
   (retry), reply (retry with guidance) or reject, and a message there answers it with `reply` and the words
   (`GATE_SCHEMA`, `decide/messages.ts`). Tests: `decide/gates.test.ts`, `decide/messages.test.ts`,
   `decide/accounts.test.ts`.
5. **Operation notes live only on the gate.** `Gate.notes` is the one place: a message replaces them (`gate.noted`,
   null clears them), approve runs with them, reply replaces them with its words and runs (`answerOperation` and
   `noteOperation` in `decide/shapes.ts`). Test: `decide/shapes.test.ts`.
6. **`task.create` takes no `shape`.** Only triage and the agent, while it plans, shape a task; `TaskAuto.shape` is true unless `mode`
   was given (`decide/tasks.ts`, `commands/parse.ts`). Tests: `decide/tasks.test.ts`, `commands/`.
7. **The proposal gate has one owner.** Inquiry steps have no gate; `your_ok` owns the hard `proposal` gate and the
   `awaiting_proposal` stage, and an inquiry that proposes on a task without `your_ok` is reshaped to wait at one
   (`STEP_SCHEMA`, `resolveProposalUpgrade`, `finishInquiry` in `decide/shapes.ts`). Tests: `decide/shapes.test.ts`,
   `domain/steps.test.ts`.
8. **Soft gates name where they escalate**: `escalatesTo` on each soft gate (checks and ci to `failure`, agent_review
   to `review`) in `domain/steps.ts`. Test: `domain/steps.test.ts`.
9. **The plan gate rule is written once**, as data: `PLAN_GATE_RULE`, described by `describePlanGateRule()` (the plan
   step's `when`) and evaluated by `needsPlanApproval` (`decide/lifecycle.ts`). Tests: `domain/steps.test.ts`,
   `decide/lifecycle.test.ts`.
10. **Operations take evidence.** A plan may ask for `evidence` for an operation; one without a code change must
    attach it before `report_outcome` (`evidence_missing`, rule `operation.evidence`, `recordDelivery` in
    `decide/shapes.ts`); `checks` stay for code changes. Tests: `domain/verification.test.ts`,
    `decide/shapes.test.ts`.
11. **Dead combinations are gone.** The gate kind and purpose went with `Gate.type`, and `RunRole` has neither
    `triage` nor `shipper` (`domain/types.ts`). Tests: `domain/tools.test.ts`, `state/`.
12. **A message at a setup gate verifies the setup again** (`verify_setup`: the gate is answered `approve` and the
    message is kept for the first agent; `decide/messages.ts`). Tests: `decide/messages.test.ts`,
    `decide/config.test.ts`.
13. **One result field.** Every inquiry hands over through `task.delivered` into `Task.result` (`recordDelivery` in
    `decide/shapes.ts`). Tests:
    `decide/shapes.test.ts`, `state/`.
14. **The delegated-question ceiling is intended.** A delegated agent's `ask` goes to its parent, which may ask you with
    its own `ask` (`decide/delegations.ts`). Test: `decide/delegations.test.ts`.
15. **Settings and repository fields only you change.** A `settings.change` or `repo.update` on your behalf that
    touches `HUMAN_ONLY_SETTINGS` or `HUMAN_ONLY_REPO_FIELDS` is refused with `human_only` (`decide/settings.ts`);
    agents keep models, providers, fix rounds, attention and compaction. Test: `decide/settings.test.ts`.
