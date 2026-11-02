import { type ActivityPerson, resolveFirstName, type TaskGuest, type TaskHandoff } from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

type HandoffEvent = Extract<
  ShinsaEvent,
  {
    type:
      | 'task.handed_off'
      | 'handoff.recorded'
      | 'handoff.failed'
      | 'handoff.claimed'
      | 'handoff.removed'
      | 'handoff.left';
  }
>;

function writeHandoff(
  state: ShinsaState,
  event: HandoffEvent,
  change: (handoff: TaskHandoff) => TaskHandoff
) {
  const handoff = state.tasks[event.taskId]?.handoff;
  if (!handoff) return;
  updateTask(state, event.taskId, event.at, { handoff: change(handoff) });
}

function resolvePerson(guest: TaskGuest): ActivityPerson {
  return { login: guest.login, name: guest.name, avatarUrl: guest.avatarUrl };
}

function applyHandedOff(state: ShinsaState, event: EventOf<'task.handed_off'>) {
  const handoff: TaskHandoff = { at: event.at, url: null, guest: null, claimedAt: null };
  updateTask(state, event.taskId, event.at, { handoff });
  record(state, event.taskId, event.at, {
    actor: 'you',
    kind: 'stage',
    text: 'Made a link to hand this task off',
  });
}

function applyClaimed(state: ShinsaState, event: EventOf<'handoff.claimed'>) {
  writeHandoff(state, event, (handoff) => ({
    ...handoff,
    url: null,
    failure: null,
    guest: event.guest,
    claimedAt: event.at,
  }));
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'stage',
    text: `Handed this task to ${resolveFirstName(event.guest)}`,
    person: resolvePerson(event.guest),
  });
}

function applyRemoved(state: ShinsaState, event: EventOf<'handoff.removed'>) {
  updateTask(state, event.taskId, event.at, { handoff: null });
  if (!event.guest) {
    record(state, event.taskId, event.at, {
      actor: 'you',
      kind: 'stage',
      text: 'Turned off the link to hand this task off',
    });
    return;
  }
  record(state, event.taskId, event.at, {
    actor: 'you',
    kind: 'stage',
    text: `Took this task back from ${resolveFirstName(event.guest)}`,
    person: resolvePerson(event.guest),
  });
}

function applyLeft(state: ShinsaState, event: EventOf<'handoff.left'>) {
  updateTask(state, event.taskId, event.at, { handoff: null });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'stage',
    text: `${resolveFirstName(event.guest)} gave this task back`,
    person: resolvePerson(event.guest),
  });
}

export function applyHandoffEvent(state: ShinsaState, event: HandoffEvent) {
  switch (event.type) {
    case 'task.handed_off':
      applyHandedOff(state, event);
      return;
    case 'handoff.recorded':
      writeHandoff(state, event, (handoff) => ({ ...handoff, url: event.url, failure: null }));
      return;
    case 'handoff.failed':
      writeHandoff(state, event, (handoff) => ({ ...handoff, failure: event.detail }));
      return;
    case 'handoff.claimed':
      applyClaimed(state, event);
      return;
    case 'handoff.removed':
      applyRemoved(state, event);
      return;
    case 'handoff.left':
      applyLeft(state, event);
      return;
  }
}
