import { describe, expect, it } from 'bun:test';
import { type Queue, type ShinsaState, type Task } from '@shinsa/core';
import {
  describeAccountOwner,
  filterOwnQueue,
  isOwnAccount,
  isOwnTask,
  MACHINE_OWNER_KEY,
  MACHINE_OWNER_LABEL,
  PERSONAL_OWNERSHIP,
  resolveOwnerFact,
  resolveOwnerLogin,
  resolveTaskOwnership,
  type TaskOwnership,
} from '@/lib/tasks/owner.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';

const KAI = { login: 'kai', name: 'Kai Lane', avatarUrl: null };
const MONA = { login: 'mona', name: 'Mona Park', avatarUrl: null };

const SHARED: TaskOwnership = { shared: true, viewer: 'Kai', memberHere: true, isMemberTask: () => true };

const KAI_TASK = createTask({ id: 'kai-task', owner: KAI });
const MONA_TASK = createTask({ id: 'mona-task', owner: MONA });
const UNOWNED = createTask({ id: 'unowned' });

function machine(id: string, sharedMachine: boolean, member = false) {
  const state = { ...createShinsaState({}), settings: { ...createShinsaState({}).settings, sharedMachine } };
  return { id, state, ...(member ? { member: true as const } : {}) };
}

describe('isOwnTask', () => {
  it('counts every task as yours on a machine that is not shared', () => {
    expect(isOwnTask(MONA_TASK, PERSONAL_OWNERSHIP)).toBe(true);
    expect(PERSONAL_OWNERSHIP.isMemberTask(MONA_TASK)).toBe(false);
  });

  it('matches the owner to the viewer by login, in any case', () => {
    expect(isOwnTask(KAI_TASK, SHARED)).toBe(true);
    expect(isOwnTask(MONA_TASK, SHARED)).toBe(false);
  });

  it('gives a task with no owner to the machine’s owner', () => {
    expect(isOwnTask(UNOWNED, SHARED)).toBe(false);
    expect(isOwnTask(UNOWNED, { ...SHARED, isMemberTask: () => false })).toBe(true);
    expect(isOwnTask(MONA_TASK, { ...SHARED, viewer: null, isMemberTask: () => false })).toBe(true);
  });
});

describe('resolveOwnerLogin', () => {
  it('is null for your own task, the login for a teammate’s and the machine’s key for no owner', () => {
    expect(resolveOwnerLogin(KAI_TASK, SHARED)).toBeNull();
    expect(resolveOwnerLogin(MONA_TASK, SHARED)).toBe('mona');
    expect(resolveOwnerLogin(UNOWNED, SHARED)).toBe(MACHINE_OWNER_KEY);
  });
});

describe('isOwnAccount and describeAccountOwner', () => {
  it('say nothing about owners off a shared machine', () => {
    expect(isOwnAccount('mona', PERSONAL_OWNERSHIP)).toBe(true);
    expect(describeAccountOwner('mona', PERSONAL_OWNERSHIP)).toBeNull();
  });

  it('mark your accounts as yours and name everyone else’s', () => {
    expect(describeAccountOwner('KAI', SHARED)).toBe('Yours');
    expect(describeAccountOwner('mona', SHARED)).toBe('mona’s');
    expect(describeAccountOwner(null, SHARED)).toBe(`${MACHINE_OWNER_LABEL}’s`);
    expect(describeAccountOwner(null, { ...SHARED, memberHere: false })).toBe('Yours');
  });
});

describe('filterOwnQueue', () => {
  const state: ShinsaState = createShinsaState({
    tasks: [KAI_TASK, MONA_TASK],
    gates: [createGate({ id: 'g1', taskId: 'kai-task' }), createGate({ id: 'g2', taskId: 'mona-task' })],
  });
  const gate = (task: Task, id: string) => ({ task, gate: state.gates[id]! });
  const queue: Queue = {
    focusProjectId: null,
    focusTeamId: null,
    ready: [gate(KAI_TASK, 'g1'), gate(MONA_TASK, 'g2')],
    upNow: [gate(MONA_TASK, 'g2')],
    later: [gate(KAI_TASK, 'g1')],
    working: [KAI_TASK, MONA_TASK],
    waiting: [MONA_TASK],
    backlog: [KAI_TASK],
    snoozed: [MONA_TASK],
  } as Queue;

  it('keeps the whole queue off a shared machine', () => {
    expect(filterOwnQueue(queue, PERSONAL_OWNERSHIP)).toBe(queue);
  });

  it('keeps only your tasks on a shared machine', () => {
    const own = filterOwnQueue(queue, SHARED);
    expect(own.ready.map((entry) => entry.task.id)).toEqual(['kai-task']);
    expect(own.upNow).toEqual([]);
    expect(own.later.map((entry) => entry.task.id)).toEqual(['kai-task']);
    expect(own.working.map((task) => task.id)).toEqual(['kai-task']);
    expect(own.waiting).toEqual([]);
    expect(own.backlog.map((task) => task.id)).toEqual(['kai-task']);
    expect(own.snoozed).toEqual([]);
  });
});

describe('resolveTaskOwnership', () => {
  const none = () => null;

  it('is personal when no machine is shared', () => {
    expect(
      resolveTaskOwnership({
        settings: { sharedMachine: false },
        machines: [machine('m1', false)],
        viewer: 'kai',
        selectTaskMachine: none,
      })
    ).toBe(PERSONAL_OWNERSHIP);
    expect(
      resolveTaskOwnership({ settings: null, machines: [], viewer: null, selectTaskMachine: none })
    ).toBe(PERSONAL_OWNERSHIP);
  });

  it('reads the setting of this machine or of any machine in the fleet', () => {
    const local = resolveTaskOwnership({
      settings: { sharedMachine: true },
      machines: [],
      viewer: 'mona',
      selectTaskMachine: none,
    });
    expect(local).toMatchObject({ shared: true, viewer: 'mona', memberHere: false });
    expect(local.isMemberTask(UNOWNED)).toBe(false);
  });

  it('knows a member machine alone, or the machine a task is on among several', () => {
    const alone = resolveTaskOwnership({
      settings: null,
      machines: [machine('vps', true, true)],
      viewer: 'kai',
      selectTaskMachine: none,
    });
    expect(alone.memberHere).toBe(true);
    expect(alone.isMemberTask(UNOWNED)).toBe(true);
    const fleet = resolveTaskOwnership({
      settings: null,
      machines: [machine('laptop', false), machine('vps', true, true)],
      viewer: 'kai',
      selectTaskMachine: (taskId) => (taskId === 'unowned' ? 'vps' : 'laptop'),
    });
    expect(fleet.memberHere).toBe(false);
    expect(fleet.isMemberTask(UNOWNED)).toBe(true);
    expect(fleet.isMemberTask(KAI_TASK)).toBe(false);
  });
});

describe('resolveOwnerFact', () => {
  it('shows only on a shared machine, with You for your own task', () => {
    expect(resolveOwnerFact(KAI_TASK, PERSONAL_OWNERSHIP)).toBeNull();
    expect(resolveOwnerFact(KAI_TASK, SHARED)).toEqual({ you: true, owner: KAI, label: 'You' });
    expect(resolveOwnerFact(MONA_TASK, SHARED)).toEqual({
      you: false,
      owner: MONA,
      label: MACHINE_OWNER_LABEL,
    });
    expect(resolveOwnerFact(UNOWNED, SHARED)).toEqual({
      you: false,
      owner: null,
      label: MACHINE_OWNER_LABEL,
    });
  });
});
