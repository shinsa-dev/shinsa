import {
  type ActiveHours,
  CLAUDE_PROVIDER,
  isActiveAt,
  type Project,
  resolveProviderLabel,
  type Task,
  type UsagePace,
  type UsageWait,
} from '@shinsa/core';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import { describeResetsIn } from '@/lib/accounts/usage.ts';
import { formatMoment, formatUntil } from '@/lib/format/time.ts';

export function isUsageWaitArmed(task: Task): task is Task & { usageWait: UsageWait } {
  return task.usageWait?.status === 'armed';
}

export function isPaceWait(wait: UsageWait): wait is UsageWait & { pace: UsagePace } {
  return wait.cause === 'pace' && wait.pace !== undefined;
}

export function isAdmissionWait(wait: UsageWait): wait is UsageWait & { pace: UsagePace } {
  return isPaceWait(wait) && wait.pace.scope === 'admission';
}

export const BUILD_NOW = 'Build now';

function formatLimit(percent: number) {
  return `${Number(percent.toFixed(1))}%`;
}

function describePaceLimit(pace: UsagePace, project: Project | null) {
  if (pace.scope === 'daily') return `the daily usage limit of ${formatLimit(pace.limit)}`;
  const name = project ? `${project.name}’s` : 'the project’s';
  return `${name} usage limit of ${formatLimit(pace.limit)} a day`;
}

export function describeUsageWaitCountdown(wait: UsageWait, now: number) {
  if (!isPaceWait(wait)) return describeResetsIn(wait.resetAt, now);
  return wait.resetAt <= now ? 'Starts now' : formatUntil('Starts', wait.resetAt, now);
}

function describeAdmissionTitle(wait: UsageWait, now: number, hours: ActiveHours | null) {
  if (!isActiveAt(hours, wait.resetAt) && isActiveAt(hours, now)) return 'Builds tonight';
  return `Builds after ${formatMoment(wait.resetAt, now)}`;
}

export function describeUsageWaitTitle(wait: UsageWait, now = Date.now(), hours: ActiveHours | null = null) {
  if (isAdmissionWait(wait)) return describeAdmissionTitle(wait, now, hours);
  if (isPaceWait(wait)) return `Held at a usage limit: starts at ${formatMoment(wait.resetAt, now)}`;
  const next = wait.autoResume ? 'continues' : 'pauses for you';
  const account = wait.account?.email ? ` on ${wait.account.email}` : '';
  return `Waiting for usage: ${next} at ${formatMoment(wait.resetAt, now)}${account}`;
}

function describeAdmissionBody(pace: UsagePace) {
  const used = `${formatLimit(pace.percent)} of today’s ${formatLimit(pace.limit)} is already used or set aside`;
  if (pace.need === undefined) return `${used}, so the build waits its turn.`;
  return `Its build needs about ${formatLimit(pace.need)}, and ${used}, so it waits its turn.`;
}

export function describeUsageWaitBody(wait: UsageWait, project: Project | null = null) {
  if (isAdmissionWait(wait)) return describeAdmissionBody(wait.pace);
  if (isPaceWait(wait)) {
    return `The last 24 hours used ${formatLimit(wait.pace.percent)}, which reached ${describePaceLimit(wait.pace, project)}, so the next step did not start.`;
  }
  const account = wait.account?.email ? ` on ${wait.account.email}` : '';
  const provider = resolveProviderLabel(wait.provider ?? CLAUDE_PROVIDER);
  return `The agent stopped at the ${provider} usage limit${account}.`;
}

export function describeUsageWaitNote(wait: UsageWait) {
  if (isAdmissionWait(wait)) {
    return 'Auto pace starts it by itself in queue order once it fits. Build now starts it at once.';
  }
  if (isPaceWait(wait)) {
    return 'Starts by itself as older usage drops out. Resume now ignores the limits for this task.';
  }
  return wait.autoResume
    ? 'Shinsa resumes it by itself when the limit resets.'
    : 'When the limit resets it pauses for you to retry.';
}

export function describeUsageWaitToggle(wait: UsageWait) {
  return wait.autoResume ? 'Don’t resume automatically' : 'Resume at the reset';
}

export function describeUsageWaitToggled(autoResume: boolean) {
  return autoResume ? 'Resumes at the reset.' : 'Waits for you at the reset.';
}

export function describeUsageWaitAction(wait: UsageWait) {
  return isAdmissionWait(wait) ? BUILD_NOW : ACCOUNT_LABEL.resumeNow;
}
