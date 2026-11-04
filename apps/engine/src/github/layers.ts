import { Layer } from 'effect';
import { RepoCiReader } from './ci/service.ts';
import { GitHubProcess } from './process/service.ts';
import { PullRequests } from './pulls/service.ts';
import { GitHubCli } from './service.ts';

export const GitHubLayer = Layer.merge(PullRequests.layer, RepoCiReader.layer).pipe(
  Layer.provideMerge(GitHubCli.layer),
  Layer.provide(GitHubProcess.layer)
);
