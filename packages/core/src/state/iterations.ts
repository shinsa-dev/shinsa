import type { Iteration } from '../domain/index.ts';
import type { EventOf } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { updateTask } from './write.ts';

type IterationEvent = EventOf<'iteration.requested' | 'iteration.answered'>;

function applyRequested(state: ShinsaState, event: EventOf<'iteration.requested'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const iterations = task.iterations ?? [];
  const request = { text: event.text, comments: event.comments, at: event.at };
  const open = iterations.find((iteration) => iteration.id === event.iterationId);
  const next: Iteration[] = open
    ? iterations.map((iteration) =>
        iteration === open ? { ...iteration, requests: [...iteration.requests, request] } : iteration
      )
    : [
        ...iterations,
        {
          id: event.iterationId,
          round: event.round,
          requests: [request],
          reply: null,
          runId: null,
          repliedAt: null,
        },
      ];
  updateTask(state, task.id, event.at, { iterations: next });
}

function applyAnswered(state: ShinsaState, event: EventOf<'iteration.answered'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  updateTask(state, task.id, event.at, {
    iterations: (task.iterations ?? []).map((iteration) =>
      iteration.id === event.iterationId
        ? { ...iteration, reply: event.reply, runId: event.runId, repliedAt: event.at }
        : iteration
    ),
  });
}

export function applyIterationEvent(state: ShinsaState, event: IterationEvent) {
  if (event.type === 'iteration.requested') applyRequested(state, event);
  else applyAnswered(state, event);
}
