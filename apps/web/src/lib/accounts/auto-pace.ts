import {
  ADMISSION_LIMITS,
  CLAUDE_PROVIDER,
  describeCount,
  resolveAdmissionRoom,
  resolveProviderLabel,
  type ShinsaState,
} from '@shinsa/core';
import { isAdmissionWait, isUsageWaitArmed } from '@/lib/accounts/usage-wait.ts';

export const AUTO_PACE_LABEL = {
  title: 'Auto pace',
  description:
    'Starts each build only when its estimate fits today’s usage, in order of priority, then the projects you work on most. Planning, questions and watchdog checks never wait.',
  toggle: 'Auto pace',
  toggled: { on: 'Auto pace is on.', off: 'Auto pace is off.' },
  noPace: 'Auto pace waits for the first usage reading of your accounts.',
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
