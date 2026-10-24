import { describe, expect, test } from 'bun:test';
import { createState, type Round, type ShinsaState, type Task } from '@shinsa/core';
import { resolveTaskBaseBranch } from '../../src/runtime/base.ts';
import { createRound, createTask } from '../helpers/state.ts';

function withBaseTask(stage: Task['stage']): ShinsaState {
  const state = createState();
  state.tasks.base = createTask({ id: 'base', branch: 'feat/base', stage });
  return state;
}

const STACKED_ROUNDS: Round[] = [
  createRound({
    number: 1,
    branch: 'feat/top',
    pullRequest: { number: 8, url: 'https://github.com/acme/app/pull/8', state: 'open', base: 'feat/base' },
  }),
  createRound({ number: 2, status: 'active', branch: 'feat/top-2', base: 'feat/top' }),
];

describe('the branch a task’s work starts from and its pull request targets', () => {
  test('a stacked round of a task stacked on another task starts from its own earlier round', () => {
    const task = createTask({ baseTaskId: 'base', branch: 'feat/top-2', rounds: STACKED_ROUNDS });
    expect(resolveTaskBaseBranch(withBaseTask('awaiting_merge'), task)).toBe('feat/top');
  });

  test('a first round starts from the task it is stacked on until that task merges or is cancelled', () => {
    const task = createTask({ baseTaskId: 'base' });
    expect(resolveTaskBaseBranch(withBaseTask('awaiting_merge'), task)).toBe('feat/base');
    expect(resolveTaskBaseBranch(withBaseTask('merged'), task)).toBeNull();
    expect(resolveTaskBaseBranch(withBaseTask('cancelled'), task)).toBeNull();
    expect(resolveTaskBaseBranch(createState(), createTask())).toBeNull();
  });
});
