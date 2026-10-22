import type { Repo, Task } from '../model/index.ts';

export function repoLine(repo: Repo | null) {
  if (!repo) return '';
  return `Repository: ${repo.name} (default branch ${repo.defaultBranch}).`;
}

export function taskLine(task: Task) {
  return `This task: [${task.title}](shinsa://task/${task.id}).`;
}

export function isStacked(base: Task) {
  return base.stage !== 'merged' && base.stage !== 'done';
}

function listQuotedTitles(tasks: Task[]) {
  return tasks.map((task) => `"${task.title}"`).join(' and ');
}

export function baseLine(bases: Task[]) {
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

export function checksLine(repo: Repo | null) {
  if (!repo || repo.checkCommands.length === 0) {
    return 'Run whatever lint, type check and tests the repository defines (see its package.json, CLAUDE.md and CI config).';
  }
  return `The checks for this repository are: ${repo.checkCommands.map((command) => `\`${command}\``).join(', ')}. Shinsa runs them after you hand over; run them yourself first.`;
}

export function planBlock(task: Task) {
  const plan = task.spec?.document?.plan ?? [];
  if (plan.length === 0) return '';
  return ['The plan:', ...plan.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`)].join(
    '\n'
  );
}

export function goalBlock(task: Task) {
  const document = task.spec?.document;
  if (!document) return '';
  return [
    `Goal: ${document.goal}`,
    document.approach ? `Approach: ${document.approach}` : '',
    document.outOfScope.length > 0 ? `Out of scope: ${document.outOfScope.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function previousPhasesBlock(task: Task, before: number) {
  const reports = task.phaseReports
    .filter((report) => report.index < before)
    .sort((a, b) => a.index - b.index);
  if (reports.length === 0) return '';
  const plan = task.spec?.document?.plan ?? [];
  return [
    'Already done by earlier phases (their changes are in your worktree):',
    ...reports.map(
      (report) => `- ${plan[report.index]?.title ?? `Phase ${report.index + 1}`}: ${report.summary}`
    ),
  ].join('\n');
}

export function resolveLaterMessages(task: Task) {
  const messages = task.activity
    .filter((entry) => entry.actor === 'you' && entry.kind === 'message' && entry.detail)
    .map((entry) => `- ${entry.detail}`);
  if (messages.length === 0) return '';
  return ['', 'The human added since:', ...messages].join('\n');
}
