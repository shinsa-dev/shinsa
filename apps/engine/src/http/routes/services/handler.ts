import { listTerminalPlaces, SERVICE_LIMITS, type ServiceDefinition } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { RequestFailed, RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { isFolder } from '../../../files/paths.ts';
import type { ServiceRun } from '../../../terminals/index.ts';
import {
  readOptionalText,
  readServiceBatch,
  readServiceIds,
  readServiceInput,
  readText,
} from '../../../terminals/input.ts';
import {
  listNewServiceSuggestions,
  listNewSuggestions,
  resolveServicePlaceIn,
  resolveServiceRunIn,
} from '../../../terminals/places.ts';
import { requestPromise, requestSync } from '../../failures.ts';
import { PROJECT_GONE, PROJECT_ID_LIMIT } from '../../schema.ts';
import { HttpServices } from '../../services/service.ts';
import {
  NO_MAIN_PLACE,
  NO_TASK_PLACE,
  PLACE_GONE,
  SERVICE_LIMIT,
  TASK_GONE,
  TASK_ID_LIMIT,
} from './schema.ts';

export const ServicesHandlers = HttpApiBuilder.group(
  EngineApi,
  'services',
  Effect.fn('ServicesHandlers')(function* (handlers) {
    const { engine, terminals: given, refiner } = yield* HttpServices;
    const terminals = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    type Found = NonNullable<typeof given>;

    const findPlaces = (projectId: string) =>
      engine.state.projects[projectId]
        ? Effect.succeed(listTerminalPlaces(engine.state, projectId))
        : Effect.fail(new RequestFailed(PROJECT_GONE));

    const listOthers = (found: Found, projectId: string, except: string | null) =>
      found.snapshot().services.filter((each) => each.projectId === projectId && each.id !== except);

    const readProjectId = (payload: Readonly<Record<string, unknown>>) =>
      requestSync(() => readText(payload, 'projectId', PROJECT_ID_LIMIT));

    const resolveRun = Effect.fn('ServicesHandlers.resolveRun')(function* (
      found: Found,
      serviceId: string,
      taskId: string | null
    ) {
      const service = yield* requestSync(() => found.findService(serviceId));
      if (taskId !== null && !engine.state.tasks[taskId]) return yield* new RequestFailed(TASK_GONE);
      const run: ServiceRun | null = resolveServiceRunIn(engine.state, service, taskId, found);
      if (!run) return yield* new RequestFailed(taskId === null ? NO_MAIN_PLACE : NO_TASK_PLACE);
      if (!isFolder(run.cwd)) return yield* new RequestFailed(PLACE_GONE);
      return run;
    });

    const readTaskId = (payload: { readonly taskId?: unknown } | null) =>
      requestSync(() => readOptionalText(payload ?? {}, 'taskId', TASK_ID_LIMIT));

    return handlers
      .handle(
        'suggestions',
        Effect.fn('ServicesHandlers.suggestions')(function* ({ query }) {
          const found = yield* terminals;
          const projectId = query.projectId ?? '';
          const others = () => listOthers(found, projectId, null);
          const suggestions = listNewSuggestions(yield* findPlaces(projectId), others());
          if (!(refiner && query.refine === '1')) return { suggestions, refined: false };
          const answer = yield* requestPromise(() => refiner.refine(projectId, suggestions));
          return {
            suggestions: listNewServiceSuggestions(answer.suggestions, others()),
            refined: answer.refined,
          };
        })
      )
      .handle(
        'add',
        Effect.fn('ServicesHandlers.add')(function* ({ payload }) {
          const found = yield* terminals;
          const projectId = yield* readProjectId(payload);
          const places = yield* findPlaces(projectId);
          return yield* requestSync(() => {
            const input = readServiceInput(payload, listOthers(found, projectId, null), places, found.home);
            const service = found.addService(projectId, input);
            return { service, ...found.snapshot() };
          });
        })
      )
      .handle(
        'addBatch',
        Effect.fn('ServicesHandlers.addBatch')(function* ({ payload }) {
          const found = yield* terminals;
          const projectId = yield* readProjectId(payload);
          const places = yield* findPlaces(projectId);
          const inputs = yield* requestSync(() =>
            readServiceBatch(payload, listOthers(found, projectId, null), places, found.home)
          );
          if (found.snapshot().services.length + inputs.length > SERVICE_LIMITS.services)
            return yield* new RequestFailed(SERVICE_LIMIT);
          const added = inputs.map((input) => found.addService(projectId, input));
          return { added, ...found.snapshot() };
        })
      )
      .handle('remove', ({ payload }) =>
        Effect.flatMap(terminals, (found) =>
          requestSync(() => {
            found.removeServices(readServiceIds(payload));
            return found.snapshot();
          })
        )
      )
      .handle(
        'startAll',
        Effect.fn('ServicesHandlers.startAll')(function* ({ payload }) {
          const found = yield* terminals;
          const projectId = yield* readProjectId(payload);
          yield* findPlaces(projectId);
          for (const service of listOthers(found, projectId, null)) {
            const place = resolveServicePlaceIn(engine.state, service, found.home);
            if (place) found.startService(service.id, { cwd: service.cwd, place, taskId: null });
          }
          return found.snapshot();
        })
      )
      .handle(
        'update',
        Effect.fn('ServicesHandlers.update')(function* ({ params, payload }) {
          const found = yield* terminals;
          const service: ServiceDefinition = yield* requestSync(() => found.findService(params.serviceId));
          const places = yield* findPlaces(service.projectId);
          return yield* requestSync(() => {
            const others = listOthers(found, service.projectId, service.id);
            found.updateService(service.id, readServiceInput(payload, others, places, found.home));
            return found.snapshot();
          });
        })
      )
      .handle(
        'start',
        Effect.fn('ServicesHandlers.start')(function* ({ params, payload }) {
          const found = yield* terminals;
          const taskId = yield* readTaskId(payload);
          const run = yield* resolveRun(found, params.serviceId, taskId);
          const terminal = yield* requestSync(() => found.startService(params.serviceId, run));
          return { terminal, ...found.snapshot() };
        })
      )
      .handle(
        'stop',
        Effect.fn('ServicesHandlers.stop')(function* ({ params, payload }) {
          const found = yield* terminals;
          const taskId = yield* readTaskId(payload);
          yield* requestPromise(() => found.stopService(params.serviceId, taskId));
          return found.snapshot();
        })
      )
      .handle(
        'restart',
        Effect.fn('ServicesHandlers.restart')(function* ({ params, payload }) {
          const found = yield* terminals;
          const taskId = yield* readTaskId(payload);
          const run = yield* resolveRun(found, params.serviceId, taskId);
          const terminal = yield* requestPromise(() => found.restartService(params.serviceId, run));
          return { terminal, ...found.snapshot() };
        })
      );
  })
);
