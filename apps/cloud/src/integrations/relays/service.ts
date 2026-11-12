import type { InstanceId } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { RelayRooms } from '../../http/worker.ts';
import {
  RELAY_ADDRESS_HEADER,
  RELAY_ROLE_HEADER,
  RELAY_ROOM_ORIGIN,
  type RelayRole,
} from '../../relay/schema.ts';
import { type RelayRequestInit, RelayUnreachable } from './schema.ts';

export class Relays extends Context.Service<
  Relays,
  {
    request(
      instanceId: InstanceId,
      path: string,
      init: RelayRequestInit
    ): Effect.Effect<Response, RelayUnreachable>;
    connect(instanceId: InstanceId): Effect.Effect<Response, RelayUnreachable>;
  }
>()('shinsa/cloud/integrations/Relays') {
  static readonly layer = Layer.effect(
    Relays,
    Effect.gen(function* () {
      const rooms = yield* RelayRooms;

      const send = (instanceId: InstanceId, path: string, role: RelayRole, init: RelayRequestInit) => {
        const { address, ...rest } = init;
        const headers = new Headers(rest.headers);
        headers.delete(RELAY_ADDRESS_HEADER);
        headers.set(RELAY_ROLE_HEADER, role);
        if (address) headers.set(RELAY_ADDRESS_HEADER, address);
        return Effect.tryPromise({
          try: () =>
            rooms.fetch(
              instanceId,
              new Request(`${RELAY_ROOM_ORIGIN}${path}`, { ...rest, headers, redirect: 'manual' })
            ),
          catch: (cause) => new RelayUnreachable({ instanceId, message: String(cause) }),
        });
      };

      return Relays.of({
        request: Effect.fn('Relays.request')(
          (instanceId: InstanceId, path: string, init: RelayRequestInit) => {
            const upgrade = new Headers(init.headers).get('upgrade')?.toLowerCase() === 'websocket';
            return send(instanceId, path, upgrade ? 'socket' : 'http', init);
          }
        ),
        connect: Effect.fn('Relays.connect')((instanceId: InstanceId) =>
          send(instanceId, '/', 'machine', { headers: { upgrade: 'websocket' } })
        ),
      });
    })
  );
}
