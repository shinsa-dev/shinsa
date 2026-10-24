import { ON_BEHALF_ACTION_LIMIT } from '../domain/index.ts';
import type { EventOf } from '../events/index.ts';
import type { ShinsaState } from './project.ts';

export function applyOnBehalfActed(state: ShinsaState, event: EventOf<'on_behalf.acted'>) {
  const action = {
    at: event.at,
    command: event.command,
    taskId: event.taskId,
    summary: event.summary,
    ...(event.byTaskId ? { byTaskId: event.byTaskId } : {}),
  };
  state.onBehalfActions = [...state.onBehalfActions, action].slice(-ON_BEHALF_ACTION_LIMIT);
}
