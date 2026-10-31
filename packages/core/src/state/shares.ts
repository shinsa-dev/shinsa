import type { ActivityActor, ShareEnd } from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

type ShareEvent = Extract<
  ShinsaEvent,
  { type: 'task.shared' | 'task.unshared' | 'share.recorded' | 'share.failed' }
>;

const SHARE_ENDED: Record<ShareEnd, { actor: ActivityActor; text: string }> = {
  you: { actor: 'you', text: 'Stopped sharing this task' },
  done: { actor: 'shinsa', text: 'Stopped sharing this task, since it finished' },
  expired: { actor: 'shinsa', text: 'Stopped sharing this task, since its time ran out' },
};

function applyShared(state: ShinsaState, event: EventOf<'task.shared'>) {
  const share = state.tasks[event.taskId]?.share;
  const limits = { limit: event.limit, endsAt: event.endsAt };
  if (share) {
    updateTask(state, event.taskId, event.at, { share: { ...share, ...limits } });
    return;
  }
  updateTask(state, event.taskId, event.at, { share: { at: event.at, url: null, ...limits } });
  record(state, event.taskId, event.at, { actor: 'you', kind: 'stage', text: 'Shared this task by link' });
}

function applyUnshared(state: ShinsaState, event: EventOf<'task.unshared'>) {
  updateTask(state, event.taskId, event.at, { share: null });
  record(state, event.taskId, event.at, { kind: 'stage', ...SHARE_ENDED[event.reason] });
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
