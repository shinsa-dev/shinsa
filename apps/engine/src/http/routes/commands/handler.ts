import { EngineApi } from '@shinsa/core/engine-api';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { dispatchUserCommand, resolveRequestOrigin } from '../../commands.ts';
import { RequestSource } from '../../schema.ts';
import { HttpServices } from '../../services/service.ts';

export const CommandsHandlers = HttpApiBuilder.group(
  EngineApi,
  'commands',
  Effect.fn('CommandsHandlers')(function* (handlers) {
    const { engine, classify, remote } = yield* HttpServices;
    return handlers.handle(
      'send',
      Effect.fn('CommandsHandlers.send')(function* ({ headers, payload }) {
        const source = yield* RequestSource;
        const taskId = yield* dispatchUserCommand(engine, payload, {
          clientId: headers['idempotency-key']?.trim() || null,
          classify: classify ?? null,
          origin: resolveRequestOrigin(source, remote),
          guest: null,
        });
        const handle = taskId ? (engine.state.tasks[taskId]?.handle ?? null) : null;
        return { ok: true as const, taskId, handle };
      })
    );
  })
);
