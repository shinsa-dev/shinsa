import type { UserCommand } from '@shinsa/core';
import type { EngineCalls } from '../cli/client/schema.ts';

export interface CommandReceipt {
  readonly ok: true;
  readonly taskId: string | null;
  readonly handle?: string | null | undefined;
  readonly scheduleId?: string;
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
  api: EngineCalls;
  send: (command: UserCommand) => Promise<CommandReceipt>;
  projects?: SurfaceProjectChanges;
  hookSecrets?: SurfaceHookSecrets;
}

export function resolveCommandKey(key: string, sent: number) {
  return sent === 0 ? key : `${key}:${sent}`;
}
