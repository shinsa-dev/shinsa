import type { Task } from '@shinsa/core';
import type { Tone } from '@/lib/format/tone.ts';

export type PullRequest = NonNullable<Task['pullRequest']>;

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
