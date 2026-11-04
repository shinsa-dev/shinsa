import { Layer } from 'effect';
import { GitLayer } from '../git/layers.ts';
import { GitHubLayer } from '../github/layers.ts';
import { ShellLayer } from '../shell/layers.ts';
import { RepoFolders } from './folders/service.ts';
import { GitHubLogins } from './login/service.ts';
import { RepoRegistry } from './registry/service.ts';
import { RepoSetup } from './setup/service.ts';

export const ReposLayer = Layer.mergeAll(RepoFolders.layer, RepoSetup.layer, GitHubLogins.layer);

export const RepoWorkLayer = RepoRegistry.layer.pipe(Layer.provideMerge(ReposLayer));

export const StandaloneRepoWorkLayer = RepoWorkLayer.pipe(
  Layer.provide(Layer.merge(GitLayer, GitHubLayer)),
  Layer.provide(ShellLayer)
);
