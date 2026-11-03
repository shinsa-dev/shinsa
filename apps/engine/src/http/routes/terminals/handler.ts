import { listTerminalPlaces, TERMINAL_LIMITS } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { RequestFailed, RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Predicate } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { readOptionalText, readText, resolveTerminalStart } from '../../../terminals/routes.ts';
import { requestPromise, requestSync } from '../../failures.ts';
import { PROJECT_GONE, PROJECT_ID_LIMIT } from '../../schema.ts';
import { HttpServices } from '../../services/service.ts';
import { PATH_LIMIT } from './schema.ts';

export const TerminalsHandlers = HttpApiBuilder.group(
  EngineApi,
  'terminals',
  Effect.fn('TerminalsHandlers')(function* (handlers) {
    const { engine, terminals: given } = yield* HttpServices;
    const terminals = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    const change = (run: (found: NonNullable<typeof given>) => void) =>
      Effect.flatMap(terminals, (found) =>
        Effect.map(
          requestSync(() => run(found)),
          () => found.snapshot()
        )
      );

    return handlers
      .handle('list', () => Effect.map(terminals, (found) => found.snapshot()))
      .handle('foreground', ({ params }) =>
        Effect.flatMap(terminals, (found) => requestPromise(() => found.readForeground(params.terminalId)))
      )
      .handle(
        'create',
        Effect.fn('TerminalsHandlers.create')(function* ({ payload }) {
          const found = yield* terminals;
          const projectId = yield* requestSync(() => readText(payload, 'projectId', PROJECT_ID_LIMIT));
          if (!engine.state.projects[projectId]) return yield* new RequestFailed(PROJECT_GONE);
          return yield* requestSync(() => {
            const path = readText(payload, 'path', PATH_LIMIT);
            const command = readOptionalText(payload, 'command', TERMINAL_LIMITS.command);
            const start = resolveTerminalStart(
              listTerminalPlaces(engine.state, projectId),
              projectId,
              path,
              found.home
            );
            const terminal = found.create(start);
            if (command) found.run(terminal.id, command);
            return { terminal, ...found.snapshot() };
          });
        })
      )
      .handle('reorder', ({ payload }) =>
        change((found) => {
          const ids = Array.isArray(payload.ids) ? payload.ids.filter(Predicate.isString) : [];
          found.reorder(readText(payload, 'projectId', PROJECT_ID_LIMIT), ids);
        })
      )
      .handle('rename', ({ params, payload }) =>
        change((found) =>
          found.rename(params.terminalId, readOptionalText(payload, 'name', TERMINAL_LIMITS.name))
        )
      )
      .handle('restart', ({ params }) => change((found) => found.restart(params.terminalId)))
      .handle('close', ({ params }) => change((found) => found.close(params.terminalId)));
  })
);
