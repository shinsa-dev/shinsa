import { listLiveRuns, type ShinsaState } from '@shinsa/core';

export function countWorkingRuns(state: ShinsaState, isHeld: (runId: string) => boolean) {
  return listLiveRuns(state).filter((run) => run.status === 'running' && !isHeld(run.id)).length;
}

export function isEngineBusy(state: ShinsaState, isHeld: (runId: string) => boolean = () => false) {
  return countWorkingRuns(state, isHeld) > 0;
}
