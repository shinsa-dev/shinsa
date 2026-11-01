import type { ActivityActor, PreviewShare, ShareEnd } from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

type ShareEvent = Extract<
  ShinsaEvent,
  {
    type:
      | 'task.shared'
      | 'task.unshared'
      | 'share.recorded'
      | 'share.failed'
      | 'share.described'
      | 'preview.shared'
      | 'preview.unshared'
      | 'preview.recorded'
      | 'preview.failed';
  }
>;

type PreviewEvent = Extract<ShareEvent, { type: `preview.${string}` }>;

const SHARE_ENDED: Record<ShareEnd, { actor: ActivityActor; text: string }> = {
  you: { actor: 'you', text: 'Stopped sharing this task' },
  done: { actor: 'shinsa', text: 'Stopped sharing this task, since it finished' },
  expired: { actor: 'shinsa', text: 'Stopped sharing this task, since its time ran out' },
};

const PREVIEW_ENDED: Record<ShareEnd, { actor: ActivityActor; text: string }> = {
  you: { actor: 'you', text: 'Stopped sharing a preview' },
  done: { actor: 'shinsa', text: 'Stopped sharing a preview, since the task finished' },
  expired: { actor: 'shinsa', text: 'Stopped sharing a preview, since its time ran out' },
};

function listPreviews(state: ShinsaState, taskId: string) {
  return state.tasks[taskId]?.previews ?? [];
}

function writePreview(
  state: ShinsaState,
  event: PreviewEvent,
  change: (preview: PreviewShare) => PreviewShare
) {
  const previews = listPreviews(state, event.taskId);
  if (!previews.some((preview) => preview.serviceId === event.serviceId)) return;
  updateTask(state, event.taskId, event.at, {
    previews: previews.map((preview) => (preview.serviceId === event.serviceId ? change(preview) : preview)),
  });
}

function applyPreviewShared(state: ShinsaState, event: EventOf<'preview.shared'>) {
  const limits = { limit: event.limit, endsAt: event.endsAt };
  const previews = listPreviews(state, event.taskId);
  if (previews.some((preview) => preview.serviceId === event.serviceId)) {
    writePreview(state, event, (preview) => ({ ...preview, ...limits }));
    return;
  }
  const added: PreviewShare = { serviceId: event.serviceId, at: event.at, url: null, ...limits };
  updateTask(state, event.taskId, event.at, { previews: [...previews, added] });
  record(state, event.taskId, event.at, { actor: 'you', kind: 'stage', text: 'Shared a preview by link' });
}

function applyPreviewUnshared(state: ShinsaState, event: EventOf<'preview.unshared'>) {
  const previews = listPreviews(state, event.taskId).filter(
    (preview) => preview.serviceId !== event.serviceId
  );
  updateTask(state, event.taskId, event.at, { previews });
  record(state, event.taskId, event.at, { kind: 'stage', ...PREVIEW_ENDED[event.reason] });
}

function applyShared(state: ShinsaState, event: EventOf<'task.shared'>) {
  const share = state.tasks[event.taskId]?.share;
  const limits = { limit: event.limit, preset: event.preset, endsAt: event.endsAt };
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

function applyDescribed(state: ShinsaState, event: EventOf<'share.described'>) {
  const share = state.tasks[event.taskId]?.share;
  if (!share) return;
  updateTask(state, event.taskId, event.at, { share: { ...share, description: event.description } });
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
    case 'share.described':
      applyDescribed(state, event);
      return;
    case 'preview.shared':
      applyPreviewShared(state, event);
      return;
    case 'preview.unshared':
      applyPreviewUnshared(state, event);
      return;
    case 'preview.recorded':
      writePreview(state, event, (preview) => ({ ...preview, url: event.url, failure: null }));
      return;
    case 'preview.failed':
      writePreview(state, event, (preview) => ({ ...preview, failure: event.detail }));
      return;
  }
}
