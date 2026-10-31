import { type parseRemoteHookPath, resolveTunnelHost } from '@shinsa/core';
import { CloudError } from './http.ts';
import type { CloudWorld } from './world.ts';

export const HOOK_BODY_LIMIT_BYTES = 1024 * 1024;

const DROPPED_HEADERS = new Set(['host', 'cookie', 'connection', 'content-length', 'transfer-encoding']);

const DROPPED_PREFIXES = ['cf-', 'x-forwarded-', 'x-real-ip'];

export const TUNNEL_OFFLINE_STATUSES = new Set([502, 503, 504, 530]);

function resolveForwardHeaders(request: Request) {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (DROPPED_HEADERS.has(name) || DROPPED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    headers.set(name, value);
  }
  return headers;
}

function respondOffline() {
  return new Response('This machine is offline. Try again later.', {
    status: 503,
    headers: { 'retry-after': '60', 'content-type': 'text/plain' },
  });
}

export type HookTarget = NonNullable<ReturnType<typeof parseRemoteHookPath>>;

export async function respondHook(request: Request, url: URL, target: HookTarget, world: CloudWorld) {
  const row = await world.store.selectInstance(target.instanceId);
  if (!row) throw new CloudError('not_found', 'No such webhook.', 404);
  let body: ArrayBuffer | null = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') body = await request.arrayBuffer();
  if (body && body.byteLength > HOOK_BODY_LIMIT_BYTES)
    throw new CloudError('body_too_large', 'The webhook body is over 1 MB.', 413);
  let answer: Response;
  try {
    answer = await world.fetch(`https://${resolveTunnelHost(row.id)}${target.enginePath}${url.search}`, {
      method: request.method,
      headers: resolveForwardHeaders(request),
      ...(body ? { body } : {}),
      redirect: 'manual',
    });
  } catch {
    return respondOffline();
  }
  if (TUNNEL_OFFLINE_STATUSES.has(answer.status)) return respondOffline();
  return new Response(answer.body, {
    status: answer.status,
    headers: { 'content-type': answer.headers.get('content-type') ?? 'text/plain' },
  });
}
