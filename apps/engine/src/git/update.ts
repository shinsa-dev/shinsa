import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { Remote } from './remote/service.ts';

export interface UpdateOptions {
  signal?: AbortSignal;
  onBehind: () => Promise<void>;
}

export function updateOntoBase(path: string, base: string, branch: string, options: UpdateOptions) {
  return edgeRuntime.runPromise(
    Remote.use((remote) =>
      remote.updateOntoBase(path, base, branch, Effect.promise(options.onBehind), options.signal)
    )
  );
}
