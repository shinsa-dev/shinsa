import type { CommandOf } from '../commands/index.ts';
import {
  describeOverlaps,
  isDelegatedRun,
  isTaskSettled,
  listNewOverlapPaths,
  type OverlapNote,
  type RunRole,
} from '../domain/index.ts';
import { listRunningRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';

function resolveOverlapNote(decider: Decider, taskId: string) {
  const untold = (decider.task(taskId).overlaps ?? []).filter((overlap) => overlap.untold.length > 0);
  if (untold.length === 0) return '';
  decider.emit({ type: 'task.overlaps_told', taskId });
  const notes = untold.flatMap((overlap): OverlapNote[] => {
    const other = decider.state.tasks[overlap.taskId];
    if (!other || isTaskSettled(other)) return [];
    return [{ handle: other.handle ?? null, title: other.title, paths: overlap.untold }];
  });
  return notes.length === 0 ? '' : describeOverlaps(notes);
}

function steerOverlaps(decider: Decider, taskId: string) {
  const running = listRunningRuns(decider.state, taskId).find(
    (run) => run.status !== 'waiting' && run.role === 'agent' && !isDelegatedRun(run)
  );
  if (!running) return;
  const note = resolveOverlapNote(decider, taskId);
  if (note) decider.run({ kind: 'run.steer', runId: running.id, text: note, from: 'shinsa' });
}

export function recordOverlaps(decider: Decider, command: CommandOf<'task.record_overlaps'>) {
  if (isTaskSettled(decider.task(command.taskId))) return;
  for (const overlap of command.overlaps) {
    const other = decider.state.tasks[overlap.taskId];
    if (!other || other.id === command.taskId || isTaskSettled(other)) continue;
    const paths = listNewOverlapPaths(decider.task(command.taskId), other.id, overlap.paths);
    if (paths.length === 0) continue;
    decider.emit({ type: 'task.overlapped', taskId: command.taskId, otherTaskId: other.id, paths });
  }
  if (command.taskId !== command.from) steerOverlaps(decider, command.taskId);
}

export function tellOverlaps(decider: Decider, taskId: string, role: RunRole) {
  if (role !== 'agent') return '';
  const note = resolveOverlapNote(decider, taskId);
  return note ? `\n\n${note}` : '';
}
