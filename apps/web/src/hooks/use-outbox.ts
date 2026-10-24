import { useSyncExternalStore } from 'react';
import { listOutboxMessages, subscribeToOutbox } from '@/lib/tasks/outbox.ts';

export function useOutbox(taskId: string) {
  return useSyncExternalStore(subscribeToOutbox, () => listOutboxMessages(taskId));
}
