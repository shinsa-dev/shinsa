import { describe, expect, it } from 'bun:test';
import type { Task } from '@shinsa/core';
import { describePullRequestFact, describeStarted } from '@/lib/tasks/facts.ts';
import { createTask, NOW } from '../../support/state.ts';

type PullRequest = NonNullable<Task['pullRequest']>;

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 42,
    url: 'https://github.com/acme/app/pull/42',
    state: 'open',
    checks: 'passing',
    unresolvedComments: 0,
    mergeable: true,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('describeStarted', () => {
  it('says when a task started', () => {
    const task = createTask({ id: 't', createdAt: NOW - 2 * 60 * 60_000 });
    expect(describeStarted(task, NOW)).toBe('Started 2h ago');
  });

  it('says added for a task that has not started because it waits on another', () => {
    const task = createTask({ id: 't', stage: 'waiting_on_tasks', waitsOn: ['base'], createdAt: NOW });
    expect(describeStarted(task, NOW)).toBe('Added just now');
    const fresh = { ...task, createdAt: Date.now() };
    expect(describeStarted(fresh)).toBe('Added just now');
  });

  it('keeps started for a task that waits to merge after another', () => {
    const task = createTask({ id: 't', stage: 'shipping', waitsOn: ['base'], createdAt: NOW - 5 * 60_000 });
    expect(describeStarted(task, NOW)).toBe('Started 5m ago');
  });
});

describe('describePullRequestFact', () => {
  it('adds nothing to a healthy open pull request', () => {
    expect(describePullRequestFact(pullRequest())).toEqual([]);
  });

  it('notes failing checks in red and unresolved comments in amber', () => {
    expect(describePullRequestFact(pullRequest({ checks: 'failing', unresolvedComments: 1 }))).toEqual([
      { text: 'checks failing', tone: 'red' },
      { text: '1 comment', tone: 'amber' },
    ]);
    expect(describePullRequestFact(pullRequest({ unresolvedComments: 3 }))).toEqual([
      { text: '3 comments', tone: 'amber' },
    ]);
  });

  it('notes a merged or closed pull request instead of its checks', () => {
    expect(describePullRequestFact(pullRequest({ state: 'merged', checks: 'failing' }))).toEqual([
      { text: 'merged', tone: 'neutral' },
    ]);
    expect(describePullRequestFact(pullRequest({ state: 'closed' }))).toEqual([
      { text: 'closed', tone: 'neutral' },
    ]);
  });
});
