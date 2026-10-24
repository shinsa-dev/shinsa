import type { CommandOf } from '../commands/index.ts';
import { type ConfigProblem, DomainError, type Gate, type GateDecision } from '../domain/index.ts';
import type { Decider } from './decider.ts';
import { isSameValue } from './equality.ts';
import { CHECKING_SETUP, settleTask, startWork } from './lifecycle.ts';
import { proceedAfterSetup } from './shapes.ts';

const PROBLEM_FIX: Record<ConfigProblem['kind'], string> = {
  repository: 'Point the task at a working repository, then check again.',
  default_branch: 'Set the default branch in the repository settings, then check again.',
  check_commands: 'Add check commands in the repository settings, or continue without checks.',
};

const PROBLEM_TITLE: Record<ConfigProblem['kind'], string> = {
  repository: 'The repository is missing',
  default_branch: 'The default branch is missing',
  check_commands: 'No checks to run',
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

export function recordConfig(decider: Decider, command: CommandOf<'config.record'>) {
  const task = decider.state.tasks[command.taskId];
  if (task?.stage !== 'triage' || task.stageReason !== CHECKING_SETUP) return;
  if (!isSameValue(task.configProblems ?? [], command.problems)) {
    decider.emit({ type: 'config.verified', taskId: task.id, problems: command.problems });
  }
  if (command.problems.length === 0) {
    proceedAfterSetup(decider, task.id);
    return;
  }
  decider.stage(task.id, 'triage', 'waiting for the setup to be fixed');
  decider.openGate(
    task.id,
    'configuration',
    describeTitle(command.problems),
    describeProblems(command.problems)
  );
}

function resolveWaivableRepo(decider: Decider, gate: Gate) {
  const task = decider.task(gate.taskId);
  const repo = decider.repoOf(task);
  const problems = task.configProblems ?? [];
  if (!repo || problems.some((problem) => problem.kind !== 'check_commands')) {
    throw new DomainError(
      'setup_incomplete',
      'Only missing checks can be skipped. Fix the repository setup, then check again.'
    );
  }
  return repo;
}

export function assertConfigurationAnswer(decider: Decider, gate: Gate, decision: GateDecision) {
  if (gate.type === 'configuration' && decision === 'waive') resolveWaivableRepo(decider, gate);
}

export function answerConfiguration(decider: Decider, gate: Gate, decision: GateDecision) {
  if (decision === 'reject') {
    settleTask(decider, gate.taskId, 'cancelled', 'cancelled during setup');
    return;
  }
  if (decision === 'waive') {
    const repo = resolveWaivableRepo(decider, gate);
    if (!repo.checksWaived) decider.emit({ type: 'repo.updated', repo: { ...repo, checksWaived: true } });
  }
  startWork(decider, gate.taskId);
}
