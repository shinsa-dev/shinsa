import type { EventOf } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

type InboxEvent = EventOf<'task.message_received' | 'task.message_routed' | 'task.message_dropped'>;

function removeInboxMessage(state: ShinsaState, event: InboxEvent) {
  const task = state.tasks[event.taskId];
  const message = task?.inbox?.find((candidate) => candidate.id === event.messageId);
  if (!task || !message) return null;
  updateTask(state, task.id, event.at, {
    inbox: (task.inbox ?? []).filter((candidate) => candidate.id !== message.id),
  });
  return message;
}

export function applyInboxEvent(state: ShinsaState, event: InboxEvent) {
  switch (event.type) {
    case 'task.message_received': {
      const task = state.tasks[event.taskId];
      if (!task) return;
      updateTask(state, task.id, event.at, {
        inbox: [...(task.inbox ?? []), { id: event.messageId, text: event.text, at: event.at }],
      });
      return;
    }
    case 'task.message_routed':
      removeInboxMessage(state, event);
      return;
    case 'task.message_dropped': {
      const message = removeInboxMessage(state, event);
      if (!message) return;
      record(state, event.taskId, event.at, {
        actor: 'shinsa',
        kind: 'failure',
        text: 'Could not deliver your message',
        detail: `${event.reason}\n\nYour message: ${message.text}`,
        undelivered: { text: message.text, reason: event.reason },
      });
    }
  }
}
