import { describe, expect, it } from 'bun:test';
import {
  isServiceActive,
  isServiceEnvKey,
  isServicePreviewUrl,
  listProjectServices,
  listServiceTaskRuns,
  listTaskServices,
  resolveServiceState,
  resolveServicesSummary,
  resolveServiceUrl,
  resolveServiceView,
  resolveTaskServiceCwd,
  SERVICE_LIMITS,
  type ServiceDefinition,
  type ShinsaState,
  selectService,
  selectServiceTerminal,
  type Task,
  type TerminalInfo,
  type TerminalsSnapshot,
} from '../../src/index.ts';

function service(id: string, extra: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    id,
    projectId: 'p1',
    name: id,
    cwd: `/code/${id}`,
    command: 'bun dev',
    env: {},
    previewUrl: null,
    portVariable: 'PORT',
    ...extra,
  };
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
    port: null,
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

function task(id: string, extra: Partial<Task>) {
  return {
    id,
    title: id,
    stage: 'building',
    handle: null,
    repoId: 'web',
    worktreePath: `/wt/${id}`,
    ...extra,
  } as Task;
}

const STATE = {
  repos: {
    web: { id: 'web', name: 'web', path: '/code/web/', projectId: 'p1' },
    other: { id: 'other', name: 'other', path: '/code/other', projectId: 'p2' },
  },
  projects: {
    p1: { id: 'p1', name: 'Shop', folders: ['/notes'] },
    p2: { id: 'p2', name: 'Other', folders: [] },
  },
  tasks: {},
} as unknown as ShinsaState;

const WEB = service('web', { cwd: '/code/web' });
const ADMIN = service('admin', { cwd: '/code/web/apps/admin/' });
const NOTES = service('notes', { cwd: '/notes' });
const SIBLING = service('sibling', { cwd: '/code/website' });

describe('resolveTaskServiceCwd', () => {
  it('runs a service in the same folder of the task’s worktree', () => {
    expect(resolveTaskServiceCwd(STATE, WEB, task('a', {}))).toBe('/wt/a');
    expect(resolveTaskServiceCwd(STATE, ADMIN, task('a', { worktreePath: '/wt/a/' }))).toBe(
      '/wt/a/apps/admin'
    );
  });

  it('has no folder outside the task’s repository, in another project, or for a task with no worktree of its own', () => {
    expect(resolveTaskServiceCwd(STATE, NOTES, task('a', {}))).toBeNull();
    expect(resolveTaskServiceCwd(STATE, SIBLING, task('a', {}))).toBeNull();
    expect(resolveTaskServiceCwd(STATE, WEB, task('a', { repoId: 'other' }))).toBeNull();
    expect(resolveTaskServiceCwd(STATE, WEB, task('a', { repoId: null }))).toBeNull();
    expect(resolveTaskServiceCwd(STATE, WEB, task('a', { worktreePath: null }))).toBeNull();
    expect(resolveTaskServiceCwd(STATE, WEB, task('a', { worktreePath: '/code/web' }))).toBeNull();
    expect(resolveTaskServiceCwd(STATE, WEB, task('a', { stage: 'merged' }))).toBeNull();
  });
});

describe('task runs', () => {
  const snapshot: TerminalsSnapshot = {
    services: [WEB, ADMIN, NOTES],
    terminals: [
      terminal({ id: 'main', serviceId: 'web', startedAt: 0 }),
      terminal({ id: 'a-web', serviceId: 'web', taskId: 'a', startedAt: 0 }),
      terminal({ id: 'b-web', serviceId: 'web', taskId: 'b', status: 'exited', exitCode: 1, endedAt: 4 }),
      terminal({ id: 'shell', taskId: 'a' }),
    ],
    home: '/home',
  };

  it('keeps the main run apart from each task’s run', () => {
    expect(selectServiceTerminal(snapshot, 'web', null)?.id).toBe('main');
    expect(selectServiceTerminal(snapshot, 'web', 'a')?.id).toBe('a-web');
    expect(selectServiceTerminal(snapshot, 'admin', 'a')).toBeNull();
    expect(
      listProjectServices(snapshot, 'p1', LATER).map((view) => [
        view.service.id,
        view.taskId,
        view.terminal?.id ?? null,
      ])
    ).toEqual([
      ['web', null, 'main'],
      ['admin', null, null],
      ['notes', null, null],
    ]);
  });

  it('lists the services a task can run, each with its folder in the worktree and its run', () => {
    const views = listTaskServices(STATE, snapshot, task('a', {}), LATER);
    expect(
      views.map((view) => [view.service.id, view.taskId, view.cwd, view.terminal?.id ?? null, view.state])
    ).toEqual([
      ['web', 'a', '/wt/a', 'a-web', 'running'],
      ['admin', 'a', '/wt/a/apps/admin', null, 'stopped'],
    ]);
    expect(listTaskServices(STATE, null, task('a', {}), LATER)).toEqual([]);
    expect(
      listTaskServices(
        STATE,
        { terminals: [], home: '/home' } as unknown as TerminalsSnapshot,
        task('a', {}),
        LATER
      )
    ).toEqual([]);
  });

  it('lists every task’s run of a service', () => {
    expect(listServiceTaskRuns(snapshot, 'web', LATER).map((view) => [view.taskId, view.state])).toEqual([
      ['a', 'running'],
      ['b', 'failed'],
    ]);
    expect(listServiceTaskRuns(snapshot, 'gone', LATER)).toEqual([]);
    expect(listServiceTaskRuns(null, 'web', LATER)).toEqual([]);
  });

  it('takes the task from the run, or the one it is asked for', () => {
    expect(resolveServiceView(WEB, null, 0).taskId).toBeNull();
    expect(resolveServiceView(WEB, null, 0, 'a').taskId).toBe('a');
  });
});

describe('resolveServiceUrl', () => {
  const preview = service('web', { previewUrl: 'http://localhost:{port}/tasks/SW-17' });

  it('puts the run’s port into the preview URL', () => {
    expect(resolveServiceUrl(preview, terminal({ port: 4123 }))).toBe('http://localhost:4123/tasks/SW-17');
    expect(resolveServiceView(preview, terminal({ port: 4123 }), LATER).url).toBe(
      'http://localhost:4123/tasks/SW-17'
    );
  });

  it('has no URL without a preview URL, or without a port to put in it', () => {
    expect(resolveServiceUrl(service('api'), terminal({ port: 4123 }))).toBeNull();
    expect(resolveServiceUrl(preview, terminal({}))).toBeNull();
    expect(resolveServiceUrl(preview, null)).toBeNull();
  });
});

describe('isServicePreviewUrl', () => {
  it('takes an http or https URL with the port placeholder', () => {
    expect(
      ['http://localhost:{port}/a', 'https://shop.test:{port}', 'http://127.0.0.1:{port}'].map(
        isServicePreviewUrl
      )
    ).toEqual([true, true, true]);
  });

  it('refuses a URL with no port placeholder, which would point every run at one server', () => {
    expect(['http://localhost:3000', 'https://shop.test/start'].map(isServicePreviewUrl)).toEqual([
      false,
      false,
    ]);
  });

  it('refuses anything else', () => {
    expect(
      ['localhost:{port}', 'file:///etc/hosts', 'javascript:alert(1)', '', 'not a url at {port}'].map(
        isServicePreviewUrl
      )
    ).toEqual([false, false, false, false, false]);
  });
});
