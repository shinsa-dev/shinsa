import { join } from 'node:path';
import { type Repo, type ShinsaState } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { Remote } from '../../git/remote/service.ts';
import type { DispatchOptions } from '../../runtime/engine/schema.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { RepoFolders } from '../folders/service.ts';
import { listProjectOwners } from '../origin/owners.ts';
import type { OriginNotConnected } from '../origin/schema.ts';
import { RepoOrigins } from '../origin/service.ts';
import { resolveNewRepoParent } from '../parent.ts';
import { resolveOwnerProjectName } from '../project-name.ts';
import { REPOSITORY_NAME, RepoNotCreated, RepoNotRegistered } from '../schema.ts';
import { RepoSetup } from '../setup/service.ts';
import type { CreateRepositoryOptions, LoginLookup, RegistryFailure } from './schema.ts';

export class RepoRegistry extends Context.Service<
  RepoRegistry,
  {
    syncRemote(repo: Repo): Effect.Effect<Repo, RegistryFailure>;
    connectOrigin(repo: Repo): Effect.Effect<Repo, OriginNotConnected | RegistryFailure>;
    upsert(
      path: string,
      login: LoginLookup | null,
      projectId?: string | null,
      from?: DispatchOptions
    ): Effect.Effect<Repo, RegistryFailure>;
    upsertProjectFolder(projectId: string | null, name: string): Effect.Effect<Repo | null, RegistryFailure>;
    create(
      parent: string,
      name: string,
      projectId: string | null,
      options?: CreateRepositoryOptions
    ): Effect.Effect<Repo, RegistryFailure>;
    createInProject(projectId: string, name: string): Effect.Effect<Repo, RegistryFailure>;
  }
>()('shinsa/engine/repos/registry/RepoRegistry') {
  static readonly layer = Layer.effect(
    RepoRegistry,
    Effect.gen(function* () {
      const definition = yield* EngineCore;
      const remotes = yield* Remote;
      const folders = yield* RepoFolders;
      const setup = yield* RepoSetup;
      const origins = yield* RepoOrigins;

      const selectRepoByPath = (state: ShinsaState, path: string) =>
        Object.values(state.repos).find((repo) => repo.path === path) ?? null;

      const recordRepoRemote = Effect.fn('RepoRegistry.recordRepoRemote')(function* (
        repo: Repo,
        remote: string
      ) {
        yield* definition.dispatch({ type: 'repo.update', repoId: repo.id, patch: { remote } });
        return (yield* definition.state).repos[repo.id] ?? repo;
      });

      const syncRemote = Effect.fn('RepoRegistry.syncRemote')(function* (repo: Repo) {
        if (repo.remote) return repo;
        const remote = yield* remotes.resolveOrigin(repo.path);
        if (!remote) return repo;
        return yield* recordRepoRemote(repo, remote);
      });

      const connectOrigin = Effect.fn('RepoRegistry.connectOrigin')(function* (repo: Repo) {
        const remote = yield* origins.connect(repo, listProjectOwners(yield* definition.state, repo));
        if (repo.remote) return repo;
        return yield* recordRepoRemote(repo, remote);
      });

      const upsert = Effect.fn('RepoRegistry.upsert')(function* (
        path: string,
        login: LoginLookup | null,
        projectId: string | null = null,
        from: DispatchOptions = {}
      ) {
        const candidate = yield* remotes.inspect(path);
        const state = yield* definition.state;
        const known = selectRepoByPath(state, candidate.path);
        if (known && !known.remote && candidate.remote)
          return yield* recordRepoRemote(known, candidate.remote);
        if (known) return known;
        const projectName =
          projectId && state.projects[projectId]
            ? null
            : yield* resolveOwnerProjectName(candidate.remote, login);
        yield* definition.dispatch(
          { type: 'repo.register', repo: { ...candidate, checkCommands: [] }, projectName, projectId },
          { ...from, id: from.id ?? `repo:${candidate.path}:${state.seq}` }
        );
        const registered = selectRepoByPath(yield* definition.state, candidate.path);
        if (!registered)
          return yield* new RepoNotRegistered({
            path: candidate.path,
            message: `Could not register ${candidate.name}.`,
          });
        return registered;
      });

      const upsertProjectFolder = Effect.fn('RepoRegistry.upsertProjectFolder')(function* (
        projectId: string | null,
        name: string
      ) {
        const project = projectId ? (yield* definition.state).projects[projectId] : undefined;
        if (!project) return null;
        const local = (yield* folders.listLocal(project.folders)).find((repo) => repo.name === name);
        if (!local) return null;
        return yield* upsert(local.path, null, project.id);
      });

      const create = Effect.fn('RepoRegistry.create')(function* (
        parent: string,
        name: string,
        projectId: string | null,
        options: CreateRepositoryOptions = {}
      ) {
        const path = join(parent, name);
        if (!REPOSITORY_NAME.test(name) || name.endsWith('.git'))
          return yield* new RepoNotCreated({
            path,
            message: `"${name}" is not a folder name Shinsa will create: use letters, digits, dots, dashes and underscores, starting with a letter or digit.`,
          });
        const known = selectRepoByPath(yield* definition.state, path);
        if (known) return known;
        yield* setup.create(path);
        const created = yield* upsert(path, options.login ?? null, projectId, options.from);
        return yield* connectOrigin(created).pipe(
          Effect.catchTag('OriginNotConnected', (failure) =>
            Effect.logWarning('[GitHub] Could not connect the new repository').pipe(
              Effect.annotateLogs({ path, error: failure.message }),
              Effect.as(created)
            )
          )
        );
      });

      const createInProject = Effect.fn('RepoRegistry.createInProject')(function* (
        projectId: string,
        name: string
      ) {
        const parent = resolveNewRepoParent(yield* definition.state, projectId);
        if (!parent)
          return yield* new RepoNotCreated({
            path: name,
            message: `The project has no folder to create "${name}" in. Add one with \`projects_add_folder\`, then try again.`,
          });
        return yield* create(parent, name, projectId);
      });

      return RepoRegistry.of({
        syncRemote,
        connectOrigin,
        upsert,
        upsertProjectFolder,
        create,
        createInProject,
      });
    })
  );
}
