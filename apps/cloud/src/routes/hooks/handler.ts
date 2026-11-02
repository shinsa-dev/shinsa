import { REMOTE_ENGINE_HOOK_PREFIX } from '@shinsa/core';
import { BodyTooLarge, NotFound } from '@shinsa/core/remote/errors';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { resolveForwardHeaders, TUNNEL_OFFLINE_STATUSES } from '../../http/forward.ts';
import { CurrentUrl } from '../../http/request.ts';
import { respondText } from '../../http/responses.ts';
import { Tunnels } from '../../integrations/tunnels/service.ts';
import { Machines } from '../../store/machines/service.ts';
import { BODILESS_METHODS, FORWARDED_AWAY, HOOK_BODY_LIMIT_BYTES, HOOK_ROUTE, HookParams } from './schema.ts';

export const HookRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const machines = yield* Machines;
    const tunnels = yield* Tunnels;

    const respondOffline = () =>
      respondText('This machine is offline. Try again later.', {
        status: 503,
        headers: { 'retry-after': '60' },
      });

    const respondHook = Effect.gen(function* () {
      const params = yield* Effect.option(HttpRouter.schemaPathParams(HookParams));
      const machine = Option.isSome(params) ? yield* machines.select(params.value.instanceId) : Option.none();
      if (Option.isNone(params) || Option.isNone(machine))
        return yield* new NotFound({ message: 'No such webhook.' });
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = yield* CurrentUrl;
      const body = BODILESS_METHODS.has(request.method) ? null : yield* Effect.orDie(request.arrayBuffer);
      if (body && body.byteLength > HOOK_BODY_LIMIT_BYTES)
        return yield* new BodyTooLarge({ message: 'The webhook body is over 1 MB.' });
      const { scheduleId, token } = params.value;
      const answer = yield* Effect.option(
        tunnels.request(machine.value.id, `${REMOTE_ENGINE_HOOK_PREFIX}${scheduleId}/${token}${url.search}`, {
          method: request.method,
          headers: resolveForwardHeaders(new Headers(request.headers), FORWARDED_AWAY),
          ...(body ? { body } : {}),
        })
      );
      if (Option.isNone(answer) || TUNNEL_OFFLINE_STATUSES.has(answer.value.status)) return respondOffline();
      return HttpServerResponse.raw(
        new Response(answer.value.body, {
          status: answer.value.status,
          headers: { 'content-type': answer.value.headers.get('content-type') ?? 'text/plain' },
        })
      );
    });

    return HttpRouter.add('*', HOOK_ROUTE, respondHook);
  })
);
