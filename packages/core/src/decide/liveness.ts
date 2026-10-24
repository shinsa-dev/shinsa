import { hasArmedWait, isTaskSettled, RUN_STAGES, type Task } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { listActiveRuns, listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';

export function isTaskLive(state: ShinsaState, task: Task) {
  return (
    isTaskSettled(task) ||
    !RUN_STAGES.has(task.stage) ||
    hasArmedWait(task) ||
    listOpenGates(state, task.id).length > 0 ||
    listActiveRuns(state, task.id).length > 0
  );
}

export function enforceLiveness(decider: Decider) {
  for (const task of Object.values(decider.state.tasks)) {
    if (isTaskLive(decider.state, task)) continue;
    decider.fail(
      task.id,
      'This task got stuck',
      `It was ${task.stageReason} but nothing was working on it. Retry to pick it up again.`
    );
  }
}
