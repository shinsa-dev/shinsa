import { listTerminalPlaces, resolveScopedTerminals, TERMINAL_LIMITS } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { RequestFailed, RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, FileSystem, Option, Predicate } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { PATH_LIMIT } from '../../../files/schema.ts';
import { EngineCore } from '../../../runtime/engine/service.ts';
import { assertFolderPresent } from '../../../terminals/folders.ts';
import { readOptionalText, readText } from '../../../terminals/input.ts';
import { resolveTerminalStart } from '../../../terminals/places.ts';
import { Terminals } from '../../../terminals/service.ts';
import { requestSync, resolveRequestFailure } from '../../failures.ts';
import { PROJECT_GONE, PROJECT_ID_LIMIT, RequestSource } from '../../schema.ts';

export const TerminalsHandlers = HttpApiBuilder.group(
  EngineApi,
  'terminals',
  Effect.fn('TerminalsHandlers')(function* (handlers) {
    const engine = yield* EngineCore;
    const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
    const given = Option.getOrUndefined(yield* Effect.serviceOption(Terminals));
    const terminals = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    const request = <A, E>(effect: Effect.Effect<A, E>) => Effect.mapError(effect, resolveRequestFailure);
    const change = <E>(run: (found: NonNullable<typeof given>) => Effect.Effect<void, E>) =>
      Effect.flatMap(terminals, (found) => Effect.andThen(request(run(found)), found.snapshot));

    return handlers
      .handle(
        'list',
        Effect.fn('TerminalsHandlers.list')(function* () {
          const snapshot = yield* (yield* terminals).snapshot;
          const { guest } = yield* RequestSource;
          if (!guest) return snapshot;
          return resolveScopedTerminals(yield* engine.state, guest.scope, snapshot);
        })
      )
      .handle('foreground', ({ params }) =>
        Effect.flatMap(terminals, (found) => request(found.readForeground(params.terminalId)))
      )
      .handle(
        'create',
        Effect.fn('TerminalsHandlers.create')(function* ({ payload }) {
          const found = yield* terminals;
          const projectId = yield* requestSync(() => readText(payload, 'projectId', PROJECT_ID_LIMIT));
          const state = yield* engine.state;
          if (!state.projects[projectId]) return yield* new RequestFailed(PROJECT_GONE);
          const { start, command } = yield* requestSync(() => {
            const path = readText(payload, 'path', PATH_LIMIT);
            const typed = readOptionalText(payload, 'command', TERMINAL_LIMITS.command);
            const places = listTerminalPlaces(state, projectId);
            return { start: resolveTerminalStart(places, projectId, path, found.home), command: typed };
          });
          yield* request(withFiles(assertFolderPresent(start.cwd)));
          const terminal = yield* request(found.create(start));
          if (command) yield* request(found.run(terminal.id, command));
          return { terminal, ...(yield* found.snapshot) };
        })
      )
      .handle('reorder', ({ payload }) =>
        change((found) =>
          Effect.flatMap(
            requestSync(() => readText(payload, 'projectId', PROJECT_ID_LIMIT)),
            (projectId) =>
              found.reorder(
                projectId,
                Array.isArray(payload.ids) ? payload.ids.filter(Predicate.isString) : []
              )
          )
        )
      )
      .handle('rename', ({ params, payload }) =>
        change((found) =>
          Effect.flatMap(
            requestSync(() => readOptionalText(payload, 'name', TERMINAL_LIMITS.name)),
            (name) => found.rename(params.terminalId, name)
          )
        )
      )
      .handle('restart', ({ params }) => change((found) => Effect.asVoid(found.restart(params.terminalId))))
      .handle('close', ({ params }) => change((found) => found.close(params.terminalId)));
  })
);
