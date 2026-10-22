import type { QueueSummary, UserCommand } from '@shinsa/core';

export interface ApiClient {
  base: string;
  sendCommand: (command: UserCommand) => Promise<{ ok: true; taskId: string | null }>;
  readQueue: () => Promise<QueueSummary>;
}

function isErrorBody(body: unknown): body is { error: { message: string } } {
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
  if (isErrorBody(body)) throw new Error(body.error.message);
  return body as T;
}

export function createApiClient(base: string): ApiClient {
  return {
    base,
    sendCommand: (command) =>
      requestApi(base, '/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      }),
    readQueue: () => requestApi(base, '/api/queue'),
  };
}
