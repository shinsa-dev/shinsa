import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { createProjectChanges, listLocalRepoViews } from '../../../projects/changes.ts';
import { createLoginResolver } from '../../../repos/index.ts';
import { listCoverageDetections } from '../../../test-coverage/index.ts';
import { requestPromise } from '../../failures.ts';
import { HttpServices } from '../../services/service.ts';

export const ProjectsHandlers = HttpApiBuilder.group(
  EngineApi,
  'projects',
  Effect.fn('ProjectsHandlers')(function* (handlers) {
    const { engine, config, roots: given, resolveLogin } = yield* HttpServices;
    const roots = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    const changes = createProjectChanges({
      engine,
      resolveLogin: resolveLogin ?? createLoginResolver(config.userHome),
      userHome: config.userHome,
    });

    return handlers
      .handle('localRepos', () =>
        Effect.flatMap(roots, (found) =>
          Effect.map(
            requestPromise(() => found.listRoots()),
            (listed) => ({ repos: listLocalRepoViews(engine, listed) })
          )
        )
      )
      .handle('coverage', () =>
        Effect.as(roots, { detected: listCoverageDetections(Object.values(engine.state.repos)) })
      )
      .handle('addRepo', ({ params, payload }) =>
        Effect.andThen(
          roots,
          requestPromise(() => changes.upsertRepo(params.projectId, payload.path))
        )
      )
      .handle('addFolder', ({ params, payload }) =>
        Effect.andThen(
          roots,
          requestPromise(() => changes.upsertFolder(params.projectId, payload.path))
        )
      );
  })
);
