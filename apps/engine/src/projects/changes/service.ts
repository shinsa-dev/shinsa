import { DomainError, type Project, type Repo } from '@shinsa/core';
import { Context, Effect, Layer, Schema } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { Remote } from '../../git/remote/service.ts';
import { describeError } from '../../log/redact.ts';
import { CurrentLogin } from '../../repos/current-login/service.ts';
import { RepoRegistry } from '../../repos/registry/service.ts';
import type { DispatchOptions } from '../../runtime/engine/schema.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { resolveProjectFolder } from '../folders.ts';
import { ProjectChangeFailed, type ProjectChangeFailure } from './schema.ts';

export class ProjectChanges extends Context.Service<
  ProjectChanges,
  {
    upsertRepo(
      projectId: string,
      path: string,
      from?: DispatchOptions
    ): Effect.Effect<{ repo: Repo }, ProjectChangeFailure>;
    upsertFolder(
      projectId: string,
      path: string,
      from?: DispatchOptions
    ): Effect.Effect<{ project: Project }, ProjectChangeFailure>;
  }
>()('shinsa/engine/projects/changes/ProjectChanges') {
  static readonly layer = Layer.effect(
    ProjectChanges,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const registry = yield* RepoRegistry;
      const { lookup } = yield* CurrentLogin;
      const { userHome } = yield* EngineConfig;
      const remote = yield* Remote;
      const isDomainError = Schema.is(DomainError);

      const findProject = Effect.fn('ProjectChanges.findProject')(function* (projectId: string) {
        const project = (yield* engine.state).projects[projectId];
        if (!project)
          return yield* new DomainError({ code: 'project_not_found', message: `No project ${projectId}.` });
        return project;
      });

      const resolveFolder = (raw: string) =>
        Effect.try({
          try: () => resolveProjectFolder(raw, userHome),
          catch: (error) =>
            isDomainError(error) ? error : new ProjectChangeFailed({ message: describeError(error) }),
        });

      const upsertRepo = Effect.fn('ProjectChanges.upsertRepo')(function* (
        projectId: string,
        raw: string,
        from: DispatchOptions = {}
      ) {
        yield* findProject(projectId);
        const path = yield* resolveFolder(raw);
        if (!(yield* remote.resolveRoot(path)))
          return yield* new DomainError({
            code: 'repo_invalid',
            message: `${path} is not a git repository.`,
          });
        const repo = yield* registry.upsert(path, lookup, projectId, from);
        if (repo.projectId !== projectId)
          yield* engine.dispatch({ type: 'repo.update', repoId: repo.id, patch: { projectId } }, from);
        return { repo: (yield* engine.state).repos[repo.id] ?? repo };
      });

      const upsertFolder = Effect.fn('ProjectChanges.upsertFolder')(function* (
        projectId: string,
        raw: string,
        from: DispatchOptions = {}
      ) {
        const project = yield* findProject(projectId);
        const folder = yield* resolveFolder(raw);
        if (project.folders.includes(folder)) return { project };
        yield* engine.dispatch(
          { type: 'project.write', project: { ...project, folders: [...project.folders, folder] } },
          from
        );
        return { project: (yield* engine.state).projects[projectId] ?? project };
      });

      return ProjectChanges.of({ upsertRepo, upsertFolder });
    })
  );
}
