import { Effect } from 'effect';
import { edgeRuntime } from '../../../runtime/edge.ts';
import type { ClaudeProcess } from './process/schema.ts';
import { makeClaudeProcess } from './process/service.ts';

export type { ClaudeProcess } from './process/schema.ts';

export function createClaudeProcess(onSpawn?: (pid: number) => void): ClaudeProcess {
  const handle = edgeRuntime.runSync(
    makeClaudeProcess({ onSpawn: (pid) => Effect.sync(() => onSpawn?.(pid)) })
  );
  return {
    spawn: (options) => edgeRuntime.runSync(handle.spawn(options)),
    readStderr: () => edgeRuntime.runSync(handle.readStderr),
    terminate: () => edgeRuntime.runPromise(handle.terminate),
  };
}
