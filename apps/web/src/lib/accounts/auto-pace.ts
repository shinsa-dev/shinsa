import {
  ADMISSION_LIMITS,
  CLAUDE_PROVIDER,
  describeCount,
  isResetEnding,
  type RecordedPace,
  resolveAdmissionRoom,
  resolveAutoPaceResets,
  type ShinsaState,
} from '@shinsa/core';
import { Option } from 'effect';
import { isAdmissionWait, isUsageWaitArmed } from '@/lib/accounts/usage-wait.ts';
import { describeEndsIn } from '@/lib/accounts/usage.ts';

export const AUTO_PACE_LABEL = {
  title: 'Auto pace',
  toggle: 'Auto pace',
  toggled: { on: 'Auto pace is on.', off: 'Auto pace is off.' },
  description: 'Starts each build only when it fits your usage, so your accounts last until they reset.',
  noPace: 'Auto pace waits for the first usage reading of these accounts.',
  resets: 'Count on usage resets',
  resetsHint:
    'Lets urgent and high-priority builds run past the safe pace while you have a usable reset, and every build on a reset that ends within 3 days. You still use the reset yourself in Claude.',
  resetsToggled: {
    on: 'Auto pace counts on usage resets.',
    off: 'Auto pace no longer counts on usage resets.',
  },
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

function describeResetPlan(state: ShinsaState, recorded: RecordedPace, now: number) {
  if (!resolveAutoPaceResets(state.settings) || recorded.resetPace - recorded.pace < PACE_STEP) return '';
  const { resetEndsAt } = recorded;
  if (
    resetEndsAt !== null &&
    isResetEnding(resetEndsAt, now) &&
    recorded.endingPace - recorded.pace >= PACE_STEP
  ) {
    return `. A usage reset ends ${describeEndsIn(resetEndsAt, now)}, so every build may use up to ${formatShare(recorded.endingPace)}, counting on you using it in Claude`;
  }
  return `. Urgent and high-priority builds may use up to ${formatShare(recorded.resetPace)}, counting on you using a reset in Claude`;
}

export function selectPaceBudget(
  state: ShinsaState,
  provider: string,
  now: number,
  title: string | null = null
): PaceBudgetRow | null {
  const recorded = state.usagePaces[provider];
  if (!recorded) return null;
  const room = Option.getOrUndefined(resolveAdmissionRoom(state, provider, now)) ?? 0;
  const waiting = countWaitingBuilds(state, provider);
  const reserve = Math.round(ADMISSION_LIMITS.reserve * 100);
  const budget = `Of ${formatShare(recorded.pace)} of a weekly limit, with ${reserve}% kept for urgent tasks`;
  const plan = describeResetPlan(state, recorded, now);
  const queued = waiting > 0 ? `. ${describeCount(waiting, 'build')} waiting` : '';
  return {
    provider,
    label: title ? `Left for ${title} builds in the next 24 hours` : 'Left for builds in the next 24 hours',
    value: `${formatShare(room)} left`,
    detail: `${budget}${plan}${queued}`,
  };
}
