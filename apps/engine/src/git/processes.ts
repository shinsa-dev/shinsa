import { edgeRuntime } from '../runtime/edge.ts';
import type { StopOptions } from './leftovers/schema.ts';
import { LeftoverProcesses } from './leftovers/service.ts';

export type { StopOptions } from './leftovers/schema.ts';
export { listWorkingFolderPids, resolveStopTargets } from './leftovers/targets.ts';

export function listProcessesIn(path: string) {
  return edgeRuntime.runPromise(LeftoverProcesses.use((leftovers) => leftovers.list(path)));
}

export function stopProcessesIn(path: string, options: StopOptions = {}) {
  return edgeRuntime.runPromise(LeftoverProcesses.use((leftovers) => leftovers.stop(path, options)));
}
