import { edgeRuntime } from '../runtime/edge.ts';
import { Remote } from './remote/service.ts';

export { classifyPushFailure, describeShortFailure, resolveOutputTail } from './remote/output.ts';
export { PushError } from './remote/schema.ts';

export function hasPrePushHook(cwd: string, signal?: AbortSignal) {
  return edgeRuntime.runPromise(Remote.use((remote) => remote.hasPrePushHook(cwd, signal)));
}

export function pushBranch(path: string, branch: string, signal?: AbortSignal) {
  return edgeRuntime.runPromise(Remote.use((remote) => remote.pushBranch(path, branch, signal)));
}
