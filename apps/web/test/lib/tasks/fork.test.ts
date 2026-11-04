import { afterEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { connection, replaceConnection } from '@/lib/connection/socket.ts';
import { runTaskAction } from '@/lib/tasks/actions.ts';
import {
  closeForkDialog,
  describeTeammateFork,
  forkTask,
  forkTeammateTask,
  openForkDialog,
  resolveForkRepo,
  resolveOwnerName,
  useForkDialog,
} from '@/lib/tasks/fork.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createRepo, createShinsaState, createTask } from '../../support/state.ts';

describe('the fork dialog', () => {
  it('opens for one task and closes again', () => {
    const { result } = renderHook(() => useForkDialog());
    expect(result.current).toBeNull();
    act(() => openForkDialog('t'));
    expect(result.current).toBe('t');
    act(() => closeForkDialog());
    expect(result.current).toBeNull();
  });

  it('opens from the task action', () => {
    const { result } = renderHook(() => useForkDialog());
    act(() => runTaskAction(createTask({ id: 'source' }), 'fork'));
    expect(result.current).toBe('source');
    act(() => closeForkDialog());
  });
});

describe('forking a task', () => {
  it('creates the fork in the source task’s project, or in its own when it has no repository', async () => {
    const spies = spyOnCommands();
    const task = createTask({ id: 't', handle: 'SW-2', repoId: 'r1', projectId: null });
    const state = createShinsaState({ tasks: [task], repos: [createRepo({ id: 'r1', projectId: 'p' })] });
    await forkTask(state, task, 'Fix it in Safari');
    await forkTask(createShinsaState({}), { ...task, repoId: null, projectId: 'own' }, 'Again');
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'task.create', request: 'Fix it in Safari', repoId: 'r1', projectId: 'p', forkOf: 't' },
        'Forked SW-2 into a new task.',
      ],
      [
        { type: 'task.create', request: 'Again', repoId: null, projectId: 'own', forkOf: 't' },
        'Forked SW-2 into a new task.',
      ],
    ] as never);
    spies.restore();
  });
});

const KAI = { id: 'u2', login: 'kai', name: 'Kai Lee', avatarUrl: null };

describe('forking a teammate’s task', () => {
  afterEach(() => replaceConnection(null));

  it('picks your repository with the same remote, or your first one, or none', () => {
    const task = createTask({ id: 'k', repoId: 'kai-repo' });
    const repos = [
      createRepo({ id: 'kai-repo', name: 'pay', remote: 'github.com/acme/pay' }),
      createRepo({ id: 'site', name: 'site', remote: 'github.com/acme/site' }),
      createRepo({ id: 'pay', name: 'pay-local', remote: 'github.com/acme/pay' }),
    ];
    const state = {
      ...createShinsaState({ tasks: [task], repos }),
      teammateRepos: { 'kai-repo': true as const },
    };
    expect(resolveForkRepo(state, task)).toBe('pay');
    expect(resolveForkRepo(state, { ...task, repoId: null })).toBe('site');
    expect(resolveForkRepo({ ...state, repos: {} }, task)).toBeNull();
    expect(resolveOwnerName({ owner: KAI, viewerId: 'u1' })).toBe('Kai Lee');
    expect(resolveOwnerName({ owner: { ...KAI, name: null }, viewerId: 'u1' })).toBe('kai');
    expect(describeTeammateFork('Kai')).toContain('from what Kai’s task was asked and did');
  });

  it('creates the fork on the machine of the repository you pick, with what the task did', async () => {
    const spies = spyOnCommands();
    replaceConnection({
      ...connection,
      selectMachine: (id: string) => (id === 'pay' ? { id: 'studio', name: 'Studio', current: true } : null),
    });
    const task = createTask({
      id: 'k',
      handle: 'PAY-1',
      title: 'Retry',
      request: 'Retry payments',
      repoId: 'kai-repo',
    });
    const state = createShinsaState({ tasks: [task], repos: [createRepo({ id: 'pay', projectId: 'p' })] });
    await forkTeammateTask(state, task, 'Retry twice', 'pay', {
      id: 'kai',
      teammate: { owner: KAI, viewerId: 'u1' },
    });
    await forkTeammateTask(state, task, 'Again', 'gone', {
      id: 'kai',
      teammate: { owner: KAI, viewerId: 'u1' },
    });
    const [first, second] = spies.sent.mock.calls;
    expect(first?.[0]).toMatchObject({
      type: 'task.create',
      request: 'Retry twice',
      repoId: 'pay',
      projectId: 'p',
      teammateFork: {
        instanceId: 'kai',
        taskId: 'k',
        handle: 'PAY-1',
        owner: 'Kai Lee',
        request: 'Retry payments',
      },
    });
    expect(first?.slice(1)).toEqual(['Forked PAY-1 onto Studio.', 'studio']);
    expect(second?.[0]).toMatchObject({ repoId: 'gone', projectId: null });
    expect(second?.slice(1)).toEqual(['Forked PAY-1 onto your machine.', null]);
    spies.restore();
  });
});
