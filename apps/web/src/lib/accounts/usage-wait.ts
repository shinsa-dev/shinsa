import { CLAUDE_PROVIDER, resolveProviderLabel, type Task, type UsageWait } from '@shinsa/core';

export function isUsageWaitArmed(task: Task): task is Task & { usageWait: UsageWait } {
  return task.usageWait?.status === 'armed';
}

export function describeUsageWaitTitle(wait: UsageWait) {
  return wait.autoResume ? 'Resumes when the usage limit resets' : 'Paused until the usage limit resets';
}

export function describeUsageWaitBody(wait: UsageWait) {
  const account = wait.account?.email ? ` on ${wait.account.email}` : '';
  const provider = resolveProviderLabel(wait.provider ?? CLAUDE_PROVIDER);
  return `The agent stopped at the ${provider} usage limit${account}.`;
}

export function describeUsageWaitNote(wait: UsageWait) {
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
