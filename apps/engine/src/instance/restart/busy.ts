import { listLiveRuns, type ShinsaState } from '@shinsa/core';
import type { EngineActivity } from '../install.ts';
import type { EngineRestartPending } from './schema.ts';

export function resolveEngineActivity(
  state: ShinsaState,
  isHeld: (runId: string) => boolean = () => false,
  restart: EngineRestartPending = null,
  restartBy: number | null = null
): EngineActivity {
  const working = listLiveRuns(state).filter((run) => run.status === 'running' && !isHeld(run.id)).length;
  return { busy: working > 0, working, restart, restartBy };
}

export function isEngineBusy(state: ShinsaState, isHeld: (runId: string) => boolean = () => false) {
  return resolveEngineActivity(state, isHeld).busy;
}
