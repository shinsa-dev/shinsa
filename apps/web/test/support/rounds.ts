import type { Round } from '@shinsa/core';

export function createRound(overrides: Partial<Round> & { number: number }): Round {
  return {
    title: `Round ${overrides.number} work`,
    request: `Do round ${overrides.number}`,
    why: null,
    shipping: 'onto_pull_request',
    status: 'merged',
    pipeline: ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge'],
    branch: 'feat/mcp',
    base: null,
    pullRequest: { number: 12, url: 'https://github.com/o/r/pull/12', state: 'merged', base: 'main' },
    queuedAt: 0,
    startedAt: 0,
    endedAt: 1,
    outcome: { goal: 'Add MCP v2.', phases: ['Wire it', 'Test it'], headline: 'Added MCP v2.', result: null },
    ...overrides,
  };
}
