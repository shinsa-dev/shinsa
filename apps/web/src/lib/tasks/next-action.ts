import { type Gate, listRunningRuns, type ShinsaState, selectLeadGate, type Task } from '@shinsa/core';
import { formatSince, formatSpan } from '@/lib/format/time.ts';
import { resolveSecretLabel } from '@/lib/secrets.ts';
import { resolveTaskPath } from '@/router.ts';

export interface TaskAction {
  label: string;
  path: string;
}

function resolveGateAction(gate: Gate, task: Task): TaskAction {
  const path = resolveTaskPath(task);
  if (gate.secret) return { label: `Give the ${resolveSecretLabel(gate)}`, path };
  switch (gate.type) {
    case 'failure':
      return { label: 'Decide what to do', path };
    case 'configuration':
      return { label: 'Fix the setup', path };
    case 'sign_in':
      return { label: 'Sign in', path };
    case 'proposal':
      return { label: 'Decide on the change', path };
    case 'operation':
      return { label: 'Confirm the operation', path };
    case 'question':
    case 'secret':
      return {
        label: 'Answer',
        path: gate.runId ? resolveTaskPath(task, { tab: 'chat', run: gate.runId }) : path,
      };
    case 'plan':
      return { label: 'Review plan', path };
    case 'review':
      return { label: 'Review changes', path: resolveTaskPath(task, { tab: 'review' }) };
    case 'merge':
      return { label: 'Review and merge', path };
  }
}

export function resolveTaskAction(state: ShinsaState, task: Task): TaskAction {
  const gate = selectLeadGate(state, task);
  if (gate) return resolveGateAction(gate, task);
  const [run] = listRunningRuns(state, task.id);
  if (run) return { label: 'Follow the agent', path: resolveTaskPath(task, { tab: 'chat', run: run.id }) };
  return { label: 'Open task', path: resolveTaskPath(task) };
}

export function resolveTaskSince(state: ShinsaState, task: Task) {
  return selectLeadGate(state, task)?.openedAt ?? task.stageChangedAt;
}

export function describeWaited(state: ShinsaState, task: Task, now = Date.now()) {
  const since = resolveTaskSince(state, task);
  const gated = selectLeadGate(state, task) !== null;
  const span = formatSpan(since, now);
  if (gated && span) return `Waiting for ${span}`;
  return formatSince(gated ? 'Opened' : 'Started', since, now);
}
