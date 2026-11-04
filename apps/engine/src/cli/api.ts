import type { QueueSummary, Repo, UserCommand } from '@shinsa/core';
import { Effect } from 'effect';
import {
  type CommandReceipt,
  resolveCommandKey,
  type SurfaceClient,
  type SurfaceFailure,
} from '../surface/index.ts';
import { createEngineCalls, type EngineFailure, type EngineWake } from './client/index.ts';

export { type EngineWake, NOT_RUNNING } from './client/index.ts';

export interface ApiClient {
  base: string;
  sendCommand: (command: UserCommand) => Effect.Effect<CommandReceipt, SurfaceFailure>;
  readQueue: () => Effect.Effect<QueueSummary, EngineFailure>;
  readRepos: () => Effect.Effect<{ readonly repos: readonly Repo[] }, EngineFailure>;
}

export function createSurfaceClient(base: string, key: string, wake?: EngineWake): SurfaceClient {
  const api = createEngineCalls({ base, wake });
  let sent = 0;
  return {
    base,
    api,
    send: (command) =>
      Effect.suspend(() => {
        const header = resolveCommandKey(key, sent);
        sent += 1;
        return api.commands.send({ headers: { 'idempotency-key': header }, payload: command });
      }),
  };
}

export function createApiClient(base: string, wake?: EngineWake): ApiClient {
  const client = createSurfaceClient(base, `cli:${Bun.randomUUIDv7()}`, wake);
  return {
    base,
    sendCommand: client.send,
    readQueue: () => client.api.server.queue(),
    readRepos: () => client.api.state.repos(),
  };
}
