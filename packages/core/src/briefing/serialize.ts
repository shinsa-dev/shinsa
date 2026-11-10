import { Option } from 'effect';
import { describeList, lowerFirst, quoteTitle } from '../chat/text.ts';
import type { Gate } from '../domain/index.ts';
import type { Queue } from '../queue/types.ts';
import type { ShinsaState } from '../state/project.ts';
import type { Briefing } from './types.ts';

function resolveTaskTitle(state: ShinsaState, taskId: string) {
  return state.tasks[taskId]?.title ?? 'a task';
}

export function serializeBriefing(briefing: Briefing, state: ShinsaState) {
  const parts = [
    briefing.now
      ? `Start with ${quoteTitle(resolveTaskTitle(state, briefing.now.taskId))}: ${lowerFirst(briefing.now.why)}.`
      : 'Nothing needs you right now.',
  ];
  if (briefing.next.length > 0) {
    parts.push(
      `Then ${describeList(briefing.next.map((item) => quoteTitle(resolveTaskTitle(state, item.taskId))))}.`
    );
  }
  parts.push(briefing.running);
  if (briefing.note) parts.push(briefing.note);
  return parts.join(' ');
}

export function selectBriefingGate(queue: Queue, taskId: string): Option.Option<Gate> {
  return Option.fromNullishOr(queue.ready.find((entry) => entry.task.id === taskId)?.gate);
}
