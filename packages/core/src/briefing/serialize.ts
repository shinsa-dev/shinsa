import type { Gate } from '../model/index.ts';
import type { Queue } from '../queue/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { listTitles, lowerFirst, quote } from './text.ts';
import type { Briefing } from './types.ts';

function resolveTitle(state: ShinsaState, taskId: string) {
  return state.tasks[taskId]?.title ?? 'a task';
}

export function serializeBriefing(briefing: Briefing, state: ShinsaState) {
  const parts = [
    briefing.now
      ? `Start with ${quote(resolveTitle(state, briefing.now.taskId))}: ${lowerFirst(briefing.now.why)}.`
      : 'Nothing needs you right now.',
  ];
  if (briefing.next.length > 0) {
    parts.push(`Then ${listTitles(briefing.next.map((item) => quote(resolveTitle(state, item.taskId))))}.`);
  }
  parts.push(briefing.running);
  if (briefing.note) parts.push(briefing.note);
  return parts.join(' ');
}

export function selectBriefingGate(queue: Queue, taskId: string): Gate | null {
  return queue.ready.find((entry) => entry.task.id === taskId)?.gate ?? null;
}
