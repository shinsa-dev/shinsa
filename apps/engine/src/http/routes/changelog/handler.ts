import { EngineApi } from '@shinsa/core/engine-api';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { EMPTY_CHANGELOG } from '../../../changelog/index.ts';
import { HttpServices } from '../../services/service.ts';

export const ChangelogHandlers = HttpApiBuilder.group(
  EngineApi,
  'changelog',
  Effect.fn('ChangelogHandlers')(function* (handlers) {
    const { changelog } = yield* HttpServices;

    return handlers.handle('list', () => Effect.succeed(changelog ?? EMPTY_CHANGELOG));
  })
);
