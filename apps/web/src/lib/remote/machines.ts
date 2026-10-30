import type { RemoteInstance } from '@shinsa/core';
import { formatSince } from '@/lib/format/time.ts';

export interface MachineRow {
  instance: RemoteInstance;
  status: string;
  access: string;
  canOpen: boolean;
}

export function describeMachine(instance: RemoteInstance, enrolled: boolean, now = Date.now()): MachineRow {
  const seen =
    instance.lastSeenAt === null ? 'Never connected' : formatSince('Last seen', instance.lastSeenAt, now);
  return {
    instance,
    status: instance.online ? 'Online' : seen,
    access: enrolled ? 'Added in this browser' : 'Not added in this browser',
    canOpen: enrolled && instance.online,
  };
}
