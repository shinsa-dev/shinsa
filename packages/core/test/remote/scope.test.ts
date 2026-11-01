import { describe, expect, test } from 'bun:test';
import {
  LOCAL_ONLY_MESSAGE,
  REMOTE_APP_ORIGIN,
  resolveClaimUrl,
  resolveScopedEngineInfo,
  resolveScopedPatch,
  resolveScopedRefusal,
  resolveScopedState,
  SCOPE_MESSAGES,
  SCOPED_COMMANDS,
  USER_COMMAND_TYPES,
} from '../../src/index.ts';
import { createHarness, createTask, linkSession, proposePlan } from '../harness.ts';

const ACCOUNT = { id: 'acct-1', email: 'owner@example.com' };

function createHandedTask() {
  const harness = createHarness();
  const taskId = createTask(harness, { planFirst: true });
  const other = createTask(harness, { request: 'Another task' });
  linkSession(harness, taskId);
  proposePlan(harness, taskId);
  const gate = harness.openGate(taskId);
  const run = Object.values(harness.state.runs).find((candidate) => candidate.taskId === taskId);
  if (!run) throw new Error('no run');
  return { harness, taskId, other, gate, run };
}

describe('resolveScopedRefusal', () => {
  test('allows the commands of the task handed off', () => {
    const { harness, taskId, gate, run } = createHandedTask();
    const state = harness.state;
    expect(resolveScopedRefusal(state, taskId, { type: 'task.message', taskId, text: 'Hi' })).toBeNull();
    expect(
      resolveScopedRefusal(state, taskId, {
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'approve',
        response: null,
      })
    ).toBeNull();
    expect(resolveScopedRefusal(state, taskId, { type: 'run.dismiss_silence', runId: run.id })).toBeNull();
    expect(resolveScopedRefusal(state, taskId, { type: 'task.retry', taskId })).toBeNull();
  });

  test('refuses another task, by its id, its run or its gate', () => {
    const { harness, taskId, other } = createHandedTask();
    const state = harness.state;
    expect(resolveScopedRefusal(state, other, { type: 'task.message', taskId, text: 'Hi' })).toBe(
      SCOPE_MESSAGES.task
    );
    expect(resolveScopedRefusal(state, taskId, { type: 'run.dismiss_silence', runId: 'missing' })).toBe(
      SCOPE_MESSAGES.task
    );
    expect(
      resolveScopedRefusal(state, taskId, {
        type: 'gate.answer',
        gateId: 'missing',
        decision: 'approve',
        response: null,
      })
    ).toBe(SCOPE_MESSAGES.task);
  });

  test('refuses what reaches beyond the task, a chosen account and the gates that stay at the keyboard', () => {
    const { harness, taskId, gate } = createHandedTask();
    const state = harness.state;
    expect(resolveScopedRefusal(state, taskId, { type: 'task.share', taskId })).toBe(SCOPE_MESSAGES.command);
    expect(resolveScopedRefusal(state, taskId, { type: 'task.wait_on', taskId, waitsOn: [] })).toBe(
      SCOPE_MESSAGES.command
    );
    expect(resolveScopedRefusal(state, taskId, { type: 'task.retry', taskId, account: ACCOUNT })).toBe(
      LOCAL_ONLY_MESSAGE
    );
    const secret = { ...state, gates: { ...state.gates, [gate.id]: { ...gate, type: 'secret' as const } } };
    expect(
      resolveScopedRefusal(secret, taskId, {
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'approve',
        response: null,
      })
    ).toBe(SCOPE_MESSAGES.gate);
  });

  test('every scoped command is one the engine parses, and none shares or hands off', () => {
    for (const type of SCOPED_COMMANDS) expect(USER_COMMAND_TYPES).toContain(type);
    for (const type of ['task.share', 'task.unshare', 'task.hand_off', 'handoff.remove', 'task.bind_account'])
      expect(SCOPED_COMMANDS as readonly string[]).not.toContain(type);
  });
});

describe('resolveScopedState', () => {
  test('keeps only the task, its records, its repository and project, and drops what is not theirs', () => {
    const { harness, taskId, other, gate, run } = createHandedTask();
    const task = harness.task(taskId);
    const state = {
      ...harness.state,
      tasks: {
        ...harness.state.tasks,
        [taskId]: {
          ...task,
          account: ACCOUNT,
          projectId: 'p1',
          share: {
            at: 1,
            url: 'https://share',
            limit: 'none' as const,
            preset: 'full' as const,
            endsAt: null,
          },
          previews: [],
          handoff: { at: 1, url: 'https://claim', guest: null, claimedAt: null },
          usageWait: {
            id: 'w1',
            runId: run.id,
            role: run.role,
            phaseIndex: null,
            account: ACCOUNT,
            resetAt: 2,
            armedAt: 1,
            autoResume: true,
            status: 'armed' as const,
          },
        },
      },
      projects: { p1: { id: 'p1', name: 'Web', color: 'blue', key: 'WEB', description: '', folders: [] } },
      runs: {
        ...harness.state.runs,
        [run.id]: {
          ...run,
          account: ACCOUNT,
          attempts: [{ id: 'a1', startedAt: 1, account: ACCOUNT }],
          failure: { class: 'unknown' as const, detail: 'x', account: ACCOUNT },
        },
      },
      gates: { ...harness.state.gates, [gate.id]: { ...gate, account: ACCOUNT } },
    } as typeof harness.state;
    const scoped = resolveScopedState(state, taskId);
    expect(Object.keys(scoped.tasks)).toEqual([taskId]);
    expect(scoped.tasks[other]).toBeUndefined();
    const kept = scoped.tasks[taskId];
    expect(kept?.share).toBeUndefined();
    expect(kept?.previews).toBeUndefined();
    expect(kept?.account).toEqual({ id: 'acct-1', email: null });
    expect(kept?.usageWait?.account).toEqual({ id: 'acct-1', email: null });
    expect(kept?.handoff?.url).toBeNull();
    expect(scoped.runs[run.id]?.account?.email).toBeNull();
    expect(scoped.runs[run.id]?.attempts?.[0]?.account?.email).toBeNull();
    expect(scoped.runs[run.id]?.failure?.account?.email).toBeNull();
    expect(scoped.gates[gate.id]?.account?.email).toBeNull();
    expect(Object.values(scoped.runs).every((entry) => entry.taskId === taskId)).toBe(true);
    expect(Object.keys(scoped.repos)).toEqual([task.repoId as string]);
    expect(Object.keys(scoped.projects)).toEqual(['p1']);
    expect(scoped.schedules).toEqual({});
    expect(scoped.seq).toBe(state.seq);
  });

  test('keeps a task without a repository, project or accounts as it is', () => {
    const { harness, taskId } = createHandedTask();
    const task = harness.task(taskId);
    const bare = { ...harness.state, tasks: { [taskId]: { ...task, repoId: null, projectId: null } } };
    const scoped = resolveScopedState(bare, taskId);
    expect(scoped.repos).toEqual({});
    expect(scoped.projects).toEqual({});
    expect(scoped.tasks[taskId]?.account).toBeUndefined();
  });

  test('is empty for a task that is gone', () => {
    const { harness } = createHandedTask();
    const scoped = resolveScopedState(harness.state, 'missing');
    expect(scoped.tasks).toEqual({});
    expect(scoped.seq).toBe(harness.state.seq);
  });
});

test('resolveClaimUrl puts the link’s parts after the claim page', () => {
  const fragment = { instanceId: 'inst', machineKey: 'key', secret: 'secret', invite: 'invite' };
  expect(resolveClaimUrl(fragment)).toBe(`${REMOTE_APP_ORIGIN}/claim#inst.key.secret.invite`);
});

describe('resolveScopedPatch', () => {
  test('carries only the task handed off and none of the machine’s fields', () => {
    const { harness, taskId, other } = createHandedTask();
    const previous = harness.state;
    const next = {
      ...previous,
      seq: previous.seq + 1,
      tasks: {
        ...previous.tasks,
        [taskId]: { ...harness.task(taskId), priority: 'urgent' as const },
        [other]: { ...harness.task(other), priority: 'urgent' as const },
      },
    };
    const patch = resolveScopedPatch(previous, next, { tasks: [taskId, other] }, taskId);
    expect(Object.keys(patch.records.tasks ?? {})).toEqual([taskId]);
    expect(patch.fields).toEqual({});
    expect(patch.to).toBe(next.seq);
  });
});

test('resolveScopedEngineInfo lists only the commands a guest may send', () => {
  const info = resolveScopedEngineInfo('1.2.3');
  expect(info.version).toBe('1.2.3');
  expect(info.commands.length).toBeGreaterThan(0);
  expect(info.commands.every((command) => (SCOPED_COMMANDS as readonly string[]).includes(command))).toBe(
    true
  );
  expect(info.commands).not.toContain('task.hand_off');
});
