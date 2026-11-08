import {
  ADMISSION_LIMITS,
  CLAUDE_PROVIDER,
  describeCount,
  type Project,
  resolveAdmissionRoom,
  resolveProjectOrder,
  resolveProviderLabel,
  type ShinsaState,
} from '@shinsa/core';
import { isAdmissionWait, isUsageWaitArmed } from '@/lib/accounts/usage-wait.ts';

export const AUTO_PACE_LABEL = {
  title: 'Auto pace',
  description:
    'Starts each build only when its estimate fits today’s usage, urgent tasks and your top projects first. Planning, questions and watchdog checks never wait.',
  toggle: 'Auto pace',
  toggled: { on: 'Auto pace is on.', off: 'Auto pace is off.' },
  noPace: 'Auto pace waits for the first usage reading of your accounts.',
  projectOrder: 'Project order',
  projectOrderHint:
    'Builds of projects higher up start first. Drag a project, or use its arrows, to move it.',
  moved: 'Project order saved.',
  moveUp: 'Move up',
  moveDown: 'Move down',
} as const;

export interface PaceBudgetRow {
  provider: string;
  label: string;
  value: string;
  detail: string;
}

function formatShare(percent: number) {
  return `${Number(Math.max(0, percent).toFixed(1))}%`;
}

function countWaitingBuilds(state: ShinsaState, provider: string) {
  return Object.values(state.tasks).filter(
    (task) =>
      isUsageWaitArmed(task) &&
      isAdmissionWait(task.usageWait) &&
      (task.usageWait.provider ?? CLAUDE_PROVIDER) === provider
  ).length;
}

export function listPaceBudgets(state: ShinsaState, now: number): PaceBudgetRow[] {
  return Object.values(state.usagePaces)
    .sort((a, b) => a.provider.localeCompare(b.provider))
    .map((recorded) => {
      const room = resolveAdmissionRoom(state, recorded.provider, now) ?? 0;
      const waiting = countWaitingBuilds(state, recorded.provider);
      const reserve = Math.round(ADMISSION_LIMITS.reserve * 100);
      const budget = `Of ${formatShare(recorded.pace)} of a weekly limit, with ${reserve}% kept for urgent tasks`;
      const queued = waiting > 0 ? `. ${describeCount(waiting, 'build')} waiting` : '';
      return {
        provider: recorded.provider,
        label: `${resolveProviderLabel(recorded.provider)} for the next 24 hours`,
        value: `${formatShare(room)} left`,
        detail: `${budget}${queued}`,
      };
    });
}

export function listRankedProjects(state: ShinsaState): Project[] {
  const order = resolveProjectOrder(state.settings);
  const rank = (project: Project) => {
    const index = order.indexOf(project.id);
    return index === -1 ? order.length : index;
  };
  return Object.values(state.projects).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function moveProject(ids: readonly string[], movedId: string, targetId: string) {
  const from = ids.indexOf(movedId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = ids.filter((id) => id !== movedId);
  next.splice(to, 0, movedId);
  return next;
}

export function shiftProject(ids: readonly string[], id: string, step: -1 | 1) {
  const target = ids[ids.indexOf(id) + step];
  return target === undefined ? [...ids] : moveProject(ids, id, target);
}
