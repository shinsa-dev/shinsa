import { hasArmedWait, isTaskSettled, RUN_STAGES, type Task } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { listActiveRuns, listOpenGates, resolveMovingTasks } from '../state/queries.ts';
import type { Decider } from './decider.ts';

function isLive(task: Task, isMoving: (taskId: string) => boolean) {
  return isTaskSettled(task) || !RUN_STAGES.has(task.stage) || hasArmedWait(task) || isMoving(task.id);
}

export function isTaskLive(state: ShinsaState, task: Task) {
  return isLive(
    task,
    (taskId) => listOpenGates(state, taskId).length > 0 || listActiveRuns(state, taskId).length > 0
  );
}

export function enforceLiveness(decider: Decider) {
  let moving = resolveMovingTasks(decider.state);
  for (const task of Object.values(decider.state.tasks)) {
    if (isLive(task, (taskId) => moving.has(taskId))) continue;
    decider.fail(
      task.id,
      'This task got stuck',
      `It was ${task.stageReason} but nothing was working on it. Retry to pick it up again.`
    );
    moving = resolveMovingTasks(decider.state);
  }
}
