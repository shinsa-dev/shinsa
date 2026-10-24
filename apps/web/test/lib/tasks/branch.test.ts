import { describe, expect, it } from 'bun:test';
import type { Task } from '@shinsa/core';
import { resolveBranchBase } from '@/lib/tasks/branch.ts';
import { createRepo, createShinsaState, createTask, NOW } from '../../support/state.ts';

const PULL_REQUEST: NonNullable<Task['pullRequest']> = {
  number: 7,
  url: 'https://github.com/acme/app/pull/7',
  base: 'release',
  state: 'open',
  checks: 'passing',
  unresolvedComments: 0,
  mergeable: true,
  updatedAt: NOW,
};

describe('resolveBranchBase', () => {
  const repo = createRepo({ id: 'app', defaultBranch: 'trunk' });
  it('uses the pull request base, then the repository default branch', () => {
    const withPullRequest = createTask({ id: 't', repoId: 'app', pullRequest: PULL_REQUEST });
    const plain = createTask({ id: 'p', repoId: 'app' });
    const state = createShinsaState({ tasks: [withPullRequest, plain], repos: [repo] });
    expect(resolveBranchBase(state, withPullRequest)).toBe('release');
    expect(resolveBranchBase(state, plain)).toBe('trunk');
  });

  it('knows nothing for a task without a repository', () => {
    const task = createTask({ id: 't', repoId: 'gone' });
    expect(resolveBranchBase(createShinsaState({ tasks: [task] }), task)).toBeNull();
    expect(resolveBranchBase(createShinsaState({}), createTask({ id: 'x' }))).toBeNull();
  });
});
