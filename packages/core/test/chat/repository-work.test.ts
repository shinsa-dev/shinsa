import { describe, expect, test } from 'bun:test';
import { listRepositoryWork, serializeRepositoryWork } from '../../src/index.ts';
import {
  createHarness,
  createTask,
  type Harness,
  proposePlan,
  pullRequest,
  reachShipping,
  registerRepo,
} from '../harness.ts';

function link(harness: Harness, taskId: string) {
  const task = harness.task(taskId);
  return `${task.handle} [${task.title}](shinsa://task/${taskId})`;
}

describe('other work in the repository', () => {
  test('lists the other open tasks of the repository with their branch, stage, files and agent', () => {
    const harness = createHarness();
    registerRepo(harness);
    const taskId = createTask(harness, { request: 'Fix the login' });
    const busy = createTask(harness, { request: 'Rework the session' });
    const cancelled = createTask(harness, { request: 'Tidy the docs' });
    harness.send({ type: 'task.cancel', taskId: cancelled });
    registerRepo(harness, 'elsewhere');
    const elsewhereRepo = Object.values(harness.state.repos).find((repo) => repo.name === 'elsewhere');
    createTask(harness, { request: 'Other repository', repoId: elsewhereRepo?.id ?? '' });
    expect(listRepositoryWork(harness.state, taskId).map((task) => task.id)).toEqual([busy]);
    const text = serializeRepositoryWork(harness.state, taskId, {
      [taskId]: ['src/session.ts'],
      [busy]: ['src/session.ts', 'src/store.ts'],
    });
    expect(text).toBe(
      [
        'Other open tasks in paywall-next, most recently active first:',
        `- ${link(harness, busy)} · planning · branch fix/${busy} · an agent is working on it now`,
        '  Changed files: src/session.ts, src/store.ts. This task changes src/session.ts too.',
      ].join('\n')
    );
  });

  test('says when files are not known, when there are none yet, and when nobody works on a task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const quiet = createTask(harness, { request: 'Quiet' });
    reachShipping(harness, quiet);
    harness.send({ type: 'pull_request.record', taskId: quiet, pullRequest: pullRequest() });
    const unknown = serializeRepositoryWork(harness.state, taskId, {});
    expect(unknown).toContain('no agent is working on it now');
    expect(unknown).toContain('  Changed files: not known.');
    expect(serializeRepositoryWork(harness.state, taskId, { [quiet]: [] })).toContain(
      '  Changed files: none yet.'
    );
    const many = Array.from({ length: 42 }, (_, index) => `f${index}.ts`);
    expect(serializeRepositoryWork(harness.state, taskId, { [quiet]: many })).toContain('f39.ts and 2 more.');
  });

  test('shows a GitButler stack from both sides', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    harness.send({ type: 'repo.update', repoId, patch: { workspace: 'gitbutler' } });
    const below = createTask(harness, { request: 'Rework the exporter' });
    const above = createTask(harness, { request: 'Stream the export' });
    const third = createTask(harness, { request: 'Log the export' });
    proposePlan(harness, above);
    harness.send({ type: 'task.stack', taskId: above, branch: `fix/${below}` });
    expect(serializeRepositoryWork(harness.state, above, {})).toContain(
      `fix/${below} · this task is stacked on it ·`
    );
    expect(serializeRepositoryWork(harness.state, below, {})).toContain(
      `fix/${above} · stacked on this task ·`
    );
    expect(serializeRepositoryWork(harness.state, third, {})).toContain(
      `fix/${above} · stacked on ${link(harness, below)} ·`
    );
  });

  test('shows a round stacked on the task’s own open pull request', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const other = createTask(harness, { request: 'MCP v2' });
    harness.send({
      type: 'task.message',
      taskId: other,
      text: 'Stack this',
      kind: 'new_round',
      title: 'Stack this',
    });
    harness.send({ type: 'round.ship', taskId: other, number: 2, shipping: 'stacked' });
    reachShipping(harness, other);
    harness.send({ type: 'pull_request.record', taskId: other, pullRequest: pullRequest() });
    expect(serializeRepositoryWork(harness.state, taskId, {})).toContain(
      `this round is stacked on branch fix/${other}`
    );
  });

  test('a task alone in its repository, one with no repository and an unknown one', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(serializeRepositoryWork(harness.state, taskId, {})).toBe(
      'No other open task works in paywall-next.'
    );
    expect(serializeRepositoryWork(harness.state, 'nope', {})).toBe('No task nope.');
    expect(listRepositoryWork(harness.state, 'nope')).toEqual([]);
    const before = new Set(Object.keys(harness.state.tasks));
    harness.send({ type: 'task.create', request: 'Plan the quarter', repoId: null });
    const loose = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
    expect(serializeRepositoryWork(harness.state, loose, {})).toBe('This task works in no repository.');
  });
});
