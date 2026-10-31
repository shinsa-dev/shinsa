import { describeList } from '../chat/text.ts';
import {
  type Activity,
  listPhaseChecks,
  listRepoChecks,
  listTaskChecks,
  type Repo,
  type Round,
  resolveCurrentRound,
  resolveTaskPipeline,
  resolveTaskRounds,
  resolveWorkStep,
  SHAPE_LIMITS,
  type Task,
  type UntoldMessage,
} from '../domain/index.ts';
import type { CheckNote, ReportCheck, ReviewFinding, TaskCheck } from '../report/types.ts';

export function describeRepository(repo: Repo | null) {
  if (!repo) return '';
  return `Repository: ${repo.name} (default branch ${repo.defaultBranch}).`;
}

export function describeNoRepository(repo: Repo | null) {
  if (repo) return '';
  return 'This task works in no repository. Work from Shinsa itself, through `find_tasks`, `read_task` and the `projects_list` tool, and from any repository the project names, read by its path. When the request needs the code of one repository and you cannot tell which, ask the human with `ask`.';
}

export function describeTaskLink(task: Task) {
  const handle = task.handle ? `${task.handle}, ` : '';
  return `This task: ${handle}[${task.title}](shinsa://task/${task.id}).`;
}

export function isStacked(base: Task) {
  return base.stage !== 'merged' && base.stage !== 'done';
}

function listQuotedTitles(tasks: Task[]) {
  return describeList(tasks.map((task) => `"${task.title}"`));
}

export function describeBases(bases: Task[]) {
  const built = bases.filter((base) => base.branch);
  const stacked = built.find(isStacked);
  if (stacked) {
    return [
      `This task builds on another task that is not merged yet: "${stacked.title}" (branch ${stacked.branch}).`,
      'Your worktree starts from that branch. Build on its work; do not redo or undo it.',
    ].join('\n');
  }
  const [only] = built;
  if (!only) return '';
  if (built.length > 1) {
    return `This task builds on ${listQuotedTitles(built)}, which are all finished. Their work is in the base branch now.`;
  }
  if (only.stage === 'merged') {
    return `This task builds on "${only.title}", which has merged. Its work is in the base branch now.`;
  }
  return `This task builds on "${only.title}", which is finished. Build on what it left in the base branch.`;
}

function describeCheckLine(check: TaskCheck) {
  return `- ${check.id}, ${check.label}: \`${check.command}\``;
}

const CHECK_CHANGES_RULE =
  'When this phase brings in files a check should cover, or a check no longer fits, send `check_changes` with `complete_phase`: `add` with a label, the scoped command and its phases, `change` or `remove` by id, each with a one-sentence reason. Shinsa runs what you add or change right away.';

export function describePhaseChecks(task: Task, repo: Repo | null, phase: number, last: boolean) {
  const checks = listPhaseChecks(task, phase);
  const baseline = last ? listRepoChecks(repo) : [];
  if (checks.length + baseline.length === 0) {
    return `The plan lists no check for this phase, so Shinsa runs none when you hand it over.\n${CHECK_CHANGES_RULE}`;
  }
  return [
    'When you hand this phase over, Shinsa runs these checks itself, and their result is what the human sees:',
    ...checks.map(describeCheckLine),
    ...(baseline.length > 0 ? ['and, once before review, the repository’s own commands:'] : []),
    ...baseline.map(describeCheckLine),
    'Run the ones your work touches yourself while you build, scoped as they are; never the whole suite, which Shinsa refuses.',
    CHECK_CHANGES_RULE,
  ].join('\n');
}

export function describeTaskChecks(task: Task, repo: Repo | null) {
  const results = new Map((task.checkResults ?? []).map((result) => [result.id, result]));
  const lines = listTaskChecks(task, repo).map((check) => {
    const result = results.get(check.id);
    const outcome = result ? CHECK_OUTCOME[result.note ?? result.outcome] : 'not run yet';
    return `${describeCheckLine(check)} (${outcome})`;
  });
  if (lines.length === 0) return '';
  return ['The checks Shinsa ran on the change, and where each stands:', ...lines].join('\n');
}

const CHECK_OUTCOME: Record<ReportCheck['outcome'] | CheckNote, string> = {
  pass: 'passed',
  fail: 'failed',
  skipped: 'skipped',
  passed_alone: 'passed when re-run alone',
  fails_on_base: 'already failing on the base branch, so it does not block',
};

export function describePlan(task: Task) {
  const plan = task.plan?.document?.phases ?? [];
  if (plan.length === 0) return '';
  return ['The plan:', ...plan.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`)].join(
    '\n'
  );
}

export function describePlanDetail(task: Task) {
  const document = task.plan?.document;
  if (!document) return '';
  const behaviour = document.behaviour.map((item) => `- ${item}`);
  const files = document.files.map((file) => `- ${file.path}: ${file.change}`);
  return [
    behaviour.length > 0 ? ['How it behaves after the change:', ...behaviour].join('\n') : '',
    files.length > 0 ? ['The files it changes:', ...files].join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function describeGoal(task: Task) {
  const document = task.plan?.document;
  if (!document) return '';
  return [
    `Goal: ${document.goal}`,
    document.approach ? `Approach: ${document.approach}` : '',
    document.outOfScope.length > 0 ? `Out of scope: ${document.outOfScope.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function describePreviousPhases(task: Task, before: number) {
  const reports = task.phaseReports
    .filter((report) => report.index < before)
    .sort((a, b) => a.index - b.index);
  if (reports.length === 0) return '';
  const plan = task.plan?.document?.phases ?? [];
  return [
    'Already done by earlier phases (their changes are in your worktree):',
    ...reports.map(
      (report) => `- ${plan[report.index]?.title ?? `Phase ${report.index + 1}`}: ${report.summary}`
    ),
  ].join('\n');
}

export function describeApprovedPlan(task: Task) {
  const plan = task.plan;
  if (!plan?.approvedAt) return '';
  return `This is plan version ${plan.version}, approved by the human. Follow this exact version, not an earlier or later draft.`;
}

export function describeFindingPlace(finding: ReviewFinding) {
  if (!finding.file) return '';
  return `${finding.file}${finding.line ? `:${finding.line}` : ''}: `;
}

export function describeDismissedFindings(task: Task) {
  const dismissed = task.dismissedFindings ?? [];
  if (dismissed.length === 0) return '';
  return [
    'The human dismissed these findings from an earlier review. Do not report them again unless the code around them changed:',
    ...dismissed.map(
      (finding) =>
        `- ${describeFindingPlace(finding)}${finding.message}${finding.verdictNote ? ` (the human: ${finding.verdictNote})` : ''}`
    ),
  ].join('\n');
}

const RESULT_HEADING = {
  answer: 'The answer given earlier on this task:',
  investigate: 'The diagnosis from the investigation:',
  research: 'The report written for this task:',
  operate: 'How the operation went:',
} as const;

export function describeEarlierWork(task: Task) {
  const lines: string[] = [];
  if (task.result) lines.push('', RESULT_HEADING[task.result.step], task.result.body);
  if (task.proposal?.status === 'accepted') {
    lines.push('', 'The human approved going on after that:', task.proposal.request);
  }
  return lines.join('\n');
}

export function describeWhatFollows(task: Task) {
  const pipeline = resolveTaskPipeline(task);
  if (!pipeline.includes('your_ok')) return null;
  const work = resolveWorkStep(pipeline) === 'operate' ? 'operation' : 'change';
  return [
    `After your hand-over the human decides whether this task goes on to the ${work}. If they agree, the ${work} is planned and carried out from what you hand over, usually by you in this same conversation.`,
    `End with what the ${work} should do.`,
  ].join('\n');
}

export const PROPOSAL_RULE = [
  'If what you found calls for a code change, add `propose_change` to your hand-over:',
  `\`request\` says what to change in a few sentences (at most ${SHAPE_LIMITS.request} characters) and \`why\` says in one sentence why it is worth doing (at most ${SHAPE_LIMITS.why}).`,
  'The human decides whether this task turns into that change, so propose one only when it is clearly worth doing. Leave it out otherwise.',
].join('\n');

export const ROUND_STATE: Record<Round['status'], string> = {
  waiting: 'waiting to start',
  active: 'in progress',
  shipped: 'its pull request is open',
  merged: 'merged',
  finished: 'finished',
  cancelled: 'stopped',
};

export function resolveRequest(task: Task) {
  const round = resolveCurrentRound(task);
  return round.number > 1 ? round.request : task.request;
}

export function describeRoundPullRequest(round: Round) {
  return round.pullRequest ? `, pull request #${round.pullRequest.number}` : '';
}

function describeShipping(task: Task, round: Round) {
  const pullRequest = task.pullRequest;
  if (pullRequest?.state === 'open') {
    return `Its commits go onto pull request #${pullRequest.number}, which already holds the earlier rounds' work. Build on that work; do not redo or undo it.`;
  }
  if (round.base) {
    return `It ships as its own pull request, stacked on branch ${round.base}, which holds the earlier rounds' work. Build on that work; do not redo or undo it.`;
  }
  return "It starts from the default branch, which holds the earlier rounds' merged work.";
}

export function describeRounds(task: Task) {
  const round = resolveCurrentRound(task);
  if (round.number === 1) return '';
  const earlier = resolveTaskRounds(task).filter((candidate) => candidate.number < round.number);
  return [
    `This is round ${round.number} of the task. A round is one piece of work inside it; this round's request is below.`,
    'The earlier rounds:',
    ...earlier.map(
      (candidate) =>
        `- Round ${candidate.number}: ${candidate.title} (${ROUND_STATE[candidate.status]}${describeRoundPullRequest(candidate)})`
    ),
    describeShipping(task, round),
    'Do what this round asks for, and only that.',
  ].join('\n');
}

const SENT_BY = {
  agent: 'Sent by an agent on the human’s behalf: ',
  schedule: 'Sent by a schedule: ',
} as const;

function describeSender(entry: Activity) {
  if (entry.actor === 'shinsa') return SENT_BY.schedule;
  return entry.onBehalf ? SENT_BY.agent : '';
}

function isUntold(task: Task, entry: Activity) {
  return (task.untoldMessages ?? []).some(
    (message) => message.at === entry.at && message.text === entry.detail
  );
}

export function resolveLaterMessages(task: Task) {
  const round = resolveCurrentRound(task).number;
  const messages = task.activity
    .filter((entry) => entry.kind === 'message' && entry.detail)
    .filter((entry) => (entry.round ?? 1) === round && !isUntold(task, entry))
    .map((entry) => `- ${describeSender(entry)}${entry.detail}`);
  if (messages.length === 0) return '';
  return ['', 'The human added since:', ...messages].join('\n');
}

export function describeUntoldMessages(messages: readonly UntoldMessage[]) {
  return [
    'While this task waited for the human, these messages were left for you. Act on them along with the rest of this turn:',
    ...messages.map((message) => `- ${SENT_BY[message.sender]}${message.text}`),
  ].join('\n');
}
