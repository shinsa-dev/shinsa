import { decide, serializeState, type UserCommand, type WireState } from '@shinsa/core';

const OPTIMISTIC_COMMANDS = new Set<UserCommand['type']>([
  'focus.change',
  'gate.answer',
  'round.ship',
  'run.dismiss_silence',
  'run.snooze_silence',
  'settings.change',
  'suggestion.dismiss',
  'task.cancel',
  'task.complete',
  'task.prioritize',
  'task.wait_on',
  'usage_wait.change',
]);

export function isOptimistic(command: UserCommand) {
  return OPTIMISTIC_COMMANDS.has(command.type);
}

let counter = 0;

function createOptimisticId() {
  counter += 1;
  return `optimistic-${counter}`;
}

function decideOrKeep(state: WireState, command: UserCommand, now: number): WireState {
  try {
    return serializeState(decide(state, command, { now, newId: createOptimisticId }).state);
  } catch {
    return state;
  }
}

export function applyOptimistic(state: WireState, commands: Iterable<UserCommand>, now = Date.now()) {
  let next = state;
  for (const command of commands) next = decideOrKeep(next, command, now);
  return next;
}
