import {
  hasStep,
  isComposedByAgent,
  isLaterRound,
  type OperationTiming,
  type Repo,
  resolveCurrentRound,
  resolveOperationTiming,
  resolveTaskPipeline,
  SHAPE_LIMITS,
  selectShippingTarget,
  type Task,
} from '../domain/index.ts';
import { PROTOCOL_LIMITS } from '../report/validate.ts';
import {
  describeApprovedPlan,
  describeBases,
  describeCheckCommands,
  describeDismissedFindings,
  describeEarlierWork,
  describeGoal,
  describePlan,
  describePreviousPhases,
  describeRepository,
  describeRounds,
  describeTaskLink,
  describeWhatFollows,
  isStacked,
  PROPOSAL_RULE,
  resolveLaterMessages,
  resolveRequest,
} from './context.ts';
import { resolveHouseRules } from './rules.ts';
import { describePlanParameters, describeStepCatalog, describeStepRules } from './steps.ts';

const OPERATION_NOTE = [
  'This task is an operation: something to run in the repository (a script, a migration, a cleanup), not code to ship. Nothing it does goes through a pull request.',
  'Plan the steps to run, in order, each with how to check it worked. The human approves the plan before anything runs, so say exactly what will change and how to undo it.',
].join('\n');

const COMBINED_NOTE: Record<Exclude<OperationTiming, 'alone'>, string> = {
  before_build:
    "This task runs an operation first and then changes the code: an operator runs the operation once the human approves the plan, then builders build the phases, and the change goes through the human's review, a pull request and the merge.",
  after_merge:
    "This task changes the code and then runs an operation: builders build the phases, the change goes through the human's review, a pull request and the merge, and then an operator runs the operation on the merged code (a backfill, a migration, a cleanup).",
};

function describeOperationNote(task: Task) {
  const timing = resolveOperationTiming(resolveTaskPipeline(task));
  if (timing === null) return '';
  if (timing === 'alone') return ['', OPERATION_NOTE].join('\n');
  return [
    '',
    COMBINED_NOTE[timing],
    '`plan` holds the code change only, as phases. List the operation in `operation`: its steps in order, each with how to check it worked. The human approves the plan, the operation included, before anything runs, so say exactly what the operation will change and how to undo it.',
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
    'Plan it when those steps fit the request; most tasks need no change. When they do not fit, call `reshape_task` instead of planning, then end your turn:',
    describeShapeChoice(task),
    '- `steps` to compose the task from these building blocks, in this order (`operate` goes right after `plan`, or last, after `merge`). Each step, who does it and when it is done:',
    describeStepCatalog(),
    'The rules, which Shinsa checks. A question, research or an investigation that changes nothing takes none of the verification steps; anything that changes code or runs an operation takes all of them:',
    describeStepRules(),
    'You cannot add a step or a gate of your own. You set the parameters in the plan instead: the verification plan, the evidence, extra checks, the impact of an operation, and whether the human approves the plan first.',
    'For example, find the cause and then run an operation from the findings: `investigate`, `your_ok`, `plan`, `operate`. Research the options, then change the code: `research`, `your_ok`, `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge`. Ship a change, then backfill the data it needs: `plan`, `build`, `checks`, `agent_review`, `your_review`, `pull_request`, `merge`, `operate`.',
    `Shinsa checks the steps and tells you what to fix. \`reason\` says in one sentence why the task takes these steps, at most ${SHAPE_LIMITS.reason} characters.`,
  ].join('\n');
}

export function resolvePlannerPrompt(task: Task, repo: Repo | null, bases: Task[], feedback: string | null) {
  return [
    resolveHouseRules('planner'),
    '',
    'Your role: planner. Plan this piece of work. Do not change any code.',
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
    task.auto?.shape && !feedback && !task.plan && !isComposedByAgent(task)
      ? ['', describeReshapeNote(task)].join('\n')
      : '',
    feedback ? ['', 'Feedback on the previous plan:', feedback, '', task.plan?.body ?? ''].join('\n') : '',
    feedback
      ? 'This is a revision: say in `change_summary` what you changed and why, in one or two sentences.'
      : '',
    '',
    'Read the code you need to understand the change, then call `propose_plan`.',
    `The \`phases\` split the work into ${PROTOCOL_LIMITS.minPlanPhases} to ${PROTOCOL_LIMITS.planPhases} phases, in order. Each phase is built by a separate agent that sees the plan,`,
    'its own phase and the summaries of the phases before it, so a phase must be a self-contained step with a clear end:',
    'a title of a few words and one or two sentences saying exactly what is done and how it is verified.',
    'Small changes still get a plan; two or three phases is fine.',
    'Decide everything you can decide from the code and the request, and say so in the approach.',
    'If the human must decide something before work can start, ask it with `ask` first, then plan with the answer.',
    'Leave `questions` empty unless a decision can wait for the human to look at the finished work.',
    'Then end your turn.',
  ].join('\n');
}

function describeOperationForBuilder(task: Task) {
  const timing = resolveOperationTiming(resolveTaskPipeline(task));
  if (timing === 'after_merge') {
    return "Do not run the plan's operation: an operator runs it after the pull request merges.";
  }
  if (timing === 'before_build') return describeEarlierWork(task).trimStart();
  return '';
}

export function resolvePhasePrompt(task: Task, repo: Repo | null, bases: Task[], index: number) {
  const plan = task.plan?.document?.phases ?? [];
  const phase = plan[index];
  const last = index >= plan.length - 1;
  return [
    resolveHouseRules('builder'),
    '',
    `Your role: builder for phase ${index + 1} of ${Math.max(plan.length, 1)}. Do this phase completely, and only this phase.`,
    describeTaskLink(task),
    describeRounds(task),
    describeRepository(repo),
    describeBases(bases),
    '',
    'The human asked for:',
    resolveRequest(task),
    '',
    describeGoal(task),
    describePlan(task),
    describeApprovedPlan(task),
    task.planAnswers ? ['', 'The human answered:', task.planAnswers].join('\n') : '',
    '',
    describePreviousPhases(task, index),
    '',
    phase ? `Your phase: ${phase.title}. ${phase.detail}` : 'Your phase: build the whole change.',
    describeOperationForBuilder(task),
    '',
    'Work until the phase is done and verified, not until it compiles.',
    describeCheckCommands(repo),
    last
      ? 'This is the last phase: the whole change must work end to end when you finish.'
      : 'Later phases build on yours; leave the code in a working state.',
    'For user-facing changes, run the app and attach screenshots or a short recording with `attach_evidence`.',
    'For logic, write the test that fails without your change and passes with it.',
    'When the phase is done, call `complete_phase`:',
    '- summary: what this phase changed, in one or two sentences.',
    '- spots: the exact line ranges (new-file line numbers) the human must read, each with why it matters.',
    '  critical = could break something or encodes a judgement call; high = worth a careful read; normal = context.',
    '  Leave boilerplate and mechanical edits out.',
    '- decisions: judgement calls the human might disagree with.',
    'Then end your turn.',
  ].join('\n');
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

export function resolveReviewerPrompt(task: Task, repo: Repo | null, bases: Task[]) {
  const stacked = bases.find((base) => base.branch && isStacked(base));
  return [
    resolveHouseRules('reviewer'),
    '',
    'Your role: reviewer. You did not write this code. Review it against the request, the plan and the repository rules. Do not edit code.',
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
    'What the builders say they did:',
    ...task.phaseReports.map((report) => `- ${report.summary}`),
    '',
    describeReviewScope(task, repo, stacked?.branch ?? null),
    'Shinsa already ran the checks and they pass. Look for what checks miss.',
    'A blocking finding is a bug, a missed requirement, a broken repository rule or a security problem. Everything optional is a suggestion.',
    'Anchor every finding to a file and line range. Reproduce a finding before you report it; one you cannot reproduce is a guess.',
    describeDismissedFindings(task),
    'Call `report_review` with your findings (an empty list if there are none), then end your turn.',
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
    '',
    'The request:',
    resolveRequest(task),
    followUp ? ['', 'The human followed up:', followUp].join('\n') : '',
    describeEarlierWork(task),
    '',
    `Read the code and anything else you need, then call \`submit_report\` with \`report\`: markdown, at most ${SHAPE_LIMITS.report} characters.`,
    'Lead with the conclusion or recommendation in one paragraph, then the comparison or findings, then the evidence (files and lines as shinsa:// links, sources as links).',
    describeWhatFollows(task) ?? PROPOSAL_RULE,
    'Then end your turn.',
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
    `When you know the cause, or have ruled out what you can, call \`report_diagnosis\` with \`findings\`: markdown, at most ${SHAPE_LIMITS.findings} characters.`,
    'Lead with the cause in one or two sentences (or what is still unknown), then how you reproduced it and the evidence (files and lines as shinsa:// links).',
    describeWhatFollows(task) ??
      (continues
        ? 'The human already asked for a fix: a planner plans it from your findings next, so end with what the fix should change.'
        : PROPOSAL_RULE),
    'Then end your turn.',
  ].join('\n');
}

const OPERATION_MOMENT: Record<Exclude<OperationTiming, 'alone'>, string> = {
  before_build: 'The code change in the plan is built after you, from the state you leave.',
  after_merge:
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
      describePlan(task),
      '',
      OPERATION_MOMENT[timing],
      'The operation to run:',
      ...steps.map((step, index) => `${index + 1}. ${step}`),
    ].join('\n') + describeImpact(task)
  );
}

export function resolveOperatorPrompt(task: Task, repo: Repo | null, guidance: string | null) {
  return [
    resolveHouseRules('operator'),
    '',
    'Your role: operator. Run the operation in the approved plan, step by step, and report how it went.',
    describeTaskLink(task),
    describeRounds(task),
    describeRepository(repo),
    '',
    'The human asked for:',
    resolveRequest(task),
    '',
    describeGoal(task),
    describeOperation(task),
    describeApprovedPlan(task),
    guidance ? ['', 'Guidance from the human:', guidance].join('\n') : '',
    describeEarlierWork(task),
    '',
    'Run only what the plan says. Check each step before the next; stop and ask with `ask` when a step fails or would do more than the plan says.',
    `Then call \`report_outcome\` with \`outcome\`: markdown, at most ${SHAPE_LIMITS.outcome} characters: what ran, what changed, anything left to do or undo.`,
    'Then end your turn.',
  ].join('\n');
}

export function resolveAnswererPrompt(task: Task, repo: Repo | null, followUp: string | null) {
  return [
    resolveHouseRules('answerer'),
    '',
    'Your role: answerer. The human asked a question about this repository. Answer it directly.',
    'Do not write implementation code and do not produce an implementation plan. Use tools only to investigate; the deliverable is the answer.',
    describeTaskLink(task),
    describeRounds(task),
    describeRepository(repo),
    repo ? `The repository is checked out at \`${repo.path}\`. Read it; never change it.` : '',
    '',
    'The question:',
    resolveRequest(task),
    followUp ? ['', 'The human followed up:', followUp].join('\n') : '',
    '',
    `Call \`answer\` with your answer in markdown (at most ${SHAPE_LIMITS.answer} characters): lead with the answer itself, then the evidence (files and lines as shinsa:// links).`,
    describeWhatFollows(task) ?? PROPOSAL_RULE,
    'For other work worth doing, propose it with `suggest_tasks`. Then end your turn.',
  ].join('\n');
}
