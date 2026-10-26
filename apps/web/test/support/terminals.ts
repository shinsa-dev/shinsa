import { SHINSA_APPEARANCE, type TerminalInfo, type TerminalsSnapshot } from '@shinsa/core';
import { createProject, createRepo, createShinsaState, createTask, NOW } from './state.ts';

export function createTerminal(overrides: Partial<TerminalInfo> & { id: string }): TerminalInfo {
  return {
    projectId: 'shop',
    name: null,
    title: null,
    cwd: '/Users/you/Developer/web',
    place: 'repository',
    taskId: null,
    status: 'running',
    exitCode: null,
    startedAt: NOW - 60_000,
    endedAt: null,
    ...overrides,
  };
}

export function createTerminalsSnapshot(terminals: TerminalInfo[] = []): TerminalsSnapshot {
  return { terminals, appearance: { ...SHINSA_APPEARANCE }, home: '/Users/you' };
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
