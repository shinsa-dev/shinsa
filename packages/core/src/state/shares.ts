import type { EventOf, ShinsaEvent } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

type ShareEvent = Extract<
  ShinsaEvent,
  { type: 'task.shared' | 'task.unshared' | 'share.recorded' | 'share.failed' }
>;

function applyShared(state: ShinsaState, event: EventOf<'task.shared'>) {
  updateTask(state, event.taskId, event.at, { share: { at: event.at, url: null } });
  record(state, event.taskId, event.at, { actor: 'you', kind: 'stage', text: 'Shared this task by link' });
}

function applyUnshared(state: ShinsaState, event: EventOf<'task.unshared'>) {
  updateTask(state, event.taskId, event.at, { share: null });
  record(state, event.taskId, event.at, { actor: 'you', kind: 'stage', text: 'Stopped sharing this task' });
}

function applyRecorded(state: ShinsaState, event: EventOf<'share.recorded'>) {
  const share = state.tasks[event.taskId]?.share;
  if (!share) return;
  updateTask(state, event.taskId, event.at, { share: { ...share, url: event.url, failure: null } });
}

function applyFailed(state: ShinsaState, event: EventOf<'share.failed'>) {
  const share = state.tasks[event.taskId]?.share;
  if (!share) return;
  updateTask(state, event.taskId, event.at, { share: { ...share, failure: event.detail } });
}

export function applyShareEvent(state: ShinsaState, event: ShareEvent) {
  switch (event.type) {
    case 'task.shared':
      applyShared(state, event);
      return;
    case 'task.unshared':
      applyUnshared(state, event);
      return;
    case 'share.recorded':
      applyRecorded(state, event);
      return;
    case 'share.failed':
      applyFailed(state, event);
      return;
  }
}
