import { isTaskSettled, RUN_STAGES, type Task } from '../model/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { listActiveRuns, listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';

export type Liveness = 'settled' | 'gate' | 'run' | 'system';

export function resolveLiveness(state: ShinsaState, task: Task): Liveness | null {
  if (isTaskSettled(task)) return 'settled';
  if (listOpenGates(state, task.id).length > 0) return 'gate';
  if (listActiveRuns(state, task.id).length > 0) return 'run';
  if (RUN_STAGES.has(task.stage)) return null;
  return 'system';
}

export function enforceLiveness(decider: Decider) {
  for (const task of Object.values(decider.state.tasks)) {
    if (resolveLiveness(decider.state, task) !== null) continue;
    decider.fail(
      task.id,
      'This task got stuck',
      `It was ${task.stageReason} but nothing was working on it. Retry to pick it up again.`
    );
  }
}
