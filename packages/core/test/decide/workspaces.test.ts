import { describe, expect, test } from 'bun:test';
import { isSettingUpWorkspace, WORKSPACE_SETUP_REASON } from '../../src/index.ts';
import { parseCommand, createHarness, createTask, registerRepo, verifySetup } from '../harness.ts';

describe('where agents work', () => {
  test('every task works in a worktree of its own', () => {
    const harness = createHarness();
    registerRepo(harness);
    const first = createTask(harness, { request: 'Fix the scroll' });
    const second = createTask(harness, { request: 'Add the banner' });
    expect(harness.task(first).worktreePath).toBe(`/wt/${first}`);
    expect(harness.task(second).worktreePath).toBe(`/wt/${second}`);
    expect(harness.task(second).stage).not.toBe('waiting_on_tasks');
  });

  test('the setup step says it sets up the worktree, and nothing else counts as setting it up', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    harness.send({ type: 'task.create', request: 'Fix it', repoId });
    const taskId = Object.keys(harness.state.tasks)[0] ?? '';
    harness.send({
      type: 'task.triage',
      taskId,
      title: 'Fix it',
      repoId,
      size: 'small',
      branch: `fix/${taskId}`,
      waitsOn: [],
    });
    verifySetup(harness, taskId);
    expect(harness.task(taskId).stageReason).toBe(WORKSPACE_SETUP_REASON);
    expect(isSettingUpWorkspace(harness.task(taskId))).toBe(true);
    expect(isSettingUpWorkspace({ stage: 'triage', stageReason: 'setting up the checkout' })).toBe(false);
    expect(harness.lastEffect('worktree.create')).toEqual({ kind: 'worktree.create', taskId });
  });

  test('a repeated ready with the same worktree records nothing new', () => {
    const harness = createHarness();
    registerRepo(harness);
    const taskId = createTask(harness);
    const created = () => harness.events.filter((event) => event.type === 'worktree.created').length;
    const before = created();
    const { worktreePath, branch } = harness.task(taskId);
    harness.send({ type: 'worktree.ready', taskId, path: worktreePath ?? '', branch: branch ?? '' });
    expect(created()).toBe(before);
    harness.send({ type: 'worktree.ready', taskId, path: '/wt/elsewhere', branch: branch ?? '' });
    expect(created()).toBe(before + 1);
    expect(harness.task(taskId).worktreePath).toBe('/wt/elsewhere');
  });

  test('a repository has no setting for where agents work', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    expect(() =>
      parseCommand({ type: 'repo.update', repoId, patch: { workspace: 'main_checkout' } })
    ).toThrow();
  });
});
