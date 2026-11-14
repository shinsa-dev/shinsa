import type { ShinsaState } from '@shinsa/core';
import * as React from 'react';

const TaskRowStateContext = React.createContext<ShinsaState | null>(null);

export function TaskRowState({ state, children }: { state: ShinsaState; children: React.ReactNode }) {
  return <TaskRowStateContext.Provider value={state}>{children}</TaskRowStateContext.Provider>;
}

export function useTaskRowState() {
  return React.useContext(TaskRowStateContext);
}
