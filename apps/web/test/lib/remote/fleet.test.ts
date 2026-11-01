import { describe, expect, it, mock } from 'bun:test';
import type {
  AccountsSnapshot,
  ChatEntry,
  EngineInfo,
  MachineResources,
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
  resolveScopedEngineInfo,
  SCOPE_MESSAGES,
} from '@shinsa/core';
import type { ShinsaConnection, Snapshot } from '@/lib/connection/socket.ts';
import {
  Fleet,
  type FleetMember,
  listSharedHandles,
  mergeFleetStates,
  resolveCommandOwner,
  resolveFleetStatus,
  resolveRequestOwner,
} from '@/lib/remote/fleet.ts';
import { describeOutdatedMachine } from '@/lib/remote/mode.ts';
import { createSignal } from '@/lib/signal.ts';
import { resolveCanonicalTaskPath, resolveTaskPath } from '@/router.ts';
import { createMachineResources } from '../../support/resources.ts';
import { createTask } from '../../support/state.ts';

function createWire(seq: number, records: Partial<WireState> = {}): WireState {
  return { ...(createState() as unknown as WireState), seq, ...records };
}

class FakeConnection implements ShinsaConnection {
  current: Snapshot = { state: null, status: 'connecting' };
  readonly commands: UserCommand[] = [];
  readonly watched: string[] = [];
  readonly calls: string[] = [];
  accounts: AccountsSnapshot | null = null;
  terminals: TerminalsSnapshot | null = null;
  resources: MachineResources | null = null;
  readonly resourcesSignal = createSignal();
  remote: RemoteSnapshot | null = null;
  teams: TeamFeedSnapshot = NO_TEAM_FEED;
  desktop = false;
  engine: EngineInfo | null = null;
  transcript: ChatEntry[] = [];
  readonly signal = createSignal();

  push(snapshot: Snapshot) {
    this.current = snapshot;
    this.signal.publish();
  }

  start = () => {
    this.calls.push('start');
  };
  subscribe = (listener: () => void) => this.signal.subscribe(listener);
  snapshot = () => this.current;
  subscribeTranscripts = (listener: () => void) => this.signal.subscribe(listener);
  selectTranscript = () => this.transcript;
  watchTranscript = (runId: string) => {
    this.watched.push(runId);
    return () => undefined;
  };
  readonly details: string[] = [];
  requestTaskDetail = (taskId: string) => {
    this.details.push(`request ${taskId}`);
  };
  watchTaskDetail = (taskId: string) => {
    this.details.push(`watch ${taskId}`);
    return () => undefined;
  };
  subscribeAccounts = (listener: () => void) => this.signal.subscribe(listener);
  selectAccounts = () => this.accounts;
  replaceAccounts = (accounts: AccountsSnapshot | null) => {
    this.accounts = accounts;
  };
  subscribeSurfaces = (listener: () => void) => this.signal.subscribe(listener);
  isDesktopConnected = () => this.desktop;
  subscribeTerminals = (listener: () => void) => this.signal.subscribe(listener);
  selectTerminals = () => this.terminals;
  replaceTerminals = (terminals: TerminalsSnapshot) => {
    this.terminals = terminals;
  };
  pushResources(resources: MachineResources | null) {
    this.resources = resources;
    this.resourcesSignal.publish();
  }
  subscribeResources = (listener: () => void) => this.resourcesSignal.subscribe(listener);
  selectResources = () => this.resources;
  subscribeRemote = (listener: () => void) => this.signal.subscribe(listener);
  selectRemote = () => this.remote;
  replaceRemote = (remote: RemoteSnapshot) => {
    this.remote = remote;
  };
  subscribeTeams = (listener: () => void) => this.signal.subscribe(listener);
  selectTeams = () => this.teams;
  selectMachine = () => null;
  listMachines = () => [];
  listUnreachableMachines = () => [];
  listMachineAccess = () => [];
  selectEngine = () => this.engine;
  command = (command: UserCommand) => {
    this.commands.push(command);
    return Promise.resolve();
  };
  reset = () => {
    this.calls.push('reset');
  };
  flush = () => {
    this.calls.push('flush');
  };
}

function createMember(id: string, name: string) {
  const connection = new FakeConnection();
  const requests: string[] = [];
  const member: FleetMember = {
    id,
    name,
    connection,
    fetch: (request) => {
      requests.push(new URL(request.url).pathname);
      return Promise.resolve(new Response(name));
    },
  };
  return { member, connection, requests };
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

  it('reads accounts, terminals and remote access from the first machine, and is quiet while any machine has its desktop app open', () => {
    const { fleet, studio, laptop } = createFleet();
    const accounts = { accounts: [] } as unknown as AccountsSnapshot;
    const terminals = { terminals: [] } as unknown as TerminalsSnapshot;
    const remote = { devices: [] } as unknown as RemoteSnapshot;
    fleet.replaceAccounts(accounts);
    fleet.replaceTerminals(terminals);
    fleet.replaceRemote(remote);
    expect(fleet.selectAccounts()).toBe(accounts);
    expect(fleet.selectTerminals()).toBe(terminals);
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
    fleet.replaceTerminals({ terminals: [] } as unknown as TerminalsSnapshot);
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
    handed.connection.engine = resolveScopedEngineInfo('1.2.0');
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
