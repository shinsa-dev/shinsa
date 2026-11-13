import { describe, expect, test } from 'bun:test';
import { describeDependencyWait, type Round, type Task, type TaskStage } from '../../src/index.ts';
import { pullRequest } from '../harness.ts';

function task(stage: TaskStage, extra: Partial<Task> = {}) {
  return { id: 't', title: 'Base', stage, pullRequest: null, rounds: [], ...extra } as Task;
}

describe('describeDependencyWait', () => {
  test('names what a task without a pull request is doing', () => {
    expect(describeDependencyWait(task('planning'))).toBe('is being planned');
    expect(describeDependencyWait(task('building'))).toBe('is being built');
    expect(describeDependencyWait(task('awaiting_review'))).toBe('waits for your review');
    expect(describeDependencyWait(task('shipping'))).toBe('is opening its pull request');
    expect(describeDependencyWait(task('cancelled'))).toBe('was cancelled');
  });

  test('names the state of an open pull request', () => {
    const open = (overrides: Parameters<typeof pullRequest>[0]) =>
      describeDependencyWait(task('shipping', { pullRequest: pullRequest({ number: 257, ...overrides }) }));
    expect(open({ checks: 'pending' })).toBe('has pull request #257 waiting for CI');
    expect(open({ checks: 'failing' })).toBe('has failing checks on pull request #257');
    expect(open({ mergeable: false })).toBe('has a conflict on pull request #257');
    expect(open({})).toBe('has pull request #257 open');
  });

  test('names a pull request at the merge gate or in the merge queue', () => {
    const ready = task('awaiting_merge', { pullRequest: pullRequest({ number: 257 }) });
    expect(describeDependencyWait(ready)).toBe('has pull request #257 ready to merge');
    const queued = task('awaiting_merge', {
      pullRequest: pullRequest({ number: 257, mergeQueue: { state: 'queued', position: 2 } }),
    });
    expect(describeDependencyWait(queued)).toBe('has pull request #257 in the merge queue');
  });

  test('says a task merged whatever it is doing now, until it starts its next round', () => {
    const merged = pullRequest({ number: 257, state: 'merged' });
    expect(describeDependencyWait(task('watching', { pullRequest: merged }))).toBe('has merged');
    const round: Round = {
      number: 1,
      title: 'Round 1',
      request: 'Round 1',
      why: null,
      shipping: 'onto_pull_request',
      status: 'shipped',
      pipeline: ['plan', 'build'],
      branch: 'b-1',
      base: null,
      pullRequest: { number: 257, url: 'u', state: 'merged', base: null },
      queuedAt: 0,
      startedAt: 0,
      endedAt: 0,
      outcome: null,
    };
    expect(describeDependencyWait(task('building', { rounds: [round] }))).toBe('is being built');
  });

  test('a cancelled task reads as cancelled even with an open pull request', () => {
    expect(describeDependencyWait(task('cancelled', { pullRequest: pullRequest() }))).toBe('was cancelled');
  });
});
