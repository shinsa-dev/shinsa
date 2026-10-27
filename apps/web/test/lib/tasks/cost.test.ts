import { describe, expect, it } from 'bun:test';
import type { Run, RunUsage } from '@shinsa/core';
import { describeBudgetRetry, describeSpent, resolveCostFacts } from '@/lib/tasks/cost.ts';
import { createRun, createShinsaState, createTask } from '../../support/state.ts';

function usage(costUsd: number | null, tokens = 1_000): RunUsage {
  return { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd };
}

function charge(from: number, spent: RunUsage, readings: [number, number] | null = null): Partial<Run> {
  const to = from + 100;
  return {
    usage: spent,
    meters: [
      {
        attemptId: `attempt-${from}`,
        window: 'account:work',
        from,
        to,
        usage: spent,
        readings: readings
          ? [
              { percent: readings[0], at: from, resetsAt: null },
              { percent: readings[1], at: to, resetsAt: null },
            ]
          : [],
      },
    ],
  };
}

const LEARNED = Array.from({ length: 5 }, (_, index) =>
  createRun({
    id: `learned-${index}`,
    taskId: `other-${index}`,
    ...charge(index * 1_000, usage(1), [index * 2, index * 2 + 2]),
  })
);

const DOCUMENT = {
  goal: 'g',
  phases: [{ title: 'Write a', detail: 'd' }],
  behaviour: [],
  approach: 'a',
  files: [],
  outOfScope: [],
  verification: [],
  questions: [],
};

describe('the cost of a task', () => {
  it('rolls runs up into a total, by role and by phase, the agent’s planning and building as one role, against the limit', () => {
    const task = createTask({ id: 't', plan: { version: 1, body: '', document: DOCUMENT, proposedAt: 1 } });
    const state = createShinsaState({
      tasks: [task],
      runs: [
        createRun({ id: 'p', taskId: 't', purpose: 'plan', usage: usage(0.5, 2_500) }),
        createRun({ id: 'b', taskId: 't', purpose: 'build', phaseIndex: 0, usage: usage(1.25, 1_200_000) }),
      ],
      patch: { settings: { ...createShinsaState({}).settings, taskBudgetUsd: 1 } },
    });
    expect(resolveCostFacts(state, task)).toEqual({
      icon: 'IconCoins',
      total: '$1.75',
      heading: '$1.75 of $1.00',
      detail: '1.2M tokens, as estimated by the agent provider.',
      budget: { share: 1, over: true },
      byRole: [{ key: 'agent', label: 'Agent', cost: '$1.75', tokens: '1.2M tokens' }],
      byPhase: [{ key: 'phase-0', label: 'Write a', cost: '$1.25', tokens: '1.2M tokens' }],
    });
    expect(describeSpent(state, task)).toBe('$1.75 so far');
    expect(describeBudgetRetry(state, task)).toBe('Allow another $1.00');
  });

  it('has nothing before any run is metered, and an unknown price stays unknown', () => {
    const task = createTask({ id: 't' });
    const empty = createShinsaState({ tasks: [task] });
    expect(resolveCostFacts(empty, task)).toBeNull();
    expect(describeSpent(empty, task)).toBeNull();
    expect(describeBudgetRetry(empty, task)).toBeNull();
    const unpriced = createShinsaState({
      tasks: [task],
      runs: [createRun({ id: 'r', taskId: 't', usage: usage(null, 10) })],
    });
    expect(resolveCostFacts(unpriced, task)).toMatchObject({
      total: 'Unknown',
      heading: 'Unknown',
      detail: '10 tokens. Some steps ran on a model without a known price.',
      budget: null,
    });
  });

  it('shows a task that ran on a subscription in its share of the weekly limit, with the dollars beside the tokens', () => {
    const task = createTask({ id: 't', plan: { version: 1, body: '', document: DOCUMENT, proposedAt: 1 } });
    const runs = [
      ...LEARNED,
      createRun({ id: 'p', taskId: 't', purpose: 'plan', ...charge(10_000, usage(0.5, 2_500)) }),
      createRun({
        id: 'b',
        taskId: 't',
        purpose: 'build',
        phaseIndex: 0,
        ...charge(11_000, usage(1.5, 2_500)),
      }),
    ];
    const measured = createShinsaState({ tasks: [task], runs });
    expect(resolveCostFacts(measured, task)).toEqual({
      icon: 'IconGauge',
      total: '4% of weekly limit',
      heading: '4% of the weekly limit',
      detail:
        '$2.00 and 5k tokens, as estimated by the agent provider. The share is learned from 5 tasks on this account.',
      budget: null,
      byRole: [{ key: 'agent', label: 'Agent', cost: '4%', tokens: '5k tokens' }],
      byPhase: [{ key: 'phase-0', label: 'Write a', cost: '3%', tokens: '3k tokens' }],
    });
    expect(describeSpent(measured, task)).toBe('4% of the weekly limit so far');
    const costLimited = createShinsaState({
      tasks: [task],
      runs,
      patch: { settings: { ...measured.settings, taskBudgetUsd: 5 } },
    });
    expect(resolveCostFacts(costLimited, task)).toMatchObject({
      heading: '4% of the weekly limit',
      budget: null,
    });
    const unpriced = createShinsaState({
      tasks: [task],
      runs: [...LEARNED, createRun({ id: 'u', taskId: 't', ...charge(10_000, usage(null, 10), [10, 11]) })],
    });
    expect(resolveCostFacts(unpriced, task)?.detail).toBe(
      '10 tokens. Some steps ran on a model without a known price.'
    );
  });

  it('counts the weekly usage a task used, against the usage limit before the cost limit', () => {
    const task = createTask({ id: 't' });
    const runs = [
      ...LEARNED,
      createRun({ id: 'p', taskId: 't', purpose: 'plan', ...charge(10_000, usage(0.5, 2_500)) }),
      createRun({ id: 'b', taskId: 't', role: 'reviewer', ...charge(11_000, usage(5.5, 2_500)) }),
    ];
    const measured = createShinsaState({ tasks: [task], runs });
    const limited = createShinsaState({
      tasks: [task],
      runs,
      patch: { settings: { ...measured.settings, taskUsageLimit: 10, taskBudgetUsd: 5 } },
    });
    expect(resolveCostFacts(limited, task)).toMatchObject({
      heading: '12% of the weekly limit, 10% allowed',
      budget: { share: 1, over: true },
    });
    expect(describeBudgetRetry(limited, task)).toBe('Allow another 10%');
    const within = createShinsaState({
      tasks: [task],
      runs,
      patch: { settings: { ...measured.settings, taskUsageLimit: 20 } },
    });
    expect(resolveCostFacts(within, task)).toMatchObject({
      heading: '12% of the weekly limit, 20% allowed',
      budget: { over: false },
    });
    expect(describeBudgetRetry(within, task)).toBeNull();
  });

  it('shows dollars while the account’s rate is still being learned, and says the share comes later', () => {
    const task = createTask({ id: 't' });
    const state = createShinsaState({
      tasks: [task],
      runs: [createRun({ id: 'r', taskId: 't', ...charge(0, usage(2, 1_000), [40, 41]) })],
    });
    expect(resolveCostFacts(state, task)).toMatchObject({
      icon: 'IconCoins',
      total: '$2.00',
      detail:
        '1k tokens, as estimated by the agent provider. The share of the weekly limit shows once a few more tasks have run on this account.',
    });
  });

  it('shows a task on an API key in dollars, and a usage limit it cannot reach stays out of the heading', () => {
    const task = createTask({ id: 't' });
    const state = createShinsaState({
      tasks: [task],
      runs: [createRun({ id: 'k', taskId: 't', usage: usage(3, 2_000) })],
      patch: { settings: { ...createShinsaState({}).settings, taskUsageLimit: 10 } },
    });
    expect(resolveCostFacts(state, task)).toMatchObject({
      icon: 'IconCoins',
      total: '$3.00',
      heading: '$3.00',
      budget: null,
    });
  });
});
