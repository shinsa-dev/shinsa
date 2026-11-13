import { describe, expect, it, jest, mock } from 'bun:test';
import type {
  AccountsSnapshot,
  ChatEntry,
  RemoteSnapshot,
  TeamFeedSnapshot,
  TerminalsSnapshot,
  UserCommand,
  WireState,
} from '@shinsa/core';
import {
  createState,
  ENGINE_PROTOCOL,
  NO_TEAM_FEED,
  resolveEngineInfo,
  DEFAULT_TEAM_SCOPES,
  resolveScopedEngineInfo,
  toggleScope,
  SCOPE_MESSAGES,
  TEAM_SCOPE_MESSAGES,
} from '@shinsa/core';
import { Effect } from 'effect';
import { Socket } from 'effect/socket';
import {
  FLEET_WAIT_MS,
  Fleet,
  type FleetMember,
  listSharedHandles,
  mergeFleetStates,
  resolveCommandOwner,
  resolveFleetStatus,
  resolveRequestOwner,
} from '@/lib/remote/fleet.ts';
import { describeOutdatedMachine } from '@/lib/remote/mode.ts';
import type { SocketTransport } from '@/lib/runtime/socket/schema.ts';
import { createSignal } from '@/lib/signal.ts';
import { resolveCanonicalTaskPath, resolveTaskPath } from '@/router.ts';
import { FakeConnection } from '../../support/connection.ts';
import { createMachineResources } from '../../support/resources.ts';
import { createTask } from '../../support/state.ts';

function createWire(seq: number, records: Partial<WireState> = {}): WireState {
  return { ...(createState() as unknown as WireState), seq, ...records };
}

function createTerminals(home: string, serviceIds: string[], terminalIds: string[] = []): TerminalsSnapshot {
  return {
    home,
    services: serviceIds.map((id) => ({ id }) as TerminalsSnapshot['services'][number]),
    terminals: terminalIds.map((id) => ({ id }) as TerminalsSnapshot['terminals'][number]),
  };
}

function createMember(id: string, name: string) {
  const connection = new FakeConnection();
  const requests: string[] = [];
  const closed: string[] = [];
  const member: FleetMember = {
    id,
    name,
    connection,
    fetch: (request) => {
      requests.push(new URL(request.url).pathname);
      return Promise.resolve(new Response(name));
    },
    close: () => closed.push(id),
  };
  return { member, connection, requests, closed };
}

function createFleet() {
  const studio = createMember('m1', 'Studio');
  const laptop = createMember('m2', 'Laptop');
  const fleet = new Fleet([studio.member, laptop.member]);
  const studioTask = createTask({ id: 'task-studio', title: 'On Studio' });
  const laptopTask = createTask({ id: 'task-laptop', title: 'On the laptop' });
  studio.connection.push({
    state: createWire(4, { tasks: { [studioTask.id]: studioTask } }),
    status: 'open',
  });
  laptop.connection.push({
    state: createWire(6, {
      tasks: { [laptopTask.id]: laptopTask },
      runs: { 'run-laptop': { id: 'run-laptop', taskId: laptopTask.id } as WireState['runs'][string] },
    }),
    status: 'open',
  });
  return { fleet, studio, laptop };
}

describe('which device you use', () => {
  it('tells every machine you use this page, and answers for a task as the machine that runs it', () => {
    const { fleet, studio, laptop } = createFleet();
    fleet.reportPresence();
    expect([studio.connection.presences, laptop.connection.presences]).toEqual([1, 1]);
    laptop.connection.attention = 'elsewhere';
    studio.connection.attention = 'here';
    expect(fleet.selectAttention('task-laptop')).toBe('elsewhere');
    expect(fleet.selectAttention('task-studio')).toBe('here');
    expect(fleet.selectAttention()).toBe('here');
    expect(new Fleet([]).selectAttention('task-laptop')).toBe('nowhere');
  });
});

describe('what each machine’s engine speaks', () => {
  it('answers for the engine of the machine that owns a task, and the first machine’s otherwise', () => {
    const { fleet, studio, laptop } = createFleet();
    laptop.connection.engine = resolveEngineInfo('1.2.0');
    expect(fleet.selectEngine('task-laptop')).toBe(laptop.connection.engine);
    expect(fleet.selectEngine('task-studio')).toBeNull();
    studio.connection.engine = resolveEngineInfo('1.1.0');
    expect(fleet.selectEngine()).toBe(studio.connection.engine);
  });

  it('refuses a command the owning machine did not list, naming that machine, and sends one it did', async () => {
    const { fleet, studio, laptop } = createFleet();
    laptop.connection.engine = resolveEngineInfo('1.2.0');
    expect(fleet.command({ type: 'task.share', taskId: 'task-studio', limit: 'day' })).rejects.toThrow(
      'Update Shinsa on Studio to use this.'
    );
    await fleet.command({ type: 'task.share', taskId: 'task-laptop', limit: 'day' });
    expect(studio.connection.commands).toEqual([]);
    expect(laptop.connection.commands.map((command) => command.type)).toEqual(['task.share']);
  });

  it('leaves out a machine on another engine protocol and lists it as one to update', async () => {
    const { fleet, studio, laptop } = createFleet();
    const before = fleet.snapshot();
    studio.connection.engine = { ...resolveEngineInfo('0.9.0'), protocol: ENGINE_PROTOCOL - 1 };
    studio.connection.push({ ...studio.connection.current, status: 'closed' });
    expect(fleet.snapshot()).not.toBe(before);
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {})).toEqual(['task-laptop']);
    expect(fleet.snapshot().status).toBe('open');
    expect(fleet.isEveryMachineOutdated()).toBe(false);
    expect(fleet.listMachines().map((machine) => machine.id)).toEqual(['m2']);
    const unreachable = fleet.listUnreachableMachines();
    expect(unreachable).toEqual([{ id: 'm1', name: 'Studio', outdated: true }]);
    expect(fleet.listUnreachableMachines()).toBe(unreachable);
    expect(fleet.command({ type: 'settings.change', patch: {} }, 'm1')).rejects.toThrow(
      describeOutdatedMachine('Studio')
    );
    await fleet.command({ type: 'settings.change', patch: {} });
    expect(studio.connection.commands).toEqual([]);
    expect(laptop.connection.commands.map((command) => command.type)).toEqual(['settings.change']);
    laptop.connection.remote = { requests: [] } as unknown as RemoteSnapshot;
    expect(fleet.selectRemote()).toBe(laptop.connection.remote);
    laptop.connection.engine = { ...resolveEngineInfo('0.9.0'), protocol: ENGINE_PROTOCOL + 1 };
    laptop.connection.push({ ...laptop.connection.current });
    expect(fleet.isEveryMachineOutdated()).toBe(true);
    expect(fleet.snapshot().state).toBeNull();
    expect(new Fleet([]).isEveryMachineOutdated()).toBe(false);
  });
});

describe('merging the state of several machines', () => {
  it('links a task by its id when another machine has a task with the same handle', () => {
    const studio = createMember('m1', 'Studio');
    const laptop = createMember('m2', 'Laptop');
    const fleet = new Fleet([studio.member, laptop.member]);
    const onStudio = createTask({ id: 'task-studio', handle: 'LOC-1' });
    const onLaptop = createTask({ id: 'task-laptop', handle: 'LOC-1' });
    const unique = createTask({ id: 'task-unique', handle: 'LOC-2' });
    studio.connection.push({
      state: createWire(1, { tasks: { [onStudio.id]: onStudio, [unique.id]: unique } }),
      status: 'open',
    });
    laptop.connection.push({ state: createWire(1, { tasks: { [onLaptop.id]: onLaptop } }), status: 'open' });
    fleet.snapshot();
    expect(resolveTaskPath(onLaptop)).toBe('/tasks/task-laptop');
    expect(resolveTaskPath(onStudio)).toBe('/tasks/task-studio');
    expect(resolveTaskPath(unique)).toBe('/tasks/LOC-2');
    expect(resolveCanonicalTaskPath(onLaptop, 'task-laptop', '')).toBeNull();
    expect(
      listSharedHandles([{ id: 'm1', state: createWire(1, { tasks: { a: onStudio, b: onStudio } }) }])
    ).toEqual(new Set());
  });

  it('puts every machine’s tasks in one state, keeps the first machine’s settings and knows who owns what', () => {
    const { fleet } = createFleet();
    const { state } = fleet.snapshot();
    expect(Object.keys(state?.tasks ?? {}).sort()).toEqual(['task-laptop', 'task-studio']);
    expect(state?.seq).toBe(10);
    expect(fleet.selectMachine('task-laptop')).toEqual({ id: 'm2', name: 'Laptop', current: false });
    expect(fleet.selectMachine('task-studio')).toEqual({ id: 'm1', name: 'Studio', current: false });
    expect(fleet.selectMachine('nothing')).toBeNull();
    expect(fleet.members).toEqual([
      { id: 'm1', name: 'Studio', current: false },
      { id: 'm2', name: 'Laptop', current: false },
    ]);
  });

  it('hands back the one machine’s state as it is, and nothing while no machine has answered', () => {
    const only = createWire(1);
    expect(mergeFleetStates([{ id: 'm1', state: only }])?.state).toBe(only);
    expect(mergeFleetStates([])).toBeNull();
  });

  it('adds up your hours from every machine, and reads a machine that sends none as none', () => {
    const { presence: _, ...older } = createWire(1);
    const merged = mergeFleetStates([
      { id: 'm1', state: createWire(1, { presence: { '10': 2, '11': 1 } }) },
      { id: 'm2', state: createWire(1, { presence: { '11': 3 } }) },
      { id: 'm3', state: older as WireState },
    ]);
    expect(merged?.state.presence).toEqual({ '10': 2, '11': 4 });
    expect(merged?.owners.has('10')).toBe(false);
  });

  it('keeps your time away and focus from every machine, and reads a machine that sends none as none', () => {
    const { away: _, focusHistory: __, ...older } = createWire(1);
    const focus = { projectIds: ['p'], except: false, from: 5, to: null, until: null };
    const merged = mergeFleetStates([
      { id: 'm1', state: createWire(1, { away: { '1': { from: 1, to: 2 } } }) },
      { id: 'm2', state: createWire(1, { away: { '3': { from: 3, to: 4 } }, focusHistory: { '5': focus } }) },
      { id: 'm3', state: older as WireState },
    ]);
    expect(merged?.state.away).toEqual({ '1': { from: 1, to: 2 }, '3': { from: 3, to: 4 } });
    expect(merged?.state.focusHistory).toEqual({ '5': focus });
  });

  it('is open when any machine is, connecting while one still tries, and closed otherwise', () => {
    expect(resolveFleetStatus(['closed', 'open'])).toBe('open');
    expect(resolveFleetStatus(['closed', 'connecting'])).toBe('connecting');
    expect(resolveFleetStatus(['closed'])).toBe('closed');
    expect(resolveFleetStatus([])).toBe('closed');
  });

  it('keeps the same snapshot until a machine sends something new, and tells its listeners when one does', () => {
    const { fleet, studio } = createFleet();
    const first = fleet.snapshot();
    expect(fleet.snapshot()).toBe(first);
    let heard = 0;
    const stop = fleet.subscribe(() => {
      heard += 1;
    });
    studio.connection.push({ state: createWire(5), status: 'open' });
    expect(heard).toBe(1);
    expect(fleet.snapshot()).not.toBe(first);
    stop();
  });

  it('shows no machine on a task while there is only one machine', () => {
    const studio = createMember('m1', 'Studio');
    const fleet = new Fleet([studio.member]);
    studio.connection.push({
      state: createWire(1, { tasks: { t: createTask({ id: 't' }) } }),
      status: 'open',
    });
    expect(fleet.selectMachine('t')).toBeNull();
  });

  it('shows the machine of a task handed to you even when it is the only one, with who handed it', () => {
    const studio = createMember('m1', 'Studio');
    const lee = { id: 'u1', login: 'lee', name: 'Lee Park', avatarUrl: null };
    const fleet = new Fleet([{ ...studio.member, guest: true, handedBy: lee }]);
    studio.connection.push({
      state: createWire(1, { tasks: { t: createTask({ id: 't' }) } }),
      status: 'open',
    });
    expect(fleet.selectMachine('t')).toMatchObject({ id: 'm1', guest: true, handedBy: lee });
  });

  it('shows a task’s machine once the account has another machine, even one this device cannot reach', () => {
    const studio = createMember('m1', 'Studio');
    const fleet = new Fleet([studio.member], [{ id: 'm2', name: 'Laptop' }]);
    studio.connection.push({
      state: createWire(1, { tasks: { t: createTask({ id: 't' }) } }),
      status: 'open',
    });
    expect(fleet.selectMachine('t')).toEqual({ id: 'm1', name: 'Studio', current: false });
  });
});

function createWaitingFleet() {
  const studio = createMember('m1', 'Studio');
  const laptop = createMember('m2', 'Laptop');
  const deadline: { settle: () => void; stopped: number; started: number } = {
    settle: () => undefined,
    stopped: 0,
    started: 0,
  };
  const fleet = new Fleet([studio.member, laptop.member], [], null, (settle) => {
    deadline.settle = settle;
    deadline.started += 1;
    return () => {
      deadline.stopped += 1;
    };
  });
  fleet.start();
  studio.connection.push({
    state: createWire(1, { tasks: { 'task-studio': createTask({ id: 'task-studio' }) } }),
    status: 'open',
  });
  return { fleet, studio, laptop, deadline };
}

describe('waiting for every machine before showing the state', () => {
  it('shows nothing while one machine is still connecting, then every machine’s tasks at once', () => {
    const { fleet, laptop, deadline } = createWaitingFleet();
    expect(fleet.snapshot().state).toBeNull();
    expect(fleet.snapshot().status).toBe('open');
    laptop.connection.push({
      state: createWire(1, { tasks: { 'task-laptop': createTask({ id: 'task-laptop' }) } }),
      status: 'open',
    });
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {}).sort()).toEqual(['task-laptop', 'task-studio']);
    expect(deadline.stopped).toBe(1);
  });

  it('keeps waiting for a machine whose connection failed, while it tries again', () => {
    const { fleet, laptop, deadline } = createWaitingFleet();
    laptop.connection.push({ state: null, status: 'closed' });
    expect(fleet.snapshot().state).toBeNull();
    laptop.connection.push({ state: null, status: 'connecting' });
    expect(fleet.snapshot().state).toBeNull();
    deadline.settle();
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {})).toEqual(['task-studio']);
    laptop.connection.push({ state: null, status: 'closed' });
    expect(fleet.snapshot().state).not.toBeNull();
  });

  it('does not wait for a machine the dashboard lists as offline, and merges it in once it answers', () => {
    const studio = createMember('m1', 'Studio');
    const laptop = createMember('m2', 'Laptop');
    const fleet = new Fleet(
      [studio.member, { ...laptop.member, online: false }],
      [],
      null,
      () => () => undefined
    );
    studio.connection.push({
      state: createWire(1, { tasks: { 'task-studio': createTask({ id: 'task-studio' }) } }),
      status: 'open',
    });
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {})).toEqual(['task-studio']);
    laptop.connection.push({
      state: createWire(1, { tasks: { 'task-laptop': createTask({ id: 'task-laptop' }) } }),
      status: 'open',
    });
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {}).sort()).toEqual(['task-laptop', 'task-studio']);
  });

  it('stops waiting for a machine on another engine protocol', () => {
    const { fleet, laptop } = createWaitingFleet();
    laptop.connection.engine = { ...resolveEngineInfo('0.9.0'), protocol: ENGINE_PROTOCOL - 1 };
    laptop.connection.push({ state: null, status: 'open' });
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {})).toEqual(['task-studio']);
  });

  it('stops waiting for a machine removed from the fleet', () => {
    const { fleet } = createWaitingFleet();
    expect(fleet.snapshot().state).toBeNull();
    fleet.removeMember('m2');
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {})).toEqual(['task-studio']);
  });

  it('shows the machines that answered once the deadline passes, and tells its listeners', () => {
    const { fleet, laptop, deadline } = createWaitingFleet();
    expect(fleet.snapshot().state).toBeNull();
    let heard = 0;
    fleet.subscribe(() => {
      heard += 1;
    });
    deadline.settle();
    expect(heard).toBe(1);
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {})).toEqual(['task-studio']);
    deadline.settle();
    expect(heard).toBe(1);
    laptop.connection.push({
      state: createWire(1, { tasks: { 'task-laptop': createTask({ id: 'task-laptop' }) } }),
      status: 'open',
    });
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {}).sort()).toEqual(['task-laptop', 'task-studio']);
  });

  it('starts the deadline once, and stops it when the fleet closes', () => {
    const { fleet, deadline } = createWaitingFleet();
    fleet.start();
    expect(deadline.started).toBe(1);
    fleet.close();
    expect(deadline.stopped).toBe(1);
  });

  it('waits ten seconds by default before showing the machines that answered', () => {
    const studio = createMember('m1', 'Studio');
    const laptop = createMember('m2', 'Laptop');
    jest.useFakeTimers();
    try {
      const fleet = new Fleet([studio.member, laptop.member]);
      fleet.start();
      studio.connection.push({ state: createWire(1), status: 'open' });
      expect(FLEET_WAIT_MS).toBe(10_000);
      jest.advanceTimersByTime(FLEET_WAIT_MS - 1);
      expect(fleet.snapshot().state).toBeNull();
      jest.advanceTimersByTime(1);
      expect(fleet.snapshot().state).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('sending to the machine that owns it', () => {
  it('finds the owner of a command from any id it names, at any depth', () => {
    const owners = new Map([
      ['task-1', 'm2'],
      ['project-1', 'm3'],
    ]);
    expect(resolveCommandOwner({ type: 'task.cancel', taskId: 'task-1' }, owners)).toBe('m2');
    expect(
      resolveCommandOwner(
        { type: 'project.write', project: { id: 'project-1' } } as unknown as UserCommand,
        owners
      )
    ).toBe('m3');
    expect(resolveCommandOwner({ type: 'task.cancel', taskId: 'task-9' }, owners)).toBeNull();
    const deep = { type: 'x', a: { b: { c: { d: { e: 'task-1' } } } } } as unknown as UserCommand;
    expect(resolveCommandOwner(deep, owners)).toBeNull();
  });

  it('sends a relayed machine’s media through its relay, once, and leaves the rest as they are', () => {
    const { studio, laptop } = createFleet();
    const fleet = new Fleet([
      studio.member,
      {
        ...laptop.member,
        resolveUrl: (path) => `/api/teams/relay/m2${path}`,
        appOrigin: 'https://app.shinsa.dev',
      },
    ]);
    const image = '/api/evidence/task-laptop/round-1/shot.png';
    expect(fleet.resolveMediaUrl(image)).toBe(`/api/teams/relay/m2${image}`);
    expect(fleet.resolveMediaUrl(`/api/teams/relay/m2${image}`)).toBe(`/api/teams/relay/m2${image}`);
    expect(fleet.resolveMediaUrl('/api/evidence/task-studio/round-1/shot.png')).toBe(
      '/api/evidence/task-studio/round-1/shot.png'
    );
    expect(fleet.resolveMediaUrl('https://example.com/shot.png')).toBe('https://example.com/shot.png');
    expect(fleet.resolveMediaUrl('//example.com/shot.png')).toBe('//example.com/shot.png');
    expect(fleet.selectAppOrigin('task-laptop')).toBe('https://app.shinsa.dev');
    expect(fleet.selectAppOrigin('task-studio')).toBeNull();
    expect(fleet.selectAppOrigin('task-nowhere')).toBeNull();
  });

  it('finds the owner of a request from its path or its query', () => {
    const owners = new Map([['task-1', 'm2']]);
    expect(resolveRequestOwner(new URL('https://shinsa.dev/api/tasks/task-1/diff'), owners)).toBe('m2');
    expect(resolveRequestOwner(new URL('https://shinsa.dev/api/code?task=task-1'), owners)).toBe('m2');
    expect(resolveRequestOwner(new URL('https://shinsa.dev/api/tasks/%E0%A4%A'), owners)).toBeNull();
  });

  it('sends a command, a transcript and a request to the machine that owns them, and the rest to the first machine', async () => {
    const { fleet, studio, laptop } = createFleet();
    await fleet.command({ type: 'task.cancel', taskId: 'task-laptop' });
    await fleet.command({ type: 'settings.change', patch: {} });
    expect(laptop.connection.commands.map((command) => command.type)).toEqual(['task.cancel']);
    expect(studio.connection.commands.map((command) => command.type)).toEqual(['settings.change']);
    fleet.watchTranscript('run-laptop')();
    expect(laptop.connection.watched).toEqual(['run-laptop']);
    fleet.requestTaskDetail('task-laptop');
    fleet.watchTaskDetail('task-laptop')();
    expect(laptop.connection.details).toEqual(['request task-laptop', 'watch task-laptop']);
    expect(studio.connection.details).toEqual([]);
    laptop.connection.transcript = [{ kind: 'note' } as unknown as ChatEntry];
    expect(fleet.selectTranscript('run-laptop')).toHaveLength(1);
    expect(await (await fleet.fetch(new Request('https://shinsa.dev/api/tasks/task-laptop'))).text()).toBe(
      'Laptop'
    );
    expect(await (await fleet.fetch(new Request('https://shinsa.dev/api/health'))).text()).toBe('Studio');
  });

  it('lists every machine with its own state once there are two, and sends a command to the machine named', async () => {
    const { fleet, studio, laptop } = createFleet();
    const machines = fleet.listMachines();
    expect(machines.map((machine) => [machine.id, machine.name, Object.keys(machine.state.tasks)])).toEqual([
      ['m1', 'Studio', ['task-studio']],
      ['m2', 'Laptop', ['task-laptop']],
    ]);
    expect(fleet.listMachines()).toBe(machines);
    await fleet.command({ type: 'task.create', request: 'Run it', repoId: null }, 'm2');
    await fleet.command({ type: 'task.create', request: 'Run it', repoId: null });
    expect(laptop.connection.commands.map((command) => command.type)).toEqual(['task.create']);
    expect(studio.connection.commands.map((command) => command.type)).toEqual(['task.create']);
    expect(fleet.listUnreachableMachines()).toEqual([]);
    fleet.removeMember('m2');
    expect(fleet.listMachines().map((machine) => machine.id)).toEqual(['m1']);
    expect(fleet.listUnreachableMachines()).toEqual([{ id: 'm2', name: 'Laptop' }]);
    fleet.removeMember('m1');
    expect(fleet.listMachines()).toEqual([]);
  });

  it('lists each machine with the resources its engine last reported, kept until a machine reports again', () => {
    const { fleet, studio, laptop } = createFleet();
    const listener = mock(() => undefined);
    const resourceListener = mock(() => undefined);
    fleet.subscribe(listener);
    fleet.subscribeResources(resourceListener);
    const before = fleet.listMachines();
    expect(before.map((machine) => machine.resources)).toEqual([null, null]);
    const busy = createMachineResources({ cpuPercent: 90 });
    laptop.connection.pushResources(busy);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(resourceListener).toHaveBeenCalledTimes(1);
    const after = fleet.listMachines();
    expect(after).not.toBe(before);
    expect(after.map((machine) => [machine.id, machine.resources])).toEqual([
      ['m1', null],
      ['m2', busy],
    ]);
    expect(after[1]?.state).toBe(before[1]?.state);
    expect(fleet.listMachines()).toBe(after);
    const idle = createMachineResources({ cpuPercent: 5 });
    studio.connection.pushResources(idle);
    expect(fleet.selectResources()).toBe(idle);
    expect(fleet.listMachines().map((machine) => machine.resources)).toEqual([idle, busy]);
  });

  it('reports no resources while no machine is reachable', () => {
    expect(new Fleet([]).selectResources()).toBeNull();
  });

  it('drops a removed machine’s tasks at once, closes it and does not list it as unreachable', () => {
    const { fleet, studio, laptop } = createFleet();
    const unreachable = new Fleet([studio.member], [{ id: 'm3', name: 'Build box' }]);
    let published = 0;
    fleet.subscribe(() => {
      published += 1;
    });
    let remotePublished = 0;
    fleet.subscribeRemote(() => {
      remotePublished += 1;
    });
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {}).sort()).toEqual(['task-laptop', 'task-studio']);
    fleet.removeMachine('m2');
    expect(published).toBe(1);
    expect(remotePublished).toBe(1);
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {})).toEqual(['task-studio']);
    expect(fleet.members.map((member) => member.id)).toEqual(['m1']);
    expect(fleet.listUnreachableMachines()).toEqual([]);
    expect(laptop.closed).toEqual(['m2']);
    expect(studio.closed).toEqual([]);
    fleet.removeMachine('m2');
    expect(laptop.closed).toEqual(['m2']);
    expect(unreachable.listUnreachableMachines()).toEqual([{ id: 'm3', name: 'Build box' }]);
    unreachable.removeMachine('m3');
    expect(unreachable.listUnreachableMachines()).toEqual([]);
  });

  it('closes a machine that no longer accepts this browser, and every machine when the fleet closes', () => {
    const { fleet, studio, laptop } = createFleet();
    fleet.removeMember('m2');
    expect(laptop.closed).toEqual(['m2']);
    fleet.close();
    expect(studio.closed).toEqual(['m1']);
    expect(laptop.closed).toEqual(['m2']);
  });

  it('keeps the account’s machines this device cannot reach, to show them disabled', () => {
    const studio = createMember('m1', 'Studio');
    const fleet = new Fleet([studio.member], [{ id: 'm3', name: 'Build box' }]);
    expect(fleet.listUnreachableMachines()).toEqual([{ id: 'm3', name: 'Build box' }]);
  });

  it('lists each machine with its own remote access, kept until one changes', () => {
    const { fleet, studio, laptop } = createFleet();
    const remote = { requests: [] } as unknown as RemoteSnapshot;
    studio.connection.remote = remote;
    const first = fleet.listMachineAccess();
    expect(first).toEqual([
      { id: 'm1', name: 'Studio', remote },
      { id: 'm2', name: 'Laptop', remote: null },
    ]);
    expect(fleet.listMachineAccess()).toBe(first);
    laptop.connection.remote = remote;
    expect(fleet.listMachineAccess()[1]?.remote).toBe(remote);
  });

  it('sends a request naming a machine to that machine', () => {
    const merged = mergeFleetStates([
      { id: 'm1', state: createWire(1) },
      { id: 'm2', state: createWire(1) },
    ]);
    const url = new URL('https://app.shinsa.dev/api/remote/requests/accept?machine=m2');
    expect(resolveRequestOwner(url, merged?.owners ?? new Map())).toBe('m2');
  });

  it('reads accounts and remote access from the first machine, and is quiet while any machine has its desktop app open', () => {
    const { fleet, studio, laptop } = createFleet();
    const accounts = { accounts: [] } as unknown as AccountsSnapshot;
    const remote = { devices: [] } as unknown as RemoteSnapshot;
    fleet.replaceAccounts(accounts);
    fleet.replaceRemote(remote);
    expect(fleet.selectAccounts()).toBe(accounts);
    expect(fleet.selectRemote()).toBe(remote);
    expect(studio.connection.accounts).toBe(accounts);
    expect(studio.connection.remote).toBe(remote);
    expect(fleet.isDesktopConnected()).toBe(false);
    laptop.connection.desktop = true;
    expect(fleet.isDesktopConnected()).toBe(true);
    let heard = 0;
    for (const subscribe of [
      fleet.subscribeTranscripts,
      fleet.subscribeAccounts,
      fleet.subscribeSurfaces,
      fleet.subscribeTerminals,
      fleet.subscribeRemote,
    ])
      subscribe(() => {
        heard += 1;
      });
    laptop.connection.push(laptop.connection.current);
    expect(heard).toBe(5);
  });

  it('lists every machine’s services and terminals, keeps the list until one changes, and puts an answer back on its machine', () => {
    const { fleet, studio, laptop } = createFleet();
    expect(fleet.selectTerminals()).toBeNull();
    studio.connection.terminals = createTerminals('/Users/mona', ['web'], ['t1']);
    expect(fleet.selectTerminals()).toBe(studio.connection.terminals);
    laptop.connection.terminals = createTerminals('/Users/kai', ['api']);
    const merged = fleet.selectTerminals();
    expect(merged).toEqual({
      home: '/Users/mona',
      services: [{ id: 'web' }, { id: 'api' }],
      terminals: [{ id: 't1' }],
    } as unknown as TerminalsSnapshot);
    expect(fleet.selectTerminals()).toBe(merged);
    const answer = createTerminals('/Users/kai', ['api', 'docs']);
    fleet.replaceTerminals(answer);
    expect(laptop.connection.terminals).toBe(answer);
    const unknown = createTerminals('/Users/kai', []);
    fleet.replaceTerminals(unknown);
    expect([studio.connection.terminals, laptop.connection.terminals]).not.toContain(unknown);
  });

  it('opens a terminal on the machine that runs it, only on a machine you own', () => {
    const { fleet, studio, laptop } = createFleet();
    laptop.connection.push({
      state: createWire(7, {
        ...laptop.connection.current.state,
        projects: { 'p-laptop': { id: 'p-laptop' } as WireState['projects'][string] },
      }),
      status: 'open',
    });
    studio.connection.terminals = createTerminals('/Users/mona', [], ['t1']);
    laptop.connection.terminals = createTerminals('/Users/kai', [], ['t2']);
    const opened: string[] = [];
    laptop.member.openTerminal = (terminalId) => {
      opened.push(terminalId);
      return new EventTarget() as unknown as WebSocket;
    };
    laptop.connection.engine = { ...resolveEngineInfo('1.2.0'), features: [] };
    expect(fleet.canOpenTerminals('p-laptop')).toBe(false);
    laptop.connection.engine = resolveEngineInfo('1.2.0');
    expect(fleet.canOpenTerminals('p-laptop')).toBe(true);
    expect(fleet.canOpenTerminals('p-studio')).toBe(false);
    expect(fleet.resolveTerminalTransport('t1')).toBeNull();
    const transport = fleet.resolveTerminalTransport('t2');
    expect(transport).not.toBeNull();
    const open = Effect.runSync(
      Effect.provide(Socket.WebSocketConstructor.use(Effect.succeed), transport as SocketTransport)
    );
    open('ws://ignored');
    expect(opened).toEqual(['t2']);
  });

  it('sends a service’s request to the machine that runs it, by its id or the project in its body', async () => {
    const { fleet, studio, laptop } = createFleet();
    laptop.connection.push({
      state: createWire(7, {
        ...laptop.connection.current.state,
        projects: { 'p-laptop': { id: 'p-laptop' } as WireState['projects'][string] },
      }),
      status: 'open',
    });
    studio.connection.terminals = createTerminals('/Users/mona', ['svc-web']);
    laptop.connection.terminals = createTerminals('/Users/kai', ['svc-api'], ['t2']);
    const post = (path: string, body: unknown, type = 'application/json') =>
      fleet.fetch(
        new Request(`https://app.shinsa.dev${path}`, {
          method: 'POST',
          headers: { 'content-type': type },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        })
      );
    expect(await (await post('/api/services/svc-api/start', null)).text()).toBe('Laptop');
    expect(await (await post('/api/services/svc-web/stop', null)).text()).toBe('Studio');
    expect(await (await post('/api/services/start-all', { projectId: 'p-laptop' })).text()).toBe('Laptop');
    expect(await (await post('/api/services/remove', { ids: ['svc-api'] })).text()).toBe('Laptop');
    expect(await (await post('/api/services/batch', 'not json')).text()).toBe('Studio');
    expect(await (await post('/api/services/batch', { projectId: 'p-laptop' }, 'text/plain')).text()).toBe(
      'Studio'
    );
    expect(await (await post('/api/terminals/t2/close', null)).text()).toBe('Laptop');
  });

  it('starts, flushes and resets every machine, and drops one that no longer accepts this browser', async () => {
    const { fleet, studio, laptop } = createFleet();
    fleet.start();
    fleet.flush();
    fleet.reset();
    expect(studio.connection.calls).toEqual(['start', 'flush', 'reset']);
    expect(laptop.connection.calls).toEqual(['start', 'flush', 'reset']);
    fleet.removeMember('m2');
    fleet.removeMember('m2');
    expect(fleet.members).toEqual([{ id: 'm1', name: 'Studio', current: false }]);
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {})).toEqual(['task-studio']);
    fleet.close();
    expect(fleet.snapshot()).toEqual({ state: null, status: 'closed' });
    await expect(fleet.command({ type: 'settings.change', patch: {} })).rejects.toThrow(
      'No machine is connected.'
    );
    await expect(fleet.fetch(new Request('https://shinsa.dev/api/health'))).rejects.toThrow(
      'No machine is connected.'
    );
    expect(fleet.selectTranscript('run')).toEqual([]);
    expect(fleet.selectAccounts()).toBeNull();
    expect(fleet.selectTerminals()).toBeNull();
    expect(fleet.selectRemote()).toBeNull();
    fleet.replaceRemote({ devices: [] } as unknown as RemoteSnapshot);
    fleet.replaceAccounts(null);
    fleet.replaceTerminals(createTerminals('/Users/mona', ['web']));
    fleet.watchTranscript('run')();
    fleet.requestTaskDetail('task');
    fleet.watchTaskDetail('task')();
  });

  it('merges every machine’s teammates’ tasks with the browser’s own, kept until one of them changes', () => {
    const studio = createMember('m1', 'Studio');
    const laptop = createMember('m2', 'Laptop');
    const hosted = { feed: NO_TEAM_FEED as TeamFeedSnapshot, signal: createSignal() };
    const fleet = new Fleet([studio.member, laptop.member], [], {
      subscribe: (listener) => hosted.signal.subscribe(listener),
      snapshot: () => hosted.feed,
    });
    let published = 0;
    fleet.subscribeTeams(() => {
      published += 1;
    });
    expect(fleet.selectTeams()).toBe(NO_TEAM_FEED);
    const machine = {
      teamId: 'team1',
      instanceId: 'p7m2',
      name: 'Kai’s Mac',
      userId: '7',
      status: 'live' as const,
      reason: null,
    };
    studio.connection.teams = { machines: [machine], tasks: [] };
    studio.connection.signal.publish();
    const merged = fleet.selectTeams();
    expect(merged.machines).toEqual([machine]);
    expect(fleet.selectTeams()).toBe(merged);
    hosted.feed = { machines: [{ ...machine, instanceId: 'q1' }], tasks: [] };
    hosted.signal.publish();
    expect(fleet.selectTeams().machines.map((entry) => entry.instanceId)).toEqual(['p7m2', 'q1']);
    expect(published).toBe(2);
    expect(new Fleet([laptop.member]).selectTeams()).toBe(NO_TEAM_FEED);
  });
});

describe('a machine that handed you one task', () => {
  it('comes after your own machines, is marked as handed, and refuses what it does not let you send', async () => {
    const handed = createMember('m3', 'Mona’s Studio');
    const own = createMember('m1', 'Studio');
    const LEE = { id: 'u1', login: 'lee', name: 'Lee Park', avatarUrl: null };
    const fleet = new Fleet([{ ...handed.member, guest: true, handedBy: LEE }, own.member]);
    const handedTask = createTask({ id: 'task-handed', title: 'Handed over' });
    handed.connection.engine = resolveScopedEngineInfo('1.2.0', { kind: 'task', taskId: 'handed' });
    handed.connection.push({
      state: createWire(2, { tasks: { [handedTask.id]: handedTask } }),
      status: 'open',
    });
    own.connection.push({ state: createWire(3), status: 'open' });
    expect(fleet.members.map((member) => member.id)).toEqual(['m1', 'm3']);
    expect(fleet.listMachines().map((machine) => [machine.id, machine.guest ?? false])).toEqual([
      ['m1', false],
      ['m3', true],
    ]);
    expect(fleet.selectMachine('task-handed')).toMatchObject({ id: 'm3', guest: true, handedBy: LEE });
    expect(fleet.command({ type: 'task.share', taskId: 'task-handed', limit: 'day' })).rejects.toThrow(
      SCOPE_MESSAGES.command
    );
    await fleet.command({ type: 'task.message', taskId: 'task-handed', text: 'Go on.' });
    expect(handed.connection.commands.map((command) => command.type)).toEqual(['task.message']);
  });
});

describe('a teammate’s machine reached through a team', () => {
  const MONA = { id: 'u2', login: 'mona', name: 'Mona Lisa', avatarUrl: null };
  const KAI = { id: 'u3', login: 'kai', name: 'Kai Tan', avatarUrl: null };
  const SCOPES = toggleScope(DEFAULT_TEAM_SCOPES, 'share', false);

  function createTeamFleet() {
    const theirs = createMember('m4', 'Mona’s Studio');
    const own = createMember('m1', 'Studio');
    const fleet = new Fleet([
      { ...theirs.member, teammate: { owner: MONA, viewerId: KAI.id, scopes: [] } },
      own.member,
    ]);
    const open = createTask({ id: 'task-theirs', title: 'Theirs' });
    const held = createTask({
      id: 'task-held',
      title: 'Taken over',
      handoff: { at: 1, url: null, guest: KAI, claimedAt: 1, teamId: 'team-1' },
    });
    theirs.connection.engine = resolveScopedEngineInfo('1.2.0', {
      kind: 'team',
      teamId: 'team-1',
      scopes: SCOPES,
    });
    theirs.connection.push({
      state: createWire(2, {
        tasks: { [open.id]: open, [held.id]: held },
        repos: { 'repo-theirs': { id: 'repo-theirs' } as WireState['repos'][string] },
        projects: { 'project-theirs': { id: 'project-theirs' } as WireState['projects'][string] },
        presence: { '10': 4 },
      }),
      status: 'open',
    });
    own.connection.push({ state: createWire(3, { presence: { '10': 1 } }), status: 'open' });
    return { fleet, theirs, own };
  }

  it('comes after your own machines and is marked with whose it is', () => {
    const { fleet } = createTeamFleet();
    expect(fleet.members.map((member) => member.id)).toEqual(['m1', 'm4']);
    expect(
      fleet.listMachines().map((machine) => [machine.id, machine.teammate?.owner.login ?? null])
    ).toEqual([
      ['m1', null],
      ['m4', 'mona'],
    ]);
    expect(fleet.selectMachine('task-theirs')).toMatchObject({ id: 'm4', teammate: { owner: MONA } });
  });

  it('opens their tasks as full pages, but keeps in your lists only what you took over', () => {
    const { state } = createTeamFleet().fleet.snapshot();
    expect(Object.keys(state?.tasks ?? {}).sort()).toEqual(['task-held', 'task-theirs']);
    expect(state?.teammateTasks).toEqual({ 'task-theirs': true });
    expect(state?.teammateRepos).toEqual({ 'repo-theirs': true });
    expect(state?.repos['repo-theirs']).toBeDefined();
    expect(state?.projects['project-theirs']).toBeUndefined();
    expect(state?.presence).toEqual({ '10': 1 });
  });

  it('marks a lone teammate machine’s tasks too', () => {
    const theirs = createMember('m4', 'Mona’s Studio');
    const fleet = new Fleet([{ ...theirs.member, teammate: { owner: MONA, viewerId: KAI.id, scopes: [] } }]);
    theirs.connection.push({
      state: createWire(1, { tasks: { t: createTask({ id: 't' }) } }),
      status: 'open',
    });
    expect(fleet.snapshot().state?.teammateTasks).toEqual({ t: true });
    expect(fleet.selectMachine('t')).toMatchObject({ teammate: { owner: MONA } });
  });

  it('refuses with the team’s words what the machine does not let a teammate send', async () => {
    const { fleet, theirs } = createTeamFleet();
    expect(fleet.command({ type: 'task.share', taskId: 'task-theirs', limit: 'day' })).rejects.toThrow(
      TEAM_SCOPE_MESSAGES.command
    );
    await fleet.command({ type: 'task.give_back', taskId: 'task-theirs' });
    expect(theirs.connection.commands.map((command) => command.type)).toEqual(['task.give_back']);
  });
});
