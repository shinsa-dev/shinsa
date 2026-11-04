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

function describeStack(state: ShinsaState, stacksOn: string[]) {
  const [first] = stacksOn;
  const title = first ? state.tasks[first]?.title : undefined;
  if (stacksOn.length === 1 && title) return `Stacks on “${title}”`;
  return `Stacks on ${stacksOn.length} tasks`;
}

function isSameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function describeWhy(auto: boolean, decided: string, why: string, owner: string | null, named = false) {
  if (auto) return named ? `Shinsa chose this. ${decided}: ${why}` : `Shinsa chose this: ${why}`;
  return `${owner ?? 'You'} changed this. Shinsa chose “${lowerFirst(decided)}”: ${why}`;
}

function resolveStartWhy(state: ShinsaState, task: Task, owner: string | null) {
  const decision = task.triageDecisions?.start;
  const start = decision
    ? describeWhy(
        isSameList(task.waitsOn, decision.value),
        describeStart(state, decision.value),
        decision.why,
        owner
      )
    : null;
  const stack = task.triageDecisions?.stack;
  if (!stack) return start;
  const stacked = describeWhy(
    isSameList(task.stacksOn ?? [], stack.value),
    describeStack(state, stack.value),
    stack.why,
    owner,
    true
  );
  const waits = (decision?.value.length ?? 0) > 0 || task.waitsOn.length > 0;
  return waits && start ? `${stacked} ${start}` : stacked;
}

export function resolveTriageWhy(
  state: ShinsaState,
  task: Task,
  fact: TriageFact,
  owner: string | null = null
): string | null {
  if (fact === 'start') return resolveStartWhy(state, task, owner);
  const decision = task.triageDecisions?.priority;
  if (!decision) return null;
  return describeWhy(task.priority === decision.value, describePriority(decision.value), decision.why, owner);
}
