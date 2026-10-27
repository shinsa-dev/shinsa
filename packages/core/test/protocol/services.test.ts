import { describe, expect, it } from 'bun:test';
import {
  isServiceActive,
  isServiceEnvKey,
  listProjectServices,
  resolveServiceState,
  resolveServicesSummary,
  SERVICE_LIMITS,
  type ServiceDefinition,
  selectService,
  type TerminalInfo,
  type TerminalsSnapshot,
} from '../../src/index.ts';

function service(id: string, extra: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return { id, projectId: 'p1', name: id, cwd: `/code/${id}`, command: 'bun dev', env: {}, ...extra };
}

function terminal(extra: Partial<TerminalInfo>): TerminalInfo {
  return {
    id: 't',
    projectId: 'p1',
    name: null,
    title: null,
    cwd: '/code',
    place: 'repository',
    taskId: null,
    serviceId: null,
    status: 'running',
    exitCode: null,
    startedAt: 0,
    endedAt: null,
    ...extra,
  };
}

const LATER = SERVICE_LIMITS.startingMs + 1;

describe('resolveServiceState', () => {
  it('is stopped with no terminal, starting for its first seconds, then running', () => {
    expect(resolveServiceState(null, 0)).toBe('stopped');
    expect(resolveServiceState(terminal({}), 1)).toBe('starting');
    expect(resolveServiceState(terminal({}), LATER)).toBe('running');
  });

  it('tells a clean exit from a failure, and counts a stop or an interrupt as stopped', () => {
    expect(resolveServiceState(terminal({ status: 'exited', exitCode: 0 }), LATER)).toBe('exited');
    expect(resolveServiceState(terminal({ status: 'exited', exitCode: 1 }), LATER)).toBe('failed');
    expect(resolveServiceState(terminal({ status: 'exited', exitCode: null }), LATER)).toBe('failed');
    expect(resolveServiceState(terminal({ status: 'exited', exitCode: 130 }), LATER)).toBe('stopped');
    expect(resolveServiceState(terminal({ status: 'stopped' }), LATER)).toBe('stopped');
  });
});

describe('listProjectServices', () => {
  const snapshot: TerminalsSnapshot = {
    services: [service('api'), service('web'), service('other', { projectId: 'p2' })],
    terminals: [
      terminal({ id: 'a', serviceId: 'api', startedAt: 5 }),
      terminal({ id: 'w', serviceId: 'web', status: 'exited', exitCode: 2, endedAt: 9 }),
      terminal({ id: 'shell' }),
    ],
    home: '/home',
  };

  it('pairs each of the project’s services with its terminal and how long it has been so', () => {
    const views = listProjectServices(snapshot, 'p1', LATER + 5);
    expect(views.map((view) => [view.service.id, view.terminal?.id, view.state, view.since])).toEqual([
      ['api', 'a', 'running', 5],
      ['web', 'w', 'failed', 9],
    ]);
    expect(views[1]?.exitCode).toBe(2);
    expect(listProjectServices(snapshot, 'p2', 0)[0]).toMatchObject({ terminal: null, since: null });
    expect(listProjectServices(null, 'p1', 0)).toEqual([]);
    expect(listProjectServices(snapshot, null, 0)).toEqual([]);
  });

  it('lists none for a snapshot that carries no services', () => {
    const terminalsOnly = {
      terminals: [terminal({ id: 'shell' })],
      home: '/home',
    } as unknown as TerminalsSnapshot;
    expect(listProjectServices(terminalsOnly, 'p1', 0)).toEqual([]);
  });

  it('sums the states for the header and says which ones still run', () => {
    const views = listProjectServices(snapshot, 'p1', LATER + 5);
    expect(resolveServicesSummary(views)).toEqual({ total: 2, running: 1, starting: 0, failed: 1 });
    expect(views.map(isServiceActive)).toEqual([true, false]);
  });

  it('finds a service by id or by name within a project', () => {
    expect(selectService(snapshot, 'API', 'p1')?.id).toBe('api');
    expect(selectService(snapshot, 'web', null)?.id).toBe('web');
    expect(selectService(snapshot, 'other', 'p1')).toBeNull();
    expect(selectService(snapshot, 'other', null)?.id).toBe('other');
  });
});

describe('isServiceEnvKey', () => {
  it('takes the names a shell can export', () => {
    expect(['PORT', '_X', 'a1'].map(isServiceEnvKey)).toEqual([true, true, true]);
    expect(['1A', 'A-B', ''].map(isServiceEnvKey)).toEqual([false, false, false]);
  });
});
