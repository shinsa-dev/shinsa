import type { EventOf } from '../events/index.ts';
import { recordHandle, type ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

type MoveEvent = EventOf<'task.moving'> | EventOf<'task.moved'>;

function describeRepoName(state: ShinsaState, repoId: string) {
  return state.repos[repoId]?.name ?? 'another repository';
}

function applyMoving(state: ShinsaState, event: EventOf<'task.moving'>) {
  updateTask(state, event.taskId, event.at, { movingTo: event.repoId });
  record(state, event.taskId, event.at, {
    actor: event.runId ? 'agent' : 'you',
    kind: 'set_up',
    text: `Moving the task to ${describeRepoName(state, event.repoId)}`,
    detail: event.reason || null,
    runId: event.runId ?? null,
  });
}

function applyMoved(state: ShinsaState, event: EventOf<'task.moved'>) {
  if (event.handle) recordHandle(state, event.handle);
  updateTask(state, event.taskId, event.at, {
    repoId: event.repoId,
    ...(event.projectId ? { projectId: event.projectId } : {}),
    ...(event.handle ? { handle: event.handle } : {}),
    movingTo: null,
    editedPaths: [],
    untoldEdits: [],
    overlaps: [],
    treeHash: null,
  });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'set_up',
    text: `Moved the task to ${describeRepoName(state, event.repoId)}`,
  });
}

export function applyMoveEvent(state: ShinsaState, event: MoveEvent & { at: number }) {
  if (event.type === 'task.moving') applyMoving(state, event);
  else applyMoved(state, event);
}
