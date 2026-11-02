import type { Repo } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import type { BundleBranch } from './remote/schema.ts';
import { Remote } from './remote/service.ts';

export type { BundleBranch } from './remote/schema.ts';

export function checkBundleMerge(repo: Repo, members: BundleBranch[], signal?: AbortSignal) {
  return edgeRuntime.runPromise(Remote.use((remote) => remote.checkBundleMerge(repo, members, signal)));
}
