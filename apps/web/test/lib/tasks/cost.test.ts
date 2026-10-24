import { describe, expect, it } from 'bun:test';
import type { RunUsage } from '@shinsa/core';
import { describeBudgetRetry, describeSpent, resolveCostFacts } from '@/lib/tasks/cost.ts';
import { createRun, createShinsaState, createTask } from '../../support/state.ts';

function usage(costUsd: number | null, tokens = 1_000): RunUsage {
  return { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd };
}

const DOCUMENT = {
  goal: 'g',
  plan: [{ title: 'Write a', detail: 'd' }],
  behaviour: [],
  approach: 'a',
  files: [],
  outOfScope: [],
  verification: [],
  questions: [],
};

describe('the cost of a task', () => {
  it('rolls runs up into a total, by step and by phase, against the limit', () => {
    const task = createTask({ id: 't', spec: { version: 1, body: '', document: DOCUMENT, proposedAt: 1 } });
    const state = createShinsaState({
      tasks: [task],
      runs: [
        createRun({ id: 'p', taskId: 't', role: 'planner', usage: usage(0.5, 2_500) }),
        createRun({ id: 'b', taskId: 't', role: 'builder', phaseIndex: 0, usage: usage(1.25, 1_200_000) }),
      ],
      patch: { settings: { ...createShinsaState({}).settings, taskBudgetUsd: 1 } },
    });
    expect(resolveCostFacts(state, task)).toEqual({
      total: '$1.75',
      heading: '$1.75 of $1.00',
      detail: '1.2M tokens, as estimated by the agent provider.',
      budget: { share: 1, over: true },
      byRole: [
        { key: 'planner', label: 'Plan', cost: '$0.50', tokens: '3k tokens' },
        { key: 'builder', label: 'Build', cost: '$1.25', tokens: '1.2M tokens' },
      ],
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

  it('counts the weekly usage a task used, against the usage limit before the cost limit', () => {
    const task = createTask({ id: 't' });
    const runs = [
      createRun({ id: 'p', taskId: 't', role: 'planner', usage: usage(0.5, 2_500), weeklyPercent: 2.4 }),
      createRun({ id: 'b', taskId: 't', role: 'builder', usage: usage(0.5, 2_500), weeklyPercent: 9.8 }),
    ];
    const measured = createShinsaState({ tasks: [task], runs });
    expect(resolveCostFacts(measured, task)?.heading).toBe('$1.00 · 12% of the weekly limit');
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
});
