import { describe, expect, test } from 'bun:test';
import { resolveCurrentPhase } from '../../src/decide/lifecycle.ts';
import { findTask } from '../../src/index.ts';
import type { TaskOwner } from '../../src/index.ts';
import {
  buildAll,
  createHarness,
  createTask,
  proposePlan,
  registerRepo,
  shipAndMerge,
  spendRetries,
} from '../harness.ts';

const KAI: TaskOwner = { login: 'kai', name: 'Kai Lee', avatarUrl: 'https://avatars.example/kai' };

const MIA: TaskOwner = { login: 'mia', name: null, avatarUrl: null };

describe('creating a task', () => {
  test('a task needs words and, when one is named, a repository that exists', () => {
    const harness = createHarness();
    expect(() => harness.send({ type: 'task.create', request: '  ', repoId: null })).toThrow(
      'Describe what you want done.'
    );
    expect(() => harness.send({ type: 'task.create', request: 'Do it', repoId: 'nope' })).toThrow(
      'No repository nope'
    );
    expect(harness.state.tasks).toEqual({});
  });

  test('a new task is trimmed, titled from its first line and sent to triage', () => {
    const harness = createHarness();
    harness.send({
      type: 'task.create',
      request: '  Fix the tabs\nThey scroll.  ',
      repoId: null,
      origin: '/code/x',
    });
    const [task] = Object.values(harness.state.tasks);
    expect(task).toMatchObject({
      request: 'Fix the tabs\nThey scroll.',
      title: 'Fix the tabs',
      priority: 'normal',
      planFirst: false,
      origin: '/code/x',
      stage: 'triage',
    });
    expect(harness.lastEffect('task.triage').taskId).toBe(task?.id ?? '');
  });
});

describe('triage', () => {
  test('triage names a repository that exists and runs only once', () => {
    const harness = createHarness();
    harness.send({ type: 'task.create', request: 'Fix it', repoId: null });
    const [taskId = ''] = Object.keys(harness.state.tasks);
    const triage = {
      type: 'task.triage' as const,
      taskId,
      title: 'Fix it',
      size: 'small' as const,
      branch: 'fix/it',
      waitsOn: [],
    };
    expect(() => harness.send({ ...triage, repoId: 'nope' })).toThrow('No repository nope');
    const repoId = registerRepo(harness);
    harness.send({ ...triage, repoId });
    const events = harness.state.seq;
    harness.send({ ...triage, repoId, title: 'Again' });
    expect(harness.state.seq).toBe(events);
    expect(harness.task(taskId)).toMatchObject({ title: 'Fix it', branch: 'fix/it', stage: 'triage' });
  });

  test('the classifier can only make a task wait on open tasks that do not wait on it', () => {
    const harness = createHarness();
    const done = createTask(harness, { request: 'Done' });
    shipAndMerge(harness, done);
    const open = createTask(harness, { request: 'Open' });
    const taskId = createTask(harness, { request: 'New', triageWaitsOn: [done, open, 'unknown', open] });
    expect(harness.task(taskId).waitsOn).toEqual([open]);
    expect(
      harness.task(taskId).activity.find((entry) => entry.actor === 'shinsa' && entry.kind === 'stage')
    ).toMatchObject({ text: 'Waits on “Open”' });
  });

  test('a worktree that is ready for a task that does not exist is refused', () => {
    const harness = createHarness();
    expect(() => harness.send({ type: 'worktree.ready', taskId: 'nope', path: '/wt', branch: 'b' })).toThrow(
      'No task nope'
    );
  });

  test('a worktree that is gone is recorded once', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.cancel', taskId });
    harness.send({ type: 'worktree.gone', taskId });
    expect(harness.task(taskId).worktreePath).toBeNull();
    const events = harness.state.seq;
    harness.send({ type: 'worktree.gone', taskId });
    expect(harness.state.seq).toBe(events);
  });
});

describe('priority', () => {
  test('a new priority reorders the guide, the same priority does nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const requests = harness.effectsOf('briefing.request').length;
    harness.send({ type: 'task.prioritize', taskId, priority: 'urgent' });
    expect(harness.task(taskId).priority).toBe('urgent');
    expect(harness.effectsOf('briefing.request')).toHaveLength(requests + 1);
    const events = harness.state.seq;
    harness.send({ type: 'task.prioritize', taskId, priority: 'urgent' });
    expect(harness.state.seq).toBe(events);
  });
});

describe('finished tasks', () => {
  test('a finished task takes no new dependencies and no failures', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const other = createTask(harness, { request: 'Other' });
    harness.send({ type: 'task.complete', taskId });
    expect(() => harness.send({ type: 'task.wait_on', taskId, waitsOn: [other] })).toThrow(
      'This task is finished.'
    );
    const events = harness.state.seq;
    harness.send({ type: 'effect.fail', taskId, title: 'Late', detail: 'x' });
    harness.send({ type: 'task.retry', taskId });
    expect(harness.state.seq).toBe(events);
  });

  test('a task that settles, done, merged or cancelled, has its scratch folder removed once', () => {
    const harness = createHarness();
    const done = createTask(harness);
    const cancelled = createTask(harness, { request: 'Other' });
    const merged = createTask(harness, { request: 'Third' });
    expect(harness.send({ type: 'task.complete', taskId: done }).effects).toContainEqual({
      kind: 'scratch.remove',
      taskId: done,
    });
    expect(harness.send({ type: 'task.cancel', taskId: cancelled }).effects).toContainEqual({
      kind: 'scratch.remove',
      taskId: cancelled,
    });
    shipAndMerge(harness, merged);
    expect(harness.lastEffect('scratch.remove').taskId).toBe(merged);
    expect(harness.send({ type: 'task.cancel', taskId: done }).effects).toEqual([]);
    expect(harness.effectsOf('scratch.remove')).toHaveLength(3);
  });
});

describe('system commands that arrive twice', () => {
  test('the same failure reported again keeps the retry that is armed, and the gate that is open', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const failure = {
      type: 'effect.fail',
      taskId,
      title: 'Could not open the pull request',
      detail: 'x',
    } as const;
    harness.send(failure);
    expect(harness.task(taskId).autoRetry).toMatchObject({ attempt: 1, status: 'armed' });
    expect(harness.send(failure).events).toEqual([]);
    harness.send({ ...failure, detail: 'GitHub is down.' });
    expect(harness.task(taskId).autoRetry).toMatchObject({ attempt: 2, detail: 'GitHub is down.' });

    spendRetries(harness, taskId);
    harness.send(failure);
    const gate = harness.openGate(taskId);
    expect(harness.send(failure).events).toEqual([]);
    expect(harness.openGate(taskId).id).toBe(gate.id);
  });

  test('a GitHub SSO refusal opens the SSO gate instead of the raw error, once', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const failure = {
      type: 'effect.fail',
      taskId,
      title: 'Could not push the branch',
      detail:
        "remote: The `acme' organization has enabled or enforced SAML SSO. To access\nremote: this repository, you must use a personal access token that has been authorized for this organization.",
    } as const;
    harness.send(failure);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({
      title: 'GitHub needs SSO authorization for acme',
      cause: 'github_sso',
      githubSso: { organization: 'acme', url: 'https://github.com/orgs/acme/sso' },
    });
    expect(harness.send(failure).events).toEqual([]);
    expect(harness.openGate(taskId).id).toBe(gate.id);
  });

  test('the same worktree reported ready again changes nothing, and is removed once for a finished task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const task = harness.task(taskId);
    const ready = {
      type: 'worktree.ready',
      taskId,
      path: task.worktreePath ?? '',
      branch: task.branch ?? '',
    } as const;
    expect(harness.send(ready).events).toEqual([]);
    harness.send({ type: 'task.cancel', taskId });
    const moved = { ...ready, path: '/wt/elsewhere' };
    expect(harness.send(moved).effects).toContainEqual({ kind: 'worktree.remove', taskId });
    const again = harness.send(moved);
    expect(again.events).toEqual([]);
    expect(again.effects).toEqual([]);
  });
});

describe('resolveCurrentPhase', () => {
  test('is the first phase without a report, or the last one when all are in', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    const task = harness.task(taskId);
    expect(resolveCurrentPhase(task)).toBe(1);
    expect(resolveCurrentPhase({ ...task, phaseReports: task.phaseReports.slice(1) })).toBe(0);
    expect(resolveCurrentPhase({ ...task, plan: null, phaseReports: [] })).toBe(0);
  });
});

describe('a dependency added while the worktree is being made', () => {
  test('makes the task wait once its worktree is ready', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    harness.send({ type: 'task.create', request: 'Child', repoId: harness.task(parent).repoId });
    const child = Object.keys(harness.state.tasks).find((id) => id !== parent) ?? '';
    harness.send({
      type: 'task.triage',
      taskId: child,
      title: 'Child',
      repoId: harness.task(parent).repoId ?? '',
      size: 'small',
      branch: 'fix/child',
      waitsOn: [],
    });
    harness.send({ type: 'task.wait_on', taskId: child, waitsOn: [parent] });
    expect(harness.task(child).stage).toBe('triage');
    harness.send({ type: 'worktree.ready', taskId: child, path: '/wt/child', branch: 'fix/child' });
    expect(harness.task(child)).toMatchObject({
      stage: 'waiting_on_tasks',
      stageReason: 'waiting for “Parent” to finish',
    });
  });
});

describe('looking up tasks', () => {
  test('find returns a task that exists and throws for one that does not', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(findTask(harness.state, taskId).id).toBe(taskId);
    expect(() => findTask(harness.state, 'nope')).toThrow('No task nope');
  });
});

describe('who owns a task', () => {
  test('a task records the person who asked for it, and none when no one is named', () => {
    const harness = createHarness();
    harness.send({ type: 'task.create', request: 'Fix the tabs', repoId: null }, { actor: KAI });
    harness.send({ type: 'task.create', request: 'Fix the menu', repoId: null });
    const [kais, nobodys] = Object.values(harness.state.tasks);
    expect(kais?.owner).toEqual(KAI);
    expect(nobodys?.owner).toBeUndefined();
    expect(harness.events.find((event) => event.type === 'task.created')).toMatchObject({ owner: KAI });
  });

  test('a task an agent files from a task belongs to that task’s owner, whoever sent the command', () => {
    const harness = createHarness();
    harness.send({ type: 'task.create', request: 'Fix the tabs', repoId: null }, { actor: KAI });
    const [source] = Object.keys(harness.state.tasks);
    harness.send(
      { type: 'task.create', request: 'Fix the menu too', repoId: null },
      { onBehalf: true, byTask: source ?? null }
    );
    harness.send(
      { type: 'task.create', request: 'Fix the footer', repoId: null },
      { onBehalf: true, byTask: source ?? null, actor: MIA }
    );
    expect(Object.values(harness.state.tasks).map((task) => task.owner)).toEqual([KAI, KAI, KAI]);
  });

  test('a sub-task of a split belongs to the owner of the task it came from, not whoever is acting', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    harness.send({ type: 'task.create', request: 'Port the page', repoId }, { actor: KAI });
    const [taskId = ''] = Object.keys(harness.state.tasks);
    harness.send({
      type: 'task.triage',
      taskId,
      title: 'Port the page',
      repoId,
      size: 'large',
      branch: 'feat/page',
      waitsOn: [],
    });
    harness.send({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: 'feat/page' });
    harness.send({ type: 'config.record', taskId, problems: [] });
    proposePlan(harness, taskId);
    harness.send(
      {
        type: 'agent.split_task',
        runId: harness.activeRun(taskId).id,
        requests: ['Port the header.'],
        thisWaits: false,
      },
      { actor: MIA }
    );
    const sub = Object.values(harness.state.tasks).find((task) => task.parentTaskId === taskId);
    expect(sub?.owner).toEqual(KAI);
  });
});
