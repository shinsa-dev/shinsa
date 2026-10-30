import { describe, expect, it } from 'bun:test';
import type { AccountsSnapshot, ChatEntry, TerminalsSnapshot, UserCommand, WireState } from '@shinsa/core';
import { createState } from '@shinsa/core';
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
import { createSignal } from '@/lib/signal.ts';
import { resolveCanonicalTaskPath, resolveTaskPath } from '@/router.ts';
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
  desktop = false;
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
  selectMachine = () => null;
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

describe('merging the state of several Macs', () => {
  it('links a task by its id when another Mac has a task with the same handle', () => {
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

  it('puts every Mac’s tasks in one state, keeps the first Mac’s settings and knows who owns what', () => {
    const { fleet } = createFleet();
    const { state } = fleet.snapshot();
    expect(Object.keys(state?.tasks ?? {}).sort()).toEqual(['task-laptop', 'task-studio']);
    expect(state?.seq).toBe(10);
    expect(fleet.selectMachine('task-laptop')).toEqual({ id: 'm2', name: 'Laptop' });
    expect(fleet.selectMachine('task-studio')).toEqual({ id: 'm1', name: 'Studio' });
    expect(fleet.selectMachine('nothing')).toBeNull();
    expect(fleet.members).toEqual([
      { id: 'm1', name: 'Studio' },
      { id: 'm2', name: 'Laptop' },
    ]);
  });

  it('hands back the one Mac’s state as it is, and nothing while no Mac has answered', () => {
    const only = createWire(1);
    expect(mergeFleetStates([{ id: 'm1', state: only }])?.state).toBe(only);
    expect(mergeFleetStates([])).toBeNull();
  });

  it('is open when any Mac is, connecting while one still tries, and closed otherwise', () => {
    expect(resolveFleetStatus(['closed', 'open'])).toBe('open');
    expect(resolveFleetStatus(['closed', 'connecting'])).toBe('connecting');
    expect(resolveFleetStatus(['closed'])).toBe('closed');
    expect(resolveFleetStatus([])).toBe('closed');
  });

  it('keeps the same snapshot until a Mac sends something new, and tells its listeners when one does', () => {
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

  it('shows no Mac on a task while there is only one Mac', () => {
    const studio = createMember('m1', 'Studio');
    const fleet = new Fleet([studio.member]);
    studio.connection.push({
      state: createWire(1, { tasks: { t: createTask({ id: 't' }) } }),
      status: 'open',
    });
    expect(fleet.selectMachine('t')).toBeNull();
  });
});

describe('sending to the Mac that owns it', () => {
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

  it('sends a command, a transcript and a request to the Mac that owns them, and the rest to the first Mac', async () => {
    const { fleet, studio, laptop } = createFleet();
    await fleet.command({ type: 'task.cancel', taskId: 'task-laptop' });
    await fleet.command({ type: 'settings.change', patch: {} });
    expect(laptop.connection.commands.map((command) => command.type)).toEqual(['task.cancel']);
    expect(studio.connection.commands.map((command) => command.type)).toEqual(['settings.change']);
    fleet.watchTranscript('run-laptop')();
    expect(laptop.connection.watched).toEqual(['run-laptop']);
    laptop.connection.transcript = [{ kind: 'note' } as unknown as ChatEntry];
    expect(fleet.selectTranscript('run-laptop')).toHaveLength(1);
    expect(await (await fleet.fetch(new Request('https://shinsa.dev/api/tasks/task-laptop'))).text()).toBe(
      'Laptop'
    );
    expect(await (await fleet.fetch(new Request('https://shinsa.dev/api/health'))).text()).toBe('Studio');
  });

  it('reads accounts and terminals from the first Mac, and is quiet while any Mac has its desktop app open', () => {
    const { fleet, studio, laptop } = createFleet();
    const accounts = { accounts: [] } as unknown as AccountsSnapshot;
    const terminals = { terminals: [] } as unknown as TerminalsSnapshot;
    fleet.replaceAccounts(accounts);
    fleet.replaceTerminals(terminals);
    expect(fleet.selectAccounts()).toBe(accounts);
    expect(fleet.selectTerminals()).toBe(terminals);
    expect(studio.connection.accounts).toBe(accounts);
    expect(fleet.isDesktopConnected()).toBe(false);
    laptop.connection.desktop = true;
    expect(fleet.isDesktopConnected()).toBe(true);
    let heard = 0;
    for (const subscribe of [
      fleet.subscribeTranscripts,
      fleet.subscribeAccounts,
      fleet.subscribeSurfaces,
      fleet.subscribeTerminals,
    ])
      subscribe(() => {
        heard += 1;
      });
    laptop.connection.push(laptop.connection.current);
    expect(heard).toBe(4);
  });

  it('starts, flushes and resets every Mac, and drops one that no longer accepts this browser', async () => {
    const { fleet, studio, laptop } = createFleet();
    fleet.start();
    fleet.flush();
    fleet.reset();
    expect(studio.connection.calls).toEqual(['start', 'flush', 'reset']);
    expect(laptop.connection.calls).toEqual(['start', 'flush', 'reset']);
    fleet.removeMember('m2');
    fleet.removeMember('m2');
    expect(fleet.members).toEqual([{ id: 'm1', name: 'Studio' }]);
    expect(Object.keys(fleet.snapshot().state?.tasks ?? {})).toEqual(['task-studio']);
    fleet.close();
    expect(fleet.snapshot()).toEqual({ state: null, status: 'closed' });
    await expect(fleet.command({ type: 'settings.change', patch: {} })).rejects.toThrow(
      'No Mac is connected.'
    );
    await expect(fleet.fetch(new Request('https://shinsa.dev/api/health'))).rejects.toThrow(
      'No Mac is connected.'
    );
    expect(fleet.selectTranscript('run')).toEqual([]);
    expect(fleet.selectAccounts()).toBeNull();
    expect(fleet.selectTerminals()).toBeNull();
    fleet.replaceAccounts(null);
    fleet.replaceTerminals({ terminals: [] } as unknown as TerminalsSnapshot);
    fleet.watchTranscript('run')();
  });
});
