import { reconcileBriefing } from '../briefing/reconcile.ts';
import { serializeBriefing } from '../briefing/serialize.ts';
import type { GateKind, Task } from '../model/index.ts';
import { briefingKey, type ShinsaState } from '../state/project.ts';
import { resolveQueue } from './rank.ts';
import type { QueueSummary } from './types.ts';

const SUMMARY_GATE_LABEL: Record<GateKind, string> = {
  spec: 'Spec',
  review: 'Review',
  merge: 'Merge',
  question: 'Question',
};

function summarise(task: Task, label: string, baseUrl: string) {
  return { taskId: task.id, title: task.title, label, url: `${baseUrl}/tasks/${task.id}` };
}

export function resolveQueueSummary(state: ShinsaState, now: number, baseUrl: string): QueueSummary {
  const queue = resolveQueue(state, now);
  const stored = state.briefings[briefingKey(queue.focusAreaId)];
  return {
    briefing: serializeBriefing(reconcileBriefing(stored, queue, now), state),
    decisions: queue.ready.map((entry) =>
      summarise(
        entry.task,
        entry.gate.purpose === 'failure' ? 'Paused' : SUMMARY_GATE_LABEL[entry.gate.kind],
        baseUrl
      )
    ),
    working: queue.working.map((task) => summarise(task, task.stage, baseUrl)),
  };
}
