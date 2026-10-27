import { describe, expect, it } from 'bun:test';
import {
  describeMergeable,
  describePullRequestChecks,
  describePullRequestState,
  type PullRequest,
  resolvePullRequestTone,
} from '@/lib/tasks/pull-request.ts';
import { NOW } from '../../support/state.ts';

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

describe('resolvePullRequestTone', () => {
  it('is green open, red failing, amber running, purple merged and neutral closed', () => {
    expect(resolvePullRequestTone(pullRequest())).toBe('green');
    expect(resolvePullRequestTone(pullRequest({ checks: 'none' }))).toBe('green');
    expect(resolvePullRequestTone(pullRequest({ checks: 'failing' }))).toBe('red');
    expect(resolvePullRequestTone(pullRequest({ checks: 'pending' }))).toBe('amber');
    expect(resolvePullRequestTone(pullRequest({ state: 'merged', checks: 'failing' }))).toBe('purple');
    expect(resolvePullRequestTone(pullRequest({ state: 'closed' }))).toBe('neutral');
  });
});

describe('describePullRequestState', () => {
  it('names the base branch of an open pull request when it is known', () => {
    expect(describePullRequestState(pullRequest({ base: 'main' }))).toBe('Open into main');
    expect(describePullRequestState(pullRequest())).toBe('Open');
    expect(describePullRequestState(pullRequest({ state: 'merged' }))).toBe('Merged');
    expect(describePullRequestState(pullRequest({ state: 'closed' }))).toBe('Closed without merging');
  });
});

describe('describeMergeable', () => {
  it('says whether the pull request has conflicts', () => {
    expect(describeMergeable(pullRequest({ mergeable: null }))).toEqual({
      label: 'Not known yet',
      tone: 'neutral',
    });
    expect(describeMergeable(pullRequest({ mergeable: true }))).toEqual({
      label: 'No conflicts',
      tone: 'neutral',
    });
    expect(describeMergeable(pullRequest({ mergeable: false }))).toEqual({
      label: 'Has conflicts',
      tone: 'red',
    });
  });
});

describe('describePullRequestChecks', () => {
  it('describes the checks of an open pull request in their tone', () => {
    expect(describePullRequestChecks(pullRequest({ checks: 'failing' }))).toEqual({
      label: 'Checks failing',
      tone: 'red',
    });
    expect(describePullRequestChecks(pullRequest({ checks: 'pending' }))).toEqual({
      label: 'Checks running',
      tone: 'amber',
    });
    expect(describePullRequestChecks(pullRequest())).toEqual({ label: 'Checks passing', tone: 'green' });
    expect(describePullRequestChecks(pullRequest({ checks: 'none' }))).toEqual({
      label: 'Open',
      tone: 'neutral',
    });
  });

  it('says merged or closed instead of the checks once the pull request is finished', () => {
    expect(describePullRequestChecks(pullRequest({ state: 'merged' }))).toEqual({
      label: 'Merged',
      tone: 'purple',
    });
    expect(describePullRequestChecks(pullRequest({ state: 'closed' }))).toEqual({
      label: 'Closed',
      tone: 'neutral',
    });
  });
});
