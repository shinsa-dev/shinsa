import { compareTasks, listPendingDependencies, type ShinsaState, type Task } from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { listOpenTaskChoices } from '@/lib/tasks/roadmap.ts';

const BEFORE_BUILD: ReadonlySet<Task['stage']> = new Set<Task['stage']>([
  'triage',
  'waiting_on_tasks',
  'planning',
]);

function isBeforeBuild(task: Task) {
  return BEFORE_BUILD.has(task.stage);
}

export function resolveDependencyLabel(task: Task) {
  return isBeforeBuild(task) ? 'Wait for another task' : 'Merge after another task';
}

export function describeWaitsOnHeading(task: Task, waitsOn: Task[]) {
  return `${isBeforeBuild(task) ? 'Starts' : 'Merges'} when ${waitsOn.length === 1 ? 'this finishes' : 'these finish'}`;
}

export function listDependencyChoices(state: ShinsaState, task: Task) {
  const open = listOpenTaskChoices(state, task);
  const shown = new Set(open.map((choice) => choice.id));
  const current = listPendingDependencies(state, task).filter((dependency) => !shown.has(dependency.id));
  const unchosen = (candidate: Task) => Number(!task.waitsOn.includes(candidate.id));
  return [...current, ...open].sort((a, b) => unchosen(a) - unchosen(b) || compareTasks(a, b));
}

export function toggleDependency(task: Task, dependency: Task) {
  if (task.waitsOn.includes(dependency.id)) {
    return sendCommandWithToast(
      { type: 'task.wait_on', taskId: task.id, waitsOn: task.waitsOn.filter((id) => id !== dependency.id) },
      `No longer waits on “${dependency.title}”.`
    );
  }
  return sendCommandWithToast(
    { type: 'task.wait_on', taskId: task.id, waitsOn: [...task.waitsOn, dependency.id] },
    `Waits on “${dependency.title}”.`
  );
}

export function resolveDependencyChoiceLabel(stackedOn: Task | null, choice: Task) {
  return stackedOn?.id === choice.id ? `Stacked on “${choice.title}”` : choice.title;
}

export function hasRemovableDependencies(task: Task, stackedOn: Task | null) {
  return task.waitsOn.some((id) => id !== stackedOn?.id);
}

export function clearDependencies(task: Task, stackedOn: Task | null) {
  if (!stackedOn) {
    return sendCommandWithToast({ type: 'task.wait_on', taskId: task.id, waitsOn: [] }, 'No longer waiting.');
  }
  return sendCommandWithToast(
    { type: 'task.wait_on', taskId: task.id, waitsOn: [stackedOn.id] },
    `Now waits only on “${stackedOn.title}”, which this task is stacked on.`
  );
}
