import { EngineApi } from '@shinsa/core/engine-api';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { EngineCore } from '../../../runtime/engine/service.ts';
import { CommandRouter } from '../../../triage/router/service.ts';
import { dispatchUserCommand } from '../../commands.ts';
import { RequestSource } from '../../schema.ts';

export const CommandsHandlers = HttpApiBuilder.group(
  EngineApi,
  'commands',
  Effect.fn('CommandsHandlers')(function* (handlers) {
    const engine = yield* EngineCore;
    const router = Option.getOrNull(yield* Effect.serviceOption(CommandRouter));
    return handlers.handle(
      'send',
      Effect.fn('CommandsHandlers.send')(function* ({ headers, payload }) {
        const source = yield* RequestSource;
        const taskId = yield* dispatchUserCommand(engine, payload, {
          clientId: headers['idempotency-key']?.trim() || null,
          router,
          origin: source.via === 'local' ? 'local' : 'remote',
          guest: null,
        });
        const handle = taskId ? ((yield* engine.state).tasks[taskId]?.handle ?? null) : null;
        return { ok: true as const, taskId, handle };
      })
    );
  })
);
