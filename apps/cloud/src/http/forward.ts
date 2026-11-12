import { Effect, Option } from 'effect';
import type { RelayUnreachable } from '../integrations/relays/schema.ts';

const TUNNEL_OFFLINE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504, 530]);

export type OfflineSurface = 'webhook' | 'slack' | 'preview';

const DROPPED_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'cdn-loop']);

const DROPPED_PREFIXES = ['cf-', 'x-forwarded-', 'x-real-ip'];

export function resolveForwardHeaders(source: Headers, dropped: ReadonlySet<string> = new Set()) {
  const headers = new Headers();
  for (const [name, value] of source) {
    if (DROPPED_HEADERS.has(name) || dropped.has(name)) continue;
    if (DROPPED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    headers.set(name, value);
  }
  return headers;
}

export function isTunnelOffline(response: Response) {
  return TUNNEL_OFFLINE_STATUSES.has(response.status);
}

export const recordMachineOffline = Effect.fn('recordMachineOffline')(function* (
  surface: OfflineSurface,
  instanceId: string,
  cause: { readonly status: number } | { readonly error: string }
) {
  yield* Effect.logWarning('[Cloud] Machine offline').pipe(
    Effect.annotateLogs({
      surface,
      instanceId,
      ...('status' in cause
        ? { reason: 'status', status: cause.status }
        : { reason: 'unreachable', error: cause.error }),
    })
  );
});

export const requestOnlineMachine = Effect.fn('requestOnlineMachine')(function* <R>(
  surface: OfflineSurface,
  instanceId: string,
  request: Effect.Effect<Response, RelayUnreachable, R>
) {
  const answer = yield* request.pipe(
    Effect.tapError((error) => recordMachineOffline(surface, instanceId, { error: error.message })),
    Effect.option
  );
  if (Option.isNone(answer)) return Option.none<Response>();
  if (!isTunnelOffline(answer.value)) return answer;
  yield* recordMachineOffline(surface, instanceId, { status: answer.value.status });
  return Option.none<Response>();
});
