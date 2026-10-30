import {
  type Evidence,
  type EvidenceItem,
  hasStep,
  isComposedByAgent,
  isLaterRound,
  listEvidenceItems,
  type OperationTiming,
  type Repo,
  resolveCurrentRound,
  resolveOperationTiming,
  resolveTaskPipeline,
  SHAPE_LIMITS,
  selectShippingTarget,
  type Task,
  type WatchSource,
} from '../domain/index.ts';
import { assembleReport } from '../report/assemble.ts';
import { listMergeSteps, MERGE_STEP_WHEN_WORDS } from '../report/merge-steps.ts';
import { listTestingLines } from '../report/testing.ts';
import { PROTOCOL_LIMITS } from '../report/validate.ts';
import { describeCoverage, listCoverageGaps } from '../test-coverage/describe.ts';
import { resolveRepoCoverage } from '../test-coverage/setting.ts';
import {
  describeApprovedPlan,
  describeBases,
  describeDismissedFindings,
  describeEarlierWork,
  describeGoal,
  describeNoRepository,
  describePhaseChecks,
  describePlan,
  describePreviousPhases,
  describeRepository,
  describeRounds,
  describeTaskChecks,
  describeTaskLink,
  describeWhatFollows,
  isStacked,
  PROPOSAL_RULE,
  resolveLaterMessages,
  resolveRequest,
} from './context.ts';
import { resolveHouseRules } from './rules.ts';
import { describePlanParameters, describeStepCatalog, describeStepRules } from './steps.ts';
import { describeWatchdogGuide, describeWatchdogsForReview, type WatchdogDefaults } from './watchdogs.ts';

const OPERATION_NOTE = [
  'This task is an operation: something to run in the repository (a script, a migration, a cleanup), not code to ship. Nothing it does goes through a pull request.',
  'Plan the steps to run, in order, each with how to check it worked. The human approves the plan before anything runs, so say exactly what will change and how to undo it.',
].join('\n');

const COMBINED_NOTE: Record<Exclude<OperationTiming, 'alone'>, string> = {
  before_build:
    "This task runs an operation first and then changes the code: you run the operation once the human approves the plan, then build the phases, and the change goes through the human's review, a pull request and the merge.",
  post_merge:
    "This task changes the code and then runs an operation: you build the phases, the change goes through the human's review, a pull request and the merge, and then you run the operation on the merged code (a backfill, a migration, a cleanup).",
};

const FIXING = 'then whatever the checks, the agent review, the pull request or the human find to fix';

const ROUND_JOB: Record<OperationTiming | 'build', string> = {
  build: `each phase in turn, ${FIXING}.`,
  alone: 'the operation in the plan, step by step.',
  before_build: `the operation in the plan first, then each phase in turn, ${FIXING}.`,
  post_merge: `each phase in turn, ${FIXING}, and after the merge the operation in the plan.`,
};

function describeRoundJob(task: Task) {
  return ROUND_JOB[resolveOperationTiming(resolveTaskPipeline(task)) ?? 'build'];
}

export function resolveAgentPrompt(instruction: string) {
  return [resolveHouseRules('agent'), '', instruction].join('\n');
}

function describeOperationNote(task: Task) {
  const timing = resolveOperationTiming(resolveTaskPipeline(task));
  if (timing === null) return '';
  if (timing === 'alone') return ['', OPERATION_NOTE].join('\n');
  return [
    '',
    COMBINED_NOTE[timing],
    '`phases` hold the code change only. List the operation in `operation`: its steps in order, each with how to check it worked. The human approves the plan, the operation included, before anything runs, so say exactly what the operation will change and how to undo it.',
  ].join('\n');
}

function hasOpenPullRequest(task: Task) {
  return task.pullRequest?.state === 'open' || selectShippingTarget(task, resolveCurrentRound(task)) !== null;
}

function describeShapeChoice(task: Task) {
  if (hasOpenPullRequest(task)) {
    return "- An earlier round of this task has an open pull request, so this round ships through it: keep `build`, `pull_request` and `merge` in the steps, and do not wait for the human's OK before planning. It cannot become a question, an investigation or research.";
  }
  return '- `shape` when the request needs no change at all: `answer` (a question answered from the code), `investigate` (find the cause of a problem and report it) or `research` (compare options or research a topic and write a report).';
}

function describeReshapeNote(task: Task) {
  return [
    `Shinsa guessed what kind of task this is from the request. Its steps now: ${resolveTaskPipeline(task).join(', ')}.`,
    'Plan it when those steps fit the request; most tasks need no change. When they do not fit, call `reshape_task` instead of planning, then stop:',
    describeShapeChoice(task),
    '- `steps` to compose the task from these building blocks, in this order (`operate` goes right after `plan`, or last, after `merge`). Each step, who does it and when it is done:',
    describeStepCatalog(),
    'The rules, which Shinsa checks. A question, research or an investigation that changes nothing takes none of the verification steps; anything that changes code or runs an operation takes all of them:',
    describeStepRules(),
    'You cannot add a step or a gate of your own. You set the parameters in the plan instead: the checks in `verification`, the evidence, the impact of an operation, and whether the human approves the plan first.',
    'For example, find the cause and then run an operation from the diagnosis: `investigate`, `your_ok`, `plan`, `operate`. Research the options, then change the code: `research`, `your_ok`, `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge`. Ship a change, then backfill the data it needs: `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge`, `operate`.',
    `Shinsa checks the steps and tells you what to fix. \`reason\` says in one sentence why the task takes these steps, at most ${SHAPE_LIMITS.reason} characters.`,
  ].join('\n');
}

export function resolvePlanningPrompt(task: Task, repo: Repo | null, bases: Task[], feedback: string | null) {
  return [
    resolveHouseRules('agent'),
    '',
    `Your role: the agent for this task, in one conversation across all of its rounds. You plan this round, then carry it out yourself in this same conversation: ${describeRoundJob(task)}`,
    'Nobody else works from your plan, so write it for yourself and for the human who reads it.',
    'While you plan you can read the code and run commands, but you cannot change files: Shinsa refuses edits until the plan is in.',
    describeTaskLink(task),
    describeRounds(task),
    describeRepository(repo),
    describeBases(bases),
    '',
    'The human asked for:',
    resolveRequest(task),
    resolveLaterMessages(task),
    describeEarlierWork(task),
    describeOperationNote(task),
    describePlanParameters(task),
    task.auto.shape && !feedback && !task.plan && !isComposedByAgent(task)
      ? ['', describeReshapeNote(task)].join('\n')
      : '',
    feedback ? ['', 'Feedback on the previous plan:', feedback, '', task.plan?.body ?? ''].join('\n') : '',
    feedback
      ? 'This is a revision: say in `change_summary` what you changed and why, in one or two sentences.'
      : '',
    '',
    'Read the code you need to understand the change, then call `propose_plan`.',
    `The \`phases\` split the work into ${PROTOCOL_LIMITS.minPlanPhases} to ${PROTOCOL_LIMITS.planPhases} phases, in order. You build them one after another in this conversation, and Shinsa commits each one when you hand it over,`,
    'so a phase must be a step with a clear end: a title of a few words and one or two sentences saying exactly what is done and how it is verified.',
    'Small changes still get a plan; two or three phases is fine.',
    'Decide everything you can decide from the code and the request, and say so in the approach.',
    'If the human must decide something before work can start, ask it with `ask` first, then plan with the answer.',
    'Leave `questions` empty unless a decision can wait for the human to look at the finished work.',
    'Then stop.',
  ].join('\n');
}

function describeOperationForBuilder(task: Task) {
  if (resolveOperationTiming(resolveTaskPipeline(task)) !== 'post_merge') return '';
  return "Do not run the plan's operation yet: you run it after the pull request merges and the human confirms it.";
}

function describePhaseOpening(task: Task, index: number) {
  if (index > 0) return `Phase ${index} is committed.`;
  if (task.result?.step === 'operate') return 'The operation is done.';
  const answers = task.planAnswers ? ` They answered: ${task.planAnswers}` : '';
  if (task.plan?.approvedAt) return `The human approved the plan.${answers}`;
  return 'The plan is in, so building starts.';
}

function describePlannedEvidence(task: Task) {
  const kinds = task.plan?.document?.evidence ?? [];
  return kinds.length > 0
    ? `The plan asks for ${kinds.map((kind) => `\`${kind}\``).join(', ')} as evidence.`
    : '';
}

function describeCoverageForPhase(repo: Repo | null) {
  if (resolveRepoCoverage(repo).mode === 'off') return '';
  return 'Cover every piece of new logic with tests. After the checks, Shinsa measures how many of your changed lines the tests run and shows the lines they miss to the reviewer and the human.';
}

function describeEvidenceForPhase(task: Task, repo: Repo | null, index: number, last: boolean) {
  const kinds = task.plan?.document?.evidence ?? [];
  const visual = kinds.includes('screenshot') || kinds.includes('recording');
  return [
    describePlannedEvidence(task),
    index === 0 && visual
      ? 'Before you edit anything a user sees, run the app and capture those screens as they are now, with `stage: "before"`: the human sees each with its after shot as one comparison.'
      : '',
    'For user-facing changes, run the app and capture the evidence the evidence skill describes: a before and after comparison of every screen you changed at the widths and in the themes it lists (the after shot with `stage: "after"` and the same title, width and theme as its before shot, or both at once as `kind: "comparison"` with `parts`), a short recording for an interaction, the browser console read. Attach each with `attach_evidence`.',
    'Give each item a `key` for what it shows (like `settings-dark-900`). When a later change alters it, attach the new one with the same `key`: it replaces the old one, so never add a second; remove what no longer applies with `remove_evidence`.',
    'For logic, write the test that fails without your change and passes with it, make sure one of the checks runs it (add one with `check_changes` when none does), and link that check with `attach_evidence` (`kind: "test"`, `check`: its id). Shinsa runs it and shows its command, outcome and output; never paste test output as evidence.',
    describeCoverageForPhase(repo),
    last
      ? 'Before the review, give the human a live preview: call `list_services`, start each service that shows this change with `run_service` and leave it running, then attach the preview URL it reports, with the path to the screen to check, as `preview` evidence (`url`, a `title` naming the screen). Name that link in How to test. When no service shows the change, add the one that would with `add_service` first.'
      : '',
    last && kinds.length > 0
      ? 'Attach all of it before you call `complete_phase`: Shinsa refuses the last phase until each kind is there.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function resolvePhaseInstruction(
  task: Task,
  repo: Repo | null,
  index: number,
  sources: readonly WatchSource[] = [],
  defaults?: WatchdogDefaults
) {
  const plan = task.plan?.document?.phases ?? [];
  const phase = plan[index];
  const last = index >= plan.length - 1;
  return [
    describePhaseOpening(task, index),
    phase
      ? `Now build phase ${index + 1} of ${plan.length}: ${phase.title}. ${phase.detail}`
      : 'Now build the whole change.',
    describeOperationForBuilder(task),
    'Do this phase completely, and only this phase. Work until it is done and verified, not until it compiles.',
    describePhaseChecks(task, repo, index + 1, last),
    last
      ? 'This is the last phase: the whole change must work end to end when you finish.'
      : 'Later phases build on this one; leave the code in a working state.',
    describeEvidenceForPhase(task, repo, index, last),
    'When the phase is done, call `complete_phase`. The human reads it as a technical walkthrough of the change:',
    '- summary: what this phase changed, in one or two sentences.',
    '- spots: every line range (new-file line numbers) the human must read, each with why it matters.',
    '  critical = could break something or encodes a judgement call; high = worth a careful read; normal = context.',
    '  Give the key pieces of code a title and an explain: how that code works, in plain words.',
    '  Leave boilerplate and mechanical edits out.',
    '- judgement_calls: every choice the human might make differently, each with the alternatives you rejected and why.',
    last
      ? '- walkthrough: required now, for the whole change: the approach, how it works behind the scenes, the risks and edge cases with their lines, how to test it, and the steps the human must take around the merge.\n  `steps` lists only what needs a person or production access, before or after the merge: an environment variable or secret to set (name it and where; never its value), a migration or deploy to run, a config or feature flag to change, a service to restart, a backfill, a third-party setting. Do everything you can in the repository yourself (code, tests, docs, `.env.example`, migration files). Never a step to stage, commit, push or open a pull request: work in another repository is a task you file with `create_task`. Give each step its exact command when it has one. Leave `steps` out when there is nothing.\n  `testing` has two parts. `automated`: one or two lines on what the tests cover, naming the test files. `manual`: the steps the human follows in order, each an `action`, a `target` when it happens in one place (a `url`, a `file` as `path:line`, a `command` or a `screen`) and `expect`, what they should see. Start from where to go (the preview deployment URL, the local preview you attached, or the command that starts the app and its local URL), then what to click and type, then the edge cases worth trying.\n  Whenever the change has structure or a flow worth drawing (pieces that call each other, a path a request or data takes, states, a tree of files), draw it in `flow` (or `approach`) as a text diagram in a fenced code block: a tree, or boxes and arrows (`a ──► b`), at most 72 columns wide, aligned for a monospace font, with a few words on each step.' +
        describeWatchdogGuide(sources, defaults)
      : '',
    'Then stop.',
  ]
    .filter(Boolean)
    .join('\n');
}

function joinLines(lines: string[]) {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function describeRound(task: Task, repo: Repo | null, bases: Task[], before: number) {
  return [
    joinLines([
      `Your role: the agent for this task, in one conversation across all of its rounds. You planned this round and you carry it out yourself: ${describeRoundJob(task)}`,
      'Your conversation may no longer hold this round, so here is where it stands. Run `git status`, `git log` and `git diff` to see the work so far.',
      describeTaskLink(task),
      describeRounds(task),
      describeRepository(repo),
      describeBases(bases),
    ]),
    joinLines(['The human asked for:', resolveRequest(task), resolveLaterMessages(task)]),
    joinLines([
      describeGoal(task),
      describePlan(task),
      describeApprovedPlan(task),
      task.planAnswers ? `The human answered:\n${task.planAnswers}` : '',
    ]),
    describePreviousPhases(task, before),
    describeEarlierWork(task).trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function describeReviewScope(task: Task, repo: Repo | null, stacked: string | null) {
  if (stacked) {
    return `This task is stacked on ${stacked}. Diff against that branch and review only this task's changes.`;
  }
  if (isLaterRound(task)) {
    const round = resolveCurrentRound(task);
    const since = new Date(round.startedAt ?? round.queuedAt).toISOString();
    return `The earlier rounds were reviewed already. Review only this round's commits, the ones made since it started (\`git log --since=${since}\`), and read every change in them.`;
  }
  return `Diff the branch against ${repo?.defaultBranch ?? 'the default branch'} and read every change.`;
}

function describeJudgementCallsForReview(task: Task) {
  const calls = assembleReport(task).judgementCalls;
  if (calls.length === 0) return '';
  return [
    '',
    'The judgement calls the agent made, numbered. They are its claims, not facts; check each against the code:',
    ...calls.map((call, index) => `${index + 1}. ${call.title}. ${call.call}: ${call.reason}`),
    'For each one you would have made differently, add it to `disagreements` with its number, why, and what you would do instead. Leave out the ones you agree with.',
  ].join('\n');
}

function describeMergeStepsForReview(task: Task) {
  const steps = listMergeSteps(task);
  const listed =
    steps.length === 0
      ? ['The agent listed no steps for the human around the merge.']
      : [
          'The steps the agent listed for the human around the merge:',
          ...steps.map((step) => `- ${MERGE_STEP_WHEN_WORDS[step.when]}, ${step.kind}: ${step.title}`),
        ];
  return [
    '',
    ...listed,
    'Check the list is complete: an environment variable, secret, migration, deploy, config or feature flag the change needs that is missing from it is a blocking finding, and so is a step an agent could have done in the repository (code, tests, docs, `.env.example`, a migration file), a step that stages, commits, pushes or opens a pull request anywhere (work in another repository is a task the agent files with `create_task`), or a secret value written into a step.',
  ].join('\n');
}

function describeTestingForReview(task: Task) {
  const lines = listTestingLines(assembleReport(task).walkthrough?.testing);
  const listed =
    lines.length === 0
      ? ['The agent wrote no guide for testing the change.']
      : ['How the agent says to test the change:', ...lines];
  return [
    '',
    ...listed,
    'Check the guide is one the human can follow: follow the manual steps you can from the worktree. A step you cannot follow (a URL, file, command or screen that does not exist or does not lead where it says), a step whose expected result is vague, or a user-visible change with no manual steps is a finding.',
  ].join('\n');
}

function describeCoverageForReview(task: Task) {
  const summary = describeCoverage(task.coverage);
  if (!summary) return '';
  const gaps = listCoverageGaps(task.coverage);
  return [
    '',
    `Shinsa measured the tests' coverage of the changed lines: ${summary}.`,
    ...(gaps.length > 0
      ? ['Changed lines no test runs (new-file line numbers):', ...gaps.map((gap) => `- ${gap}`)]
      : []),
    gaps.length > 0
      ? 'Read those lines. Important new logic that no test runs (a branch that decides something, error handling, a calculation) is a finding: blocking when a bug there would go unnoticed, should fix otherwise. Leave out trivial lines.'
      : '',
  ].join('\n');
}

const REVIEW_AGAIN =
  'You reviewed earlier work on this task in this conversation. Judge this review on its own: check that your earlier blocking findings are fixed, read the new commits as closely as the first time, and never pass something because you passed it before.';

function describeEvidenceItem({ key, kind, title, parts }: EvidenceItem) {
  const [first] = parts;
  const names =
    kind === 'comparison' ? parts.map((part) => part.label ?? part.stage).join(' and ') : first?.stage;
  const facts = [names, first?.width ? `${first.width}px` : null, first?.theme].filter(Boolean).join(', ');
  return `- \`${key}\`, ${kind}: ${title}${facts ? ` (${facts})` : ''}`;
}

export function describeEvidenceForFix(evidence: readonly Evidence[]) {
  const items = listEvidenceItems(evidence).filter((item) => !item.parts.some((part) => part.checkId));
  if (items.length === 0) return '';
  return [
    'The evidence you attached this round, which the human sees in the review:',
    ...items.map(describeEvidenceItem),
    'If your fix changes what one shows, replace it before you hand over (attach a new one with the same `key`). Shinsa refuses `complete_fix` while an item whose files your fix changed is not replaced, removed with `remove_evidence`, or named in `evidence_kept`.',
  ].join('\n');
}

function describeEvidenceForReview(evidence: readonly Evidence[]) {
  const items = listEvidenceItems(evidence);
  if (items.length === 0) {
    return 'The agent attached no evidence this round. If the change is visible to a user, capture your own as the evidence skill describes and attach it with `attach_evidence`: the human sees it as independent evidence from the review.';
  }
  return [
    'The evidence the agent attached this round (the human sees it in the review):',
    ...items.map(describeEvidenceItem),
    'Check it shows what the change claims. Where a user-visible claim has none, or you doubt one, capture your own as the evidence skill describes and attach it with `attach_evidence`: the human sees it as independent evidence from the review.',
  ].join('\n');
}

export function resolveReviewerPrompt(
  task: Task,
  repo: Repo | null,
  bases: Task[],
  again = false,
  evidence: readonly Evidence[] = []
) {
  const stacked = bases.find((base) => base.branch && isStacked(base));
  return [
    resolveHouseRules('reviewer'),
    '',
    'Your role: reviewer. You did not write this code. Review it against the request, the plan and the repository rules. Do not edit code.',
    again ? REVIEW_AGAIN : '',
    describeTaskLink(task),
    describeRounds(task),
    describeRepository(repo),
    '',
    'The human asked for:',
    resolveRequest(task),
    '',
    describeGoal(task),
    describePlan(task),
    '',
    'What the agent says it did:',
    ...task.phaseReports.map((report) => `- ${report.summary}`),
    describeJudgementCallsForReview(task),
    describeMergeStepsForReview(task),
    describeWatchdogsForReview(assembleReport(task).walkthrough?.watchdogs ?? []),
    describeTestingForReview(task),
    describeCoverageForReview(task),
    '',
    describeEvidenceForReview(evidence),
    '',
    describeReviewScope(task, repo, stacked?.branch ?? null),
    describeTaskChecks(task, repo),
    "None of them blocks: a check that fails on the base branch too is not the change's, and CI runs the whole suite on the pull request. Look for what the checks miss, and run what the change touches that no check covers.",
    'Rank every finding by what should happen to it. `blocking`: a bug, a missed requirement, a broken repository rule or a security problem; the agent fixes it before the human sees the review. `should_fix`: not proven broken, but the change is worse without the fix and you would ask for it before the merge (an unhandled edge case, untested logic that decides something, a duplicated helper, a misleading name or message); the human sees it with Fix chosen. `optional`: taste, polish or a small cleanup the change is fine without; the human sees it with Dismiss chosen.',
    'When you are unsure between `should_fix` and `optional`, ask whether you would hold the merge for it in a colleague’s pull request: yes is `should_fix`.',
    'Check the new code follows the patterns of the code around it: a helper, component or query the repository already has re-implemented, or a new way of doing what it does one way everywhere, is a finding that names the existing code. It is blocking when the repository’s rules name the pattern, and should fix otherwise.',
    'Anchor every finding to a file and line range. Reproduce a finding before you report it; one you cannot reproduce is a guess.',
    'Give every finding a title of at most 80 characters that says what is wrong in a few words.',
    'Use its message, at most 280 characters, for what is wrong and why it matters.',
    'Add a fix of at most 600 characters when you know what to change: a sentence, or a short code block.',
    'Write a summary of one or two sentences, at most 400 characters: what you checked and your overall view of the change.',
    describeDismissedFindings(task),
    'Call `report_review` with your summary and your findings (an empty list if there are none), then stop.',
    'You are a signal for the human, never the approval.',
  ].join('\n');
}

function describeCheckout(task: Task, repo: Repo | null) {
  if (task.worktreePath)
    return `You work in the task's worktree at \`${task.worktreePath}\`. Read it; never change it.`;
  return repo ? `The repository is checked out at \`${repo.path}\`. Read it; never change it.` : '';
}

export function resolveResearcherPrompt(task: Task, repo: Repo | null, followUp: string | null) {
  return [
    resolveHouseRules('researcher'),
    '',
    'Your role: researcher. The human asked for research or a comparison. Write the report; do not change any code.',
    describeTaskLink(task),
    describeRounds(task),
    describeRepository(repo),
    describeCheckout(task, repo),
    describeNoRepository(repo),
    '',
    'The request:',
    resolveRequest(task),
    followUp ? ['', 'The human followed up:', followUp].join('\n') : '',
    describeEarlierWork(task),
    '',
    `Read the code and anything else you need, then call \`submit_report\` with \`report\`: markdown, at most ${SHAPE_LIMITS.report} characters.`,
    'Lead with the conclusion or recommendation in one paragraph, then the comparison or findings, then the evidence (files and lines as shinsa:// links, sources as links).',
    describeWhatFollows(task) ?? PROPOSAL_RULE,
    'Then stop.',
  ].join('\n');
}

export function resolveInvestigatorPrompt(task: Task, repo: Repo | null, followUp: string | null) {
  const continues = hasStep(task, 'plan');
  return [
    resolveHouseRules('investigator'),
    '',
    'Your role: investigator. Find out what is going on and report it. Do not fix it.',
    describeTaskLink(task),
    describeRounds(task),
    describeRepository(repo),
    '',
    'The human asked:',
    resolveRequest(task),
    followUp ? ['', 'The human followed up:', followUp].join('\n') : '',
    '',
    'Reproduce the problem first. You may run anything, add logging or write a failing test to narrow it down: this worktree is scratch and nothing you change in it ships. Shinsa resets it before any fix is built.',
    `When you know the cause, or have ruled out what you can, call \`report_diagnosis\` with \`diagnosis\`: markdown, at most ${SHAPE_LIMITS.diagnosis} characters.`,
    'Lead with the cause in one or two sentences (or what is still unknown), then how you reproduced it and the evidence (files and lines as shinsa:// links).',
    describeWhatFollows(task) ??
      (continues
        ? 'The human already asked for a fix: an agent plans it from your diagnosis next, so end with what the fix should change.'
        : PROPOSAL_RULE),
    'Then stop.',
  ].join('\n');
}

const OPERATION_MOMENT: Record<Exclude<OperationTiming, 'alone'>, string> = {
  before_build: 'You build the code change in the plan after it, from the state the operation leaves.',
  post_merge:
    'The code change in the plan has merged into the default branch, and your worktree has it. The human read the merged commit and confirmed the operation. Run it against that code.',
};

function describeImpact(task: Task) {
  const impact = task.plan?.document?.impact;
  return impact ? ['', 'The impact the human approved:', impact].join('\n') : '';
}

function describeOperation(task: Task) {
  const timing = resolveOperationTiming(resolveTaskPipeline(task));
  const steps = task.plan?.document?.operation ?? [];
  if (timing === null || timing === 'alone' || steps.length === 0)
    return describePlan(task) + describeImpact(task);
  return (
    [
      OPERATION_MOMENT[timing],
      'The operation to run:',
      ...steps.map((step, index) => `${index + 1}. ${step}`),
    ].join('\n') + describeImpact(task)
  );
}

function describeOperationOpening(task: Task) {
  if (resolveOperationTiming(resolveTaskPipeline(task)) === 'post_merge') return '';
  return task.plan?.approvedAt ? 'The human approved the plan.' : '';
}

export function resolveOperationInstruction(task: Task, guidance: string | null) {
  return [
    describeOperationOpening(task),
    'Now run the operation in the plan, step by step, and report how it went.',
    describeOperation(task),
    guidance ? ['', 'Guidance from the human:', guidance].join('\n') : '',
    '',
    'Run only what the plan says. Check each step before the next; stop and ask with `ask` when a step fails or would do more than the plan says.',
    `Then call \`report_outcome\` with \`outcome\`: markdown, at most ${SHAPE_LIMITS.outcome} characters: what ran, what changed, anything left to do or undo.`,
    'Then stop.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function resolveAnswererPrompt(task: Task, repo: Repo | null, followUp: string | null) {
  return [
    resolveHouseRules('answerer'),
    '',
    repo
      ? 'Your role: answerer. The human asked a question about this repository. Answer it directly.'
      : 'Your role: answerer. The human asked a question or wrote to you. Answer it directly.',
    'Do not write implementation code and do not produce an implementation plan. Use tools only to investigate; the deliverable is the answer.',
    describeTaskLink(task),
    describeRounds(task),
    describeRepository(repo),
    repo ? `The repository is checked out at \`${repo.path}\`. Read it; never change it.` : '',
    describeNoRepository(repo),
    '',
    'The question:',
    resolveRequest(task),
    followUp ? ['', 'The human followed up:', followUp].join('\n') : '',
    '',
    `Call \`answer\` with your answer in markdown (at most ${SHAPE_LIMITS.answer} characters): lead with the answer itself, then the evidence (files and lines as shinsa:// links).`,
    describeWhatFollows(task) ?? PROPOSAL_RULE,
    'For other work worth doing, propose it with `suggest_tasks`. Then stop.',
  ].join('\n');
}
