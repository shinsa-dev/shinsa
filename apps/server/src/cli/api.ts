import { DomainError, type QueueSummary, type Repo, type UserCommand } from '@shinsa/core';
import { type CommandReceipt, resolveCommandKey, type SurfaceClient } from '../surface/index.ts';

export interface ApiClient {
  base: string;
  sendCommand: (command: UserCommand) => Promise<CommandReceipt>;
  readQueue: () => Promise<QueueSummary>;
  readRepos: () => Promise<{ repos: Repo[] }>;
}

function isErrorBody(body: unknown): body is { error: { code?: string; message: string } } {
  return Boolean(body) && typeof body === 'object' && 'error' in (body as object);
}

export type EngineWake = () => Promise<boolean>;

export const NOT_RUNNING =
  'Shinsa is not running. Open the Shinsa app, which starts it and keeps it running.';

async function reach(
  base: string,
  path: string,
  init: RequestInit | undefined,
  wake: EngineWake | undefined
) {
  try {
    return await fetch(`${base}${path}`, init);
  } catch {
    if (!wake || !(await wake())) throw new Error(NOT_RUNNING);
  }
  try {
    return await fetch(`${base}${path}`, init);
  } catch {
    throw new Error(NOT_RUNNING);
  }
}

async function requestApi<T>(base: string, path: string, init?: RequestInit, wake?: EngineWake): Promise<T> {
  const response = await reach(base, path, init, wake);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Shinsa on ${base} answered ${response.status} without JSON.`);
  }
  if (isErrorBody(body)) throw new DomainError(body.error.code ?? 'request_failed', body.error.message);
  return body as T;
}

function postJson(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

export function createSurfaceClient(base: string, key: string, wake?: EngineWake): SurfaceClient {
  let sent = 0;
  return {
    base,
    read: (path) => requestApi(base, path, undefined, wake),
    post: (path, body) => requestApi(base, path, postJson(body), wake),
    send: (command) => {
      const header = resolveCommandKey(key, sent);
      sent += 1;
      return requestApi(base, '/api/commands', postJson(command, { 'idempotency-key': header }), wake);
    },
  };
}

export function createApiClient(base: string, wake?: EngineWake): ApiClient {
  const client = createSurfaceClient(base, `cli:${Bun.randomUUIDv7()}`, wake);
  return {
    base,
    sendCommand: client.send,
    readQueue: () => client.read('/api/queue'),
    readRepos: () => client.read('/api/repos'),
  };
}
