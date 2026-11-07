import { useStoredFlag, writeFlag } from '@/lib/preferences/stored-flag.ts';

const EVERYONE_QUEUE_KEY = 'shinsa.queue-everyone';

export function useEveryoneQueue() {
  return useStoredFlag(EVERYONE_QUEUE_KEY, false);
}

export function writeEveryoneQueue(everyone: boolean) {
  writeFlag(EVERYONE_QUEUE_KEY, everyone);
}
