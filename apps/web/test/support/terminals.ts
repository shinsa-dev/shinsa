import type { ServiceDefinition, TerminalInfo, TerminalsSnapshot } from '@shinsa/core';
import { createProject, createRepo, createShinsaState, createTask, NOW } from './state.ts';

export function createTerminal(overrides: Partial<TerminalInfo> & { id: string }): TerminalInfo {
  return {
    projectId: 'shop',
    name: null,
    title: null,
    cwd: '/Users/you/Developer/web',
    place: 'repository',
    taskId: null,
    serviceId: null,
    port: null,
    status: 'running',
    exitCode: null,
    startedAt: NOW - 60_000,
    endedAt: null,
    ...overrides,
  };
}

export function createTerminalsSnapshot(
  terminals: TerminalInfo[] = [],
  services: ServiceDefinition[] = []
): TerminalsSnapshot {
  return { terminals, services, home: '/Users/you' };
}

export function createService(overrides: Partial<ServiceDefinition> & { id: string }): ServiceDefinition {
  return {
    projectId: 'shop',
    name: overrides.id,
    cwd: `/Users/you/Developer/web/apps/${overrides.id}`,
    command: 'bun run dev',
    env: {},
    previewUrl: null,
    portVariable: 'PORT',
    ...overrides,
  };
}

export function createTerminalState() {
  return createShinsaState({
    projects: [
      createProject({ id: 'shop', name: 'Shop', key: 'SH', folders: ['/Users/you/notes'] }),
      createProject({ id: 'docs', name: 'Docs', key: 'DO' }),
    ],
    repos: [createRepo({ id: 'web', projectId: 'shop' }), createRepo({ id: 'api', projectId: 'shop' })],
    tasks: [
      createTask({
        id: 'fix',
        handle: 'SH-4',
        title: 'Fix the cart',
        repoId: 'web',
        stage: 'building',
        worktreePath: '/Users/you/.config/shinsa/data/worktrees/fix',
      }),
    ],
  });
}
