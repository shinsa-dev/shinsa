import { RemoteApi } from '@shinsa/core/remote/api';
import { NotFound } from '@shinsa/core/remote/errors';
import { Clock, Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { isMachineOnline, resolveTunnelUrl } from '../../domain/machines.ts';
import { appendResponseHeader, NOINDEX } from '../../http/responses.ts';
import { Machines } from '../../store/machines/service.ts';

export const SharesHandlers = HttpApiBuilder.group(
  RemoteApi,
  'shares',
  Effect.fn(function* (handlers) {
    const machines = yield* Machines;

    return handlers.handle(
      'connect',
      Effect.fn('shares.connect')(function* ({ params }) {
        yield* appendResponseHeader('x-robots-tag', NOINDEX);
        const machine = yield* machines.select(params.instanceId);
        if (Option.isNone(machine))
          return yield* new NotFound({ message: 'This task is no longer shared, or the link is wrong.' });
        return {
          url: resolveTunnelUrl(machine.value),
          online: isMachineOnline(machine.value, yield* Clock.currentTimeMillis),
        };
      })
    );
  })
);
