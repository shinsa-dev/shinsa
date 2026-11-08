import { listTerminalPlaces, SERVICE_LIMITS, type ServiceDefinition } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { RequestFailed, RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, FileSystem, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { isFolder } from '../../../files/probe.ts';
import { EngineCore } from '../../../runtime/engine/service.ts';
import { listNewSuggestions } from '../../../terminals/detect.ts';
import { assertFolderPresent } from '../../../terminals/folders.ts';
import {
  readOptionalText,
  readServiceBatch,
  readServiceIds,
  readServiceInput,
  readText,
} from '../../../terminals/input.ts';
import { listNewServiceSuggestions, resolveServicePlaceIn } from '../../../terminals/places.ts';
import { ServiceRefiner } from '../../../terminals/refine/service.ts';
import { selectServiceRunIn } from '../../../terminals/runs.ts';
import { Terminals } from '../../../terminals/service.ts';
import { requestSync, resolveRequestFailure } from '../../failures.ts';
import { PROJECT_GONE, PROJECT_ID_LIMIT } from '../../schema.ts';
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
    const engine = yield* EngineCore;
    const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
    const given = Option.getOrUndefined(yield* Effect.serviceOption(Terminals));
    const refiner = Option.getOrUndefined(yield* Effect.serviceOption(ServiceRefiner));
    const terminals = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    type Found = NonNullable<typeof given>;
    const request = <A, E>(effect: Effect.Effect<A, E>) => Effect.mapError(effect, resolveRequestFailure);

    const findPlaces = Effect.fn('ServicesHandlers.findPlaces')(function* (projectId: string) {
      const state = yield* engine.state;
      if (!state.projects[projectId]) return yield* new RequestFailed(PROJECT_GONE);
      return listTerminalPlaces(state, projectId);
    });

    const listOthers = (found: Found, projectId: string, except: string | null) =>
      Effect.map(found.snapshot, (snapshot) =>
        snapshot.services.filter((each) => each.projectId === projectId && each.id !== except)
      );

    const readProjectId = (payload: Readonly<Record<string, unknown>>) =>
      requestSync(() => readText(payload, 'projectId', PROJECT_ID_LIMIT));

    const resolveRun = Effect.fn('ServicesHandlers.resolveRun')(function* (
      found: Found,
      serviceId: string,
      taskId: string | null
    ) {
      const service = yield* request(found.findService(serviceId));
      if (taskId !== null && !(yield* engine.state).tasks[taskId]) return yield* new RequestFailed(TASK_GONE);
      const run = yield* withFiles(selectServiceRunIn(yield* engine.state, service, taskId, found));
      if (Option.isNone(run))
        return yield* new RequestFailed(taskId === null ? NO_MAIN_PLACE : NO_TASK_PLACE);
      if (!(yield* withFiles(isFolder(run.value.cwd)))) return yield* new RequestFailed(PLACE_GONE);
      return run.value;
    });

    const readTaskId = (payload: { readonly taskId?: unknown } | null) =>
      requestSync(() => readOptionalText(payload ?? {}, 'taskId', TASK_ID_LIMIT));

    return handlers
      .handle(
        'suggestions',
        Effect.fn('ServicesHandlers.suggestions')(function* ({ query }) {
          const found = yield* terminals;
          const projectId = query.projectId ?? '';
          const others = listOthers(found, projectId, null);
          const suggestions = yield* withFiles(
            listNewSuggestions(yield* findPlaces(projectId), yield* others)
          );
          if (!(refiner && query.refine === '1')) return { suggestions, refined: false };
          const answer = yield* request(refiner.refine(projectId, suggestions));
          return {
            suggestions: listNewServiceSuggestions(answer.suggestions, yield* others),
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
          const others = yield* listOthers(found, projectId, null);
          const input = yield* requestSync(() => readServiceInput(payload, others, places, found.home));
          yield* request(withFiles(assertFolderPresent(input.cwd)));
          const service = yield* request(found.addService(projectId, input));
          return { service, ...(yield* found.snapshot) };
        })
      )
      .handle(
        'addBatch',
        Effect.fn('ServicesHandlers.addBatch')(function* ({ payload }) {
          const found = yield* terminals;
          const projectId = yield* readProjectId(payload);
          const places = yield* findPlaces(projectId);
          const others = yield* listOthers(found, projectId, null);
          const inputs = yield* requestSync(() => readServiceBatch(payload, others, places, found.home));
          yield* request(withFiles(Effect.forEach(inputs, (input) => assertFolderPresent(input.cwd))));
          if ((yield* found.snapshot).services.length + inputs.length > SERVICE_LIMITS.services)
            return yield* new RequestFailed(SERVICE_LIMIT);
          const added = yield* request(Effect.forEach(inputs, (input) => found.addService(projectId, input)));
          return { added, ...(yield* found.snapshot) };
        })
      )
      .handle(
        'remove',
        Effect.fn('ServicesHandlers.remove')(function* ({ payload }) {
          const found = yield* terminals;
          const ids = yield* requestSync(() => readServiceIds(payload));
          yield* request(found.removeServices(ids));
          return yield* found.snapshot;
        })
      )
      .handle(
        'startAll',
        Effect.fn('ServicesHandlers.startAll')(function* ({ payload }) {
          const found = yield* terminals;
          const projectId = yield* readProjectId(payload);
          yield* findPlaces(projectId);
          for (const service of yield* listOthers(found, projectId, null)) {
            const place = resolveServicePlaceIn(yield* engine.state, service, found.home);
            if (place)
              yield* request(found.startService(service.id, { cwd: service.cwd, place, taskId: null }));
          }
          return yield* found.snapshot;
        })
      )
      .handle(
        'update',
        Effect.fn('ServicesHandlers.update')(function* ({ params, payload }) {
          const found = yield* terminals;
          const service: ServiceDefinition = yield* request(found.findService(params.serviceId));
          const places = yield* findPlaces(service.projectId);
          const others = yield* listOthers(found, service.projectId, service.id);
          const input = yield* requestSync(() => readServiceInput(payload, others, places, found.home));
          yield* request(withFiles(assertFolderPresent(input.cwd)));
          yield* request(found.updateService(service.id, input));
          return yield* found.snapshot;
        })
      )
      .handle(
        'start',
        Effect.fn('ServicesHandlers.start')(function* ({ params, payload }) {
          const found = yield* terminals;
          const taskId = yield* readTaskId(payload);
          const run = yield* resolveRun(found, params.serviceId, taskId);
          const terminal = yield* request(found.startService(params.serviceId, run));
          return { terminal, ...(yield* found.snapshot) };
        })
      )
      .handle(
        'stop',
        Effect.fn('ServicesHandlers.stop')(function* ({ params, payload }) {
          const found = yield* terminals;
          const taskId = yield* readTaskId(payload);
          yield* request(found.stopService(params.serviceId, taskId));
          return yield* found.snapshot;
        })
      )
      .handle(
        'restart',
        Effect.fn('ServicesHandlers.restart')(function* ({ params, payload }) {
          const found = yield* terminals;
          const taskId = yield* readTaskId(payload);
          const run = yield* resolveRun(found, params.serviceId, taskId);
          const terminal = yield* request(found.restartService(params.serviceId, run));
          return { terminal, ...(yield* found.snapshot) };
        })
      );
  })
);
