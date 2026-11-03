import { DomainError } from '@shinsa/core';
import { Effect, Schema } from 'effect';
import { Remote } from '../../git/remote/service.ts';
import { describeError } from '../../log/redact.ts';
import type { DispatchOptions } from '../../runtime/engine.ts';
import { resolveProjectFolder } from '../folders.ts';
import { ProjectChangeFailed, type ProjectChanges, type ProjectChangesDefinition } from './schema.ts';

export const makeProjectChanges = Effect.fn('ProjectChanges.make')(function* (
  definition: ProjectChangesDefinition
) {
  const remote = yield* Remote;
  const isDomainError = Schema.is(DomainError);

  const findProject = Effect.fn('ProjectChanges.findProject')(function* (projectId: string) {
    const project = (yield* definition.state).projects[projectId];
    if (!project)
      return yield* new DomainError({ code: 'project_not_found', message: `No project ${projectId}.` });
    return project;
  });

  const resolveFolder = (raw: string) =>
    Effect.try({
      try: () => resolveProjectFolder(raw, definition.userHome),
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
      return yield* new DomainError({ code: 'repo_invalid', message: `${path} is not a git repository.` });
    const repo = yield* definition.registerRepo(path, projectId, from);
    if (repo.projectId !== projectId)
      yield* definition.dispatch({ type: 'repo.update', repoId: repo.id, patch: { projectId } }, from);
    return { repo: (yield* definition.state).repos[repo.id] ?? repo };
  });

  const upsertFolder = Effect.fn('ProjectChanges.upsertFolder')(function* (
    projectId: string,
    raw: string,
    from: DispatchOptions = {}
  ) {
    const project = yield* findProject(projectId);
    const folder = yield* resolveFolder(raw);
    if (project.folders.includes(folder)) return { project };
    yield* definition.dispatch(
      { type: 'project.write', project: { ...project, folders: [...project.folders, folder] } },
      from
    );
    return { project: (yield* definition.state).projects[projectId] ?? project };
  });

  const changes: ProjectChanges = { upsertRepo, upsertFolder };
  return changes;
});
