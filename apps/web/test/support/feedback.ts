import type { Feedback } from '@shinsa/core';

export function createFeedback(overrides: Partial<Feedback> & { id: string }): Feedback {
  return {
    source: 'human',
    note: 'The plan tool refused a plan with two phases.',
    title: 'Plans with two phases are refused',
    body: 'The plan tool refused a plan with two phases, though two is the minimum.',
    status: 'draft',
    failure: null,
    issue: null,
    taskId: null,
    runId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
