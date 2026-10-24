import {
  isSamePipeline,
  lowerFirst,
  resolveTaskPipeline,
  SHAPE_PIPELINES,
  type ShinsaState,
  type Task,
  type TaskPriority,
} from '@shinsa/core';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { SHAPE_LABEL } from '@/lib/tasks/shapes.ts';

export type TriageFact = 'shape' | 'start' | 'priority';

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

function describeWhy(auto: boolean, decided: string, why: string) {
  if (auto) return `Shinsa chose this: ${why}`;
  return `You changed this. Shinsa chose “${lowerFirst(decided)}”: ${why}`;
}

function resolveShapeWhy(task: Task) {
  const last = task.shapeChanges?.at(-1);
  if (last?.by === 'agent' && last.reason) return `An agent set these steps: ${last.reason}`;
  const decision = task.triageDecisions?.shape;
  if (!decision) return null;
  const auto = isSamePipeline(resolveTaskPipeline(task), SHAPE_PIPELINES[decision.value]);
  return describeWhy(auto, SHAPE_LABEL[decision.value], decision.why);
}

export function resolveTriageWhy(state: ShinsaState, task: Task, fact: TriageFact): string | null {
  if (fact === 'shape') return resolveShapeWhy(task);
  if (fact === 'start') {
    const decision = task.triageDecisions?.start;
    if (!decision) return null;
    const auto = isSameList(task.waitsOn, decision.value);
    return describeWhy(auto, describeStart(state, decision.value), decision.why);
  }
  const decision = task.triageDecisions?.priority;
  if (!decision) return null;
  return describeWhy(task.priority === decision.value, describePriority(decision.value), decision.why);
}
