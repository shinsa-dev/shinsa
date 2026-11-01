# The Shinsa protocol

Every object Shinsa keeps, its schema and its name, read from the code (`packages/core/src`), for review. When this
file and the code disagree, the code wins and this file is wrong. Behaviour lives in `docs/engine.md`; this file is the
nouns, the fields and who may send what.

Sections: Glossary · Naming decisions · The task · Rounds · Lifecycle · Projects and handles · Runs, attempts and
roles · Steps and gates · Verification · Composing · Checks · Messages · Commands · Events · Effects · Agent tools · Where it lives ·
Open protocol questions · Settled protocol questions.

## Glossary

One definition per term. **Code** is the name in `packages/core`; **UI** is the word on screen when it differs.

| Term | Definition | Code | UI |
| --- | --- | --- | --- |
| task | The conversation about one goal you asked for, worked in rounds; the only object with a lifecycle. A small task is a task with one round | `Task` | task |
| round | One unit of work inside a task, with its own steps, plan, build, review and pull request; numbered within the task (`SW-14 · Round 3`). One is active at a time | `Round`, `Task.rounds` | round |
| request | What you wrote when you created the task (round 1), or the message that started a later round; the first line becomes the title | `Task.request`, `Round.request` | request |
| shipping | How a round's commits reach GitHub: onto the task's open pull request (the default), or as its own pull request stacked on it | `RoundShipping` (`onto_pull_request`, `stacked`) | "Onto #12", "As a stacked pull request" |
| resting | A task whose last round finished on its own (merged, answered, ran): open, holding no run or gate, and a message starts its next round | `isTaskResting` | Merged, Done |
| closed | A task you (or an agent, once nothing is open) marked done, or cancelled; it takes no message | `isTaskClosed`, `Task.closedAt` | Done, Cancelled |
| project | A named group of repositories and folders with a key and a description; scopes tasks, triage and the focus | `Project` | project |
| repository | A git repository Shinsa registered, inside at most one project | `Repo` | repository |
| handle | A task's name for people, `<project key>-<number>` (`SW-142`), given once, never reused, never a key | `Task.handle` | the handle |
| id | A UUIDv7, the key of everything stored (events, receipts, references, transcripts) | `id` | not shown |
| focus | The one project or team whose work Home, the queue and the guide show, or none for your work | `Focus` | Focus |
| team | People who watch each other's work: a project in a team shows every task in it to every member, live and read-only, without its chat | `RemoteTeam`, `Project.teamIds` | team |
| teammate | Another member of a team you are in, whose team tasks you see read-only | `TeamTask.owner` | teammate |
| run | One agent working one step of a task (or a delegation of it), from start to end | `Run` | a run, "the agent" |
| attempt | One execution of a run; a resume, a retry on another account or a restart is a new attempt | `RunAttempt`, `attemptId` (`<run>:<n>`) | not shown |
| session | The provider's own conversation a run executes in; several runs and attempts can share one | `Run.sessionId` | not shown |
| role | Which agent a run is (the round's agent, a reviewer, an answerer…); picks its prompt, tools, model and where it works | `RunRole` (runs), `AgentRole` (settings), `RUN_AGENT_ROLE` (which settings a run role uses) | Agent, Reviewer… |
| purpose | What one run of the round's agent does: plan, build a phase, fix, run the operation, check a watchdog or read an integration for a watch; picks its instruction, its hand-over and whether it may edit | `RunPurpose`, `Run.purpose`, `PURPOSE_HAND_OVERS` | planning, phase 2 of 3, fixing… |
| step | One fixed building block of a task's path (`answer` … `merge`); a task's pipeline is a list of steps | `PipelineStep` | step |
| pipeline | The ordered steps one task takes | `Task.pipeline` | "the steps a task takes" |
| phase | One part of an approved plan's build, built by its own run of the round's agent, on the session that planned it, and committed on its own | `PlanDocument.phases[i]` (`PlanPhase`), `PhaseProgress` | phase |
| stage | Where a task is right now, one value of 21; each working stage belongs to a step | `TaskStage` | the status line |
| shape | A named pipeline preset (answer, investigate, research, change, fix, operation), or the shape a pipeline reads as | `TaskShape` | kind of task |
| plan | What the round's agent hands over while it plans: goal, phases, approach, files, verification plan, and for an operation its steps and impact | `Plan`, `PlanDocument` | plan |
| operation | One-off work run in the repository (a backfill, a migration, a cleanup) by the round's agent from an approved plan, opening no pull request | step `operate`, purpose `operate` | operation |
| gate | A durable decision record that holds a task until it is decided | `Gate` | the decision ("Review", "Merge"…) |
| hard gate | A gate only you decide (plan, review, merge, question, secret, proposal, operation, failure, setup, sign-in) | `GateType`, `HardGateDefinition` | Needs you |
| soft gate | An automatic check a step must pass (checks, agent review, CI); it passes, fails back to the round's agent, or escalates to the hard gate it names | `SoftGateType`, `SoftGateDefinition` | not a gate on screen |
| decision | Your answer to a hard gate: approve, revise, reject or reply (with words) | `GateDecision` | Approve, Ask for changes, Reject… |
| evidence | A file or link an agent attached to prove something (screenshot, recording, test, check, note, preview), with the width, theme and stage (before or after) it was captured at, or the output of one of Shinsa's check runs (a `check` of no run); a test or check an agent attaches links a check (`checkId`, `shinsa://check/<id>`) | `Evidence`, `EvidenceKind`, `EvidenceTheme`, `EvidenceStage`, `CheckEvidence` | Evidence |
| evidence item | What you review as one piece of evidence: a comparison (one view before and after, or in several states, its parts sharing an `itemId`) or a single piece of its own kind | `EvidenceItem`, `EvidenceItemKind`, `listEvidenceItems` | a comparison, a recording, a screenshot, a test run… |
| evidence key | What an item shows, the same each time it is captured again; a new item with the same key replaces the earlier one, which moves to the earlier versions | `Evidence.key`, `resolveEvidenceKey`, `replacedBy`, `listEarlierEvidenceItems` | "Updated after your review", Earlier versions |
| check | A scoped command that proves part of a change, chosen by the task's agent in its plan and kept current as it builds (or one of the repository's own commands, run once before review); Shinsa runs it and records pass, fail or skipped, with a note when it passed when re-run alone or already fails on the base branch | `PlanCheck`, `TaskCheck`, `ReportCheck`, step `checks` | Checks |
| CI run | One CI check GitHub reports on the pull request | `CiRun`, `CiState` (stored as `PullRequest.checkRuns`, `PullRequest.checks`) | CI |
| check-in | A monitor's next look at what it waits for | `Monitor.nextCheckAt`, `monitor.check_in_now` | "Check in now", "Check-in 2 of 10" |
| setup verification | Shinsa verifying the repository, the default branch and the workspace before a task's first agent | `config.verify`, `VERIFYING_SETUP`, gate type `configuration` | "Setup incomplete", "Verify again" |
| review | Reading a change: the agent review (the reviewer, on its own session, soft gate) or your review (hard gate) | steps `agent_review`, `your_review` | Agent review, Review |
| finding | One problem the reviewer reports at a file and line, ranked blocking, should fix or optional | `ReviewFinding` | finding |
| diagnosis | What an investigation hands over: what it found and why | `report_diagnosis`, `TaskResult` step `investigate` | Diagnosis |
| judgement call | A choice the agent made in a phase, with its reason and the alternatives it rejected | `JudgementCall` | Judgement call, "Judgement calls" |
| disagreement | A judgement call the reviewer would have made differently, with why | `ReviewDisagreement`, `report_review`'s `disagreements`, `Task.reviewDisagreements` | Disputed, "The agent review disagrees" |
| spot | A line range the work report points you at, ranked critical, high or normal; a key piece of code also has a title and an explanation | `CodeSpot` | spot, "Key code" |
| walkthrough | The Agent's technical account of the whole change on its last phase: approach, flow, risks, testing (what the tests cover and a guide to try it by hand) and the steps around the merge; a fix revises the parts it changes | `ReportWalkthrough`, `complete_phase`'s `walkthrough`; `ReportWalkthroughRevision`, `complete_fix`'s | Approach, How it works, Risks and edge cases, How to test, Pre-merge, Post-merge |
| request (an iteration) | Something you sent an agent that its next hand-over answers (changes at a gate, line comments, feedback on a plan, a message to a running or resting agent, a follow-up, a restarted step), with its reply: a headline, each point you raised marked done, answered or not changed with a note, and what you do now. The chat shows it on the hand-over's card and the overview on the card it belongs to, the earlier ones under Earlier requests, so you never read the chat to know what changed | `Iteration` (`Task.iterations`), `IterationRequest`, `AgentReply` (the `reply` of every hand-over that answers one), `ReplyingHandOver`, `ReplyPoint`, `ReplyOutcome`, `iteration.requested`, `iteration.answered` | "Your request", Earlier requests, Done, Answered, Not changed, "What to do now" |
| merge step | Something you must do around the merge that needs a person or production access (a variable or secret to set, a migration or deploy to run, a config or flag to change), before it or after it; you tick each one, and the merge waits for every one before it. Never shipping code: a step that stages, commits, pushes or opens a pull request is refused. Each task the merge waits on (`Task.waitsOn`) shows among them as a linked row you never tick, done once that task finishes | `MergeStep` (`when`, `kind`, `title`, `detail`, `command`), `walkthrough.steps`, `MergeStepView` (a `ChecklistItem` with `round` and `due`), `Task.mergeStepsDone`, `Task.carriedMergeSteps`, `merge_step.tick`, the steps `pre_merge` and `post_merge`, the gate `post_merge` | Pre-merge, Post-merge, "Post-merge · 2 steps left" |
| watchdog | A check the Agent writes in its walkthrough that watches the merged change for a window, with checks that back off, through a data source, from the merge or once the change is live in production; each check is a read of that source scoped to the change, and a report it files is a task forked from this one | `WatchdogSpec` (`walkthrough.watchdogs`), `Watchdog` (`Task.watchdogs`), `WatchdogStatus`, purpose `watch`, stage `watching`, `file_report`, `report_read` | Watchdogs, Watching |
| integration (of a project) | An MCP server from Integrations a project's agents read, with what it holds there and the repositories it covers | `WatchSource` (`Project.watchSources`), `watch_source.write`, `ScheduleSource` (`Schedule.source`) | integration |
| watch | An automation that reads one of its project's integrations on a clock or a webhook and files a task per new report, from a home task no list shows | `Schedule.source`, `Task.watchHome`, `isWatchHome`, purpose `intake` | Watch, Show its reads |
| suggested watch | A watch offered for one click, never running until you accept it: one per integration a project starts using, worded from what it holds, or one an agent asked for; accepting writes it as yours, dismissing keeps it from being offered again | `WatchSuggestion` (`state.watchSuggestions`), `watch_suggestion.record`, `watch_suggestion.accept`, `watch_suggestion.dismiss`, the effect `watch.suggest` | Suggested watch, Add the watch, Dismiss the suggested watch (the cross in Settings), Cancel (the chat card) |
| report | One message or signal in an integration a watch or a watchdog read (a Slack message, a support email, an error) that it filed as a task, kept on that task with its id or link, author, time and text; the filed tasks are what dedupes the next read, a watch's and a watchdog's alike | `SourceReport` (`Task.sourceReport`), purposes `intake` and `watch`, `file_report`, `report_read`, `TaskCreator.kind: 'intake'` or `'watchdog'` | Reported in, Filed by, N tasks filed |
| fork | A task whose Agent starts from a copy of another task's conversation | `Task.forkOf`, `Run.fork` | Fork into a new task, Forked from, Forked into |
| point | Anything the Review tab marks for you to read: a spot, a judgement call, a risk or a finding | `ReviewItem` (web, `lib/review/report.ts`) | point, "Every point" |
| ref | The commit the Code tab reads at: the head of the branch, the base, a commit between them, or the working copy (`working`) while the worktree exists | `TaskRefs`, `WORKING_REF` | "Head of the branch", "Working copy", "Base" |
| line comment | A comment you leave on a line or range of the new or the removed side, sent with Request changes | `ReviewComment` (`gate.answer`'s `comments`), `LineComment` in the web's draft (`lib/review/draft.ts`, adds its id and commit) | Your comments |
| your edits | A file you change in the Code tab: saved to the task's working copy as you type, committed with the round's next commit, and named to the agent's next turn | `FileWrite`, `Task.editedPaths`, `Task.untoldEdits`, `task.record_edit`, `task.edited` | "Edited ‹path›", "Saving…" |
| proposal | An inquiry's request to turn the task into a change or an operation, decided at your OK | `ChangeProposal`, gate type `proposal` | "Your OK", "What it would change" |
| result | What an answer, an investigation, research or an operation hands over (the answer, the diagnosis, the report, the outcome) | `TaskResult` | Answer, Diagnosis, Report, Outcome |
| delegation | Work a running step hands to another agent: a run of the same task with a parent run, never a new task | `RunDelegation` on `Run` | Delegations |
| courier | A new task an agent files for work that belongs elsewhere (`create_task`), such as the part of a change in another repository, optionally making its own task wait on it (`this_task_waits`) or waiting on its own task (`after_this`) | `TaskCreator.kind: 'courier'` | a task, Filed by |
| memory | The rules you keep for every later agent, for every project or one; an agent proposes one with `remember` and only you keep it (`docs/engine.md` → Memory) | `MemoryEntry`, `state.memories`, `MEMORY_LIMITS` | Memory, "rule" |
| feedback | A note on Shinsa itself, from you or an agent, that your agent drafts as a public issue on `shinsa-dev/shinsa` and only you open (`docs/engine.md` → Feedback) | `Feedback`, `state.feedback`, `FEEDBACK_LIMITS`, `FEEDBACK_REPOSITORY` | Feedback, "issue" |
| suggested task | A task an agent proposes (or Shinsa's classifier, for a split-off); it starts nothing until you accept it | `TaskSuggestion` | Suggested tasks |
| follow-up | A message to a finished answer, investigation or report, answered on the same session | message effect `follow_up`, `acceptsFollowUp` | follow-up |
| waits on | The tasks a task waits for before it starts (or before its merge gate opens) | `Task.waitsOn`, stage `waiting_on_tasks` | "Waits on", "Wait for another task" |
| bundle | A line of tasks in one repository, each stacked on the one below: each starts once the one below is ready to merge, branches off its branch and opens its pull request on it, and the root's one merge gate, on the task into the default branch, merges them all once the whole bundle merges cleanly (`docs/engine.md` → Bundles). Never a round stack, which is one task's own rounds | `Task.stacksOn`, `Task.stackBase`, `Task.bundleReady`, `Task.bundleConflict`, `resolveBundle`, `listBundleBelow`, `listBundleAbove`, `decide/bundles.ts` | "Bundle", "Stack on another task", "Take out of the bundle", "Ready, merges with its bundle" |
| backlog | Where work you want planned now and built later waits: a status of a task, never a kind; it is triaged and planned, then its plan waits out of Needs you until you start building it. Only you, or an agent you asked, put work there | `Task.backlog` (`TaskBacklog`), `task.backlog_changed`, `task.move_to_backlog`, `task.remove_from_backlog`, `isHeldInBacklog`, `queue.backlog`, plan gate reason `backlog` | Backlog, "Move to the backlog", "Remove from the backlog", "Start building" |
| All tasks | Every task in to-do order, in status groups (the Backlog one of them), a waiting or stacked task nested under the task it builds on | `resolveTaskGroup`, `TASK_GROUPS` (web) | All tasks |
| schedule (automation) | A trigger (once, interval, daily, webhook) that starts a task, messages one, or watches an integration; on screen a Schedule, a Trigger or a Watch | `Schedule`, `ScheduleSource` | Settings → Automations: Schedule, Trigger, Watch |
| monitor | An agent's armed wait (`wait_for`): its run ends and a fresh one checks in again later | `Monitor` | "Waiting to check in again" |
| usage wait | A step paused until a usage limit resets, then resumed on the same session | `UsageWait` | "Waiting for the usage limit" |
| account | A Claude login a run is leased on | `RunAccount` | account |
| provider sign-in | A provider's own login (Codex), named on a Sign in gate with no account | `ProviderSignIn`, `Gate.provider` | "Paused: ‹email› needs signing in" |
| command | A request to change state; `decide` turns it into events and effects or refuses it | `ShinsaCommand` (`UserCommand`, `AgentCommand`, `SystemCommand`) | not shown |
| event | A past-tense fact; the only way state changes; replayed forever | `ShinsaEvent` | Activity (some of them) |
| effect | Work with I/O that a decision asks for, run from the outbox, reporting back with commands | `ShinsaEffect` | not shown |
| receipt | The stored answer to a command id, so a repeat is answered and never applied twice | `CommandReceipt` (engine) | not shown |
| on your behalf | A user command an agent's management tool sent for you from its task, recorded with the acting task | `onBehalf`, `byTask`, `OnBehalfAction` | "‹handle› agent (on your behalf)" |
| hand-off | A task given to someone by a link: the first GitHub account to open it steers that one task on your machine | `TaskHandoff`, `task.hand_off` | Hand off, "took this task over" |
| guest | The account a task was handed to, and its device, scoped to that task | `TaskGuest`, `GuestActor`, `byGuest`, `role: 'guest'` | "Kai" as a user tag, "A task handed to you by …" |
| message kind | What the classifier read a message to be: feedback on the current round (a follow-up on a finished one), a message that needs nothing (thanks, "ok"), new work for the task (a new round), or work for another task (a split-off) | `MessageKind` (`feedback`, `acknowledge`, `new_round`, `separate_task`) | not shown |
| split-off | A suggested task saying something you asked for in this chat belongs in a task of its own; you make it a task or keep it here, which sends it to this task now | `TaskSuggestion.splitOff` | "Make it a task", "Keep it here" |

### Two names for one thing

| Thing | Names in use |
| --- | --- |
| The kind of task | `TaskShape`, `shape`, `reshape_task`, `task.reshaped`; UI "kind of task"; `mode: 'ask'` for an answer task asked for as one (`tasks create --ask`, a schedule's `just_answer`) |
| Your request | `request` everywhere new; the refusal code for an empty one is still `intent_required` (`decide/tasks.ts`) |
| Waiting on another task | `waitsOn`, `task.wait_on`, `task.waits_on_changed`, stage `waiting_on_tasks`, triage's `waits_on`; the rules in `decide/dependencies.ts` (`resolveDependencies`, `listPendingDependencies`); UI "Waits on" |
| A bundle | `stacksOn` (on `Task`, `task.create`, `task.stack_on`), `stack_on_this` (`create_task`), `task.stack_changed`, `stackBase` and `task.stack_based`, `bundleReady` and `task.bundle_ready`, `bundleConflict`, `bundle.record_check` and `task.bundle_conflict`, `bundle` on `pull_request.merge`, `tasks stack-on` and `tasks unstack`; UI "Bundle", "Stack on another task", "Ready". Never "stack" alone on screen: that is a round stack |
| Snoozing | `Task.snoozed` (`TaskSnooze`), `task.snooze_changed`, `task.snooze`, `task.unsnooze`, `queue.snoozed`, `decide/snooze.ts`, the task group and queue section `snoozed`; UI "Snooze", "Unsnooze", "Snoozed". Never "pause" for it: Paused is a step that stopped for you |
| The backlog | `Task.backlog`, `task.backlog_changed`, `task.move_to_backlog`, `task.remove_from_backlog`, `backlog: true` on `task.create`, `suggestion.accept` and `create_task`; the rules in `domain/backlog.ts` (`canWaitInBacklog`, `resolveBacklogRefusal`) and `decide/backlog.ts`; UI "Backlog" |
| A round that waits to start | `RoundStatus 'waiting'`; event `round.queued`, `Round.queuedAt`, `ROUND_LIMITS.queued` |
| Your OK | step `your_ok`; gate type `proposal`; stage `awaiting_proposal`; `ChangeProposal`, `task.change_proposed|approved|declined`, `propose_change`; UI "Your OK", "Change to approve" (also for an operation), "Make it a change" |
| Ask for changes | decision `revise`; UI "Ask for changes", "Request changes"; CLI `plans revise`, `reviews revise`; message effects `revise_plan`, `request_changes`, `send_back` |
| Answered | stage `answered`; gate type `result` ("Read the answer", "Read the report", "Read the diagnosis"), opened by an answer, research or investigation that hands over with nothing after it; its approve is Close (`closeResult`), which settles the task as done; UI "Answered", "Close". Never "done" for it: done means you have read it |
| Answering a question | decision `reply`, command `gate.answer` (which takes every decision), CLI `questions answer`; a parent answering its delegation: `delegation_answer`, `agent.answer_delegation` |
| CI on the pull request | `CiRun`, `CiState`; stored on `PullRequest` as `checkRuns` and `checks` |
| The classifier | agent role `classifier`, command and effect `task.triage`, stage `triage`; UI "Quick jobs" |

### One name for two things

| Name | Meanings |
| --- | --- |
| round | a task's round (`Round`); a fix round (`fixRounds`, "Fix round 2"); a review round (`MAX_REVIEW_ROUNDS`) |
| step | a pipeline step (`PipelineStep`); an operation's numbered steps (`PlanDocument.operation`); a step around the merge (`MergeStep`, `walkthrough.steps`), which you do, not an agent |
| check | a task's check (`checks` step, `TaskCheck`, `ReportCheck`), the agent's or the repository's; CI on the pull request as stored (`PullRequest.checks`, `checkRuns`); the evidence kind `check` |
| wait | a monitor (`wait_for`); a usage wait; a run waiting on its delegations (`RunStatus 'waiting'`, `RunWait`); a task waiting on other tasks (`waiting_on_tasks`); a round waiting to start (`RoundStatus 'waiting'`) |
| queued | the status of a run created but not yet dispatched; GitHub's merge queue; a round waiting to start, in the event `round.queued` |
| answer | the step, the tool and the result step `answer`; the command `gate.answer`, which takes every decision (the words-taking one is `reply`); CLI `questions answer`; the delegation tool `delegation_answer` |
| decision | `GateDecision` (any answer to a hard gate); `isDecisionGate` (only plan, review and merge); `Task.triageDecisions` (triage's choices); "decisions" in Needs you |
| change | the change shape; the proposal (`ChangeProposal`, `task.change_*`, `propose_change`, "Change to approve", even when it proposes an operation); "Changes to review" |
| fix | the fix shape (investigate, then a change); an agent run with purpose `fix`; a fix round; the review verdict `fix` |
| review | the agent review; your review; the gate type `review`; the Code tab's review view |
| spec | a command-surface spec (`apps/engine/src/surface`, `humanOnly`) |

## Naming decisions

All twenty are decided and in the code. Shinsa has never shipped, so nothing reads the old names: every event,
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
10. **Checks are the task's** (since 2026-10-27): the plan's `verification` is `PlanCheck[]`, the task keeps
    `TaskCheck`s (`Task.checks`, ids `c1`…, source `plan` or `agent`) and the repository's `checkCommands` are the
    baseline `r1`… (source `repo`); a result is `ReportCheck` with `id`, `label` and `command` (no `name`), changes are
    `CheckChange` (`checks.changed`) and the tool field is `check_changes`. CI is `CiRun`, `CiState` (the stored
    `PullRequest.checks` and `checkRuns` keep their names); a monitor's look is a check-in (`monitor.check_in_now`,
    `tasks check-in-now`); the setup check is setup verification (`VERIFYING_SETUP`, "Verify again").
11. **Waits on**: `waitsOn`, `task.wait_on`, `task.waits_on_changed`, triage's `waits_on`, `releaseWaiting`, stage
    `waiting_on_tasks`, `RoundStatus 'waiting'`, `tasks wait-on` and `tasks stop-waiting`.
12. **One role list**: `RunRole` has no `triage` and no `shipper`; `RUN_AGENT_ROLE` is the one table. A round has one
    agent (`agent`, "Agent"), whose runs differ by `purpose`; there is no `fixer` or `operator` role, and `planner`
    and `builder` name delegated agents only (`docs/engine.md` → Agents).
13. **Judgement calls**: `JudgementCall { title, call, reason, file, line, end?, alternatives? }`, `judgementCalls`,
    `complete_phase` `judgement_calls`; a decision is only your answer at a gate.
14. **Reply**: `GateDecision` is `approve | revise | reject | reply`; the command stays `gate.answer`.
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
20. **Backlog, never roadmap** (since 2026-10-30): planned work you start later is the backlog (`Task.backlog`,
    `task.backlog_changed`, `task.move_to_backlog`, `task.remove_from_backlog`, `tasks move-to-backlog`, `tasks
    remove-from-backlog`, `--backlog`); the list of every task is All tasks, its groups `TaskGroup` (`resolveTaskGroup`,
    `TASK_GROUPS`, `components/tasks/`, the disclosure scope `tasks:group:`). "Roadmap" names nothing, in code, tools,
    the command line or on screen.

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
| `origin` | string \| null | the folder `shinsa do` or `shinsa import` ran in, a hint for triage; `onboarding` for the welcome task setup records |
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
| `triageDecisions?` | `{ shape, start, priority }` each `{ value, why }` \| null, and `duplicate?` `{ unreached }` | triage's choice and why, per Auto part; `duplicate.unreached` lists the team machines (`UnreachedTeammate`: `{ teamId, machineId, name, owner }`, `owner` a `TeammateOwner` `{ login, name, avatarUrl }` or null) whose tasks the team-wide duplicate check could not read |
| `shapeChanges?` | `ShapeChange[]` (last 20) | each pipeline change: from, to, by (`you`, `agent`, `shinsa`), reason |
| `proposal?` | `ChangeProposal` \| null | an inquiry's proposal: request, why, status (`open`, `accepted`, `declined`) |
| `planFirst` | boolean | plan first: the plan always waits at a gate |
| `backlog?` | `{ at }` \| null | in the backlog since `at`: its plan gate opens and is held out of Needs you until you start it |
| `share?` | `TaskShare` \| null | shared by link since `at`: `url` once the engine made the link (null while `share.link` runs), which holds the share id and, in its fragment, the key; `limit` how long (`ShareLimit`: `until_done`, `hour`, `day`, `week`, `none`), `preset` what it shows (`SharePreset`: `status`, `standard`, `full`, each a list of `ShareGroup`s in `SHARE_PRESET_GROUPS`) and `endsAt` when a time limit runs out (null otherwise); `failure` the reason the link could not be made, cleared once it is; `description` the summary the writer wrote of what the task addresses when sharing started (`share.describe`) (`docs/engine.md` → Sharing a task) |
| `previews?` | `PreviewShare[]` | the task's service runs shared by link, one per `serviceId`: `at`, `url` (`https://<label>.shinsa.page/?key=<key>` once the engine made it, null while `preview.link` runs), `limit` and `endsAt` as on `share`, `failure` the reason the link could not be made (`docs/engine.md` → Sharing a preview) |
| `handoff?` | `TaskHandoff` \| null | handed off by a link since `at`: `url` once the engine made the link (null while `handoff.link` runs and once someone claimed it), `failure` the reason the link could not be made, `guest` the account that took it over (`TaskGuest`: `id`, `login`, `name`, `avatarUrl`) and `claimedAt` when (`docs/engine.md` → Handing off a task) |

**Lifecycle and scheduling**

| Field | Type | Meaning |
| --- | --- | --- |
| `stage` | `TaskStage` | where it is (Lifecycle, below) |
| `stageReason` | string | a few lower-case words: "waiting for CI" |
| `cancelledFrom?` | `TaskStage` \| null | the stage a cancelled task was in, so its progress shows the step it stopped at |
| `duplicate?` | `{ of, by, why, teammate? }` \| null | closed as a duplicate of task `of`, by `you` or by triage (`shinsa`), with triage's reason; the stage stays `cancelled` and the page shows Duplicate. `teammate` (`TeammateOriginal`: `{ teamId, machineId, taskId, handle, title, owner }`, `owner` a `TeammateOwner` `{ login, name, avatarUrl }` or null) when the original is a teammate's task, `of` then holding its id on their machine. A shared task and a team listing carry `duplicate` with the status fields, so the original's owner sees what was kept over it |
| `priority` | `urgent` \| `high` \| `normal` \| `low` | how high its decisions sit in Needs you; never what runs |
| `waitsOn` | string[] | task ids it waits on |
| `stacksOn?` | string \| null | the task it stacks on as a bundle (Bundles in `docs/engine.md`) |
| `stackBase?` | string \| null | the branch of the task below, recorded once that task is ready; `resolveRoundBase` returns it when no round of its own is stacked |
| `bundleReady?` | `{ commit }` \| null | ready to merge with its bundle at head `commit`; a task stacked on another has it in place of a merge gate of its own |
| `bundleConflict?` | `{ taskId, behindTaskId, base }` \| null | on a bundle's root: the task that conflicts with the default branch once the bundle merges, and the lowest task behind its base, updated first (null when none is) |
| `note` | string \| null | the latest `note` an agent kept |
| `activity` | `Activity[]` | what happened, newest last (each with an `ActivityKind`: `check` for check results and the agent's check changes); a gate's entry names its `gateType`, and a decision sent with line comments keeps them (`comments`); a message of yours that needed nothing is `noted`, and one dropped from the inbox keeps its `undelivered` text and reason |

**Plan and build**

| Field | Type | Meaning |
| --- | --- | --- |
| `plan` | `Plan` \| null | the current plan: version, body, document, change summary, changes, feedback, `approvedAt` |
| `planHistory?` | `PlanRevision[]` (last 10) | earlier versions |
| `planAnswers` | string \| null | your words when you approved the plan, for the agent as it builds |
| `phases` | `PhaseProgress[]` | per plan phase: `pending`, `active`, `done`, `skipped` |
| `phaseReports` | `PhaseReport[]` | per finished phase: summary, code spots, judgement calls (`judgementCalls`), the last phase's `walkthrough?`, and `files?`: the files the phase's commit changed (absent when it changed none), which decide the checks a later fix runs again |
| `summary` | string \| null | the work's summary |
| `report` | `WorkReport` \| null | the review built from every phase: headline, sections, the check results, judgement calls, `walkthrough?` |
| `mergeStepsDone?` | string[] | the steps around the merge you ticked, by key (`resolveMergeStepKey`: `when:` and a hash of the step's kind, title, detail and command, so any change to a step clears its tick); the steps themselves are the latest walkthrough's `steps` (`listMergeSteps`); a new round starts it empty |
| `carriedMergeSteps?` | `CarriedMergeStep[]` (`MergeStep` with `round`, `done`) | the open steps a new round carried over from the round before it: every step after the merge, and the steps before the merge of a round still shipping onto the next one's pull request; ticks of a carried step land here; done ones are dropped at the next round |
| `worktreePath` | string \| null | the task's worktree; for a main-checkout task, the repository itself |
| `workspace?` | `WorkspaceMode` | where the task works, taken from its repository when it set up (`worktree.requested`) and kept |
| `returnBranch?` | string | main checkout: the branch the checkout was on when the task took it, where it goes back when the task settles |
| `editedPaths?` | string[] | files you changed in the Code tab that no commit has taken yet (`task.edited`; cleared by `work.committed` and `task.edits_committed`) |
| `approvedEdits?` | `review` \| `merge` \| null | you approved that gate while `editedPaths` had files: every check runs before the push (`review`), or CI before the merge (`merge`); `task.edits_approved`, dropped by a real fix turn |
| `approveAfterFix?` | boolean | you asked for changes with Fix N findings and approve (`gate.answered` with `thenApprove`): the next review gate that opens without an escalation is approved at once (`ahead`); written by every review answer, false in a new round |
| `untoldEdits?` | string[] | those of them no agent has been told about; the next run's prompt names them (`task.edits_told`) |
| `untoldMessages?` | `UntoldMessage[]` (`at`, `text`, `sender`: `agent` \| `schedule`) | messages sent for you while a gate was open (`task.messaged` with `kept`), not yet told; the next run of the task's session is told them (`task.messages_told`) |
| `overlaps?` | `TaskOverlap[]` (`taskId`, `paths`, `untold`) | per other open task of the repository, the files both change (`task.overlapped`), and those the Agent has not been told yet; its next run's prompt names them (`task.overlaps_told`) |
| `treeHash?` | string \| null | the tree of the last commit Shinsa made |

**Checks, review and fixes**

| Field | Type | Meaning |
| --- | --- | --- |
| `checks?` | `TaskCheck[]` | the task's checks: the plan's (`plan.proposed`, ids `c1`…, source `plan`) and the agent's changes (`checks.changed`, source `agent`); the repository's commands are not stored here (`listRepoChecks`, `listTaskChecks`); a new round starts from its plan |
| `runningChecks?` | `string[]` | the ids of the checks the current run holds (`checks.started`); empty once its result is recorded or the stage leaves `checking` |
| `checkResults` | `ReportCheck[]` \| null | the latest result of each check, by id (`checks.recorded` merges; a changed or removed check loses its result) |
| `coverage?` | `Coverage` \| null | the coverage of the task's changed lines by the tests among its checks, measured once before review (`checks.recorded`); kept until the next measurement, cleared by a new round |
| `reviewSummary` | string \| null | the last agent review's summary: what the reviewer checked and its view of the change |
| `findings` | `ReviewFinding[]` | the last agent review's findings, each with an optional `title` and `fix` |
| `reviewDisagreements?` | `ReviewDisagreement[]` | the judgement calls the last agent review would have made differently: the call's text and why |
| `dismissedFindings?` | `ReviewFinding[]` (last 30) | findings you dismissed, never reported again |
| `fixRounds` | number | automatic fix rounds used |
| `fixFor` | `checks` \| `review` \| `you` \| `pull_request` \| `conflict` \| `update` \| `hook` \| null | what the current fix is for (`conflict`: the pull request conflicts with its base, read by the pull request watch; `update`: conflicts while updating the branch onto its base before a push; `hook`: the repository's pre-push hook rejected the push) |
| `fixSignature`, `stalledFixes`, `fixFingerprints?` | | repeat detection: the same failures after the same tree |
| `recoveries`, `recoveryFingerprint?` | number, string | the recovery budget and the durable state it is keyed to |
| `iterations?` | `Iteration[]` | every request you sent after the work was in, with its reply, oldest first; kept across rounds, each with its `round` (not archived by a new round): `id`, `round`, `requests` (`text`, `comments`: the line comments sent with it, `at`), `reply` (`AgentReply` \| null while open), `runId` and `repliedAt` of the run whose hand-over answered it. At most one is open, the last (`selectOpenIteration`) |

**Pull request**

| Field | Type | Meaning |
| --- | --- | --- |
| `pullRequest` | `PullRequest` \| null | number, url, state, CI (`checks: CiState`, `checkRuns: CiRun[]`), comments, mergeable, head, merge queue, merge commit, `changes` (`PullRequestChanges`: additions, deletions, changedFiles, from `gh pr view`; null when GitHub gives none) |
| `pullRequestWatch?` | `PullRequestWatch` \| null | the watch's memory: per-check states, comment watermark, conflict, stop reason, and whether no checks on this head means it has no CI (`ciAbsent`) |
| `pullRequestReadFailures?` | number | failed reads in a row (stops at 8) |
| `pushedSha?`, `pushedAt?`, `pushedFrom?`, `pushPending?` | | the push Shinsa made (or the head someone else pushed), when, and whether GitHub has shown it; the wait for CI to start counts from `pushedAt` |
| `pushHookFailure?` | `PushHookFailure` \| null | the last pre-push hook rejection: its output tail, the failures read from it (null when unreadable) and their identity (`signature`); cleared by a push that gets through and by a new round |

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
| `configProblems?` | `ConfigProblem[]` | the problems setup verification found, each a `kind` (`repository`, `no_repository`, `default_branch` or `workspace`) and a `detail`; the checks are never one (`docs/engine.md` → Setup verification) |

**Agents and other tasks**

| Field | Type | Meaning |
| --- | --- | --- |
| `suggestions?` | `TaskSuggestion[]` | tasks agents suggested |
| `parentTaskId?` | string \| null | the task whose agent filed this one |
| `createdBy?` | `TaskCreator` \| null | `courier` (`create_task`), `split` (`split_task`), `watchdog` (`file_report` in a watchdog check) or `intake` (`file_report` in a watch's read), with the task, the run and request key |
| `forkOf?` | string \| null | the task this one was forked from: its first Agent run forks that task's session (`docs/engine.md` → Forking a task) |
| `watchdogs?` | `Watchdog[]` | the watchdogs of its merged rounds: `id`, `round`, `title`, `check`, `source` or `sourceRequest`, `firstCheckMinutes`, `maxGapMinutes`, `forMinutes`, `startsOn` (`merge` or `production`) and its `productionCheck`, `status` (`needs_source`, `awaiting_production`, `watching`, `passed`, `tripped`, `stopped`), `armedAt`, `awaitingSince` (when it began waiting for production), `startedAt`, `endsAt`, `nextCheckAt`, the `runId` of a check running now, the last 20 `checks` (`at`, `healthy`, `summary`), the `forkTaskIds` its checks filed (forks of this task), the `linkedTaskIds` they found already filed by a watch or another watchdog, `endedAt` (`docs/engine.md` → Watchdogs) |
| `splits?` | `TaskSplit[]` | tasks `split_task` made, once per plan version (`planVersion`); each of them shows Split from |
| `scheduleId?` | string \| null | the schedule that started it, or whose read filed it |
| `watchHome?` | boolean | the home a watch reads in: no handle, no triage, on no list, takes no messages (`docs/engine.md` → Schedules and webhooks) |
| `slack?` | `SlackThreadLink` \| null | the Slack thread it was started from: `teamId`, `channelId`, `threadTs`, the author's `userId`, the mention's `messageTs`, the `permalink`, `statusTs`, the status message edited in place, and `reaction`, the one reaction on the mention (`docs/engine.md` → Slack) |
| `sourceReport?` | `SourceReport` \| null | the report it was filed from: `scheduleId` (a watch's) or `watchdogId` (a watchdog's; the other is null), `server`, `reportId`, `link` (one of the two is set), `author`, `postedAt`, `text` (`docs/engine.md` → Schedules and webhooks) |

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
  changes?: PullRequestChanges | null;
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
| `pullRequest` | the pull request its commits went to, with its `changes` (lines added and removed, files changed) once read; the Stats tab counts them for merged rounds |
| `outcome` | what it kept when it ended: plan goal, phase titles, the work's headline, the result |

`Run.round`, `Gate.round`, `Evidence.round` and `Activity.round` name the round a step, a gate, a piece of evidence or an
activity entry belongs to; they are set only from round 2 on, so a missing one is round 1.

## Lifecycle

Settled stages are `merged`, `done`, `cancelled` (`isTaskSettled`). A gate stage holds a hard gate; a working stage
holds an active run; Shinsa's own stages hold an effect.

| Stage | Step | Who moves it | Leaves for |
| --- | --- | --- | --- |
| `triage` | none | Shinsa: classify, setup verification, worktree | `waiting_on_tasks`, the first step, or a setup gate (stays `triage`) |
| `waiting_on_tasks` | none | Shinsa, when every task it waits on is answered, merged or done (`isTaskComplete`) | `triage` (worktree), then the first step |
| `answering` | answer | answerer | `answered`, `awaiting_proposal`; `done` (a follow-up on merged or finished work) |
| `researching` | research | researcher | `answered`, `awaiting_proposal` |
| `investigating` | investigate | investigator | `answered`, `awaiting_proposal`, `triage` (the worktree reset, fix shape) then `planning` |
| `answered` | answer, research or investigate | you, at the result gate | `done` (Close, or marked done), the inquiry again (message), the next round (new work closes it first) |
| `awaiting_proposal` | your OK | you | `triage` (setup verified again) then `planning`; `done` (reject); the inquiry again (message) |
| `planning` | plan | the agent, read-only (`purpose: plan`) | `awaiting_plan`, `building`, `operating` |
| `awaiting_plan` | plan | you | `building`, `operating`, `planning` (revise), `cancelled` |
| `operating` | operate | the agent (`purpose: operate`) | `done`, `building` (operation before the build) |
| `watching` | merge | the agent, read-only (`purpose: watch`), checking a watchdog of the merged change; or (`purpose: intake`) a watch's read, in its home | `merged`, `done` |
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
`task.complete` settle from anywhere open, and so does `task.mark_duplicate`, a cancel that records the task it
duplicates (`task.duplicated`, then `cancelled`).

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
| `watchSources?` | `WatchSource[]` | at most 20 integrations its agents read: `server` (an MCP server), `data`, `repoIds` (none for every repository), `addedBy` (`you` or `agent`), `addedAt`; kept by `project.write` |
| `teamIds?` | string[] | the teams that see every task of the project (`docs/engine.md` → Teams); written only by `project.add_to_team` and `project.remove_from_team`, kept by `project.write`; absent for none |

| `Repo` field | Type | Meaning |
| --- | --- | --- |
| `id`, `name`, `path` | string | |
| `defaultBranch` | string | |
| `remote` | string \| null | `origin`'s URL |
| `projectId` | string \| null | its project |
| `checkCommands` | string[] | the repository's own commands, an optional baseline every task runs once before review (`r1`…); empty runs nothing extra; only you change it |
| `workspace?` | `WorkspaceMode` | where agents work: `worktrees` (the default) or `main_checkout`; only you change it (`docs/engine.md` → Where agents work) |
| `coverage?` | `CoverageSetting` | how test coverage is measured from the tests among a task's checks: `{ mode: 'auto' }` (the default, absent), `{ mode: 'off' }` or `{ mode: 'custom', command, report, format }` (`report` a path inside the repository, `format` `lcov` \| `cobertura` \| `go` or null to read it from the report's name, `resolveCoverageFormat`); only you change it (`docs/engine.md` → Test coverage of the change) |

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
- **Focus**: `{ projectId, teamId, until }`, a project or a team, never both (`focus_refused`); `until` ends it at a time.

## Runs, attempts and roles

| `Run` field | Type | Meaning |
| --- | --- | --- |
| `id`, `taskId`, `role` | | |
| `status?` | `queued` \| `running` \| `waiting` | `waiting`: its turn ended while its delegations work |
| `purpose?` | `plan` \| `build` \| `fix` \| `operate` \| `watch` \| `intake` | set on every run of the round's agent (`agent`) and no other: what this run does, which hand-over it may call (`PURPOSE_HAND_OVERS`) and whether it may edit (`plan`, `watch` and `intake` are read-only, `isReadOnlyRun`) |
| `phaseIndex?` | number \| null | the plan phase a build run builds |
| `prompt?`, `rolePrompt?`, `resume?` | | the brief; the brief before Shinsa appended the project and any adoption note, or before it put the round brief in front of an agent run that has no session to resume (its short instruction), which a recovery or a usage resume starts from; whether it resumes an earlier session. `resolveRunBrief(state, run)` gives the full brief of a resumed agent run for a session that cannot hold the round. Neither prompt goes to the page (The socket) |
| `provider`, `model` | string, string \| null | where it started |
| `sessionId`, `sessionProvider?`, `sessionLost?` | | the provider session, who owns it, whether it is gone |
| `startedAt`, `endedAt`, `outcome`, `summary` | | `completed`, `failed`, `cancelled` |
| `attemptId?`, `attempts?` | | the current attempt and every attempt |
| `failure?` | `RunFailure` | class (13), message, code, retryable, `resetAt`, `account` (a Claude account), `login` (a provider's own sign-in: `{ provider, email }`) |
| `resumePending?`, `continuations?` | | restart continuation and its loop guard |
| `monitorId?`, `usageWaitId?` | | the wait it was woken from |
| `cacheExpiresAt?` | number | when the prompt cache the run last wrote expires |
| `continues?` | | the run whose step it carries on (a recovery nudge, a `wait_for` wake-up, a usage-limit resume); such a run never folds the turns before it |
| `feedback?` | string \| null | your words it carries |
| `usage?`, `meters?` | | tokens and cost; per attempt (`RunMeter`), its window (`account:<id>` or `provider:<id>`), time span, usage and the weekly readings taken at its start and end, which teach its window's rate; its share of the weekly window is its cost at that rate (`resolveUsageShares`) |
| `silence?` | `RunSilence` | the quiet-run mark, snooze and dismissal |
| `account?` | `RunAccount` | the account this run is bound to |
| `delegation?`, `cohort?`, `waitingOn?` | | set on a delegated run; its parent's delivery state and what it waits on |
| `compactions?` | string[] | sessions compacted while idle |
| `fork?` | `RunFork` \| null | a forked task's first session: the source task's run and session to copy (`taskId`, `runId`, `sessionId`); the run starts with `resume: false` and `sessionId: null` until the copy reports its own id |
| `round?` | number | the round it works for (Rounds, above) |

`RunAttempt`: `attemptId`, `provider`, `model`, `resumed`, `handoff` (`provider_switch`, `session_restore` or `fork`,
entry counts), `startedAt`, `account`, `cwd` (the directory the attempt ran in: a resumed turn in another directory than
the session's last one is told where it works now, `resolveMovedNote`).

Which agent role's settings (provider, model, speed) each run role uses is one table, `RUN_AGENT_ROLE`
(`packages/core/src/agent-models/index.ts`):

| Run role | Settings role (`RUN_AGENT_ROLE`) | Read-only | Works in | Hands over with |
| --- | --- | --- | --- | --- |
| `agent` | agent | while it plans (`purpose: plan`) | worktree | by purpose: `propose_plan` or `reshape_task` (plan), `complete_phase` (build), `complete_fix` (fix), `report_outcome` (operate), `report_read` after any `file_report` (watch and intake, read-only, in the repository) |
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
| `answer` | inquiry | answerer | the answer (`answer`) | hard: `result`, when it hands over and nothing follows it | | no | answering |
| `research` | inquiry | researcher | the report (`submit_report`) | hard: `result`, likewise | | no | researching |
| `investigate` | inquiry | investigator | the diagnosis (`report_diagnosis`), evidence | hard: `result`, likewise | | yes | investigating |
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

An inquiry's own gate is `result`, which opens only when nothing follows it (stage `answered`, until you close it); a proposal goes to `your_ok`. An inquiry that proposes a change on a task without
`your_ok` is reshaped by the agent to `[inquiry, your_ok, plan, build, checks, agent_review, your_review,
pull_request, merge]` (`resolveProposalUpgrade`) and waits at `your_ok`, so a proposal and a composed OK take one path.

**The plan gate rule** is data, `PLAN_GATE_RULE` (`domain/steps.ts`): `always` when the task operates, was created
plan first, is in the backlog or the plan asks for approval (`operates`, `plan_first`, `backlog`, `asks_approval`); with Approve plans
(`approvePlans`, a `PlanApproval`: `when_asked`, `large`, `always`) on Large plans, also when the plan has more than 3
phases or 6 files or is a revision (`withLargePlans`: `large`, `revised`; the limits are `PLAN_SIZE_LIMITS`, counted on
the plan document, never the triage size); on Always, every plan. `describePlanGateRule()` writes
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
| `plan` | Plan to approve | the plan, its version and changes, the operation and impact | approve (records the version, starts work) · revise · reject (cancels) | "Approve, ask for changes or reject." | no |
| `review` | Review | the report, the diff by risk, evidence and checks, findings | approve (push, open the pull request) · revise (the agent) · reject | same | no |
| `merge` | Merge | the final diff, CI and bots, what changed since review | approve (merge) · revise (the agent) · reject | same | no |
| `question` | Question | the question, context, choices, recommendation | reply | "Answer the question." | no |
| `secret` | Secret | what it is for, why | reply (a secret ref only) · reject | "Paste the secret into the secret field." | no |
| `proposal` | Your OK | the answer, report or diagnosis, the proposal and why | approve (setup verified again, then planned) · reject (keeps the inquiry, finishes) | "Approve the proposal or keep the task." | no |
| `operation` | Run the operation | the merged commit and pull request, the steps, the impact, your notes | approve (runs with the notes on the gate) · reply (replaces the notes with your words, then runs; empty clears them) · reject (finishes without it) | "Run the operation or finish without it." | no |
| `failure` | Paused | what stopped, why, what Retry does | approve (retry) · reply (retry with guidance) · reject (cancel) | "Retry or cancel the task." | yes |
| `configuration` | Setup incomplete | each setup problem and its fix | approve (verifies the setup again) · reject | "Verify the setup again, or cancel." | yes |
| `sign_in` | Sign in | the provider and the account | approve (retry) · reply (retry with guidance) · reject (cancel) | "Sign in, retry or cancel the task." | yes |
| `post_merge` | Post-merge | each step left for you after the merge, which are ticked | none: ticking the last step withdraws it (`merge_step.tick`), unticking one opens it again | "Tick each step under Post-merge once you did it; the gate closes with the last one." | no |
| `result` | Answered (titled "Read the answer", "Read the report" or "Read the diagnosis") | the answer, report or diagnosis | approve (Close: settles the task as done, still open to follow-ups) | "Close the task once you have read the result." | no |

`reply` needs words, except at the operation gate, where empty words clear the notes.

Soft gates, decided by Shinsa or the reviewer:

| Type | Decided by | Pass | Fail | Escalate (`escalatesTo`) |
| --- | --- | --- | --- | --- |
| `checks` | Shinsa | the next phase, or the agent review after the last | the agent with the output of the checks the change broke, then those checks again | `failure` (out of rounds or stalled) |
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
| `cause?` | `budget` \| `monitor` \| `push_hook` | why a failure gate opened, when not plain recovery; `push_hook` is the same pre-push hook failure after a fix round, whose approve (Send to the agent again) starts another fix round |
| `escalation?` | reason (`rounds`, `stalled`, `exhausted`), rounds | an escalated review |
| `verdicts?` | `{ index, verdict: fix \| dismiss, note }[]` | your per-finding decisions |
| `supersededBy?` | string \| null | the message that withdrew a question |
| `provider?` | string | the provider a Sign in gate is for, set on every one (`claude` for a Claude account) |
| `account?` | `RunAccount` \| null | the Claude account a Sign in gate names, or null for a provider with its own login |
| `secret?` | `{ label }` | what a secret gate asks for |
| `commit?` | string \| null | the merged commit an operation gate shows; on a merge gate, the head it was opened for, which approving merges and nothing newer |
| `notes?` | string \| null | the notes for the operation, kept only here: a message at the operation gate replaces them (`gate.noted`, null clears them), `reply` replaces them with its words, and the agent runs the operation with them |
| `round?` | number | the round it belongs to (Rounds, above) |

## Verification

`VERIFICATION_RULES` (`domain/verification.ts`) apply exactly when a composition contains work of their class and
the rule's scope holds (`always`; `alone`: no `build`; `with_code`: with `build`; `post_merge`).

| Rule | Class | Scope | Checked by | Requirement |
| --- | --- | --- | --- | --- |
| `code.verification_plan` | code | `always` | `propose_plan` | the plan names the checks that prove the change (`verification`: each a label, its scoped command and the phases it covers) |
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
rules + "a plan without `build` has no `verification`", and `validatePlanHandOver` refuses a whole-suite command
(`isWholeSuiteCommand`, `describeWholeSuiteRefusal`). A plan may ask for `evidence` for an operation as for a code
change.
`listMissingEvidence` names the kinds still missing.

## Composing

The agent composes steps and sets plan parameters while it plans; it cannot add a step kind or a gate.

- **Steps**: `reshape_task` with `shape` (answer, investigate, research) or `steps` (an enum of `PIPELINE_ORDER`),
  before it plans, once per task, never for a kind you chose. A refusal is `pipeline_invalid` with every problem;
  the run carries on.
- **Plan parameters** in `propose_plan` (`PlanDocument`): `verification` (the checks, required for code, none
  without it; Checks, below), `evidence` (`screenshot`, `recording`, `test`, `note`, `preview`; for a code change or an
  operation), `impact` (required for an operation), `operation` (its steps, required with code), `approval` (asks for
  the plan gate), `title` (a new title, only when the work moved away from the task's, such as a question that became
  a change; the plan gate shows it and the round takes it once the plan is accepted, `task.retitled`). A refusal is
  `plan_invalid`.
- **Checks later**: `check_changes` on `complete_phase` and `complete_fix` (Checks, below).
- The only hard gates an agent can add: your OK (`your_ok`, after an inquiry) and plan approval (`approval`).

Examples:

| Request | Steps | What applies |
| --- | --- | --- |
| A question | `answer` | no class with rules: no plan, checks, review or pull request |
| A fix | `investigate`, `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge` | every code rule; the worktree is reset before the plan |
| A change, then an operation | `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge`, `operate` | code rules, `operation.impact`, `operation.steps`, the plan gate, the operation gate after the merge |
| An operation alone | `plan`, `operate` | `operation.impact`, `operation.evidence`, the plan gate |
| Investigate, your OK, then a change | `investigate`, `your_ok`, `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge` | your OK first; leaving out `your_ok`, `checks` or `agent_review` is refused with the rule's message |

## Checks

The agent chooses a task's checks and Shinsa runs them (`docs/engine.md` → Checks). Types in
`packages/core/src/report/types.ts` and `domain/types.ts`, rules in `domain/checks.ts` and `decide/checks.ts`.

| Object | Fields | Meaning |
| --- | --- | --- |
| `PlanCheck` | `label` (60), `command` (200), `phases` (1-based, at least one) | one check in the plan's `verification`, at most 12 (`PROTOCOL_LIMITS.checks`, `checkLabel`, `checkCommand`); never a whole-suite command (`isWholeSuiteCommand`) |
| `TaskCheck` | `PlanCheck` + `id`, `source` (`plan` \| `agent` \| `repo`) | a check of the task: `c1`… from the plan or the agent (`Task.checks`), `r1`… for the repository's `checkCommands` (derived by `listRepoChecks`, `phases: []`, never stored) |
| `ReportCheck` | `id`, `label`, `command`, `outcome` (`pass` \| `fail` \| `skipped`), `detail` (string \| null), `note?` | one check's result; `note` is `CheckNote`: `passed_alone` (passed when its failing test files were re-run alone) or `fails_on_base` (every failure it names, each failing test or error compared by its identity without line numbers, fails on the base commit too, so not blocking; with new ones it blocks and its `detail` starts with them); `isBlockingCheck` is a `fail` without `fails_on_base` |
| `CheckChangeHandOver` | `action` (`add` \| `change` \| `remove`), `id`, `label`, `command`, `phases` (each null when not given), `reason` (200) | one entry of `check_changes`, at most 6 (`checkChanges`); `add` needs a label and a command and covers the current phase onward unless it names phases; `id` (12, `checkId`) names the check to change or remove |
| `CheckChange` | `action`, `check` (the `TaskCheck` after the change), `reason` | what `checks.changed` records |
| `CheckToRun` | `id`, `label`, `command` | one check in a `checks.run` effect |
| `CheckEvidence` | `checkId`, `title`, `uri` | the stored output of one check run, which `checks.record` attaches as Shinsa's own `check` evidence |
| `Evidence.checkId?` | string | the check a piece of evidence is the output of (Shinsa's, `runId: null`) or links to (an agent's `test` or `check`, `uri` `shinsa://check/<id>`) |

Refusals of a check change: `check_unknown` (an id the task does not have), `check_exists` (an `add` whose command the
task already has), `check_phases_invalid` (a phase the plan does not have), `check_human_only` (a repository check,
`r*`). A linked test or check with an unknown id is refused with `check_unknown` too.

## Messages

`task.message` never approves a plan, a review, a merge, your OK or an operation. `resolveMessageEffect`
(`decide/messages.ts`) says what it does; `decide` delivers by it and every composer's hint reads it
(`apps/web/src/lib/tasks/messages.ts`). The table is in `docs/engine.md` → Gates → What a message does. Values
(`MessageEffect`): `steer`, `wake`, `retry` (a failure or Sign in gate: answered `reply` with your words),
`verify_setup` (a setup gate: verified again with `approve`, the message kept for the first agent),
`supersede_question`, `revise_plan`, `request_changes`, `send_back`, `fix`, `decline_proposal`, `operation_notes`
(replaces the operation gate's notes), `restart_step`, `kept`, `follow_up` (any resting task), `closed`.

A message sent on your behalf (or by a schedule) to a task with any open gate is not delivered into the gate: core
records it (`task.messaged` with `kept`) into `Task.untoldMessages`, and the next run of the task's session (never
the reviewer, a watchdog's check or a watch's read) is told it once at the tail of its prompt, resumed or fresh ("Sent by an agent on the human’s behalf:
…", or "Sent by a schedule: …"; `task.messages_told`). `resolveLaterMessages` leaves it out until then.

`task.message` carries an optional `kind` (`MessageKind`), with the classifier's `title`, `why` and `shape` for new
work. Without one it is `feedback`, except a schedule's message to a resting task, which is `new_round`. Where the
effect is `retry`, `verify_setup`, `supersede_question`, `revise_plan`, `request_changes`, `decline_proposal` or
`operation_notes` it is `feedback` whatever `kind` it carries, and the server asks no classifier (`needsMessageKind`).
A `task.message` or `message.receive` whose text matches a message still in the task's inbox, or the request of a
round still waiting, from the last 10 minutes emits nothing. `feedback` is
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

**Requests and replies.** Every message an agent must answer emits `iteration.requested` before the agent hears it
(`decide/iterations.ts`, `requestIteration`): a gate answer or message that starts a fix (`request_changes`,
`send_back`, `fix`, Request changes at the review or merge gate, verdicts and line comments included), Revise at the
plan gate and `revise_plan`, `follow_up` and `decline_proposal` on an inquiry, `restart_step`, and a `steer` or `wake`
of a run that can reply (`isReplyingRun`: the Agent planning, building, fixing or operating, or an answerer,
investigator or researcher; never a delegated run, the reviewer or a watch). While the last iteration has no reply, a
request joins it (same `iterationId`), so one reply answers everything sent before the hand-over; otherwise it opens
the next. The seven hand-overs that answer (`ReplyingHandOver`: `propose_plan`, `complete_phase`, `complete_fix`,
`answer`, `report_diagnosis`, `submit_report`, `report_outcome`) call `answerIteration`: `reply` is required while an
iteration is open (`reply_required`) and refused otherwise (`reply_unasked`), each error naming the tool; the reply is
`iteration.answered` with the run that wrote it. A first hand-over that answers only the task's request carries none.

## Commands

Every command has an id; a repeat is answered from its receipt. `parseUserCommand` checks a user command field by field
before `decide` sees it; `decide` throws `DomainError` (nothing emitted) for anything not allowed.

### User commands

Sent by you (the web over the socket, `POST /api/commands`, the command line) or by a task agent's management tool on
your behalf (`onBehalf`, `byTask`). **Human** = only you: its specs are `humanOnly` and core refuses it on your behalf;
**agent** = a task agent has a tool for it.

| Command | Does | Command line | Who |
| --- | --- | --- | --- |
| `task.create` | creates a task (request, project, priority, plan first, backlog, waits on, stacks on: `stacksOn`, mode, account, the task it forks: `forkOf`) | `tasks create` | you; task agents file tasks with `create_task` |
| `task.message` | your message; what it does: Messages, above; `kind` says whether it is feedback, a new round or work for another task | `tasks message [--as]` | agent |
| `round.ship` | how a round ships: onto the open pull request or stacked | `rounds ship` | agent |
| `round.update` | replaces what a round waiting to start asks for (`request`; its title becomes the request's first line); a round that started is refused (`round_started`) | `rounds update` | agent |
| `round.remove` | removes a round waiting to start; the waiting rounds after it move up one number; a round that started is refused (`round_started`) | `rounds remove` | agent |
| `round.send` | sends a round waiting to start to the current round now: it leaves the queue (`round.removed`) and its request is delivered as your message, read as `feedback` (What a message does); a round that started is refused (`round_started`) | `rounds send` | agent |
| `task.prioritize` | sets the priority | `tasks prioritize` | agent |
| `task.wait_on` | replaces the tasks it waits on (`waitsOn`) | `tasks wait-on`, `tasks stop-waiting` | agent |
| `task.stack_on` | stacks it on a task as a bundle (`stacksOn`), or takes it out (`null`); refused on itself (`stack_self`), a cancelled (`dependency_cancelled`) or finished task (`stack_parent_settled`), one with no pull request (`stack_no_pull_request`), in another repository (`stack_repository`) or already stacked on (`stack_taken`), a cycle (`dependency_cycle`), and once it builds (`stack_started`) | `tasks stack-on`, `tasks unstack` | agent |
| `task.move_to_backlog` | puts a task in the backlog; its open plan gate becomes held ("in the backlog"); refused for a settled task (`task_settled`), an inquiry (`backlog_inquiry`) or once a plan was approved or building started (`backlog_started`); a task already there records nothing | `tasks move-to-backlog` | agent |
| `task.remove_from_backlog` | takes it out; its plan waits in Needs you ("plan ready for you"); a task not there records nothing | `tasks remove-from-backlog` | agent |
| `task.snooze` | snoozes an open task in any step: its gates leave `ready` and it is listed in `queue.snoozed`, nothing else changes; refused for a settled task (`task_settled`); a snoozed task records nothing | `tasks snooze` | agent |
| `task.unsnooze` | clears the snooze: the task shows where it is now; a task not snoozed records nothing | `tasks unsnooze` | agent |
| `task.retry` | restarts the current step with a fresh budget, optionally on an account | `tasks retry`, `tasks rerun` | agent |
| `task.cancel` | cancels it, and stops its watchdogs | `tasks cancel` | agent |
| `task.share` | shares it by a link that reads it live from this machine (`share.link` makes it), for `limit` and as `preset` (the `shareLimit` and `sharePreset` settings when left out); again with another `limit` or `preset` it changes how long or what it shows and keeps the link; again on a failed share it asks for the link once more; an automation's home, or `until_done` on a finished task, is refused (`share_refused`) | `tasks share [--until] [--preset]` | **human** |
| `task.unshare` | stops sharing it: every open link ends at once and the link stops working | `tasks unshare` | **human** |
| `preview.share` | shares the task's run of a service (`serviceId`) by a link on `shinsa.page` (`preview.link` makes it), for `limit` (the `shareLimit` setting when left out); again with another `limit` it changes how long and keeps the link; again on a failed share it asks for the link once more; an automation's home or a finished task is refused (`share_refused`) | `services share <service> --task [--until]` | **human** |
| `preview.unshare` | stops sharing that run: its open pages and sockets end at once and the link stops working | `services unshare <service> --task` | **human** |
| `task.hand_off` | hands it to someone by a link (`handoff.link` makes it): the first GitHub account to open it takes the task over; again on a failed link it asks for the link once more; an automation's home or a finished task is refused (`handoff_refused`) | `tasks hand-off` | **human** |
| `handoff.remove` | takes it back: the link stops working, and whoever took it over loses access at once (`handoff.revoke`) | `tasks hand-off-remove` | **human** |
| `task.mark_duplicate` | closes it as a duplicate of `duplicateOf`: `task.duplicated`, then the cancel's settle; refused for itself (`duplicate_of_itself`), a finished task (`task_settled`) or an original that is a duplicate (`duplicate_of_duplicate`) | `tasks duplicate --of` | agent |
| `task.clear_duplicate` | starts a duplicate again (`task.duplicate_cleared`): one that never ran an agent through `startWork`, as if triage had not closed it; one that did in a fresh round with the same request (`round.queued`, `round.started`); refused for a task that is no duplicate (`not_duplicate`) | `tasks not-duplicate` | agent |
| `watchdog.stop` | stops a watchdog, and its check if one runs | `watchdogs stop` | agent |
| `watchdog.connect` | gives a watchdog that waits for a source its server (`server`, `data`), adds it to the project's sources for the repository, and starts its window | `watchdogs connect` | agent |
| `watch_source.write`, `watch_source.remove` | adds, changes or removes an integration the project uses (`server`, `data`, `repoIds`); at most 20 (`too_many_sources`) | `sources write`, `sources remove` | agent |
| `task.complete` | marks it done without merging, and stops its watchdogs; sent for you, refused while one watches or waits for a source (`task_open`) | `tasks done` | agent |
| `task.bind_account` | binds it to an account, or any | `tasks bind` | agent |
| `gate.answer` | decides a gate, any gate; at a review or merge gate, Request changes (`revise`) may carry `comments` (Line comments, below); at a review gate, `revise` may carry `thenApprove: true`, which approves the next review that opens without an escalation by itself (`then_approve_invalid`, `then_approve_conflict`); approving a merge gate needs every step before the merge ticked, on every task of its bundle too (`merge_steps_open`) | `gates answer`, `plans *`, `reviews *`, `merges approve`, `merges reject`, `operations *`, `questions answer`, `command` | **human** |
| `merge_step.tick` | ticks or unticks a step around the merge (`key`, `done`); a step that is not due is refused (`merge_step_early`: one after the merge before its pull request merged, one before the merge once it merged), a step the task does not have is refused (`merge_step_not_found`), and a closed task's not at all (`task_settled`); ticking the last open step after the merge withdraws the Post-merge gate | `merges tick [--undo]` | **human** |
| `suggestion.accept` | adds a suggested task, optionally waiting on this one or in the backlog (`backlog`) | `suggestions accept` | agent |
| `suggestion.dismiss` | dismisses one | `suggestions dismiss` | agent |
| `suggestion.keep` | keeps a split-off in this task and sends it now: feedback to the open round, or a new round on a resting task (`shape` optional; the server asks the classifier for a new round when it is left out) | `suggestions keep` | agent |
| `memory.write` | writes a rule (`text`, `projectId` or null for every project) or, with `memoryId`, changes one; writing over a proposal keeps it; at most 240 characters and 20 kept rules per scope (`memory_invalid`, `memory_full`) | `memory write` | **human** |
| `memory.accept` | keeps a rule an agent proposed | `memory keep` | **human** |
| `memory.remove` | forgets a rule, or dismisses a proposal | `memory remove` | **human** |
| `feedback.write` | records a note on Shinsa (`note`, at most 4,000 characters) and drafts it as an issue; with `feedbackId`, rewrites one that is neither busy nor filed and drafts it again (`feedback_invalid`, `feedback_busy`, `feedback_filed`) | `feedback write` | agent |
| `feedback.update` | changes the `title` (120) and `body` (12,000) of a draft that waits for you (`feedback_not_draft`) | `feedback edit` | agent |
| `feedback.file` | opens a draft as a public issue with your GitHub login, after the privacy check passes on its text as it is (`feedback_private` names each leak) | `feedback file` | **human** |
| `feedback.dismiss` | forgets an entry, refused while it is being opened | `feedback dismiss` | agent |
| `monitor.check_in_now` | fires a monitor's next check-in now | `tasks check-in-now` | agent |
| `usage_wait.change` | turns a usage wait's auto-resume on or off | `tasks auto-resume` | agent |
| `usage_wait.resume_now` | resumes a usage wait now | `tasks resume-now` | agent |
| `run.snooze_silence` | snoozes a quiet-run warning | `runs snooze` | agent |
| `run.dismiss_silence` | dismisses it for the run | `runs dismiss` | agent |
| `delegation.cancel` | stops a delegation and what it delegated | `delegations stop` | agent |
| `schedule.write` | creates or changes a schedule; with `source` (`projectId`, `server`) it is a watch, reading that integration in a home it creates; no target (`source_target`), and a schedule that starts or messages a task never becomes one (`source_change`); a new watch sent for you is recorded as a suggested watch instead (`watch_suggestion.recorded`, origin the acting task) | `schedules write` | agent |
| `schedule.enable` | pauses or resumes one | `schedules enable`, `schedules disable` | agent |
| `watch_suggestion.accept` | accepts a suggested watch: writes it as your `schedule.write` with `source` (`createdBy: you`, its home, its first read a slot later); refused once decided (`suggestion_decided`) or with its integration gone (`source_not_found`) | `schedules accept` | **human** |
| `watch_suggestion.dismiss` | dismisses a suggested watch, which is never offered again for that integration | `schedules dismiss` | agent |
| `schedule.remove` | deletes one | `schedules delete` | agent |
| `project.write` | creates or changes a project | `projects write` | agent |
| `project.remove` | removes one | `projects remove` | agent |
| `project.add_to_team` | shows every task of the project to a team (`teamId`), read-only: `project.written` with the team in `teamIds`; nothing when it is already there | `projects add-to-team --team` | **human** |
| `project.remove_from_team` | stops showing them: every open view of its tasks for that team closes | `projects remove-from-team --team` | **human** |
| `repo.update` | changes a repository's fields | `repos update` | agent; **human** for `checkCommands`, `workspace`, `coverage` (`HUMAN_ONLY_REPO_FIELDS`) |
| `repo.remove` | forgets a repository | `repos remove` | agent |
| `focus.change` | sets or clears the focus: `projectId` or `teamId`, never both (`focus_refused`), and `until` | `focus set`, `focus clear` | agent |
| `settings.change` | changes settings (`SETTINGS_KEYS`) | `settings set` | agent; **human** for `approvePlans`, `mergeMethod`, `taskBudgetUsd`, `taskUsageLimit`, `autoResume`, `snoozeLimited`, `accountSwitchAt`, `fastMode`, `agentFastModes`, `delegationLimit`, `shareLimit`, `sharePreset` (`HUMAN_ONLY_SETTINGS`) |

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
| `agent.propose_plan` | `propose_plan` | hands over a plan (checked by `validatePlanRules`), with `reply` while a request of yours is open and only then (Messages → Requests and replies) |
| `agent.complete_phase` | `complete_phase` | hands over a phase with its judgement calls, `reply` while a request of yours is open and only then, and `checkChanges?` (`check_changes`, recorded as `checks.changed`); Shinsa commits it, adds `treeHash` and `files` (the files the commit changed, kept on the `PhaseReport`) and runs the phase's checks (the last one needs the evidence) |
| `agent.complete_fix` | `complete_fix` | hands over a fix (`summary`, `reply` while a request of yours is open and only then (`reply_required`, `reply_unasked`; Messages → Requests and replies), `walkthrough` when it changes how the change works, `checks?`: the ids to run again, `checkChanges?`, `evidenceKept?`: earlier evidence that still applies); refused while an earlier item whose files the fix changed is not replaced, removed or kept (`evidence_stale`, `docs/engine.md` → Evidence); Shinsa commits and adds `treeHash` and `files`, then runs the failing checks, those, the changed ones and the checks of every phase whose files the fix changed, or pushes when shipping |
| `agent.report_review` | `report_review` | hands over the review: `summary` (or null), the findings and the `disagreements` with the Agent's judgement calls |
| `agent.deliver` | `answer`, `report_diagnosis`, `submit_report`, `report_outcome` | hands over an answer, a diagnosis, a report or an outcome (step `answer`, `investigate`, `research`, `operate`), an inquiry optionally with a proposal, each with `reply` while a request of yours is open and only then; an operation without a code change needs its evidence first |
| `agent.reshape` | `reshape_task` | recomposes the steps before planning |
| `agent.ask` | `ask` | asks you (or, from a delegated run, its parent) |
| `agent.attach_evidence` | `attach_evidence` | attaches evidence, stored under its task and round (`validateEvidence`; `docs/engine.md` → Evidence) |
| `agent.attach_comparison` | `attach_evidence` with `kind: "comparison"` | attaches one comparison: a piece per part, sharing one `itemId` (`docs/engine.md` → Evidence) |
| `agent.attach_check` | `attach_evidence` with `kind: "test"` or `"check"` | links a check (`kind`, `checkId`, `detail?`): `evidence.attached` with `checkId`, the check's label as title and `shinsa://check/<id>` (`check_unknown` otherwise) |
| `agent.remove_evidence` | `remove_evidence` | removes items that no longer apply (`items` by key or id, `reason`): `evidence.removed` (`evidence_unknown` for an item the side did not attach this round) |
| `agent.note` | `note` | keeps a note on the task |
| `agent.wait_for` | `wait_for` | ends the run and arms a monitor |
| `agent.suggest_tasks` | `suggest_tasks` | suggests up to five tasks |
| `agent.remember` | `remember` | proposes a rule for every later agent (`scope`, `text`, `why`); a known one is dropped, at most ten wait at once |
| `agent.report_feedback` | `report_feedback` | reports a problem with Shinsa itself (`feedback`), drafted like yours and waiting for you; a known note is dropped, at most 3 per task and 10 agent reports waiting (`feedback_full`) |
| `agent.request_secret` | `request_secret` | opens a secret gate |
| `agent.delegate` | `delegate_task` | starts a delegation from its `brief` |
| `agent.cancel_delegation` | `delegation_cancel` | stops one |
| `agent.answer_delegation` | `delegation_answer` | answers a delegation's question |
| `agent.acknowledge_delegation` | `delegation_status` | marks a finished result read |
| `agent.file_report` | `file_report` | in a watch's read or a watchdog check only: files a task from one report (`title`, `request`, `reportId` or `link`, `author`, `postedAt`, `text`, `repoId`, `forkOf`); refuses a report the project already has a task for (`report_filed`) and a repository of another project (`repo_project`); a watchdog's always forks the shipped task (`fork_watchdog`), and links a report another watch or watchdog filed first (`watchdog.report_linked`) rather than refusing it |
| `agent.report_read` | `report_read` | ends a read with its `summary`, as not finished with `reached: false`: a watch's next read covers the same time, a watchdog's check is missed; a watchdog check that filed a report trips it, one that filed none is healthy, and `live` answers a watchdog waiting for production; the task rests again |
| `agent.create_task` | `create_task` | files a courier task from its `request`, optionally waiting on it (`thisWaits`), waiting on this task (`afterThis`, never with `thisWaits`), in the backlog (`backlog`), stacked on this task as a bundle (`stackOnThis`, never with `thisWaits` or `afterThis`) or forked from a task (`forkOf`) |
| `agent.split_task` | `split_task` | splits the approved plan into tasks (`requests`) |
| `agent.set_schedule` | `set_schedule` | writes one of its task's schedules; `source` names an integration of the task's project to watch: a new watch is recorded as a suggested watch for you to accept (origin the task and run, in its activity), at most 10 open at once (`suggestion_limit`) |
| `agent.delete_schedule` | `delete_schedule` | deletes one |

The delegation tools name a delegation by `delegation_id`. Reads with no command: `find_tasks`, `read_task`,
`list_repository_work`,
`list_schedules`, `list_services`, `run_service` (which acts on the task's own service runs, in the terminals
beside the log, not through a command; `docs/engine.md` → Services → Runs for a task) and `add_service` (which adds a
service definition beside the log, no command either; `docs/engine.md` → Services → Agents add the services they
need), `remove_service` (which removes service definitions the same way; `docs/engine.md` → Services → Agents remove
services), and `delegation_status` for a delegation still working.

### System commands

Sent by the server, each under an id named after its cause (`docs/engine.md` → Command receipts).

| Command | Sender | Does |
| --- | --- | --- |
| `task.triage` | `task.triage` effect (`triage/`) | records title, repository, size, branch, waits on, and the Auto parts; a `duplicateOf` naming an open task, or a `duplicateOfTeammate` (`TeammateOriginal`), closes it as that task's duplicate before any work (a local one wins when both come); `unreached` lists the team machines the duplicate check could not read |
| `repo.register` | `repos/index.ts` | registers a repository on first use |
| `config.record` | `config.verify` effect | records what setup verification found, with the repository it found (`repoId`) for a task that had none |
| `worktree.ready`, `worktree.gone` | worktree effects | the worktree exists (with the branch a main checkout was on, `returnBranch`), or is gone |
| `task.record_edit` | the file route after a save from the Code tab (`http/edits.ts`) | you saved `path`; `changed` says whether it now differs from the checkout's commit. Records the edit (once per file) or drops it, and steers a running agent of the task |
| `task.commit_edits` | the push effect before it pushes, and the checks effect when the review was approved with edits | Shinsa committed your uncommitted edits (`treeHash`); clears `editedPaths` |
| `task.record_overlaps` | an agent's `propose_plan`, `complete_phase` or `complete_fix`, before it dispatches (`agents/repository-work.ts`) | `overlaps`: the other open tasks of the repository and the files this task shares with each; `from`: the task whose hand-over compared them; records the ones not known yet (`task.overlapped`) and steers this task's Agent at work with them at once when `from` is another task, else they wait for its next turn |
| `checks.record` | `checks.run` effect | records a round of checks (`results: ReportCheck[]`), with `outputs?` (`CheckEvidence[]`, one per check run: the output the server stored, attached as Shinsa's own `check` evidence with its `checkId`) and `coverage?` (`Coverage`) when the run before review measured it; ignored outside `checking` or with no results |
| `pull_request.record` | open, merge and watch effects | records a pull request read; `ci` says whether the repository has CI for its base (`RepoCi`: `none`, `workflows`, `required`, `unknown` when absent), read only when the head has no checks |
| `share.record` | `share.link` effect | the link the engine made (`url`, null when it kept the one recorded); clears the last failure |
| `share.fail` | `share.link` effect, when it gives up; the engine, when the machine is paired again | the reason (`detail`), kept on `TaskShare.failure` for Share task; opens no gate |
| `share.expire` | `ShareClock`, at `TaskShare.endsAt` | ends a share whose time ran out (`task.unshared`, `reason: 'expired'`); nothing before it |
| `share.describe` | `share.describe` effect | the description the writer wrote (`description`, trimmed), kept on `TaskShare.description` (`share.described`); ignored once the task is no longer shared, empty or unchanged |
| `preview.record` | `preview.link` effect | the link the engine made (`url`, null when it kept the one recorded); clears the last failure |
| `preview.fail` | `preview.link` effect, when it gives up; the engine, when the machine is paired again (`PREVIEW_LINK_LOST`) | the reason (`detail`), kept on `PreviewShare.failure` for Share preview; opens no gate |
| `preview.expire` | `ShareClock`, at `PreviewShare.endsAt` | ends a preview whose time ran out (`preview.unshared`, `reason: 'expired'`); nothing before it |
| `handoff.record` | `handoff.link` effect | the link the engine made (`url`); clears the last failure; ignored once claimed |
| `handoff.fail` | `handoff.link` effect, when it gives up | the reason (`detail`), kept on `TaskHandoff.failure` for Share task; opens no gate |
| `handoff.claim` | the engine, when a browser proves a hand-off link on the sealed channel | the account that opened it (`guest`); the same account again does nothing, another is refused (`handoff_claimed`), and a task no longer handed off too (`handoff_gone`) |
| `handoff.leave` | the engine, when a heartbeat no longer lists a guest who holds the task | gives it back (`handoff.left`) and queues `handoff.revoke`; nothing when another account holds it (`guestId`) |
| `pull_request.read_failed` | the watch effect | counts a failed read |
| `pull_request.record_push` | open and push effects | records a pushed commit |
| `pull_request.record_step` | open and push effects | `step`: `{ kind: 'updating', base }`, `{ kind: 'pushing', hook }` or `{ kind: 'opening' }`; sets the stage reason while the task ships with a push pending |
| `pull_request.record_retry` | the engine, before it requeues a failed open or push | `step` (`updating`, `pushing`, `opening`), the `attempt` that failed, `attempts`, `retryAt`, a short `detail`: `pull_request.push_retrying` and the stage reason "pushing again in 30s, attempt 2 of 5: …" |
| `pull_request.record_update_conflict` | open and push effects, after aborting the merge of the base | `base`, the conflicted `files`: a fix round (`fixFor: 'update'`) |
| `bundle.record_check` | the pull request watch, reading a bundle's root while every task above is ready | `conflict` (`{ taskId, behindTaskId, base }` or null) from merging the bundle into the default branch in git: holds the root's gate and pushes the lowest task behind its base, or pauses the root when none is; null clears it and reads the root again |
| `pull_request.record_hook_failure` | open and push effects | the hook's `output` tail and the `failures` read from it (or null): `pull_request.hook_failed`, then a fix round (`fixFor: 'hook'`), or the `push_hook` failure gate when the same failures come back |
| `pull_request.record_closed` | the close effect | the pull requests it `closed` and the ones it `failed` to close (`{ number, detail }[]`): `pull_request.closed`, only on a cancelled task with something in either list |
| `evidence.record_uploads` | open and push effects | the GitHub attachment `url` of each uploaded piece (`uploads: { evidenceId, url }[]`): `evidence.uploaded` with the pieces of this task whose address is new, nothing otherwise |
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
| `watchdog.fire` | `WatchdogClock` | checks a watchdog at its `nextCheckAt` (`dueAt`), defers it while the task works, or passes it once its window ended |
| `usage_wait.resume` | `UsageResumeClock` | resumes a step after the reset |
| `watch_suggestion.record` | the `watch.suggest` effect | records the suggested watch for a new integration (`projectId`, `server`, the Writer's `name` and `text` or null for plain wording, `timeZone`), hourly; does nothing when the integration is gone or watched, was suggested before, or 10 suggestions are open |
| `feedback.record_draft` | the `feedback.draft` effect | the drafted `title` and `body` of an entry still `drafting`; an empty one fails it |
| `feedback.record_filed` | the `feedback.file` effect | the new issue's `number` and `url`, for an entry still `filing`; its `openedAt` is now and `closedAt` null |
| `feedback.record_issue_state` | `FeedbackEffects.syncIssues`, with the pull request sync | an opened issue's `closedAt` as GitHub reports it, or null when it opened again; nothing when it did not change |
| `feedback.record_failure` | either feedback effect, and the start after a restart | fails a `drafting` or `filing` entry with `detail` |
| `account.signed_in`, `account.removed` | the accounts service | answers that account's Sign in gates; releases bound tasks |
| `provider.record_sign_in` | the accounts service | a provider's own sign-in is back: answers its open Sign in gates that name no account |
| `onboarding.welcome` | `Onboarding.complete` (`onboarding/index.ts`), when setup ends | records the welcome task, "Welcome to Shinsa", with `body` as its answer: `task.created` (origin `onboarding`, no repository, mode `ask`), `task.triaged`, `task.delivered`, then done; no triage, agent or effect; refused with an empty body (`welcome_invalid`) or once a task with that origin exists (`welcome_recorded`) |
| `delegation.record_delivery`, `delegation.release` | `agents/deliveries.ts` | a delivery claim was taken, or released |
| `delegation.wake_policy` | `agents/tools/orchestration.ts` | a `wait` call that timed out switches to waking |
| `delegations.recover` | the supervisor at boot | releases claims and waits, claims again |
| `schedule.fire`, `schedule.fail` | `ScheduleClock`, the webhook | fires a slot, or records a failed one |
| `schedule.deliver` | the webhook receiver | starts the schedule's work from a delivery |
| `slack.mention` | `POST /api/slack/events`, command id `slack:<event id>` | a signed `SlackMention`: messages the open task of its thread (kept while a gate is open), else asks for `slack.evaluate` |
| `slack.start_task` | the `slack.evaluate` effect, when the mention is work | the mention: starts a task as Home does and links it to the thread, or messages the thread's task when one opened meanwhile |
| `slack.record_status` | the `slack.status` effect | the ts of the task's status message and the reaction now on the mention, once Slack has them |
| `slack.answer` | `POST /api/slack/interactions`, command id `slack-answer:<trigger id>` | a signed `SlackAnswer`: answers an open question gate with its choice (`gate.answer`, `reply`), only for the Slack user who started the task from that thread; refused `slack_answer_closed`, `slack_answer_refused` or `slack_answer_choice` |

## Events

`ShinsaEvent` = a body + `seq`, `at`, and `onBehalf`, `byTask` when sent on your behalf, or `byGuest` (the login) when sent by the person a task was handed to. Only `decide` emits them;
`applyEvent` folds them. Never removed or redefined.

| Event | Recorded when |
| --- | --- |
| `repo.registered`, `repo.updated`, `repo.removed` | a repository is registered, changed, forgotten |
| `project.written`, `project.removed` | a project is written, removed |
| `focus.changed` | the focus changes |
| `settings.changed` | settings change (the whole settings object) |
| `task.created` | a task is created (`request`, `planFirst`; with its handle when it has a project; `createdBy`, `scheduleId` and `sourceReport` for one a watch's read filed; `watchHome` for a watch's home) |
| `task.triaged` | triage set title, repository (or none), size, branch, handle, pipeline, decisions (always) |
| `task.repo_bound` | a task with no repository got the one the setup check found (`repoId`, and `projectId` when it had none) |
| `task.reshaped` | the pipeline changed (`by` you, agent or Shinsa, with a reason) |
| `task.shared`, `task.unshared` | you shared a task by link or changed how long or what it shows (`limit`, `endsAt`, `preset`; the first adds an activity entry), or sharing stopped (`reason`: `you`, `done` when a task shared `until_done` settled, `expired`; each adds an activity entry) |
| `share.recorded`, `share.failed` | the engine made the link (`url`, null when unchanged), or could not (`detail`) |
| `share.described` | the writer described a shared task (`description`) |
| `preview.shared`, `preview.unshared` | you shared a service run by link or changed how long (`serviceId`, `limit`, `endsAt`; the first adds an activity entry), or sharing stopped (`reason`: `you`, `done` when the task settled, whatever its limit, `expired`; each adds an activity entry) |
| `preview.recorded`, `preview.failed` | the engine made the preview's link (`url`, null when unchanged), or could not (`detail`) |
| `task.handed_off`, `handoff.removed` | you handed a task off, or took it back (`guest`, null when no one had claimed it); each adds an activity entry |
| `handoff.recorded`, `handoff.failed`, `handoff.claimed` | the engine made the hand-off link (`url`), or could not (`detail`), or an account took the task over (`guest`; adds an activity entry, "Handed this task to Kai", with the guest as `Activity.person`) |
| `handoff.left` | the guest left the machine at app.shinsa.dev, so the task is no longer handed off (`guest`; adds an activity entry, "Kai gave this task back", with the guest as `Activity.person`) |
| `task.staged` | the stage and its reason changed |
| `task.prioritized` | the priority changed |
| `task.retitled` | an accepted plan named the work anew (`round`, `title`): the round takes the title, and the task too when it is round 1; activity “Renamed to …” |
| `task.duplicated` | the task was closed as a duplicate (`duplicate: { of, by, why, teammate? }`); the `cancelled` stage follows |
| `task.duplicate_cleared` | a triage-closed duplicate is not one after all: the mark, `closedAt` and `cancelledFrom` are cleared |
| `task.waits_on_changed` | the tasks it waits on changed (`waitsOn`) |
| `task.stack_changed` | the task it stacks on changed (`stacksOn`, `null` when taken out; `by` you or Shinsa) |
| `task.stack_based` | its base became the branch of the task below (`base`), or the default branch again (`null`) once that task merged or left |
| `task.bundle_ready` | it is ready to merge with its bundle (`ready: { commit }`), or no longer is (`null`) |
| `task.bundle_conflict` | its bundle conflicts with the default branch once it merges (`conflict`), or no longer does (`null`) |
| `task.snooze_changed` | you (or an agent for you) snoozed or unsnoozed it (`snoozed`) |
| `task.backlog_changed` | it entered or left the backlog (`backlog`; `cause`: `you`, `started` when you approved its plan, `inquiry` when triage made it an inquiry) |
| `task.messaged` | you (or a schedule, or an agent for you) sent a message; `kind` and `round` when it was new work, `suggestionId` when it became a split-off, `kept` when it was sent for you while a gate was open (adds it to `untoldMessages`) |
| `task.messages_told` | a new run of the task's session was told the messages in `untoldMessages`; clears it |
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
| `task.edited` | you saved `path` from the Code tab (`changed`), or put it back the way it was committed; keeps `editedPaths` and `untoldEdits` |
| `task.edits_told` | a new run's prompt named the files in `untoldEdits`; clears it |
| `task.overlapped` | the task and another open one (`otherTaskId`) both change `paths`, none of them recorded before; adds them to `overlaps` and its `untold` |
| `task.overlaps_told` | a steer or a new Agent run's prompt named the untold overlaps; clears every `untold` |
| `task.edits_committed` | Shinsa committed your edits before a push or the checks; clears `editedPaths` |
| `task.edits_approved` | `gate`: the review or merge you approved with uncommitted edits (`approvedEdits`), or null once the checks or CI it waited for passed |
| `plan.proposed`, `plan.answered`, `plan.approved` | a plan version was proposed; you answered it; approved |
| `phase.updated`, `phase.completed` | a phase's status changed; a phase was handed over (`judgementCalls`, and the last phase's `walkthrough`) |
| `walkthrough.revised` | a fix changed how the change works (`walkthrough`: only the parts that changed, `runId`); merged into the latest phase report's walkthrough (`docs/engine.md` → The review report) |
| `watchdog.armed` | a merged round's walkthrough armed a watchdog (watching, or waiting for a source) |
| `watchdog.started` | a watchdog that waited got its source (`source`, `status`: watching, or waiting for production; `awaitingSince`, `startedAt`, `endsAt`, `nextCheckAt`) |
| `watchdog.checking`, `watchdog.deferred` | a check started on a run (`runId`), or moved on 15 minutes while the task worked (`nextCheckAt`) |
| `watchdog.checked` | a check's result (`check`, `status`, `nextCheckAt`, `forkTaskIds`) |
| `watchdog.report_linked` | a check found a report another watch or watchdog already filed (`reportTaskId`); it joins `linkedTaskIds`, never `forkTaskIds`, and trips the watchdog at the check's end |
| `watchdog.live` | the change reached production, so the window starts (`endsAt`, `nextCheckAt`), for every watchdog of the task that waited for it |
| `watchdog.missed` | a check that could not run, given up without a gate (`reason`, `nextCheckAt`; none left stops the watchdog) |
| `watchdog.ended` | you stopped a watchdog (Stop, or the task marked done or cancelled) |
| `watch_source.written`, `watch_source.removed` | an integration a project uses added or changed, or removed |
| `merge_step.ticked` | you ticked or unticked a step around the merge (`key`, `title`, `done`); adds or removes its key in `mergeStepsDone`, or marks the carried step, and records it in the activity |
| `work.submitted` | the work report was assembled (`sections`, `judgementCalls`) |
| `work.committed` | Shinsa committed (the tree hash) |
| `checks.recorded` | a round of checks finished (`results`, and `coverage?` when it was measured; merges `checkResults` by id, sets `coverage`, an activity entry of kind `check`) |
| `checks.changed` | the agent changed the task's checks at a hand-over (`changes: CheckChange[]`, `runId`); updates `Task.checks`, drops the last result of a changed or removed check, an activity entry of kind `check` per change |
| `checks.started` | Shinsa started a run of checks (`checkIds`); sets `Task.runningChecks` |
| `review.reported`, `review.escalated` | a reviewer reported (`summary`, `findings`, `disagreements?`); the review escalated to you |
| `fix.started` | a fix round started (reason, signature, tree) |
| `iteration.requested` | you sent a request after the work was in (`iterationId`, `round`, `text`, `comments`); appends to the iteration with that id or opens it |
| `iteration.answered` | the hand-over that answered it carried its `reply` (`iterationId`, `runId`); sets `reply`, `runId` and `repliedAt` |
| `evidence.attached` | evidence was attached (`checkId` on a check's output or a linked check; `replaces`: the ids of the pieces it replaced, which get `replacedBy`) |
| `evidence.removed` | an agent removed evidence that no longer applies (`ids`, `reason`, `runId`; each piece gets `removedAt` and `removedReason`) |
| `evidence.uploaded` | pieces were uploaded to GitHub for the pull request description (`taskId`, `uploads`; each piece gets `uploadUrl`) |
| `gate.opened`, `gate.answered`, `gate.withdrawn`, `gate.superseded` | a gate opened (`type`), was answered (`thenApprove` when you asked to approve after the fix, `ahead` when that approval was made for you), withdrawn, or replaced by your message |
| `gate.noted` | the open operation gate's notes were replaced (`notes`, null clears them; the same gate, no new notification) |
| `run.started`, `run.dispatched` | a run was created; it started |
| `run.attempted`, `run.linked` | an attempt began; it linked its session |
| `run.ended` | a run ended (outcome, failure) |
| `run.interrupted`, `run.continued` | marked at shutdown; continued after a restart |
| `run.session_lost`, `run.compacted` | a session is gone; an idle session was compacted |
| `run.cached` | a run ended with its prompt cache's expiry known (`run.end`'s `cacheExpiresAt`), kept as `Run.cacheExpiresAt` for the next step's fold |
| `run.metered` | usage and cost were charged, with the weekly readings (`readings`) the attempt took |
| `run.silenced`, `run.silence_snoozed`, `run.silence_dismissed` | a run went quiet; the warning snoozed or dismissed |
| `run.waiting` | a step's turn ended while its delegations work |
| `monitor.armed`, `monitor.fired`, `monitor.ended` | a monitor was armed, fired, ran out or was cleared |
| `usage_wait.armed`, `usage_wait.ended` | a usage wait was armed; resumed, reset or cleared |
| `pull_request.opened`, `pull_request.updated` | the pull request was opened; a read changed it |
| `pull_request.push_requested`, `pull_request.pushed`, `pull_request.head_moved` | a push was asked for, made; someone else moved the head |
| `pull_request.read_failed`, `pull_request.read_failures_cleared` | a read failed; the count reset |
| `pull_request.push_retrying` | a failed update, push or open is retried: step, attempt, attempts, when, why (one activity entry) |
| `pull_request.hook_failed` | the pre-push hook rejected the push: `failure` (output, failures, signature), kept as `task.pushHookFailure` |
| `pull_request.closed` | a cancel closed pull requests: `closed` turn `closed` on the task and its rounds ("Closed pull request #N"), each of `failed` stays open with its `detail` ("Could not close pull request #N") |
| `pull_request.watched` | the watch's memory changed (with what changed) |
| `delegation.asked`, `delegation.answered` | a delegation asked its parent; was answered |
| `delegation.acknowledged` | the parent read a finished result |
| `delegation.wake_changed`, `delegation.adopted` | a wake policy changed; a restarted step adopted its children |
| `delegation.claimed`, `delegation.delivered`, `delegation.released` | a delivery cohort was claimed, delivered, released |
| `delegation.message_queued` | your message was queued for a waiting step |
| `memory.written`, `memory.proposed`, `memory.removed` | you wrote, kept or changed a rule (the whole `entry`); an agent proposed one (recorded in its task's activity); a rule was forgotten or a proposal dismissed, or its project removed |
| `feedback.recorded`, `feedback.removed` | an entry was written, drafted, changed, opened or failed (the whole `entry`; an agent's new report is recorded in its task's activity); an entry was dismissed |
| `schedule.written`, `schedule.removed`, `schedule.fired` | a schedule was written, removed, fired (with its run) |
| `watch_suggestion.recorded`, `watch_suggestion.accepted`, `watch_suggestion.dismissed`, `watch_suggestion.removed` | a watch was suggested (the whole `suggestion`; an agent's is recorded in its task's activity); you accepted it (with the `scheduleId` it became) or dismissed it; an open one was dropped with its integration, or any with its project |
| `schedule.read` | a watch's read finished with `report_read`: the next one reads from `readFrom`, when it started (`Schedule.lastReadAt`) |
| `on_behalf.acted` | a command sent on your behalf changed something (command, task, sentence, acting task) |
| `slack.thread_linked` | a task was started from a Slack thread (the whole `link`, `Task.slack`; "Started from a Slack thread") |
| `slack.status_posted` | the task's status message has this `ts` and its mention this `reaction` now |

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
| `checks.run` | replay_safe | `task:<id>` | `task.commit_edits` first when the review was approved with edits, then `checks.record`; payload `round`, `checks: CheckToRun[]` (run in parallel) and `coverage` (true for the run before review) |
| `pull_request.open` | replay_safe | `task:<id>` | `pull_request.record_step` per step, then `pull_request.record_push`, `evidence.record_uploads` when it uploaded evidence for the description, and `pull_request.record`; or `pull_request.record_update_conflict` or `pull_request.record_hook_failure` instead of the push |
| `pull_request.push` | replay_safe | `task:<id>` | as `pull_request.open`, without opening when the pull request is open; then rewrites the description's block (`evidence.record_uploads` for what it uploaded) |
| `pull_request.merge` | replay_safe | `task:<id>` | `pull_request.record`; merges only `headSha` (`--match-head-commit`), and records a moved head instead of merging it; on a bundle's root, with `bundle` (`{ taskId, number }[]`, the tasks above, the top first): checks the root's head and that the bundle merges into the default branch, then merges each of them and the root last, without a head to match, and records each; a failure lands on the root |
| `pull_request.watch` | replay_safe | `side:<id>` | `pull_request.record`, `pull_request.read_failed` |
| `pull_request.close` | replay_safe | `task:<id>` | `pull_request.record_closed`; queued by `settleTask` only on a cancel, with `numbers`, the task's open pull request and its open stacked ones; `gh pr close <n> --comment …` for each, the branch kept; a failed close is reported, never thrown |
| `share.link` | replay_safe | `share:<id>` | `share.record`, or `share.fail` when it gives up: makes a share id and a key for this machine's instance, unless a link to it is recorded; not paired fails at once (`SHARE_NOT_PAIRED`) |
| `share.describe` | replay_safe | `share:<id>` | `share.describe`, or nothing when the writer gave nothing: one writer quick call over the task's title and request, without attachments, when sharing starts (`remote/share-describe.ts`) |
| `preview.link` | replay_safe | `preview:<id>` | `preview.record`, or `preview.fail` when it gives up: makes a preview id and a key for this machine's instance, unless a link to it is recorded; not paired (`PREVIEW_NOT_PAIRED`) or a service with no preview URL (`PREVIEW_NO_URL`) fails at once |
| `handoff.link` | replay_safe | `handoff:<id>` | `handoff.record`, or `handoff.fail` at once when remote access is off: a hand-off token from app.shinsa.dev and a secret, kept with the task's id in `remote.json`, unless one is kept for the task |
| `handoff.revoke` | replay_safe | `handoff:<id>` | nothing: turns the link off at app.shinsa.dev, forgets the task's devices and closes their channels, and removes the guest there (`guestId`) unless they hold another task on the machine |
| `watch.suggest` | replay_safe | `suggest:<project id>` | `watch_suggestion.record`, after one Writer quick call words the watch from the integration's `server` and `data` (`schedules/suggest.ts`) |
| `feedback.draft` | replay_safe | `feedback:<id>` | `feedback.record_draft`, after one quick call rewrites the note without anything private (`feedback/draft.ts`); `feedback.record_failure` when no usable draft comes back |
| `feedback.file` | process_bound | `feedback:<id>` | `feedback.record_filed`, after `gh issue create --repo shinsa-dev/shinsa` (`feedback/file.ts`); `feedback.record_failure` with what `gh` said; never retried, and one a restart cut short is failed on start |
| `briefing.request` | replay_safe | `briefing` | none: `Engine.writeBriefing` stores the Home guide beside the log (`docs/engine.md` → The briefing) |
| `run.execute` | process_bound | `run:<id>` | `run.attempt`, `run.link`, `run.meter`, `run.end`, agent commands |
| `run.wake` | process_bound | `run:<id>` | as `run.execute`, on the waiting step's session |
| `run.cancel` | process_bound | `cancel:<id>` | `run.end` |
| `run.steer` | process_bound | `steer:<id>` | `message.deliver` when it is too late to steer; `from: 'shinsa'` steers a note of Shinsa's (an overlap, your edits in the Code tab) instead of your words |
| `question.resolve` | process_bound | `gate:<id>` | none: releases the waiting `ask` call |
| `delegation.steer` | process_bound | `steer:<id>` | `delegation.record_delivery`, `delegation.release` |
| `delegation.reply` | process_bound | `reply:<id>` | none: answers the child's question |
| `slack.evaluate` | replay_safe | `slack:<thread key>` | ⏳ on the mention first; `slack.start_task` for work; otherwise ⏳ off and "Not a task, so nothing was started.", once per thread; key `slack.evaluate:<event id>` |
| `slack.post` | replay_safe | `slack:<thread key>` | none: posts a gate, the result, "Sent to …" or "Kept for …" through app.shinsa.dev |
| `slack.status` | replay_safe | `slack:<thread key>` | `slack.record_status` for a new status message or reaction; edits it at most every 5 s and moves the mention's reaction |

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
| `report_read` | ✓ watch, intake | | | | | | |
| `ask` | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `attach_evidence` | ✓ | ✓ | | ✓ | | ✓ | ✓ |
| `remove_evidence` | ✓ | ✓ | | ✓ | | | |
| `find_tasks`, `read_task`, `note` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `list_repository_work` | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `list_services`, `run_service` | ✓ | ✓ | | ✓ | | | |
| `add_service`, `remove_service` | ✓ | | | ✓ | | | |
| `wait_for` | ✓ | | | ✓ | | | |
| `suggest_tasks` (`split_off`) | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `remember` | ✓ | | ✓ | ✓ | ✓ | | |
| `report_feedback` | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `delegate_task`, `delegation_status`, `delegation_cancel`, `delegation_answer` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `create_task` | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `split_task` | ✓ | | | | | | |
| `file_report` | ✓ watch, intake | | | | | | |
| `set_schedule`, `list_schedules`, `delete_schedule` | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `request_secret` | ✓ | | ✓ | ✓ | ✓ | | |

Hand-over tools (the first ten rows, `isHandOverTool`) end the step. Every task-session role is served every tool of
the union in every run, since the session's tool list must not change between turns (the prompt cache); the agent
may call only the hand-over its purpose names (`PURPOSE_HAND_OVERS`, the word after ✓), and another is refused with
`wrong_step`; `file_report` is refused outside a `watch` or `intake` run the same way. A delegated
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
| `propose_plan` | **`goal`**, **`phases`** (**`title`**, **`detail`**), **`behaviour`**, **`approach`**, **`files`** (**`path`**, **`change`**), **`out_of_scope`**, **`verification`** (**`label`**, **`command`**, **`phases`**), **`questions`** (**`question`**, **`options`**, `recommendation`); `title`, `impact`, `evidence`, `approval`, `operation`, `reply` (as in `complete_fix`) | title 60; goal 300; 2 to 8 phases (title 60, detail 160); behaviour 8 × 200; approach 700; files 20 (change 140); out of scope 6 × 200; verification 12 checks (label 60, command 200, never a whole-suite command or one listed twice; phases 1-based, at least one, within the plan); questions 4 (question 200, 2 to 4 options of 100); impact 1,000; operation 8 × 200; reply as in `complete_fix` |
| `complete_phase` | `reply` (as in `complete_fix`); **`summary`**, **`spots`** (**`file`**, **`start`**, **`end`**, **`attention`**: critical, high or normal, **`why`**, `title`, `explain`), **`judgement_calls`** (**`title`**: a few words naming the decision, **`call`**, **`reason`**, `file`, `line`, `end`, `alternatives` (**`option`**, **`rejected`**)); `walkthrough` (**`approach`**, **`flow`**, `risks` (**`title`**: a few words naming the risk, **`risk`**, `file`, `line`, `end`), `testing` (`automated`, `manual` (**`action`**, `target` (**`kind`**: url, file, command or screen, **`value`**), **`expect`**)), `steps` (**`when`**: pre_merge or post_merge, **`kind`**: env, secret, migration, deploy, config or other, **`title`**, **`detail`**, `command`), `watchdogs` (**`title`**, **`check`**, `first_check_minutes`, `max_gap_hours`, `for_hours`, `starts` (`merge` or `production`) with `production_check`, and exactly one of `source` (**`server`**, **`data`**) or `source_request` (**`data`**, **`evidence`**, **`suggestions`**))), asked for on the last phase; `check_changes` (**`action`**: add, change or remove, `id` (not for add), `label`, `command`, `phases`, **`reason`**) | summary 240; 8 spots (why 180, title 80, explain 400); 5 judgement calls (title 60, call 120, reason 240; 3 alternatives, option 100, rejected 200); walkthrough approach 1,200, flow 2,400, 8 risks (title 60, risk 280), testing automated 4 × 240 and 10 manual steps (action 240, target 400, expect 240), 8 steps (title 80, unique per `when`; detail 400; command 400); 5 watchdogs (title 80, unique; check 600; server 128; data 200; evidence 600; 1 to 4 suggestions of 160; first check 1 to 720 minutes, gaps up to 1 to 24 hours, for 1 to 720 hours and no less than the first check; production check 400, required with `starts: production`; a `source_request` whose suggestions name a server the run already has is refused unless its `evidence` says it checked that server (“checked <server>” in one clause), here and on `complete_fix`); 6 check changes (id 12, label 60, command 200, reason 200; an add needs a label and a command); reply as in `complete_fix` |
| `complete_fix` | **`summary`**; `reply` (**`headline`**, **`points`** (**`ask`**, **`outcome`**: done, answered or not_changed, **`note`**), `next`), required while a request of yours is open and refused otherwise; `walkthrough` (`approach`, `flow`, `risks` (**`title`**, **`risk`**, `file`, `line`, `end`), `testing`, `steps`), only when the fix changes how the change works, with only the parts that changed and at least one; `testing` and `steps` replace the part whole, an empty one included; `checks` (ids of checks to run again besides the failing ones); `check_changes` as in `complete_phase`; `evidence_kept` (earlier items, by key or id, that still show the work as it is) | summary 240; reply headline 240, 1 to 8 points (ask 160, note 280), next 1,200; walkthrough as in `complete_phase`; checks 12 ids of 12; check changes as in `complete_phase`; evidence kept 24 of 60 |
| `report_review` | **`findings`** (**`severity`**: `blocking`, `should_fix` or `optional`, **`message`**: what is wrong and why it matters, `title`, `fix`, `file`, `line`, `end`); `summary`; `disagreements` (**`call`**: the judgement call's number in the brief, **`reason`**) | summary 400; 12 findings (title 80, message 280, fix 600); 8 disagreements (reason 280), each call once |
| `answer` | **`answer`**; `propose_change` (**`request`**, **`why`**); `reply` (as in `complete_fix`) | answer 8,000; request 2,000, why 240; reply as in `complete_fix` |
| `report_diagnosis` | **`diagnosis`**; `propose_change`; `reply` | 12,000; reply as in `complete_fix` |
| `submit_report` | **`report`**; `propose_change`; `reply` | 40,000; reply as in `complete_fix` |
| `report_outcome` | **`outcome`**; `reply` | 8,000; reply as in `complete_fix` |
| `report_read` | **`summary`**: what it read, filed and skipped; `reached` (false when the source still failed after 3 tries; true when left out); `live` (only for a watchdog waiting for production: false while it is not live, true once it is; a report filed counts as true) | 1,000 |
| `file_report` | **`title`**, **`request`**, **`text`**; `report_id` or `link` (one is required), `author`, `posted_at`, `fork_from` (a task id or handle; a watchdog's is always the shipped task), `repository` (a name) | title 100; request 2,000; report_id 200; link 2,000; author 120; posted_at 60; text 4,000 |
| `reshape_task` | **`reason`**; `shape` (answer, investigate, research) or `steps` (`PIPELINE_ORDER` names) | reason 240 |
| `attach_evidence` | **`kind`** (comparison, screenshot, recording, test, check, note, preview); for test or check only **`check`** (a check id of the task) and `detail`; otherwise **`title`**: what it shows, the same for a before shot and its after shot; `detail`: what to look at; `width` (CSS pixels), `theme` (light, dark), `stage` (before, after); `key`: what it shows, lower-case words and hyphens (not for a test or check); `replaces`: earlier items by key or id; exactly one of `path`, `url` (http or https) or `text`, or for a comparison **`parts`** (each **`path`**, `stage`, `label`) | title 80; detail 280; check 12; width 1 to 7,680; text 40,000; url 2,000; path 300; 2 to 6 parts, label 40; key 60; replaces 24 |
| `remove_evidence` | **`items`** (by key or id), **`reason`**: why it no longer applies | 1 to 24 items of 60; reason 200 |

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
| `task.detail { taskId }` | Send a summarized task whole and keep it whole on this socket: the page opened or hovered it |

| Server → page (`ServerMessage`) | When |
| --- | --- |
| `state { state }` | On connect, after every other connect message, and on `state.sync`: the state as the page holds it (`WireState`, below), settled tasks as summaries |
| `task.detail { detail }` | After `task.detail`: a `TaskDetail` (below), queued in order with patches |
| `state.patch { patch }` | After every change: a `StatePatch` from log position `from` to `to` |
| `ack { id, error }` | After a command, after its patch; `error` is `{ code, message }` or null |
| `transcript { runId, entries, start }` | On subscribing (the entries from `from`, in pages of 500) and for each new entry; `start` is the position of the first one |
| `accounts { accounts }` | On connect and after every change to the accounts |
| `surfaces { desktop }` | On connect, and when whether any desktop surface is connected changes |
| `engine { engine }` | On connect, right after `surfaces` and before every other message: what this engine speaks, an `EngineInfo` (below) |
| `terminals { terminals }` | On connect and after every change to your terminals or services: `TerminalsSnapshot` (the terminals in order, each with the service it runs if any, your services, your home folder) |
| `resources { resources }` | On connect once sampled, then every 5 s while a page is connected: `MachineResources` (core's `remote/resources.ts`: the machine's cores, CPU percent, memory used and total, disk free and total, and each open task's agent, services and checks as CPU percent and memory, its process count and its worktree's size). An engine samples only while a socket listens, so a page that never reads it costs nothing; an older engine never sends it and an older page ignores it |
| `remote { remote }` | On connect and after every change to remote access (a device added or forgotten, pausing, resuming, removing, the tunnel's status, a pairing, a team): `RemoteSnapshot` (Remote access, below) |
| `teams { teams }` | On connect and after every change to what the machine watches of its teammates: `TeamFeedSnapshot` (Teams, below) |

Each terminal has a socket of its own, `/ws/terminals/<id>` (`packages/core/src/protocol/terminals.ts`, `docs/engine.md`
→ Terminals): binary frames carry the shell's output and what you type, text frames carry `reset { cols, rows }` and
`live` (server → page, around the screen sent on attach) and `resize { cols, rows }` and `colors { colors }` (page →
server, `parseTerminalClientFrame`). A terminal (`TerminalInfo`) is in a project, at a place (`TerminalPlace`:
`repository`, `folder` or `worktree`, `listTerminalPlaces`), and `running`, `exited` or `stopped`; a service's
terminal keeps the port its run was given (`port`), which `resolveServiceUrl` puts in the service's `previewUrl`
for `ServiceView.url`, and while remote access is on a running service terminal carries its private address
(`remoteUrl`, `https://<label>.shinsa.page/…`, null otherwise), which `ServiceView.remoteUrl` carries on. Opening it
takes an access token (`createPreviewAccessToken`: instance, preview id, account and expiry, an HMAC with the connect
key) that the Worker passes on as `x-shinsa-preview-access` (`docs/engine.md` → Private service addresses).

**What an engine speaks** (`packages/core/src/protocol/engine.ts`). The hosted web app is built from `main` and can
be newer than the engine it reaches, so every engine tells each page what it speaks (`resolveEngineInfo`) and the page
offers nothing an engine cannot do (`docs/engine.md` → Remote access, What each machine speaks):

| `EngineInfo` field | Holds |
| --- | --- |
| `version` | The engine's build, `0.0.0` in development (`DEVELOPMENT_VERSION`) |
| `protocol` | `ENGINE_PROTOCOL`, raised only when an older page and this engine cannot talk at all (a changed state shape) |
| `commands` | Every user command type it parses, `USER_COMMAND_TYPES` itself, so a new command is announced the moment it exists |
| `features` | The named capabilities in `ENGINE_FEATURES` (`task.share` and `feedback` today) that are not a command, such as a route or a setting an older engine ignores |

`ENGINE_BASELINE_COMMANDS` is frozen: the commands every engine has had since before the `engine` message, which a page
sends to any engine, one that never announced included (`resolveEngineCommands(null)`). A command added since is
outside it and must be listed in core's test (`GATED_COMMANDS` in `test/protocol/engine.test.ts`), which fails on any
command in neither. `parseEngineInfo` reads the message leniently (unknown fields dropped, a missing version read as
development) and refuses one without a whole-number `protocol`. `hasEngineFeature` and `isEngineProtocolMatch` answer
for one engine; an engine that sent nothing has no features and matches.

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
| `conflicts` | The pull request conflicts with its base, or the branch was being updated onto its base |

**Settled tasks as summaries** (`packages/core/src/protocol/summaries.ts`). `serializeViewState(state, summarized)`
makes the state a socket gets, the tasks in `summarized` (`listSummarizedTasks`: every settled task, on connect and
`state.sync`) as summaries; `resolveViewPatch(patch, previous, next, summarized)` rewrites the shared patch for one
socket, returning the same patch when it touches none of them, and the view it leaves (a task that reopened or went
away leaves it, sent whole):

| Summarized | What the page gets |
| --- | --- |
| The task (`summarizeTask`) | A `WireTask` with `summarized: true`; `plan`, `report` and `coverage` null; `phaseReports`, `findings`, `overlaps`, `planHistory`, `iterations`, `dismissedFindings` and `reviewDisagreements` empty; `activity` only its last entry and its newest agent entry. `isSummarizedTask` tells one |
| Its runs (`summarizeRun`) | Each without `summary` (null), `feedback`, `compactions`, `continuations`, `silence`, `cohort`, `waitingOn`, `fork` and `failure`, and only its last attempt, without `cwd` and with `handoff` null |
| Its gates | Only the open ones, whole |
| Its evidence | None |

A `TaskDetail` (`resolveTaskDetail`) is `{ taskId, seq, task, runs, gates, evidence }`: the task whole (null when it is
gone), its runs as `WireRun`s, its gates and evidence, and the log position it was read at. `applyTaskDetail` replaces
the task's entries in a `WireState` with it, or answers null when `seq` is not the state's.

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

## Remote access

Everything the engine, the web app and the Worker on app.shinsa.dev share for remote access is in
`packages/core/src/remote/` (how it behaves is `docs/engine.md` → Remote access). It uses WebCrypto only, and key
pairs and secrets come from the caller, so core stays free of randomness.

**The wire contract** (`contract.ts`, append-only: a paired machine updates on its own schedule and the Worker deploys
on merge, so a path or field is never renamed or removed, only optional fields added):

| Path on app.shinsa.dev (`REMOTE_PATHS`) | Who calls it | What it does |
| --- | --- | --- |
| `POST /__remote/pair/start` | The engine | `{ name, publicKey, version }` → `{ claimCode, pollSecret, url, expiresAt }` |
| `POST /__remote/pair/poll` | The engine | `{ claimCode, pollSecret }` → `pending`, `expired` or `claimed` with `MachineCredentials` and the owner's GitHub login, once |
| `GET /__remote/pairs/<code>`, `POST …/approve` | The pairing page | The machine's name and key fingerprint; approving creates the instance and its tunnel |
| `POST /__remote/machine/heartbeat`, `offline`, `remove` | The engine, with its machine token | `{ localUrl, version, signingKey? }` (`HeartbeatRequest`; `signingKey` the machine's ECDSA P-256 public key, raw and base64url, kept when left out, else 400 `body_invalid`) keeps the instance online and its ingress on the engine's port and answers `{ ok, owner, members, guests }` (`HeartbeatResponse`, a `RemoteAccess` and the machine's guests as `RemoteMember`s), which the engine reads leniently; a 401 means revoked |
| `POST /__remote/machine/invites`, `POST /__remote/machine/invites/remove` | The engine, with its machine token | The machine's one reusable invite token, replacing the one before (`InviteCreateResponse`: `token`); removing it turns the invite off |
| `POST /__remote/machine/requesters/find`, `POST /__remote/machine/members/add`, `POST /__remote/machine/members/remove` | The engine, with its machine token | `{ userId }` (`MemberRequest`): the GitHub user of an account that opened this machine's invite, a member, the owner or someone in a team with the owner (a `RemoteUser`, else 404); making such an account a member when you accept its request or give a teammate this machine (a `RemoteMember`, 409 `members_full` past 20); taking a member's access away |
| `POST /__remote/invites/accept` | The enroll page | `{ token }` (`InviteAcceptRequest`) records that the signed-in account asked and answers the machine's `instanceId`, `name`, `owner`, the account's `user` and a `connect` (`ConnectResponse`) to ask the machine with (`InviteAcceptResponse`); it makes no member |
| `POST /__remote/machine/handoffs`, `POST /__remote/machine/handoffs/remove` | The engine, with its machine token | A new hand-off token (`InviteCreateResponse`), one per hand-off; removing takes `{ token }` (`HandoffRemoveRequest`) and turns that one off |
| `POST /__remote/machine/guests/add`, `POST /__remote/machine/guests/remove` | The engine, with its machine token | `{ userId }` (`MemberRequest`): makes an account that opened a hand-off link a guest (409 `guests_full` past `MAX_INSTANCE_GUESTS`, 20), or removes one |
| `POST /__remote/handoffs/accept` | The claim page | `{ token }` answers as `invites/accept` does, for a hand-off token (404 `handoff_invalid`) |
| `GET /__remote/session`, `/__remote/sign-in`, `POST /__remote/sign-out` | The page | GitHub sign-in (`RemoteSession`) |
| `GET /__remote/sign-in?client=native&redirect=…&code_challenge=…`, `POST /__remote/sign-in/token` | The iPhone app | GitHub sign-in that ends at `shinsa://` (or `shinsa-dev://`, `REMOTE_NATIVE_REDIRECT_SCHEMES`) with `?code=`, a one-time code bound to the app's S256 challenge, traded once within 60 s for `{ token, user }` (`NativeSignInTokenRequest`, `NativeSignInTokenResponse`); a failed sign-in ends at `?error=` |
| `GET /__remote/instances`, `POST …/<id>/connect`, `POST …/<id>/remove`, `POST …/<id>/leave` | The page | The instances you own or are a member of (`RemoteInstance`, with its `owner` and your `role`, `owner`, `member` or `guest`), a connect token and the channel's URL (`ConnectResponse`), removal (the owner only), leaving (a member or a guest) |
| `/hooks/<instance>/<schedule>/<token>` | Anyone | A webhook, forwarded to the tunnel's `/api/hooks/<schedule>/<token>` (`parseRemoteHookPath`) |
| `POST /__remote/shares/<instance>/connect` | Anyone with a share link | `ShareConnectResponse` (`url`: `wss://t-<instance>.shinsa.dev`, `online`), no session, `X-Robots-Tag: noindex`; 404 when the instance does not exist (`resolveShareConnectPath`) |
| `POST /__remote/machine/teams` | The engine, with its machine token | `{ name }` (`TeamCreateRequest`) makes a team its owner owns (409 `teams_full` past `MAX_OWNED_TEAMS`) and answers `TeamCreateResponse` (`team`, a `RemoteTeam`, and `invite`) |
| `POST /__remote/machine/teams/join`, `POST /__remote/teams/join` | The engine, with its machine token; the join page | `{ invite }` (`TeamJoinRequest`) records that the account asked, unless it is in the team already, and answers `TeamJoinResponse` (`teamId`, `name`, `owner`, `status`: `requested` or `member`); 404 `invite_invalid` for a link turned off |
| `POST /__remote/teams/preview` | The join page, signed in | `{ invite }` answers `TeamPreviewResponse` (`name`, `owner`) so the page names the team before anyone asks; records nothing; 404 `invite_invalid` for a link turned off |
| `POST /__remote/machine/teams/<team>/<action>` | The engine, with its machine token | `TeamAction`: `invite` (a new invite, `TeamInviteResponse`), `invite/remove`, `members/add` and `requests/decline` (`{ userId }`, of an account that asked), `members/remove`, `remove` (the owner only, else 403 `not_owner`), `leave` (a member; 409 `owner_cannot_leave`), `connect` (`TeamConnectRequest`, below); 404 for a team the account is not in |
| `GET /__remote/teams`, `POST /__remote/teams/<team>/leave`, `POST /__remote/teams/<team>/connect` | The page | Your teams (`RemoteTeam[]`), leaving one, and a team connect token |
| any path on `<label>.shinsa.page` | Anyone with a preview link | A shared preview (`previews.ts`): `?key=` set as the `__Host-shinsa_preview` cookie and a 303 to the same path without it; with the cookie, forwarded with `x-shinsa-preview-key` (`PREVIEW_KEY_HEADER`) to the tunnel's `/__preview/<id><path>` (`resolvePreviewTunnelPath`), WebSockets included; `PREVIEW_GONE` (404) or `PREVIEW_OFFLINE` (503) otherwise |

A **team connect token** (`connect`, `{ instanceId }`) is answered only for the team's owner or a member and a
machine of one of them, as `ConnectResponse` with `url` `wss://t-<instance>.shinsa.dev/team?token=…`
(`resolveTeamChannelUrl`), the token signed with that machine's connect key for the GitHub account that asked. The
heartbeat's answer also carries `teams` (`RemoteTeam[]`: `id`, `name`, `owner`, your `role`, `members`, `requests`
(the owner's only), `machines` (`TeamMachine`: `id`, `name`, `userId`, `online`, `lastSeenAt`, `signingKey` when the machine sent one, every member's), and
`createdAt`).

Every signed-in route above takes the session as the `__Host-shinsa_session` cookie or as `Authorization: Bearer
<token>`; a bearer request needs no `Origin`, since it is not a page.

**Teams** (`teams.ts` here, `share/teams.ts` for the list): the join link is `https://app.shinsa.dev/share/team#<team>.<invite>.<key>`
(`TeamJoinFragment`, `resolveTeamJoinUrl`, `parseTeamJoinUrl`, `REMOTE_PATHS.teamJoinPage`), the key `TEAM_KEY_BYTES`
(32) as base64url (`isTeamKey`), never sent to a server. The tunnel's `TEAM_CHANNEL_PATH` (`/team?token=…`) takes one
`TeamHello` (`team`, `view`: `TeamView`, `{ kind: 'list' }` or `{ kind: 'task', taskId }`, a fresh `ephemeral`, and
`proof`, an HMAC with the team key over the team, the view and the key), answered by a welcome with the machine's
fresh key and a proof over all of it or by `refused`; both derive the session key with the view in it
(`deriveTeamSessionKey`, `TeamKeys`), then the machine sends `ShareMessage`s as a share does. A list view is a
`TeamListView` (`tasks`: `TeamTask[]`, `machineKey`: the machine's public key, `updatedAt`, `snapshot`: the same list
signed, and `held`: the signed lists it keeps of the team's offline machines): each a `SharedListing` (the redacted task, its gates, its project, its repository)
with `owner` (GitHub login) and `machine` (its name), every open task of the team's projects and the
`TEAM_SETTLED_LIMIT` (50) most recently finished. A task view is a `ShareLiveView`. What a machine watches is a
`TeamFeedSnapshot`: `machines` (`TeamFeedMachine`: `teamId`, `instanceId`, `name`, `userId`, `status`, one of
`connecting`, `live`, `offline`, `refused`, `reason`, and `updatedAt`, when the owner's machine made the list it shows; the page marks a machine that is not `live` but has one as Offline) and `tasks` (`TeamFeedTask`: a `TeamTask` with its `teamId`
and `instanceId`); `GET /api/teams/tasks` (`TEAM_TASKS_PATH`, `?team=`, `?open=true`) answers the same shape. The
local relay of one task is the socket `TEAM_VIEW_PATH` (`/api/teams/view?team=&machine=&task=`, `resolveTeamViewPath`,
`parseTeamViewTarget`), which carries the task's `ShareMessage`s as text and closes on anything the page sends. A
`TeamSnapshot` is `{ body, signature }`: `body` the JSON of `TeamSnapshotBody` (`teamId`, `instanceId`, `tasks`,
`updatedAt`), `signature` an ECDSA P-256 SHA-256 signature (`SIGNING_KEY_ALGORITHM`) over `shinsa-team-snapshot-v1`, a
newline and `body`, as base64url (`signTeamSnapshot`, `verifyTeamSnapshot` with the signer's `TeamMachine.signingKey`,
`selectTeamSnapshotSigner`); a copy lasts `TEAM_SNAPSHOT_TTL_MS` (30 days) from its `updatedAt`
(`isTeamSnapshotExpired`). The engine keeps them in `data/team-snapshots.json` (`{ version: 1, lists }`, each
`teamId`, `instanceId`, `keyDigest`, the team key's SHA-256 in hex, `tasks`, `updatedAt` and `snapshot` or null).

**Shared previews** (core's `remote/previews.ts`): a link is `PreviewLink` (`instanceId`, `previewId` of
`PREVIEW_ID_BYTES`, `key` of `PREVIEW_KEY_BYTES`, base64url), written `https://<label>.shinsa.page/?key=<key>`
(`PREVIEW_ORIGIN`; `serializePreviewUrl`, `parsePreviewUrl`), the label lowercase base32 of the preview id's bytes
followed by the instance id's (`serializePreviewLabel`, `parsePreviewLabel`, `parsePreviewHost`), one DNS label of 63
characters at most. The engine's tunnel route is `PREVIEW_TUNNEL_PREFIX` (`/__preview/<id><path>`,
`parsePreviewTunnelPath`); its pages are `serializePreviewPage('gone' | 'stopped' | 'offline')` (`preview-page.ts`,
`PREVIEW_PAGES`), one self-contained page each in the app's empty-state look. Nothing is sealed: the key is checked on every request (`docs/engine.md` → Sharing a preview).

**Shared tasks** (`shares.ts` and `share-channel.ts` here, `share/` for the projection): `SharedTask` is `task` (a
`Task` with every field not copied by name left empty), `gates` and `runs` (redacted), `evidence` (current evidence; a
stored file's `uri` is `shared-evidence:<id>`, `SHARED_EVIDENCE_PREFIX`), `repo` and `project` (their records without
path, folders or description), `owner`, `machine`, `repository` (its name), `code` (`hasSharedCode`: a repository
with a working copy or an open or merged pull request), `description` (the writer's one or two sentences on what the
task addresses, made when you share it), `update` (`ShareUpdate`, the customer's update worked out from where the task
stands: `planning`, `working`, `ready`, `deploying`, `live`, `looking_into`, `answered`, `done` or `closed`) and
`preset`, whose groups decide which of them are filled (a Status share has no owner, machine, repository, evidence or
code; its card dates itself by the task's `stageChangedAt`), the same for a public or a private repository (`docs/engine.md` → Sharing a
task has the table). A link is `ShareLink` (`instanceId`, `shareId` of `SHARE_ID_BYTES`, `key` of `SHARE_KEY_BYTES`),
written `https://app.shinsa.dev/share/t/<token>#<key>`, the token the share id's bytes followed by the instance id's, as
base64url (`serializeShareUrl`, `resolveSharePagePath`, `parseShareUrl`, `parseShareLocation`). Its channel is the tunnel's `SHARE_CHANNEL_PATH` (`/share?id=<share id>`,
`resolveShareChannelUrl`): the page sends one `ShareHello` (`share`, a fresh P-256 `ephemeral`, `proof`: an HMAC with
the key), the machine answers `ShareWelcome` (`welcome` with its fresh key and a proof over both, or `refused`), both
derive one AES-GCM key (`deriveShareSessionKey`: HKDF over the ECDH and the key), and from then on only the machine
sends, sealed frames of `ShareMessage`: `view` (a `ShareLiveView`: `shared`, `files`: each file id's `ShareFile`
`{ version, type }`, `updatedAt`), `file`, `body` and `end` (a file in 256 KB chunks, one of `SHARE_FILE_TYPES`,
`SHARE_FILE_BYTES` at most) and `closed` (the link ended, with the reason). A file's id is its evidence id, `diff`
(`SHARE_DIFF_FILE`), `code` (`SHARE_CODE_FILE`, `{ files: { <path>: <content at the head> } }`) or, for each
Standard or Full access share's run, `transcript-<run id>-<page>` (`resolveShareTranscriptFile`: one page of 200 of the run's
`ChatEntry[]` after `redactTranscriptPage`, versioned by its entry count, so a full page is sent once).

`MachineCredentials` is `instanceId`, `machineToken`, `tunnelToken`, `tunnelHost` (`t-<instance>.shinsa.dev`,
`resolveTunnelHost`), `connectKey`. The enrollment link is `https://app.shinsa.dev/enroll#<instance>.<machine
key>.<secret>`, with `.<invite token>` after it for an invite (`EnrollFragment`, `resolveEnrollUrl`,
`parseEnrollFragment`): everything after `#` stays in the browser. A hand-off link is the same fragment at `/claim` with a hand-off token in place of the invite token (`resolveClaimUrl`). A GitHub account is a `RemoteUser` everywhere
(`id`, `login`, `name`, `avatarUrl`); a machine's people are a `RemoteAccess` (`owner`, and `members`, each a
`RemoteMember`: `user`, `addedAt`).

**Connect tokens** (`connect-token.ts`): `<payload>.<signature>`, base64url, the payload `{ i: instance, u: GitHub
user, e: expiry }` and the signature an HMAC-SHA256 with the instance's connect key. `verifyConnectToken` refuses
another instance, an expired token and one that lives longer than `CONNECT_TOKEN_TTL_MS` (60 s).

**The handshake** (`handshake.ts`, `REMOTE_PROTOCOL_VERSION` 1), on `wss://<tunnel host>/remote?token=…`, as text frames:

| Message | From | Fields |
| --- | --- | --- |
| `hello` | The browser | `version`, `device` (its P-256 public key, raw, base64url), `ephemeral` (a fresh one), `enroll` (null, or the proof), `name` (the device name it asks under, null, at most `DEVICE_NAME_LIMIT`, 60) |
| `pending` | The engine | Nothing: the request waits for an answer, and `welcome` or `refused` follows on the same socket |
| `welcome` | The engine | `ephemeral` (its fresh key) |
| `refused` | The engine | `reason`; the socket then closes |

Both sides compute three ECDH secrets, `ee` (the two ephemerals), `es` (the browser's ephemeral and the machine's
key) and `se` (the device's key and the engine's ephemeral), and HKDF-SHA-256 over them, salted with a SHA-256 of
the four public keys, gives one AES-256-GCM key per direction (`deriveClientSession`, `deriveServerSession`). Only
the holder of the machine's private key and of an added device's private key can finish it. The link proof is an
HMAC-SHA256 with the link's secret over the machine key, the device key and the browser's ephemeral
(`createEnrollProof`, `verifyEnrollProof`), so a proof seen on the way works for no other device.

**Frames** (`frames.ts`): every message after the handshake is one binary frame, an 8-byte counter and the AES-GCM
ciphertext, the counter as the nonce, so no nonce repeats. Sealing and opening run in call order; a frame that is
short, out of order or fails to open throws `FrameError` and the channel closes.

**Inside the channel** (`channel.ts`, `ChannelMessage`, JSON in each sealed frame):

| Message | What it carries |
| --- | --- |
| `{ t: 'ready' }` | Each side's first frame: it confirms the key |
| `{ t: 'socket', data }` | One message of the app socket (`ClientMessage` or `ServerMessage` above) |
| `{ t: 'request', id, method, path, headers }` | An HTTP request; `path` starts with `/` |
| `{ t: 'response', id, status, headers }` | Its answer |
| `{ t: 'body', id, chunk }` / `{ t: 'end', id }` | A body in base64url chunks of 256 KB (`CHANNEL_BODY_CHUNK_BYTES`), then its end |
| `{ t: 'abort', id }` | The page gave up on a request |

**One task for a guest** (`scope.ts`): a device with a task is a `GuestActor` (`taskId`, `login`). Its socket gets `resolveScopedState` and `resolveScopedPatch` (that task, its runs, gates, evidence, repository and project, accounts without their email, no share, previews or hand-off link) and `resolveScopedEngineInfo` (only `SCOPED_COMMANDS`); `resolveScopedRefusal` refuses any other command, another task's, a secret or sign-in gate's answer and a retry on a chosen account, with the code `handoff_scope` (`SCOPE_REFUSAL_CODE`, `SCOPE_MESSAGES`).

**What stays at the keyboard** (`local-only.ts`): `isLocalOnlyCommand` names the user commands a remote request may
not send (a human-only setting or repository field, `task.bind_account`); the refusal's code is `local_only`
(`LOCAL_ONLY_CODE`, `LOCAL_ONLY_MESSAGE`). A request's `RequestOrigin` (`local` or `remote`) comes from how it
arrived, never from the page.

**The engine's snapshot** (`status.ts`, `GET /api/remote`): `RemoteSnapshot` is `paired`, `enabled`, `status`
(`TunnelStatus`: `off`, `starting`, `connected`, `reconnecting`, `revoked`), `instanceId`, `owner`, `machineName`,
`machineKey`, `pairing` (`PairingView`: `claimCode`, `url`, `expiresAt`), `devices` (`RemoteDevice`: `publicKey`,
`name`, `enrolledAt`, `lastSeenAt`, `taskId` for a device a task was handed to, which reaches only that task, `userId`: the GitHub account the device was added for, null for a device from
before members), `access` (the `RemoteAccess` the last heartbeat answered, null until one did), `link`
(`RemoteLink`: `url` and `createdAt`, the one invite link, or null while it is off) and `requests` (`AccessRequest`:
`id`, `publicKey`, `deviceName`, `user`, a `RemoteUser`, and `requestedAt`) and `teams` (`RemoteTeamEntry`: `id`,
`name`, `status`, `member` or `requested` (a key kept while the owner answers), `onMachine` (this machine holds the
team key), `invite` (a join link is on), and `team`, the `RemoteTeam`, null while requested). The enroll fragment
(`EnrollFragment`) is `<instance>.<machine key>.<secret>.<invite token>`, all four parts required.

## Slack

What the engine, the Worker on app.shinsa.dev and the web share for the Slack bot is in `packages/core/src/slack/`
(how it behaves is `docs/engine.md` → Slack). Like remote access's contract it is append-only.

| Path (`SLACK_RELAY_PATHS`, `SLACK_ENGINE_EVENTS_PATH`, `SLACK_ENGINE_INTERACTIONS_PATH`) | Who calls it | What it does |
| --- | --- | --- |
| `GET /slack/connect?instance=<id>` | The browser, from Settings | Signs in with Slack for one of your machines (the one seen last without `instance`) |
| `GET /slack/connect/callback`, `/slack/install/callback` | Slack | Writes the link, adding the app to the workspace first when it has none; then `/slack/linked?team=` or `?error=` (`resolveSlackLinkedPath`) |
| `POST /slack/events` | Slack | Events API, checked against Slack's signature; a mention is answered at once and forwarded after |
| `POST /slack/interactions` | Slack | Interactivity (`payload` form field), checked against Slack's signature and answered at once; a `shinsa.answer.<n>` click from a linked person on a message their machine posted is forwarded as a `SlackAnswer`, and the click's `response_url` (on `hooks.slack.com`) gets the answered post or a private refusal; anything else is dropped |
| `POST https://t-<instance>.shinsa.dev/api/slack/interactions` | app.shinsa.dev | The `SlackAnswer` (`SLACK_ENGINE_INTERACTIONS_PATH`), signed as a mention is → `SlackAnswerReply`: `{ answered: true, choice }` or `{ answered: false, reason }` |
| `POST https://t-<instance>.shinsa.dev/api/slack/events` | app.shinsa.dev | The `SlackMention`, with `x-shinsa-slack-signature` (`v1=<hex>`, an HMAC-SHA256 over `v1:<ms>:<body>` keyed by `slack:<connect key>`) and `x-shinsa-slack-timestamp` (`SLACK_FORWARD_HEADERS`), good for five minutes (`SLACK_FORWARD_WINDOW_MS`) |
| `POST /__remote/slack/post` | The engine, with its machine token | `SlackRelayPost` (`teamId`, `channelId`, `threadTs`, `replaceTs`, `message` of `text` and Block Kit `blocks`; `parseSlackRelayPost`) → `SlackRelayPosted` `{ ts }`; 403 for a thread not sent to it or a message it did not post, 410 when the app was removed, 502 when Slack refused |
| `POST /__remote/slack/session` | The engine, with its machine token | `SlackRelaySession` (the thread and a `status` of `SLACK_SESSION_STATUSES`: `processing`, `suspended`, `active`, `closed`; `parseSlackRelaySession`) → `SlackRelaySessionSet` `{ applied }`: `agents.sessions.setStatus`, `applied: false` when the workspace cannot show one (`not_authorized` from an app not on Agent Sessions, `feature_disabled` from a workspace without agent features), after which the engine stops asking for that workspace until it restarts; any other refusal is 502 `slack_failed`, logged, and tried again at the next change |
| `POST /__remote/slack/react` | The engine, with its machine token | `SlackRelayReaction` (the thread, the mention's `messageTs`, the emoji name to `add` and to `remove`, at least one; `parseSlackRelayReaction`) → `SlackRelayReacted` `{ applied }`: `reactions.remove` then `reactions.add` on a message of a thread sent to that machine; `no_reaction` and `already_reacted` count as done, anything else (`missing_scope` on a workspace that added the app before `reactions:write`) is `applied: false` |
| `GET /__remote/slack/links`, `POST /__remote/slack/unlink` | The engine, with its machine token | `SlackLinks` (`teamId`, `teamName`, `userId`, `userName`, `linkedAt` each); removes every link of the machine |

| Shape | Fields |
| --- | --- |
| `SlackMention` (`contract.ts`, `parseSlackMention`) | `eventId`, `teamId`, `channelId`, `threadTs`, `messageTs`, `userId`, `userName`, `text`, `permalink`, `thread` (`SlackThreadMessage`: `ts`, `userId`, `userName`, `text`, `bot`; the last 100, at most 4,000 characters each, `SLACK_LIMITS`) |
| `SlackPost` (`posts.ts`) | `gate` with its `gateId`, `result`, `forwarded`, `held` |
| `SlackMessage` (`blocks.ts`) | `text`, the notification's fallback, and `blocks` (`header`, `section` with text or fields, `context`, `actions` of buttons) within Slack's limits (`SLACK_BLOCK_LIMITS`: 50 blocks, 3,000 characters a section, 150 a header, 75 a button, 10 fields) |
| `SlackAnswer` (`answers.ts`, `parseSlackAnswer`) | `interactionId`, `teamId`, `channelId`, `threadTs`, `messageTs`, `userId`, `gateId`, `choice` (the index into the gate's choices; a button's value is `{ gateId, choice }`, `serializeSlackAnswerValue`) |
| `SlackSnapshot` (the engine's `GET /api/slack`) | `remote`, `connectUrl`, `links`, `problem` |

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
| Checks: whole-suite refusal, the repository baseline, blocking, when they run, the agent's changes | `packages/core/src/domain/checks.ts`, `decide/checks.ts`; the runner, re-runs alone and the base comparison in `apps/engine/src/checks/` |
| Shapes, presets, `validateComposition`, `resolveProposalUpgrade` | `packages/core/src/domain/shapes.ts` |
| Tools per role | `packages/core/src/domain/tools.ts` |
| Projects, keys, handles | `packages/core/src/domain/projects.ts` |
| Delegations, accounts, schedules, pull request watch, settings | `packages/core/src/domain/{delegations,accounts,schedules,pull-requests,settings}.ts` |
| Memory: the rules, their limits, what agents are told | `packages/core/src/domain/memory.ts`, `decide/memory.ts`, `state/memory.ts`, `prompts/memory.ts`; `apps/web/src/lib/memory.ts`, `components/settings/memory.tsx` |
| Feedback: entries, the privacy check, drafting and filing | `packages/core/src/domain/feedback.ts`, `decide/feedback.ts`, `state/feedback.ts`; `apps/engine/src/feedback/`, `surface/feedback.ts`; `apps/web/src/lib/feedback.ts`, `components/feedback/` |
| On your behalf record | `packages/core/src/domain/on-behalf.ts`, `decide/on-behalf.ts`, `state/on-behalf.ts` |
| Plan document, reports, findings, `PROTOCOL_LIMITS` | `packages/core/src/report/` |
| Commands and the parser | `packages/core/src/commands/` |
| Events | `packages/core/src/events/` |
| Effects, recovery, keys, lanes | `packages/core/src/effects/index.ts` |
| Decisions | `packages/core/src/decide/` (`messages.ts` for `resolveMessageEffect`) |
| State folds | `packages/core/src/state/` |
| Chat protocol | `packages/core/src/chat/protocol.ts` |
| Socket messages, surfaces, what an engine speaks | `packages/core/src/protocol/messages.ts`, `protocol/engine.ts`; `apps/engine/src/http/socket.ts`, `apps/web/src/lib/connection/socket.ts` |
| Terminals, their places and frames | `packages/core/src/protocol/terminals.ts`; `apps/engine/src/terminals/`, `apps/web/src/lib/terminal/` |
| Services, their states, suggestions and runs for a task | `packages/core/src/protocol/services.ts` (`ServiceView.taskId`, `ServiceView.url`, `resolveServiceUrl`, `resolveTaskServiceCwd`, `listTaskServices`, `listServiceTaskRuns`); `apps/engine/src/terminals/` (`detect.ts`, `routes.ts`), `apps/engine/src/agents/services.ts` (the agents' tools), `apps/web/src/lib/terminal/services.ts` |
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
    `decide/shapes.ts`); the `checks` step and the plan's `verification` stay for code changes. Tests:
    `domain/verification.test.ts`,
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
16. **The agent chooses the checks** (2026-10-27). The plan's `verification` is the task's checks, scoped commands
    (a whole-suite command is refused), changed with `check_changes`; Shinsa runs them per phase, after a fix and
    before review, and only a failure the change caused blocks (`domain/checks.ts`, `decide/checks.ts`). The
    repository's commands are a baseline only you change, and setup verification no longer asks for checks (no
    `waive`, no `checksWaived`). Tests: `domain/checks.test.ts`, `decide/checks.test.ts`.
