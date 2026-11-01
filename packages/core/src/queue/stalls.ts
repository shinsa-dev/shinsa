import {
  compareTasks,
  type Gate,
  isDecisionGate,
  isPausingGate,
  isRoundFinished,
  type Task,
} from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { listOpenGates } from '../state/queries.ts';
import { listWaitsOn } from './rank.ts';

export type StalledReason = 'needs_you' | 'paused' | 'cancelled';

export interface WaitLeaf {
  task: Task;
  path: Task[];
  reason: StalledReason;
  gate: Gate | null;
}

export function selectLeadGate(state: ShinsaState, task: Task) {
  const gates = listOpenGates(state, task.id);
  const current = gates.filter((gate) => gate.type !== 'post_merge');
  const lead = current.find((gate) => !isDecisionGate(gate)) ?? current[0];
  if (lead) return lead;
  return isRoundFinished(task) ? (gates[0] ?? null) : null;
}

function resolveStall(state: ShinsaState, task: Task): Omit<WaitLeaf, 'path' | 'task'> | null {
  if (task.stage === 'cancelled') return { reason: 'cancelled', gate: null };
  const gate = selectLeadGate(state, task);
  if (!gate) return null;
  return { reason: isPausingGate(gate) ? 'paused' : 'needs_you', gate };
}

export function traceStalledLeaf(state: ShinsaState, task: Task): WaitLeaf | null {
  const seen = new Set<string>([task.id]);
  const visit = (current: Task, path: Task[]): WaitLeaf | null => {
    for (const parent of listWaitsOn(state, current).sort(compareTasks)) {
      if (seen.has(parent.id)) continue;
      seen.add(parent.id);
      const route = [...path, parent];
      const stall = resolveStall(state, parent);
      if (stall) return { task: parent, path: route, ...stall };
      const deeper = visit(parent, route);
      if (deeper) return deeper;
    }
    return null;
  };
  return visit(task, []);
}
