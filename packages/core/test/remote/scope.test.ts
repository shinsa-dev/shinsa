import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_TEAM_PERMISSIONS,
  isTaskInScope,
  OWNER_ONLY_MESSAGE,
  REMOTE_APP_ORIGIN,
  resolveClaimUrl,
  resolveScopedEngineInfo,
  resolveScopedPatch,
  resolveScopedRefusal,
  resolveScopedState,
  SCOPE_MESSAGES,
  SCOPED_COMMANDS,
  TEAM_SCOPE_MESSAGES,
  type TeamPermissions,
  USER_COMMAND_TYPES,
} from '../../src/index.ts';
import { createHarness, createTask, linkSession, proposePlan, registerRepo } from '../harness.ts';

const ACCOUNT = { id: 'acct-1', email: 'owner@example.com' };

const KAI = { id: 'u-kai', login: 'kai', name: 'Kai Lane', avatarUrl: null };

function taskScope(taskId: string) {
  return { kind: 'task' as const, taskId };
}

function guestOf(taskId: string) {
  return { ...KAI, scope: taskScope(taskId) };
}

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
    expect(
      resolveScopedRefusal(state, guestOf(taskId), { type: 'task.message', taskId, text: 'Hi' })
    ).toBeNull();
    expect(
      resolveScopedRefusal(state, guestOf(taskId), {
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'approve',
        response: null,
      })
    ).toBeNull();
    expect(
      resolveScopedRefusal(state, guestOf(taskId), { type: 'run.dismiss_silence', runId: run.id })
    ).toBeNull();
    expect(resolveScopedRefusal(state, guestOf(taskId), { type: 'task.retry', taskId })).toBeNull();
  });

  test('refuses another task, by its id, its run or its gate', () => {
    const { harness, taskId, other } = createHandedTask();
    const state = harness.state;
    expect(resolveScopedRefusal(state, guestOf(other), { type: 'task.message', taskId, text: 'Hi' })).toBe(
      SCOPE_MESSAGES.task
    );
    expect(
      resolveScopedRefusal(state, guestOf(taskId), { type: 'run.dismiss_silence', runId: 'missing' })
    ).toBe(SCOPE_MESSAGES.task);
    expect(
      resolveScopedRefusal(state, guestOf(taskId), {
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
    expect(resolveScopedRefusal(state, guestOf(taskId), { type: 'task.share', taskId })).toBe(
      SCOPE_MESSAGES.command
    );
    expect(resolveScopedRefusal(state, guestOf(taskId), { type: 'task.wait_on', taskId, waitsOn: [] })).toBe(
      SCOPE_MESSAGES.command
    );
    expect(
      resolveScopedRefusal(state, guestOf(taskId), { type: 'task.retry', taskId, account: ACCOUNT })
    ).toBe(OWNER_ONLY_MESSAGE);
    const secret = { ...state, gates: { ...state.gates, [gate.id]: { ...gate, type: 'secret' as const } } };
    expect(
      resolveScopedRefusal(secret, guestOf(taskId), {
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'approve',
        response: null,
      })
    ).toBe(SCOPE_MESSAGES.gate);
  });

  test('refuses a file attached by text, since only the owner can attach one', () => {
    const { harness, taskId } = createHandedTask();
    const block = '<attachments><attachment url="/api/attachments/x/secret.png" /></attachments>';
    expect(
      resolveScopedRefusal(harness.state, guestOf(taskId), {
        type: 'task.message',
        taskId,
        text: `See ${block}`,
      })
    ).toBe(SCOPE_MESSAGES.attachments);
    expect(
      resolveScopedRefusal(harness.state, guestOf(taskId), {
        type: 'round.update',
        taskId,
        number: 2,
        request: block,
      })
    ).toBe(SCOPE_MESSAGES.attachments);
    expect(
      resolveScopedRefusal(harness.state, guestOf(taskId), {
        type: 'round.update',
        taskId,
        number: 2,
        request: 'Plain',
      })
    ).toBeNull();
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
    const scoped = resolveScopedState(state, taskScope(taskId));
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
    const scoped = resolveScopedState(bare, taskScope(taskId));
    expect(scoped.repos).toEqual({});
    expect(scoped.projects).toEqual({});
    expect(scoped.tasks[taskId]?.account).toBeUndefined();
  });

  test('is empty for a task that is gone', () => {
    const { harness } = createHandedTask();
    const scoped = resolveScopedState(harness.state, taskScope('missing'));
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
    const patch = resolveScopedPatch(previous, next, { tasks: [taskId, other] }, taskScope(taskId));
    expect(Object.keys(patch.records.tasks ?? {})).toEqual([taskId]);
    expect(patch.fields).toEqual({});
    expect(patch.to).toBe(next.seq);
  });
});

test('resolveScopedEngineInfo lists only the commands a guest may send', () => {
  const info = resolveScopedEngineInfo('1.2.3', taskScope('t1'));
  expect(info.version).toBe('1.2.3');
  expect(info.commands.length).toBeGreaterThan(0);
  expect(info.commands.every((command) => (SCOPED_COMMANDS as readonly string[]).includes(command))).toBe(
    true
  );
  expect(info.commands).not.toContain('task.hand_off');
});

function teamScope(permissions: Partial<TeamPermissions> = {}) {
  return {
    kind: 'team' as const,
    teamId: 'team-1',
    permissions: { ...DEFAULT_TEAM_PERMISSIONS, ...permissions },
  };
}

function teammate(permissions: Partial<TeamPermissions> = {}) {
  return { ...KAI, scope: teamScope(permissions) };
}

function createTeamTasks() {
  const harness = createHarness();
  const sharedRepo = registerRepo(harness, 'paywall-next', 'Superwall');
  const ownRepo = registerRepo(harness, 'shinsa', 'Personal');
  const sharedProject = harness.state.repos[sharedRepo]?.projectId ?? '';
  harness.send({ type: 'project.add_to_team', projectId: sharedProject, teamId: 'team-1' });
  const shared = createTask(harness, { repoId: sharedRepo, planFirst: true });
  const own = createTask(harness, { repoId: ownRepo, request: 'Mine alone' });
  linkSession(harness, shared);
  proposePlan(harness, shared);
  const gate = harness.openGate(shared);
  return { harness, shared, own, gate, sharedProject };
}

function holdBy(harness: ReturnType<typeof createHarness>, taskId: string) {
  harness.send({ type: 'task.hand_to_teammate', taskId, teamId: 'team-1', teammate: KAI });
}

describe('a teammate’s scope', () => {
  test('acts on every task of the team’s projects by default, and on nothing else', () => {
    const { harness, shared, own, gate } = createTeamTasks();
    const state = harness.state;
    expect(
      resolveScopedRefusal(state, teammate(), { type: 'task.prioritize', taskId: shared, priority: 'high' })
    ).toBeNull();
    expect(
      resolveScopedRefusal(state, teammate(), {
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'approve',
        response: null,
      })
    ).toBeNull();
    expect(
      resolveScopedRefusal(state, teammate(), { type: 'task.prioritize', taskId: own, priority: 'high' })
    ).toBe(TEAM_SCOPE_MESSAGES.task);
    expect(
      resolveScopedRefusal(state, teammate(), { type: 'task.prioritize', taskId: 'gone', priority: 'high' })
    ).toBe(TEAM_SCOPE_MESSAGES.task);
    expect(
      resolveScopedRefusal(state, teammate(), { type: 'settings.change', patch: { maxFixRounds: 2 } })
    ).toBe(TEAM_SCOPE_MESSAGES.command);
    expect(resolveScopedRefusal(state, teammate(), { type: 'task.hand_off', taskId: shared })).toBe(
      TEAM_SCOPE_MESSAGES.command
    );
  });

  test('takes over, gives back and shares by default, and is refused each one its team turned off', () => {
    const { harness, shared } = createTeamTasks();
    const state = harness.state;
    const share = { type: 'task.share', taskId: shared } as const;
    const preview = { type: 'preview.share', taskId: shared, serviceId: 'svc' } as const;
    const takeOver = { type: 'task.take_over', taskId: shared } as const;
    expect(resolveScopedRefusal(state, teammate(), takeOver)).toBeNull();
    expect(resolveScopedRefusal(state, teammate(), share)).toBeNull();
    expect(resolveScopedRefusal(state, teammate(), preview)).toBeNull();
    expect(resolveScopedRefusal(state, teammate({ takeOver: false }), takeOver)).toBe(
      TEAM_SCOPE_MESSAGES.takeOver
    );
    expect(resolveScopedRefusal(state, teammate({ share: false }), share)).toBe(TEAM_SCOPE_MESSAGES.share);
    expect(resolveScopedRefusal(state, teammate({ share: false }), preview)).toBe(TEAM_SCOPE_MESSAGES.share);
    expect(
      resolveScopedRefusal(state, teammate({ act: false }), { type: 'task.give_back', taskId: shared })
    ).toBeNull();
  });

  test('messages an agent only when the team allows it or the teammate holds the task', () => {
    const { harness, shared } = createTeamTasks();
    const message = { type: 'task.message', taskId: shared, text: 'Use the new API.' } as const;
    const update = { type: 'round.update', taskId: shared, number: 2, request: 'Plain' } as const;
    expect(resolveScopedRefusal(harness.state, teammate(), message)).toBe(TEAM_SCOPE_MESSAGES.message);
    expect(resolveScopedRefusal(harness.state, teammate(), update)).toBe(TEAM_SCOPE_MESSAGES.message);
    expect(resolveScopedRefusal(harness.state, teammate({ message: true }), message)).toBeNull();
    const pause = { type: 'task.snooze', taskId: shared } as const;
    expect(resolveScopedRefusal(harness.state, teammate({ act: false }), pause)).toBe(
      TEAM_SCOPE_MESSAGES.act
    );
    holdBy(harness, shared);
    expect(resolveScopedRefusal(harness.state, teammate(), message)).toBeNull();
    expect(resolveScopedRefusal(harness.state, teammate({ act: false }), pause)).toBeNull();
    const robin = { ...teammate(), id: 'u-robin', login: 'robin' };
    expect(resolveScopedRefusal(harness.state, robin, message)).toBe(TEAM_SCOPE_MESSAGES.message);
    expect(
      resolveScopedRefusal(harness.state, teammate({ share: false }), {
        type: 'task.unshare',
        taskId: shared,
      })
    ).toBe(TEAM_SCOPE_MESSAGES.share);
  });

  test('keeps the owner’s files and keyboard gates to the owner', () => {
    const { harness, shared, gate } = createTeamTasks();
    const block = '<attachments><attachment url="/api/attachments/x/secret.png" /></attachments>';
    expect(
      resolveScopedRefusal(harness.state, teammate({ message: true }), {
        type: 'task.message',
        taskId: shared,
        text: block,
      })
    ).toBe(SCOPE_MESSAGES.attachments);
    const state = {
      ...harness.state,
      gates: { ...harness.state.gates, [gate.id]: { ...gate, type: 'sign_in' as const } },
    };
    expect(
      resolveScopedRefusal(state, teammate(), {
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'approve',
        response: null,
      })
    ).toBe(SCOPE_MESSAGES.gate);
  });

  test('sees the team’s tasks with their records, and their share links only when it may share', () => {
    const { harness, shared, own, sharedProject } = createTeamTasks();
    const task = harness.task(shared);
    const share = {
      at: 1,
      url: 'https://share',
      limit: 'none' as const,
      preset: 'full' as const,
      endsAt: null,
    };
    const state = {
      ...harness.state,
      tasks: { ...harness.state.tasks, [shared]: { ...task, share, previews: [] } },
    };
    const scoped = resolveScopedState(state, teamScope());
    expect(Object.keys(scoped.tasks)).toEqual([shared]);
    expect(scoped.tasks[own]).toBeUndefined();
    expect(scoped.tasks[shared]?.share).toEqual(share);
    expect(scoped.tasks[shared]?.previews).toEqual([]);
    expect(Object.values(scoped.runs).every((run) => run.taskId === shared)).toBe(true);
    expect(Object.values(scoped.runs).length).toBeGreaterThan(0);
    expect(Object.keys(scoped.projects)).toEqual([sharedProject]);
    expect(Object.keys(scoped.repos)).toEqual([task.repoId as string]);
    const closed = resolveScopedState(state, teamScope({ share: false }));
    expect(closed.tasks[shared]?.share).toBeUndefined();
    expect(closed.tasks[shared]).not.toHaveProperty('previews');
  });

  test('isTaskInScope reads a task, a team and a missing id', () => {
    const { harness, shared, own } = createTeamTasks();
    expect(isTaskInScope(harness.state, teamScope(), shared)).toBe(true);
    expect(isTaskInScope(harness.state, teamScope(), own)).toBe(false);
    expect(isTaskInScope(harness.state, teamScope(), 'gone')).toBe(false);
    expect(isTaskInScope(harness.state, teamScope(), null)).toBe(false);
    expect(isTaskInScope(harness.state, taskScope(own), own)).toBe(true);
  });

  test('resolveScopedEngineInfo announces what the team allows', () => {
    const open = resolveScopedEngineInfo('1.2.3', teamScope()).commands;
    expect(open).toContain('task.take_over');
    expect(open).toContain('task.share');
    expect(open).toContain('task.give_back');
    expect(open).toContain('task.message');
    expect(open).not.toContain('task.hand_off');
    const closed = resolveScopedEngineInfo('1.2.3', teamScope({ takeOver: false, share: false })).commands;
    expect(closed).not.toContain('task.take_over');
    expect(closed).not.toContain('preview.share');
    expect(closed).toContain('task.give_back');
    expect(resolveScopedEngineInfo('1.2.3', taskScope('t1')).commands).not.toContain('task.take_over');
  });
});
