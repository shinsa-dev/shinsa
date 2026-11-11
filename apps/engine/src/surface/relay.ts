import { DomainError, resolveTeamRelayPath, type UserCommand } from '@shinsa/core';
import { RequestFailedWire } from '@shinsa/core/engine-api/errors';
import { Effect, Schema } from 'effect';
import type { SurfaceTeammateRelay } from './schema.ts';

export type TeammateRelay = (instanceId: string, request: Request) => Effect.Effect<Response>;

const RELAY_ORIGIN = 'http://teammate.local';

const COMMANDS_PATH = '/api/commands';

const readRelayFailure = Effect.fn('Surface.readRelayFailure')(function* (response: Response) {
  const text = yield* Effect.promise(() => response.text());
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(RequestFailedWire))(text);
  const message =
    decoded._tag === 'Some' ? decoded.value.message : `The teammate’s machine answered ${response.status}.`;
  const code = decoded._tag === 'Some' ? decoded.value.code : 'relay_failed';
  return new DomainError({ code, message });
});

export function createCommandRelay(
  relay: TeammateRelay,
  resolveSender: Effect.Effect<Record<string, unknown>> = Effect.succeed({})
): SurfaceTeammateRelay {
  return Effect.fn('Surface.relay')(function* (instanceId: string, command: UserCommand) {
    const sender = yield* resolveSender;
    const request = new Request(`${RELAY_ORIGIN}${COMMANDS_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...command, ...sender }),
    });
    const response = yield* relay(instanceId, request);
    if (!response.ok) return yield* Effect.fail(yield* readRelayFailure(response));
  });
}

export function createLocalRelay(
  base: string,
  fetch: typeof globalThis.fetch = globalThis.fetch
): TeammateRelay {
  return (instanceId, request) =>
    Effect.tryPromise(() =>
      fetch(`${base}${resolveTeamRelayPath(instanceId)}${new URL(request.url).pathname}`, request)
    ).pipe(Effect.catch(() => Effect.succeed(new Response(null, { status: 502 }))));
}
