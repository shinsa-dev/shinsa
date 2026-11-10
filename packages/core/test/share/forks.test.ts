import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  selectForkRepo,
  listOwnRepos,
  resolveTeammateFork,
  serializeTeamTaskReferences,
  type TeamFeedTask,
} from '../../src/index.ts';
import { createHarness, createTask, registerRepo } from '../harness.ts';

describe('forking a teammate’s task', () => {
  test('carries what the task was asked and did, its branch and its pull request', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Retry failed payments' });
    expect(
      resolveTeammateFork({ instanceId: 'kai', task: harness.task(taskId), owner: 'Kai' })
    ).toMatchObject({
      instanceId: 'kai',
      taskId,
      title: harness.task(taskId).title,
      owner: 'Kai',
      request: 'Retry failed payments',
      pullRequest: null,
    });
    const opened = {
      ...harness.task(taskId),
      handle: 'PAY-1',
      branch: 'fix/retry',
      pullRequest: {
        number: 12,
        url: 'https://github.com/acme/pay/pull/12',
        state: 'open' as const,
        checks: 'passing' as const,
        unresolvedComments: 0,
        mergeable: true,
        updatedAt: 1,
      },
    };
    const fork = resolveTeammateFork({ instanceId: 'kai', task: opened, owner: null });
    expect(fork).toMatchObject({
      handle: 'PAY-1',
      branch: 'fix/retry',
      pullRequest: { number: 12, url: 'https://github.com/acme/pay/pull/12', state: 'open' },
    });
    expect(fork.rounds[0]).toContain('Round 1');
  });

  test('lands in the repository of yours with the same remote, then the same name, then the same project', () => {
    const harness = createHarness();
    const mine = registerRepo(harness, 'paywall-next', 'Superwall');
    const other = registerRepo(harness, 'site', 'Marketing');
    const theirs = registerRepo(harness, 'kai-paywall', null);
    const state = { ...harness.state, teammateRepos: { [theirs]: true as const } };
    expect(listOwnRepos(state).map((repo) => repo.id)).toEqual([mine, other]);
    expect(
      Option.getOrNull(
        selectForkRepo(state, { name: 'x', remote: 'GitHub.com/superwall/paywall-next' }, null)
      )
    ).toBe(mine);
    expect(Option.getOrNull(selectForkRepo(state, { name: 'site', remote: null }, null))).toBe(other);
    expect(Option.getOrNull(selectForkRepo(state, null, { name: 'marketing' }))).toBe(other);
    expect(Option.getOrNull(selectForkRepo(state, { name: 'kai-paywall', remote: null }, null))).toBeNull();
    expect(Option.getOrNull(selectForkRepo(harness.state, { name: 'kai-paywall', remote: null }, null))).toBe(
      theirs
    );
  });
});

describe('finding a teammate’s task', () => {
  function entry(
    harness: ReturnType<typeof createHarness>,
    taskId: string,
    owner: string | null
  ): TeamFeedTask {
    return {
      task: harness.task(taskId),
      gates: [],
      project: null,
      repo: null,
      owner,
      machine: 'Kai’s MacBook',
      teamId: 'core',
      instanceId: 'kai',
    };
  }

  test('lists matching teammate tasks by id for fork_from, and nothing when none match', () => {
    const harness = createHarness();
    const payments = createTask(harness, { request: 'Retry failed payments' });
    const repo = registerRepo(harness, 'pay', null);
    const named = createTask(harness, { request: 'Other work', repoId: repo });
    const cancelled = createTask(harness, { request: 'Retry dropped' });
    harness.send({ type: 'task.cancel', taskId: cancelled });
    const tasks = [
      entry(harness, payments, 'Kai'),
      { ...entry(harness, named, null), repo: harness.state.repos[repo] ?? null },
      entry(harness, cancelled, 'Kai'),
    ];
    const listed = serializeTeamTaskReferences(tasks, 'retry');
    expect(listed).toContain('Set `fork_from` to one’s id');
    expect(listed).toContain(`Kai’s task`);
    expect(listed).toContain(`id ${payments}`);
    expect(listed).not.toContain(cancelled);
    expect(serializeTeamTaskReferences(tasks, '')).toContain('a teammate’s task · ');
    expect(serializeTeamTaskReferences(tasks, '')).toContain('repository pay');
    expect(serializeTeamTaskReferences(tasks, 'nothing like it')).toBe('');
  });
});
