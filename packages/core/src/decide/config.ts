import { Option } from 'effect';
import type { CommandOf } from '../commands/index.ts';
import {
  type ConfigProblem,
  type Gate,
  type GateDecision,
  isLaterRound,
  isRepoNamed,
  needsRepository,
  resolveRepoMove,
  resolveTaskPipeline,
  DomainError,
  type Repo,
  type Task,
} from '../domain/index.ts';
import { resolveNextHandle, type ShinsaState } from '../state/project.ts';
import { findRepo, listProjectRepos } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { isSameValue } from './equality.ts';
import { settleTask, startWork, VERIFYING_SETUP } from './lifecycle.ts';
import { proceedAfterSetup } from './shapes.ts';

const PROBLEM_FIX: Record<ConfigProblem['kind'], string> = {
  repository: 'Point the task at a working repository, then verify the setup again.',
  no_repository:
    'Say in a message which repository the task works in, and Shinsa verifies the setup again with it. A repository Shinsa does not know yet can be added to the project in Settings.',
  default_branch: 'Set the default branch in the repository settings, then verify the setup again.',
};

const PROBLEM_TITLE: Record<ConfigProblem['kind'], string> = {
  repository: 'The repository is missing',
  no_repository: 'No repository for this task',
  default_branch: 'The default branch is missing',
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

const MAX_REPOSITORY_CHOICES = 8;

const PICK_REPOSITORY_TITLE = 'Which repository is this task for?';

function sortRepos(repos: Repo[]) {
  return [...repos].sort((a, b) => a.name.localeCompare(b.name));
}

function listNamedOutsideRepos(state: ShinsaState, task: Task) {
  if (!task.projectId || isLaterRound(task)) return [];
  return sortRepos(
    Object.values(state.repos).filter(
      (repo) =>
        repo.projectId !== null && repo.projectId !== task.projectId && isRepoNamed(task.request, repo.name)
    )
  ).slice(0, MAX_REPOSITORY_CHOICES);
}

function listRepoChoices(state: ShinsaState, task: Task) {
  const inProject = task.projectId ? listProjectRepos(state, task.projectId) : [];
  if (inProject.length === 0) {
    const repos = sortRepos(Object.values(state.repos)).slice(0, MAX_REPOSITORY_CHOICES);
    return repos.map((repo) => ({ repo, label: resolveRepoLabel(state, repo, repos), outside: false }));
  }
  const named = listNamedOutsideRepos(state, task);
  const own = sortRepos(inProject).slice(0, MAX_REPOSITORY_CHOICES - named.length);
  return [
    ...own.map((repo) => ({ repo, label: resolveRepoLabel(state, repo, own), outside: false })),
    ...named.map((repo) => ({ repo, label: resolveOutsideLabel(state, repo, named), outside: true })),
  ];
}

function resolveProjectName(state: ShinsaState, repo: Repo) {
  return repo.projectId ? (state.projects[repo.projectId]?.name ?? null) : null;
}

function resolveRepoLabel(state: ShinsaState, repo: Repo, repos: Repo[]) {
  const twins = repos.filter((other) => other.name === repo.name);
  if (twins.length < 2) return repo.name;
  const project = resolveProjectName(state, repo);
  const sameProject = twins.filter((other) => resolveProjectName(state, other) === project);
  return project && sameProject.length < 2 ? `${repo.name} (${project})` : `${repo.name} (${repo.path})`;
}

function resolveOutsideLabel(state: ShinsaState, repo: Repo, repos: Repo[]) {
  const project = resolveProjectName(state, repo);
  const twins = repos.filter(
    (other) => other.name === repo.name && resolveProjectName(state, other) === project
  );
  return project && twins.length < 2 ? `${repo.name} (${project})` : `${repo.name} (${repo.path})`;
}

function isLoneNoRepository(problems: ConfigProblem[]) {
  return problems.length === 1 && problems[0]?.kind === 'no_repository';
}

function describeRepoQuestion(state: ShinsaState, task: Task) {
  const named = listNamedOutsideRepos(state, task);
  const project = task.projectId ? state.projects[task.projectId]?.name : undefined;
  return [
    'Shinsa could not tell which repository this task works in, and its work needs one.',
    ...(named.length > 0 && project
      ? [
          '',
          `The request names ${named.map((repo) => repo.name).join(', ')}, outside ${project}. Picking one moves the task to that repository's project.`,
        ]
      : []),
    '',
    'Pick one below, or say in a message which repository it is. A repository Shinsa does not know yet can be added to the project in Settings.',
  ].join('\n');
}

function openSetupGate(decider: Decider, task: Task, problems: ConfigProblem[]) {
  const choices = isLoneNoRepository(problems) ? listRepoChoices(decider.state, task) : [];
  if (choices.length === 0) {
    decider.openGate(task.id, 'configuration', describeTitle(problems), describeProblems(problems));
    return;
  }
  decider.openGate(
    task.id,
    'configuration',
    PICK_REPOSITORY_TITLE,
    describeRepoQuestion(decider.state, task),
    {
      details: { choices: choices.map((choice) => choice.label) },
    }
  );
}

export function assertConfigurationReply(
  decider: Decider,
  gate: Gate,
  decision: GateDecision,
  response: string | null
) {
  if (gate.type !== 'configuration' || decision !== 'reply') return;
  if (!selectChosenRepo(decider, gate, response)) {
    throw new DomainError({ code: 'decision_invalid', message: 'Pick one of the repositories listed.' });
  }
}

function selectChosenRepo(decider: Decider, gate: Gate, response: string | null) {
  const label = response?.trim() ?? '';
  if (!gate.choices?.includes(label)) return null;
  const choices = listRepoChoices(decider.state, decider.task(gate.taskId));
  return choices.find((choice) => choice.label === label) ?? null;
}

function resolveBindProject(task: Task, repo: Repo, outside: boolean) {
  if (outside) return repo.projectId ?? null;
  return Option.getOrNull(resolveRepoMove(task, repo));
}

function bindRepo(decider: Decider, task: Task, repoId: string, outside = false) {
  if (task.repoId !== null) return;
  const repo = findRepo(decider.state, repoId);
  const projectId = resolveBindProject(task, repo, outside);
  decider.emit({
    type: 'task.repo_bound',
    taskId: task.id,
    repoId,
    ...(projectId ? { projectId } : {}),
    ...(projectId && task.projectId ? { handle: resolveNextHandle(decider.state, projectId) } : {}),
  });
}

export function recordConfig(decider: Decider, command: CommandOf<'config.record'>) {
  const task = decider.state.tasks[command.taskId];
  if (task?.stage !== 'triage' || task.stageReason !== VERIFYING_SETUP) return;
  if (command.repoId) bindRepo(decider, task, command.repoId);
  if (command.started) decider.emit({ type: 'task.repo_started', taskId: task.id, start: command.started });
  const problems = resolveProblems(decider.task(task.id), command.problems);
  if (!isSameValue(task.configProblems ?? [], problems)) {
    decider.emit({ type: 'config.verified', taskId: task.id, problems });
  }
  if (problems.length === 0) {
    proceedAfterSetup(decider, task.id);
    return;
  }
  decider.stage(task.id, 'triage', 'waiting for the setup to be fixed');
  openSetupGate(decider, decider.task(task.id), problems);
}

export function answerConfiguration(
  decider: Decider,
  gate: Gate,
  decision: GateDecision,
  response: string | null
) {
  if (decision === 'reject') {
    settleTask(decider, gate.taskId, 'cancelled', 'cancelled during setup');
    return;
  }
  const choice = decision === 'reply' ? selectChosenRepo(decider, gate, response) : null;
  if (choice) bindRepo(decider, decider.task(gate.taskId), choice.repo.id, choice.outside);
  startWork(decider, gate.taskId);
}
