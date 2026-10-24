import { describe, expect, test } from 'bun:test';
import {
  formatRoundLabel,
  isTaskClosed,
  isTaskResting,
  listStackedPullRequests,
  type Round,
  resolveRoundBase,
  resolveRoundTitle,
  selectShippingTarget,
  type Task,
} from '../../src/index.ts';

function round(number: number, overrides: Partial<Round> = {}): Round {
  return {
    number,
    title: `Round ${number}`,
    request: `Round ${number}`,
    why: null,
    shipping: 'onto_pull_request',
    status: 'shipped',
    pipeline: ['plan', 'build'],
    branch: `b-${number}`,
    base: null,
    pullRequest: { number: 10 + number, url: 'u', state: 'open', base: null },
    queuedAt: 0,
    startedAt: 0,
    endedAt: null,
    outcome: null,
    ...overrides,
  };
}

function taskOf(rounds: Round[], pullRequest: Task['pullRequest'] = null) {
  return {
    rounds,
    request: 'x',
    title: 'x',
    createdAt: 0,
    pipeline: [],
    mode: 'build' as const,
    branch: 'b-3',
    pullRequest,
    stage: 'building' as const,
  };
}

describe('rounds', () => {
  test('a round is named by its number, and its title is the first line of the request', () => {
    expect(formatRoundLabel({ number: 3 })).toBe('round 3');
    expect(resolveRoundTitle(`  ${'x'.repeat(100)}\nmore`)).toHaveLength(80);
    expect(resolveRoundTitle('Add search\nand filters')).toBe('Add search');
  });

  test('a stacked round targets the branch below it only while that pull request is open', () => {
    const stacked = round(3, { status: 'active', base: 'b-2', pullRequest: null });
    expect(resolveRoundBase(taskOf([round(1), round(2), stacked]))).toBe('b-2');
    const merged = round(2, { pullRequest: { number: 12, url: 'u', state: 'merged', base: null } });
    expect(resolveRoundBase(taskOf([round(1), merged, stacked]))).toBeNull();
    expect(resolveRoundBase(taskOf([round(1), round(2, { status: 'active' })]))).toBeNull();
  });

  test('the stack lists each open pull request under the task’s own once, newest first', () => {
    const onto = round(2, { pullRequest: { number: 11, url: 'u', state: 'open', base: null } });
    const top = round(3, {
      status: 'active',
      pullRequest: { number: 13, url: 'u', state: 'open', base: 'b-2' },
    });
    const task = taskOf([round(1), onto, top], {
      number: 13,
      url: 'u',
      state: 'open',
      checks: 'passing',
      unresolvedComments: 0,
      mergeable: true,
      updatedAt: 0,
    });
    expect(listStackedPullRequests(task).map((entry) => entry.number)).toEqual([11]);
    expect(
      listStackedPullRequests(taskOf([round(1, { pullRequest: null }), round(2)])).map(
        (entry) => entry.number
      )
    ).toEqual([12]);
  });

  test('a waiting round ships onto the task’s open pull request, a started one onto the last earlier round still open', () => {
    const open = {
      number: 20,
      url: 'u',
      state: 'open' as const,
      checks: 'passing' as const,
      unresolvedComments: 0,
      mergeable: true,
      updatedAt: 0,
    };
    expect(selectShippingTarget(taskOf([round(1)], open), { number: 2, status: 'waiting' })?.number).toBe(20);
    expect(
      selectShippingTarget(taskOf([round(1)], { ...open, state: 'merged' }), { number: 2, status: 'waiting' })
    ).toBeNull();
    expect(selectShippingTarget(taskOf([round(1)]), { number: 2, status: 'waiting' })).toBeNull();
    expect(
      selectShippingTarget(taskOf([round(1), round(2), round(3, { status: 'active' })]), {
        number: 3,
        status: 'active',
      })?.number
    ).toBe(12);
    expect(
      selectShippingTarget(taskOf([round(1, { status: 'merged' })]), { number: 2, status: 'active' })
    ).toBeNull();
  });

  test('a task rests when its round finished on its own, and is closed once you mark it done or cancel it', () => {
    expect(isTaskResting({ stage: 'merged', closedAt: null })).toBe(true);
    expect(isTaskResting({ stage: 'done' })).toBe(true);
    expect(isTaskResting({ stage: 'done', closedAt: 5 })).toBe(false);
    expect(isTaskClosed({ stage: 'cancelled' })).toBe(true);
    expect(isTaskResting({ stage: 'building' })).toBe(false);
  });
});
