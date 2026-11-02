import type { Repo } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import { RepoFolders } from './folders/service.ts';
import { GitHubLogins } from './login/service.ts';
import type { DiscoveryOptions, LoginResolver, SetupScope } from './schema.ts';
import { RepoSetup } from './setup/service.ts';

export function discoverRoots(home: string, options: DiscoveryOptions = {}) {
  return edgeRuntime.runPromise(RepoFolders.use((folders) => folders.discover(home, options)));
}

export function createDiscoverer(skipPrivate: boolean) {
  return (home: string) => discoverRoots(home, { skipPrivate });
}

export function listLocalRepos(roots: readonly string[], limit?: number) {
  return edgeRuntime.runSync(RepoFolders.use((folders) => folders.listLocal(roots, limit)));
}

export function listCandidateRepos(roots: readonly string[], origin: string | null) {
  return edgeRuntime.runPromise(RepoFolders.use((folders) => folders.listCandidates(roots, origin)));
}

export function readOriginRemote(repo: string) {
  return edgeRuntime.runSync(RepoFolders.use((folders) => folders.readOrigin(repo)));
}

export function verifySetup(repo: Repo, scope: SetupScope, signal?: AbortSignal) {
  return edgeRuntime.runPromise(RepoSetup.use((setup) => setup.verify(repo, scope, signal)));
}

export function createLoginResolver(cwd: string): LoginResolver {
  const login = edgeRuntime.runSync(GitHubLogins.use((logins) => logins.make(cwd)));
  return () => edgeRuntime.runPromise(login);
}
