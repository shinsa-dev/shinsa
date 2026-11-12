import { RELAY_MACHINE_SEGMENT, resolveRelayPath } from '@shinsa/core';
import { NotFound, Revoked } from '@shinsa/core/remote/errors';
import { Effect, Layer, Option, Redacted } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { BEARER, NOT_PAIRED } from '../../auth/schema.ts';
import { CloudCrypto } from '../../crypto/service.ts';
import { resolveForwardHeaders } from '../../http/forward.ts';
import { CurrentUrl } from '../../http/request.ts';
import { respondText } from '../../http/responses.ts';
import { Relays } from '../../integrations/relays/service.ts';
import { Machines } from '../../store/machines/service.ts';
import {
  RELAY_FORWARDED_AWAY,
  RELAY_OFFLINE_MESSAGE,
  RELAY_ROUTE,
  RELAY_SOCKETS_ONLY_MESSAGE,
  RelayParams,
} from './schema.ts';

export const RelayRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const machines = yield* Machines;
    const relays = yield* Relays;
    const crypto = yield* CloudCrypto;

    const respondOffline = () =>
      respondText(RELAY_OFFLINE_MESSAGE, { status: 503, headers: { 'retry-after': '30' } });

    const assertMachineToken = Effect.fn('relay.assertMachineToken')(function* (
      instanceId: string,
      authorization: string | undefined
    ) {
      const revoked = new Revoked({ message: NOT_PAIRED });
      const token = authorization?.startsWith(BEARER) ? authorization.slice(BEARER.length) : '';
      if (token === '') return yield* revoked;
      const machine = yield* machines.selectByToken(yield* crypto.hashToken(Redacted.make(token)));
      if (Option.isNone(machine) || machine.value.id !== instanceId) return yield* revoked;
    });

    const respondRelay = Effect.gen(function* () {
      const params = yield* Effect.option(HttpRouter.schemaPathParams(RelayParams));
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (request.headers.upgrade?.toLowerCase() !== 'websocket')
        return yield* new NotFound({ message: RELAY_SOCKETS_ONLY_MESSAGE });
      const machine = Option.isSome(params) ? yield* machines.select(params.value.instanceId) : Option.none();
      if (Option.isNone(params) || Option.isNone(machine))
        return yield* new NotFound({ message: 'No such machine.' });
      const instanceId = machine.value.id;
      const url = yield* CurrentUrl;
      const path = url.pathname.slice(resolveRelayPath(instanceId).length);
      if (path === `/${RELAY_MACHINE_SEGMENT}`) {
        yield* assertMachineToken(instanceId, request.headers.authorization);
        const accepted = yield* Effect.option(relays.connect(instanceId));
        return Option.isSome(accepted) ? HttpServerResponse.raw(accepted.value) : respondOffline();
      }
      const answer = yield* Effect.option(
        relays.request(instanceId, `${path}${url.search}`, {
          method: 'GET',
          headers: resolveForwardHeaders(new Headers(request.headers), RELAY_FORWARDED_AWAY),
          address: request.headers['cf-connecting-ip'] ?? null,
        })
      );
      return Option.isSome(answer) ? HttpServerResponse.raw(answer.value) : respondOffline();
    });

    return HttpRouter.add('GET', RELAY_ROUTE, respondRelay);
  })
);
