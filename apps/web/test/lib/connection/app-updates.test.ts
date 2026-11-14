import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  createAppUpdatesActions,
  refreshAppUpdates,
  resetAppUpdates,
  selectAppUpdates,
  useAppUpdates,
} from '@/lib/connection/app-updates.ts';
import { createAppUpdatesAnswer } from '../../support/app-updates.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { answerFetch } from '../../support/fetch-fake.ts';

const RUNNING = createAppUpdatesAnswer();

const READY = createAppUpdatesAnswer({
  app: { version: '1.4.0', protocol: 1, channel: 'stable', update: { status: 'ready', version: '1.5.0' } },
});

let routes: Record<string, () => Response> = {};

let requests: ReturnType<typeof answerFetch> = [];

beforeEach(() => {
  resetAppUpdates();
  routes = {};
  requests = answerFetch((request) => {
    const route = routes[`${request.method} ${request.path}`];
    return route
      ? route()
      : Response.json(
          { error: { code: 'app_not_running', message: 'That machine is offline.' } },
          { status: 400 }
        );
  });
});

afterEach(() => {
  act(() => resetAppUpdates());
});

function listPaths() {
  return requests.map((request) => `${request.method} ${request.path}`);
}

describe('reading a machine’s updates', () => {
  it('reads the local engine while the section is open, and stops once it closes', async () => {
    routes['GET /api/app-updates'] = () => Response.json(RUNNING);
    const { result, unmount } = renderHook(() => useAppUpdates(null));
    await waitFor(() => expect(result.current.answer).toEqual(RUNNING));
    unmount();
    const read = requests.length;
    await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    expect(requests).toHaveLength(read);
  });

  it('reads nothing while inactive', () => {
    renderHook(() => useAppUpdates(null, false));
    expect(requests).toHaveLength(0);
  });

  it('reads each machine through its own engine and keeps them apart', async () => {
    routes['GET /api/app-updates?machine=studio'] = () => Response.json(READY);
    await refreshAppUpdates('studio');
    await refreshAppUpdates('laptop');
    expect(selectAppUpdates('studio').answer).toEqual(READY);
    expect(selectAppUpdates('laptop')).toEqual({
      answer: null,
      failure: 'That machine is offline.',
      busy: null,
    });
    expect(selectAppUpdates(null).answer).toBeNull();
  });
});

describe('acting on a machine’s app', () => {
  it('sends each request to that machine and shows what its engine answers', async () => {
    routes['POST /api/app-updates/request?machine=studio'] = () => Response.json(READY);
    const actions = createAppUpdatesActions('studio');
    await actions.check();
    await actions.install();
    await actions.changeChannel('beta');
    await actions.answerDowngrade(false);
    expect(requests.map((request) => request.body)).toEqual([
      { kind: 'check' },
      { kind: 'install' },
      { kind: 'channel', channel: 'beta' },
      { kind: 'downgrade', accept: false },
    ]);
    expect(selectAppUpdates('studio')).toEqual({ answer: READY, failure: null, busy: null });
  });

  it('opens the app and restarts the engine, then reads the machine again', async () => {
    routes['POST /api/app-updates/open'] = () => Response.json(RUNNING);
    routes['POST /api/engine/restart'] = () => Response.json({ restarting: true });
    routes['GET /api/app-updates'] = () => Response.json(RUNNING);
    const actions = createAppUpdatesActions(null);
    await actions.open();
    await actions.restartEngine();
    expect(listPaths()).toEqual([
      'POST /api/app-updates/open',
      'POST /api/engine/restart',
      'GET /api/app-updates',
    ]);
    expect(requests[1]?.body).toEqual({ when: 'now' });
    expect(selectAppUpdates(null).answer).toEqual(RUNNING);
  });

  it('toasts a refusal and sends nothing more while a request is under way', async () => {
    const toasts = spyOnToasts();
    const actions = createAppUpdatesActions('studio');
    const first = actions.check();
    expect(selectAppUpdates('studio').busy).toBe('check');
    await actions.install();
    await first;
    expect(requests).toHaveLength(1);
    expect(toasts.error).toHaveBeenCalledWith('That machine is offline.');
    expect(selectAppUpdates('studio').busy).toBeNull();
  });
});
