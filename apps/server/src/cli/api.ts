import { DomainError, type QueueSummary, type UserCommand } from '@shinsa/core';
import { type CommandReceipt, resolveCommandKey, type SurfaceClient } from '../surface/index.ts';

export interface ApiClient {
  base: string;
  sendCommand: (command: UserCommand) => Promise<CommandReceipt>;
  readQueue: () => Promise<QueueSummary>;
}

function isErrorBody(body: unknown): body is { error: { code?: string; message: string } } {
  return Boolean(body) && typeof body === 'object' && 'error' in (body as object);
}

async function requestApi<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, init);
  } catch {
    throw new Error(`Shinsa is not running on ${base}. Start it with \`shinsa\`.`);
  }
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

export function createSurfaceClient(base: string, key: string): SurfaceClient {
  let sent = 0;
  return {
    base,
    read: (path) => requestApi(base, path),
    post: (path, body) => requestApi(base, path, postJson(body)),
    send: (command) => {
      const header = resolveCommandKey(key, sent);
      sent += 1;
      return requestApi(base, '/api/commands', postJson(command, { 'idempotency-key': header }));
    },
  };
}

export function createApiClient(base: string): ApiClient {
  const client = createSurfaceClient(base, `cli:${Bun.randomUUIDv7()}`);
  return {
    base,
    sendCommand: client.send,
    readQueue: () => client.read('/api/queue'),
  };
}
