import type { RepoCandidate } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import { Remote } from './remote/service.ts';

export { normalizeRemote } from './remote/output.ts';

export function resolveRepoRoot(path: string) {
  return edgeRuntime.runPromise(Remote.use((remote) => remote.resolveRoot(path)));
}

export function resolveRepoRemote(root: string) {
  return edgeRuntime.runPromise(Remote.use((remote) => remote.resolveOrigin(root)));
}

export function inspectRepo(path: string): Promise<RepoCandidate> {
  return edgeRuntime.runPromise(Remote.use((remote) => remote.inspect(path)));
}
