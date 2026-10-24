import { describe, expect, it } from 'bun:test';
import type { Task } from '@shinsa/core';
import {
  type Check,
  CI_GLYPH,
  countPassing,
  describeMergeable,
  describePullRequestChecks,
  describePullRequestState,
  listTaskChecks,
  type PullRequest,
  resolvePullRequestTone,
} from '@/lib/tasks/pull-request.ts';
import { createTask, NOW } from '../../support/state.ts';

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

const PASS: Check = { name: 'test', outcome: 'pass', detail: null };
const FAIL: Check = { name: 'lint', outcome: 'fail', detail: 'two errors' };

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

describe('CI_GLYPH', () => {
  it('labels every CI state except passing, which its accent check already says', () => {
    expect(CI_GLYPH.passing.label).toBeNull();
    expect(CI_GLYPH.failing.label).toBe('Failing');
    expect(CI_GLYPH.pending.label).toBe('Running');
    expect(CI_GLYPH.none.label).toBe('None');
  });
});

describe('listTaskChecks', () => {
  it('prefers the latest check results, then the report, then nothing', () => {
    const report = { headline: '', phases: [], checks: [PASS], decisions: [] } as NonNullable<Task['report']>;
    expect(listTaskChecks(createTask({ id: 't', checkResults: [FAIL], report }))).toEqual([FAIL]);
    expect(listTaskChecks(createTask({ id: 't', report }))).toEqual([PASS]);
    expect(listTaskChecks(createTask({ id: 't' }))).toEqual([]);
  });
});

describe('countPassing', () => {
  it('counts only checks that passed', () => {
    expect(countPassing([PASS, FAIL, { ...PASS, outcome: 'skipped' }, PASS])).toBe(2);
    expect(countPassing([])).toBe(0);
  });
});
