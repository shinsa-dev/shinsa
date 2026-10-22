import { type Gate, listRunningRuns, type ShinsaState, type Task } from '@shinsa/core';
import { resolveTaskPath } from '@/lib/routing/task-paths.ts';
import { selectLeadGate } from './task-status.ts';

export interface TaskAction {
  label: string;
  path: string;
}

function resolveGateAction(gate: Gate): TaskAction {
  const path = resolveTaskPath(gate.taskId);
  if (gate.purpose === 'failure') return { label: 'Decide what to do', path };
  if (gate.purpose === 'agent_question' || gate.kind === 'question') {
    return {
      label: 'Answer',
      path: gate.runId ? resolveTaskPath(gate.taskId, { tab: 'chat', run: gate.runId }) : path,
    };
  }
  switch (gate.kind) {
    case 'spec':
      return { label: 'Review plan', path };
    case 'review':
      return { label: 'Review changes', path: resolveTaskPath(gate.taskId, { tab: 'code' }) };
    case 'merge':
      return { label: 'Review and merge', path };
  }
}

export function resolveTaskAction(state: ShinsaState, task: Task): TaskAction {
  const gate = selectLeadGate(state, task.id);
  if (gate) return resolveGateAction(gate);
  const [run] = listRunningRuns(state, task.id);
  if (run) return { label: 'Follow the agent', path: resolveTaskPath(task.id, { tab: 'chat', run: run.id }) };
  return { label: 'Open task', path: resolveTaskPath(task.id) };
}

export function resolveTaskSince(state: ShinsaState, task: Task) {
  return selectLeadGate(state, task.id)?.openedAt ?? task.stageChangedAt;
}
