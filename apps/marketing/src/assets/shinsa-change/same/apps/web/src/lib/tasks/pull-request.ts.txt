import type { Task } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { Tone } from '@/lib/format/tone.ts';

export type PullRequest = NonNullable<Task['pullRequest']>;

export type Check = NonNullable<Task['report']>['checks'][number];

export const CI_GLYPH: Record<
  PullRequest['checks'],
  { icon: IconName; className: string; label: string | null }
> = {
  passing: { icon: 'IconCheckCircle2Filled', className: 'text-primary-4', label: null },
  failing: { icon: 'IconCircleXFilled', className: 'text-red-4', label: 'Failing' },
  pending: { icon: 'IconCircleDotted', className: 'text-amber-4', label: 'Running' },
  none: { icon: 'IconCircleDotted', className: 'text-fg-2', label: 'None' },
};

export function resolvePullRequestTone(pullRequest: PullRequest): Tone {
  if (pullRequest.state === 'merged') return 'purple';
  if (pullRequest.state === 'closed') return 'neutral';
  if (pullRequest.checks === 'failing') return 'red';
  return pullRequest.checks === 'pending' ? 'amber' : 'green';
}

export function describePullRequestState(pullRequest: PullRequest) {
  if (pullRequest.state === 'merged') return 'Merged';
  if (pullRequest.state === 'closed') return 'Closed without merging';
  return pullRequest.base ? `Open into ${pullRequest.base}` : 'Open';
}

export function describeMergeable(pullRequest: PullRequest): { label: string; tone: Tone } {
  if (pullRequest.mergeable === null) return { label: 'Not known yet', tone: 'neutral' };
  return pullRequest.mergeable
    ? { label: 'No conflicts', tone: 'neutral' }
    : { label: 'Has conflicts', tone: 'red' };
}

export function describePullRequestChecks(pullRequest: PullRequest): { label: string; tone: Tone } {
  if (pullRequest.state === 'merged') return { label: 'Merged', tone: 'purple' };
  if (pullRequest.state === 'closed') return { label: 'Closed', tone: 'neutral' };
  if (pullRequest.checks === 'failing') return { label: 'Checks failing', tone: 'red' };
  if (pullRequest.checks === 'pending') return { label: 'Checks running', tone: 'amber' };
  if (pullRequest.checks === 'passing') return { label: 'Checks passing', tone: 'green' };
  return { label: 'Open', tone: 'neutral' };
}

export function listTaskChecks(task: Task): Check[] {
  return task.checkResults ?? task.report?.checks ?? [];
}

export function countPassing(checks: Check[]) {
  return checks.filter((check) => check.outcome === 'pass').length;
}
