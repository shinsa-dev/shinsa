import { describeTaskName } from '../chat/text.ts';
import type { TeammateFork } from '../domain/index.ts';
import type { EventOf } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record } from './write.ts';

function describeTeammateFork(fork: TeammateFork) {
  const name = fork.handle ?? `“${fork.title}”`;
  return fork.owner ? `Forked from ${fork.owner}’s task ${name}` : `Forked from a teammate’s task ${name}`;
}

export function recordFork(state: ShinsaState, event: EventOf<'task.created'>) {
  if (event.teammateFork && state.tasks[event.taskId]) {
    record(state, event.taskId, event.at, {
      actor: event.createdBy ? 'agent' : 'you',
      kind: 'fork',
      text: describeTeammateFork(event.teammateFork),
    });
    return;
  }
  const source = event.forkOf ? state.tasks[event.forkOf] : undefined;
  const fork = state.tasks[event.taskId];
  if (!source || !fork) return;
  const actor = event.createdBy ? 'agent' : 'you';
  record(state, fork.id, event.at, { actor, kind: 'fork', text: `Forked from ${describeTaskName(source)}` });
  if (event.createdBy?.taskId === source.id) return;
  record(state, source.id, event.at, {
    actor,
    kind: 'fork',
    text: `Forked into ${describeTaskName(fork)}`,
    detail: event.request,
  });
}
