import { lowerFirst, type ShinsaState, type Task, type TaskPriority } from '@shinsa/core';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';

export type TriageFact = 'start' | 'priority';

function describePriority(priority: TaskPriority) {
  return priority === 'urgent' ? PRIORITY_LABEL.urgent : `${PRIORITY_LABEL[priority]} priority`;
}

function describeStart(state: ShinsaState, waitsOn: string[]) {
  if (waitsOn.length === 0) return 'Starts now';
  const [first] = waitsOn;
  const title = first ? state.tasks[first]?.title : undefined;
  if (waitsOn.length === 1 && title) return `Starts after “${title}”`;
  return `Starts after ${waitsOn.length} tasks`;
}

function isSameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function describeWhy(auto: boolean, decided: string, why: string, owner: string | null) {
  if (auto) return `Shinsa chose this: ${why}`;
  return `${owner ?? 'You'} changed this. Shinsa chose “${lowerFirst(decided)}”: ${why}`;
}

export function resolveTriageWhy(
  state: ShinsaState,
  task: Task,
  fact: TriageFact,
  owner: string | null = null
): string | null {
  if (fact === 'start') {
    const decision = task.triageDecisions?.start;
    if (!decision) return null;
    const auto = isSameList(task.waitsOn, decision.value);
    return describeWhy(auto, describeStart(state, decision.value), decision.why, owner);
  }
  const decision = task.triageDecisions?.priority;
  if (!decision) return null;
  return describeWhy(task.priority === decision.value, describePriority(decision.value), decision.why, owner);
}
