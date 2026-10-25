import { isTaskSettled, resolveRoundBase, type Task } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { listActiveRuns, selectStackedOnTask } from '../state/queries.ts';
import { STAGE_WORDS, serializeReference } from './references.ts';

const WORK_LIMIT = 20;

const FILE_LIMIT = 40;

export type RepositoryFiles = Record<string, readonly string[] | null>;

export function listRepositoryWork(state: ShinsaState, taskId: string) {
  const task = state.tasks[taskId];
  if (!task?.repoId) return [];
  return Object.values(state.tasks)
    .filter((other) => other.id !== task.id && other.repoId === task.repoId && !isTaskSettled(other))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, WORK_LIMIT);
}

function describeTask(task: Task) {
  return `${task.handle ? `${task.handle} ` : ''}[${task.title}](${serializeReference({ kind: 'task', id: task.id })})`;
}

function describeStack(state: ShinsaState, task: Task, current: Task) {
  const below = selectStackedOnTask(state, task);
  const parts: string[] = [];
  if (below)
    parts.push(below.id === current.id ? 'stacked on this task' : `stacked on ${describeTask(below)}`);
  if (selectStackedOnTask(state, current)?.id === task.id) parts.push('this task is stacked on it');
  const round = resolveRoundBase(task);
  if (round) parts.push(`this round is stacked on branch ${round}`);
  return parts;
}

function describeFiles(paths: readonly string[]) {
  const shown = paths.slice(0, FILE_LIMIT);
  const more = paths.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

function describeChanged(files: RepositoryFiles, task: Task, current: Task) {
  const paths = files[task.id];
  if (paths === null || paths === undefined) return '  Changed files: not known.';
  if (paths.length === 0) return '  Changed files: none yet.';
  const own = new Set(files[current.id] ?? []);
  const shared = paths.filter((path) => own.has(path));
  const also = shared.length > 0 ? ` This task changes ${describeFiles(shared)} too.` : '';
  return `  Changed files: ${describeFiles(paths)}.${also}`;
}

function describeWork(state: ShinsaState, task: Task, current: Task, files: RepositoryFiles) {
  const running = listActiveRuns(state, task.id).length > 0;
  const parts = [
    describeTask(task),
    STAGE_WORDS[task.stage],
    task.branch ? `branch ${task.branch}` : '',
    ...describeStack(state, task, current),
    running ? 'an agent is working on it now' : 'no agent is working on it now',
  ];
  return [`- ${parts.filter(Boolean).join(' · ')}`, describeChanged(files, task, current)].join('\n');
}

export function serializeRepositoryWork(state: ShinsaState, taskId: string, files: RepositoryFiles) {
  const task = state.tasks[taskId];
  if (!task) return `No task ${taskId}.`;
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  if (!repo) return 'This task works in no repository.';
  const work = listRepositoryWork(state, taskId);
  if (work.length === 0) return `No other open task works in ${repo.name}.`;
  return [
    `Other open tasks in ${repo.name}, most recently active first:`,
    ...work.map((other) => describeWork(state, other, task, files)),
  ].join('\n');
}
