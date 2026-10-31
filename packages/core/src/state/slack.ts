import type { EventOf, ShinsaEvent } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

type SlackEvent = Extract<ShinsaEvent, { type: 'slack.thread_linked' | 'slack.status_posted' }>;

function applyThreadLinked(state: ShinsaState, event: EventOf<'slack.thread_linked'>) {
  updateTask(state, event.taskId, event.at, { slack: event.link });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'set_up',
    text: 'Started from a Slack thread',
  });
}

function applyStatusPosted(state: ShinsaState, event: EventOf<'slack.status_posted'>) {
  const link = state.tasks[event.taskId]?.slack;
  if (!link) return;
  updateTask(state, event.taskId, event.at, {
    slack: { ...link, statusTs: event.ts, reaction: event.reaction },
  });
}

export function applySlackEvent(state: ShinsaState, event: SlackEvent) {
  switch (event.type) {
    case 'slack.thread_linked':
      applyThreadLinked(state, event);
      return;
    case 'slack.status_posted':
      applyStatusPosted(state, event);
      return;
  }
}
