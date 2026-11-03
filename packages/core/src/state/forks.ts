import { describeTaskName } from '../chat/text.ts';
import type { EventOf } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record } from './write.ts';

export function recordFork(state: ShinsaState, event: EventOf<'task.created'>) {
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
