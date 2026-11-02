import type { UserCommand } from '@shinsa/core';

export interface CommandReceipt {
  ok: true;
  taskId: string | null;
  handle?: string | null;
  scheduleId?: string;
}

export interface SurfaceHookSecrets {
  assertSecret: (scheduleId: string | null, ref: string | null) => void;
  writeSecret: (scheduleId: string, ref: string | null) => string | null;
}

interface SurfaceProjectChanges {
  upsertRepo: (projectId: string, path: string) => Promise<unknown>;
  upsertFolder: (projectId: string, path: string) => Promise<unknown>;
}

export interface SurfaceClient {
  base: string;
  read: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body: unknown) => Promise<T>;
  send: (command: UserCommand) => Promise<CommandReceipt>;
  projects?: SurfaceProjectChanges;
  hookSecrets?: SurfaceHookSecrets;
}

export function resolveCommandKey(key: string, sent: number) {
  return sent === 0 ? key : `${key}:${sent}`;
}
