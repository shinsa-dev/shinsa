import {
  CLAUDE_PROVIDER,
  type Project,
  resolveProviderLabel,
  type Task,
  type UsagePace,
  type UsageWait,
} from '@shinsa/core';
import { describeResetsIn } from '@/lib/accounts/usage.ts';
import { formatMoment, formatUntil } from '@/lib/format/time.ts';

export function isUsageWaitArmed(task: Task): task is Task & { usageWait: UsageWait } {
  return task.usageWait?.status === 'armed';
}

export function isPaceWait(wait: UsageWait): wait is UsageWait & { pace: UsagePace } {
  return wait.cause === 'pace' && wait.pace !== undefined;
}

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

export function describeUsageWaitTitle(wait: UsageWait, now = Date.now()) {
  if (isPaceWait(wait)) return `Held at a usage limit: starts at ${formatMoment(wait.resetAt, now)}`;
  const next = wait.autoResume ? 'continues' : 'pauses for you';
  const account = wait.account?.email ? ` on ${wait.account.email}` : '';
  return `Waiting for usage: ${next} at ${formatMoment(wait.resetAt, now)}${account}`;
}

export function describeUsageWaitBody(wait: UsageWait, project: Project | null = null) {
  if (isPaceWait(wait)) {
    return `The last 24 hours used ${formatLimit(wait.pace.percent)}, which reached ${describePaceLimit(wait.pace, project)}, so the next step did not start.`;
  }
  const account = wait.account?.email ? ` on ${wait.account.email}` : '';
  const provider = resolveProviderLabel(wait.provider ?? CLAUDE_PROVIDER);
  return `The agent stopped at the ${provider} usage limit${account}.`;
}

export function describeUsageWaitNote(wait: UsageWait) {
  if (isPaceWait(wait)) {
    return 'It starts by itself once older usage drops out of the last 24 hours. Raise the limit to start it sooner.';
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
