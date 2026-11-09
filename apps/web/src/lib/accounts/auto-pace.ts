import {
  ADMISSION_LIMITS,
  CLAUDE_PROVIDER,
  describeCount,
  resolveAdmissionRoom,
  type ShinsaState,
} from '@shinsa/core';
import { isAdmissionWait, isUsageWaitArmed } from '@/lib/accounts/usage-wait.ts';

export const AUTO_PACE_LABEL = {
  title: 'Auto pace',
  description: 'Spreads your builds over the forecast below, so your accounts last until they reset.',
  toggle: 'Auto pace',
  toggled: { on: 'Auto pace is on.', off: 'Auto pace is off.' },
  on: 'Each build starts only when its estimate fits the safe pace in the forecast below, in order of priority, then the projects you work on most. Planning, questions and watchdog checks never wait.',
  off: 'Turn it on to start each build only when its estimate fits the safe pace in the forecast below. Until then every build starts at once.',
  noPace: 'Auto pace waits for the first usage reading of these accounts.',
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

const PACE_STEP = 0.5;

function describeResetsCounted(pace: number, safePace: number | null) {
  return safePace !== null && pace - safePace >= PACE_STEP ? ', counting your usable usage resets' : '';
}

export function selectPaceBudget(
  state: ShinsaState,
  provider: string,
  now: number,
  safePace: number | null = null,
  title: string | null = null
): PaceBudgetRow | null {
  const recorded = state.usagePaces[provider];
  if (!recorded) return null;
  const room = resolveAdmissionRoom(state, provider, now) ?? 0;
  const waiting = countWaitingBuilds(state, provider);
  const reserve = Math.round(ADMISSION_LIMITS.reserve * 100);
  const counted = describeResetsCounted(recorded.pace, safePace);
  const budget = `Of ${formatShare(recorded.pace)} of a weekly limit${counted}, with ${reserve}% kept for urgent tasks`;
  const queued = waiting > 0 ? `. ${describeCount(waiting, 'build')} waiting` : '';
  return {
    provider,
    label: title ? `Left for ${title} builds in the next 24 hours` : 'Left for builds in the next 24 hours',
    value: `${formatShare(room)} left`,
    detail: `${budget}${queued}`,
  };
}
