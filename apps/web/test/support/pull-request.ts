import type { PullRequest } from '@shinsa/core';
import { NOW } from './state.ts';

export function createPullRequest(overrides: Partial<PullRequest> & { number: number }): PullRequest {
  return {
    url: `https://github.com/you/app/pull/${overrides.number}`,
    state: 'open',
    checks: 'passing',
    unresolvedComments: 0,
    mergeable: true,
    updatedAt: NOW - 1_000,
    ...overrides,
  };
}
