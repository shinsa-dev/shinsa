import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, FileSystem, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { listLocalRepoViews } from '../../../projects/changes.ts';
import { ProjectChanges } from '../../../projects/changes/service.ts';
import { Roots } from '../../../repos/roots/service.ts';
import { EngineCore } from '../../../runtime/engine/service.ts';
import { listCoverageDetections } from '../../../test-coverage/index.ts';
import { resolveRequestFailure } from '../../failures.ts';

export const ProjectsHandlers = HttpApiBuilder.group(
  EngineApi,
  'projects',
  Effect.fn('ProjectsHandlers')(function* (handlers) {
    const engine = yield* EngineCore;
    const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
    const givenRoots = Option.getOrUndefined(yield* Effect.serviceOption(Roots));
    const givenProjects = Option.getOrUndefined(yield* Effect.serviceOption(ProjectChanges));
    const notFound = new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE });
    const roots = givenRoots ? Effect.succeed(givenRoots) : Effect.fail(notFound);
    const changes = givenRoots && givenProjects ? Effect.succeed(givenProjects) : Effect.fail(notFound);

    return handlers
      .handle('localRepos', () =>
        Effect.flatMap(roots, (found) =>
          Effect.zip(found.listRoots, engine.state).pipe(
            Effect.flatMap(([listed, state]) => withFiles(listLocalRepoViews(state, listed))),
            Effect.map((repos) => ({ repos }))
          )
        )
      )
      .handle('coverage', () =>
        Effect.andThen(roots, engine.state).pipe(
          Effect.flatMap((state) => withFiles(listCoverageDetections(Object.values(state.repos)))),
          Effect.map((detected) => ({ detected }))
        )
      )
      .handle('addRepo', ({ params, payload }) =>
        Effect.flatMap(changes, (found) =>
          found.upsertRepo(params.projectId, payload.path).pipe(Effect.mapError(resolveRequestFailure))
        )
      )
      .handle('addFolder', ({ params, payload }) =>
        Effect.flatMap(changes, (found) =>
          found.upsertFolder(params.projectId, payload.path).pipe(Effect.mapError(resolveRequestFailure))
        )
      );
  })
);
