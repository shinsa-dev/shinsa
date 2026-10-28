import type { CommandOf } from '../commands/index.ts';
import {
  type ConfigProblem,
  DomainError,
  type Gate,
  type GateDecision,
  needsRepository,
  resolveTaskPipeline,
  type Task,
} from '../domain/index.ts';
import type { Decider } from './decider.ts';
import { isSameValue } from './equality.ts';
import { settleTask, startWork, VERIFYING_SETUP } from './lifecycle.ts';
import { proceedAfterSetup } from './shapes.ts';

const PROBLEM_FIX: Record<ConfigProblem['kind'], string> = {
  repository: 'Point the task at a working repository, then verify the setup again.',
  no_repository:
    'Say in a message which repository the task works in, and Shinsa verifies the setup again with it. A repository Shinsa does not know yet can be added to the project in Settings.',
  default_branch: 'Set the default branch in the repository settings, then verify the setup again.',
  workspace:
    'Fix it in the repository, or change where agents work in Settings → Projects, then verify the setup again.',
};

const PROBLEM_TITLE: Record<ConfigProblem['kind'], string> = {
  repository: 'The repository is missing',
  no_repository: 'No repository for this task',
  default_branch: 'The default branch is missing',
  workspace: 'Agents cannot work in this repository yet',
};

function describeTitle(problems: ConfigProblem[]) {
  const [first] = problems;
  if (problems.length === 1 && first) return PROBLEM_TITLE[first.kind];
  return `The setup has ${problems.length} problems`;
}

function describeProblems(problems: ConfigProblem[]) {
  const lines = problems.map((problem) => `- ${problem.detail}`);
  const fixes = [...new Set(problems.map((problem) => PROBLEM_FIX[problem.kind]))];
  return [
    'Shinsa stopped before any agent started because the setup is not complete:',
    ...lines,
    '',
    ...fixes,
  ].join('\n');
}

const NO_REPOSITORY: ConfigProblem = {
  kind: 'no_repository',
  detail: 'Shinsa could not tell which repository this task works in, and its work needs one.',
};

function resolveProblems(task: Task, problems: ConfigProblem[]) {
  if (task.repoId !== null || !needsRepository(resolveTaskPipeline(task))) return problems;
  return problems.some((problem) => problem.kind === 'no_repository')
    ? problems
    : [NO_REPOSITORY, ...problems];
}

function bindRepo(decider: Decider, task: Task, repoId: string) {
  if (task.repoId !== null) return;
  const repo = decider.repoOf({ repoId });
  if (!repo) throw new DomainError('repo_not_found', `No repository ${repoId}`);
  decider.emit({
    type: 'task.repo_bound',
    taskId: task.id,
    repoId,
    ...(task.projectId ? {} : { projectId: repo.projectId }),
  });
}

export function recordConfig(decider: Decider, command: CommandOf<'config.record'>) {
  const task = decider.state.tasks[command.taskId];
  if (task?.stage !== 'triage' || task.stageReason !== VERIFYING_SETUP) return;
  if (command.repoId) bindRepo(decider, task, command.repoId);
  const problems = resolveProblems(decider.task(task.id), command.problems);
  if (!isSameValue(task.configProblems ?? [], problems)) {
    decider.emit({ type: 'config.verified', taskId: task.id, problems });
  }
  if (problems.length === 0) {
    proceedAfterSetup(decider, task.id);
    return;
  }
  decider.stage(task.id, 'triage', 'waiting for the setup to be fixed');
  decider.openGate(task.id, 'configuration', describeTitle(problems), describeProblems(problems));
}

export function answerConfiguration(decider: Decider, gate: Gate, decision: GateDecision) {
  if (decision === 'reject') {
    settleTask(decider, gate.taskId, 'cancelled', 'cancelled during setup');
    return;
  }
  startWork(decider, gate.taskId);
}
