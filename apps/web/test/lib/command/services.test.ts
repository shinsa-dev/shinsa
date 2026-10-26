import { afterEach, describe, expect, it, mock } from 'bun:test';
import { SERVICE_LIMITS } from '@shinsa/core';
import { listServiceSections } from '@/lib/command/services.ts';
import { createProject, createShinsaState, NOW } from '../../support/state.ts';
import { createService, createTerminal, createTerminalsSnapshot } from '../../support/terminals.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const STATE = createShinsaState({
  projects: [
    createProject({ id: 'shop', name: 'Shop', key: 'SH' }),
    createProject({ id: 'docs', name: 'Docs', key: 'DO' }),
  ],
});

const LATER = NOW + SERVICE_LIMITS.startingMs + 1;

describe('listServiceSections', () => {
  it('has nothing without services', () => {
    expect(listServiceSections(STATE, createTerminalsSnapshot(), NOW)).toEqual([]);
    expect(listServiceSections(STATE, null, NOW)).toEqual([]);
  });

  it('starts, stops and restarts each service, and starts all of a project’s that are stopped', () => {
    const fetch = mock(async (_url: string) => Response.json(createTerminalsSnapshot()));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const snapshot = createTerminalsSnapshot(
      [createTerminal({ id: 'svc', serviceId: 'api', startedAt: NOW })],
      [
        createService({ id: 'api' }),
        createService({ id: 'web' }),
        createService({ id: 'worker' }),
        createService({ id: 'site', projectId: 'docs' }),
      ]
    );
    const [section] = listServiceSections(STATE, snapshot, LATER);
    const commands = section?.commands ?? [];
    expect(commands.map((command) => command.label)).toEqual([
      'Start all of Shop’s services',
      'Start site',
      'Restart api',
      'Stop api',
      'Start web',
      'Start worker',
    ]);
    for (const command of commands) if (command.kind === 'run') command.run();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/services/start-all',
      '/api/services/site/start',
      '/api/services/api/restart',
      '/api/services/api/stop',
      '/api/services/web/start',
      '/api/services/worker/start',
    ]);
    const focused = { ...STATE, focus: { projectId: 'shop', until: null } };
    expect(listServiceSections(focused, snapshot, LATER)[0]?.commands[0]?.label).toBe('Start all services');
  });
});
