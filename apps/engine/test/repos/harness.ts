import type { Repo } from '@shinsa/core';
import { Layer, ManagedRuntime } from 'effect';
import { GitLayer } from '../../src/git/layers.ts';
import { GitHubLayer } from '../../src/github/layers.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { RepoFolders } from '../../src/repos/folders/service.ts';
import { ReposLayer } from '../../src/repos/layers.ts';
import type { DiscoveryOptions, SetupScope, SetupTarget } from '../../src/repos/schema.ts';
import { RepoSetup } from '../../src/repos/setup/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';

const runtime = ManagedRuntime.make(
  Layer.merge(
    ReposLayer.pipe(Layer.provide(Layer.merge(GitLayer, GitHubLayer)), Layer.provide(ShellLayer)),
    JsonLogger
  )
);

export function discoverRoots(home: string, options: DiscoveryOptions = {}) {
  return runtime.runPromise(RepoFolders.use((folders) => folders.discover(home, options)));
}

export function readOriginRemote(repo: string) {
  return runtime.runPromise(RepoFolders.use((folders) => folders.readOrigin(repo)));
}

export function prepareSetup(target: SetupTarget) {
  return runtime.runPromise(RepoSetup.use((setup) => setup.prepare(target)));
}

export function verifySetup(repo: Repo, scope: SetupScope) {
  return runtime.runPromise(RepoSetup.use((setup) => setup.verify(repo, scope)));
}
