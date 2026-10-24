import { reconcileBriefing } from '../briefing/reconcile.ts';
import { serializeBriefing } from '../briefing/serialize.ts';
import { STAGE_WORDS } from '../chat/references.ts';
import type { Task } from '../domain/index.ts';
import { briefingKey, type ShinsaState } from '../state/project.ts';
import { resolveQueue } from './rank.ts';
import { resolveGateWords } from './reasons.ts';
import type { QueueSummary } from './types.ts';

function summarise(task: Task, label: string, baseUrl: string) {
  return { taskId: task.id, title: task.title, label, url: `${baseUrl}/tasks/${task.handle ?? task.id}` };
}

export function resolveQueueSummary(state: ShinsaState, now: number, baseUrl: string): QueueSummary {
  const queue = resolveQueue(state, now);
  const stored = state.briefings[briefingKey(queue.focusProjectId)];
  return {
    briefing: serializeBriefing(reconcileBriefing(stored, queue, now), state),
    decisions: queue.ready.map((entry) => summarise(entry.task, resolveGateWords(entry.gate).label, baseUrl)),
    working: queue.working.map((task) => summarise(task, STAGE_WORDS[task.stage], baseUrl)),
  };
}
