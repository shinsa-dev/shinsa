import type { TaskOverlap } from '../domain/index.ts';
import type { EventOf } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { updateTask } from './write.ts';

function mergePaths(paths: readonly string[], added: readonly string[]) {
  return [...new Set([...paths, ...added])].sort();
}

export function applyOverlapEvent(
  state: ShinsaState,
  event: EventOf<'task.overlapped'> | EventOf<'task.overlaps_told'>
) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const overlaps = task.overlaps ?? [];
  if (event.type === 'task.overlaps_told') {
    updateTask(state, task.id, event.at, {
      overlaps: overlaps.map((overlap) => ({ ...overlap, untold: [] })),
    });
    return;
  }
  const known = overlaps.find((overlap) => overlap.taskId === event.otherTaskId);
  const next: TaskOverlap = {
    taskId: event.otherTaskId,
    paths: mergePaths(known?.paths ?? [], event.paths),
    untold: mergePaths(known?.untold ?? [], event.paths),
  };
  updateTask(state, task.id, event.at, {
    overlaps: [...overlaps.filter((overlap) => overlap.taskId !== event.otherTaskId), next],
  });
}
