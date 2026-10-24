import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import type { ExtensionsSnapshot } from '@shinsa/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  checkServers,
  EXTENSION_ACTIONS,
  refreshExtensions,
  requestServerCheck,
  resetExtensions,
  SIGN_IN_CHANNEL,
  SIGN_IN_LIMIT_MS,
  SIGN_IN_POLL_MS,
  selectExtensions,
  signInServer,
  stopSignInWatch,
  useExtensions,
  useRefreshOnReturn,
  useServerCheck,
} from '@/lib/connection/extensions.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { createExtensions, createPlugin, createServer, createSkill } from '../../support/extensions.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';

const LINEAR = createServer({ id: 'linear' }, { state: 'needs_sign_in' });

const SNAPSHOT = createExtensions({
  servers: [LINEAR],
  skills: [createSkill({ id: 'review' })],
  plugins: [createPlugin({ id: 'stripe' })],
});

const SIGNED_IN = createExtensions({ servers: [{ ...LINEAR, signedIn: true }] });

const CONNECTED = createExtensions({
  servers: [{ ...LINEAR, signedIn: true, status: { ...LINEAR.status, state: 'connected', tokens: 900 } }],
});

const REFUSED = { status: 400, answer: { error: { code: 'bad', message: 'That server is not Shinsa’s.' } } };

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

let toasts: ReturnType<typeof spyOnToasts>;

class FakeChannel {
  static opened: FakeChannel[] = [];
  name: string;
  closed = false;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    FakeChannel.opened.push(this);
  }

  close() {
    this.closed = true;
  }

  post(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

const realChannel = globalThis.BroadcastChannel;

beforeEach(() => {
  resetExtensions();
  toasts = spyOnToasts();
  FakeChannel.opened = [];
  globalThis.BroadcastChannel = FakeChannel as unknown as typeof BroadcastChannel;
});

afterEach(() => {
  act(() => resetExtensions());
  fake?.stop();
  fake = null;
  toasts.restore();
  globalThis.BroadcastChannel = realChannel;
});

function serve(routes: Parameters<typeof startFakeOnboarding>[0]) {
  fake = startFakeOnboarding(routes);
  return fake;
}

function showPage(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

function bodiesTo(path: string) {
  return (fake?.requests ?? []).filter((request) => request.path === path).map((request) => request.body);
}

describe('the extensions snapshot', () => {
  it('reads the snapshot once while asked, then checks the servers once', async () => {
    const checked = { ...SNAPSHOT, servers: [{ ...LINEAR, status: { ...LINEAR.status, tokens: 900 } }] };
    serve({
      'GET /api/extensions': { answer: SNAPSHOT },
      'POST /api/extensions/check': { answer: checked },
    });
    const { result, rerender } = renderHook(({ active }) => useExtensions(active), {
      initialProps: { active: false },
    });
    expect(result.current).toEqual({ snapshot: null, failure: null });
    rerender({ active: true });
    await act(() => refreshExtensions());
    expect(result.current.snapshot).toEqual(SNAPSHOT);
    renderHook(() => useServerCheck());
    await waitFor(() => expect(result.current.snapshot).toEqual(checked));
    expect(bodiesTo('/api/extensions/check')).toEqual([{}]);
  });

  it('keeps what it showed and says why when the server cannot be read', async () => {
    serve({ 'GET /api/extensions': { answer: SNAPSHOT } });
    await refreshExtensions();
    fake?.stop();
    serve({});
    await refreshExtensions();
    expect(selectExtensions()).toEqual({ snapshot: SNAPSHOT, failure: 'Shinsa answered with status 404.' });
    await requestServerCheck();
    expect(selectExtensions().failure).toBe('Shinsa answered with status 404.');
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('reads it again when you come back to the page, and stops listening once it is gone', async () => {
    serve({ 'GET /api/extensions': { answer: SNAPSHOT } });
    const { unmount } = renderHook(() => useRefreshOnReturn());
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(bodiesTo('/api/extensions')).toHaveLength(1));
    showPage('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    showPage('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(bodiesTo('/api/extensions')).toHaveLength(2));
    unmount();
    window.dispatchEvent(new Event('focus'));
    await refreshExtensions();
    expect(bodiesTo('/api/extensions')).toHaveLength(3);
  });

  it('asks only once while a read is on its way', async () => {
    serve({ 'GET /api/extensions': { answer: SNAPSHOT } });
    await Promise.all([refreshExtensions(), refreshExtensions()]);
    expect(bodiesTo('/api/extensions')).toHaveLength(1);
  });
});

describe('changes', () => {
  it('sends each change, takes the snapshot it answers and confirms it', async () => {
    const answer = { answer: SNAPSHOT };
    serve({
      'POST /api/extensions/check': answer,
      'POST /api/extensions/servers/add': answer,
      'POST /api/extensions/servers/update': answer,
      'POST /api/extensions/servers/remove': answer,
      'POST /api/extensions/servers/choose': answer,
      'POST /api/extensions/servers/sign-out': answer,
      'POST /api/extensions/skills/choose': answer,
      'POST /api/extensions/plugins/choose': answer,
      'POST /api/extensions/optimizer': answer,
    });
    const skill = createSkill({ id: 'review' });
    const plugin = createPlugin({ id: 'stripe' });
    const input = { name: 'linear', transport: 'http' as const, url: 'https://x.dev' };
    expect(await EXTENSION_ACTIONS.check(null)).toBe(true);
    expect(await checkServers(LINEAR)).toBe(true);
    expect(await EXTENSION_ACTIONS.add(input, 'Added linear.')).toBe(true);
    expect(await EXTENSION_ACTIONS.update(LINEAR, input, 'Saved linear.')).toBe(true);
    expect(await EXTENSION_ACTIONS.remove(LINEAR)).toBe(true);
    expect(await EXTENSION_ACTIONS.choose(LINEAR, { enabled: false }, 'Turned off linear for agents.')).toBe(
      true
    );
    expect(await EXTENSION_ACTIONS.signOut(LINEAR)).toBe(true);
    expect(await EXTENSION_ACTIONS.chooseSkill(skill, false)).toBe(true);
    expect(await EXTENSION_ACTIONS.choosePlugin(plugin, true)).toBe(true);
    expect(await EXTENSION_ACTIONS.chooseOptimizer(SNAPSHOT.optimizer, { enabled: true })).toBe(true);
    expect(selectExtensions().snapshot).toEqual(SNAPSHOT);
    expect(bodiesTo('/api/extensions/optimizer')).toEqual([{ enabled: true }]);
    expect(bodiesTo('/api/extensions/check')).toEqual([{}, { serverId: 'linear' }]);
    expect(bodiesTo('/api/extensions/servers/add')).toEqual([{ server: input }]);
    expect(bodiesTo('/api/extensions/servers/update')).toEqual([{ serverId: 'linear', server: input }]);
    expect(bodiesTo('/api/extensions/servers/remove')).toEqual([{ serverId: 'linear' }]);
    expect(bodiesTo('/api/extensions/servers/choose')).toEqual([{ serverId: 'linear', enabled: false }]);
    expect(bodiesTo('/api/extensions/servers/sign-out')).toEqual([{ serverId: 'linear' }]);
    expect(bodiesTo('/api/extensions/skills/choose')).toEqual([{ skillId: 'review', enabled: false }]);
    expect(bodiesTo('/api/extensions/plugins/choose')).toEqual([{ pluginId: 'stripe', enabled: true }]);
    expect(toasts.success.mock.calls.map(([text]) => text)).toEqual([
      'Checked every server that is on.',
      'Checked linear.',
      'Added linear.',
      'Saved linear.',
      'Removed linear.',
      'Turned off linear for agents.',
      'Signed out of linear.',
      'Turned off the review skill.',
      'Turned on the stripe plugin.',
      'Agents now leave out servers unused for 14 days.',
    ]);
  });

  it('shows the server’s reason when it refuses a change', async () => {
    serve({ 'POST /api/extensions/servers/remove': REFUSED });
    expect(await EXTENSION_ACTIONS.remove(LINEAR)).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('That server is not Shinsa’s.');
  });
});

describe('signing in to a server', () => {
  let opened: Mock<typeof window.open>;
  let tab: { closed: boolean; location: { href: string }; close: () => void };
  let intervals: (() => void)[];
  let interval: Mock<typeof setInterval>;
  let cleared: Mock<typeof clearInterval>;

  beforeEach(() => {
    tab = {
      closed: false,
      location: { href: 'about:blank' },
      close() {
        this.closed = true;
      },
    };
    opened = spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    intervals = [];
    interval = spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void) => {
      intervals.push(callback);
      return intervals.length as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval);
    cleared = spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
  });

  afterEach(() => {
    stopSignInWatch();
    opened.mockRestore();
    interval.mockRestore();
    cleared.mockRestore();
  });

  function startSignIn(reads: ExtensionsSnapshot[] = [SNAPSHOT, CONNECTED]) {
    let count = 0;
    serve({
      'POST /api/extensions/servers/sign-in': {
        answer: { authorizationUrl: 'https://auth.linear.app/x', snapshot: SNAPSHOT },
      },
      'GET /api/extensions': {
        answer: () => {
          count += 1;
          return reads[Math.min(count, reads.length) - 1];
        },
      },
    });
    return signInServer(LINEAR);
  }

  it('opens the sign-in page in a new tab and watches for the sign-in to finish', async () => {
    expect(await startSignIn()).toBe(true);
    expect(opened).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.location.href).toBe('https://auth.linear.app/x');
    expect(interval.mock.calls[0]?.[1]).toBe(SIGN_IN_POLL_MS);
    const [channel] = FakeChannel.opened;
    expect(channel?.name).toBe(SIGN_IN_CHANNEL);
    intervals[0]?.();
    await act(() => refreshExtensions());
    expect(toasts.success).not.toHaveBeenCalled();
    channel?.post({ ok: true });
    await act(() => refreshExtensions());
    expect(selectExtensions().snapshot).toEqual(CONNECTED);
    expect(toasts.success).toHaveBeenCalledWith('Signed in to linear.');
    expect(channel?.closed).toBe(true);
    channel?.post({ ok: true });
    await act(() => refreshExtensions());
    expect(toasts.success).toHaveBeenCalledTimes(1);
  });

  it('keeps watching until Shinsa has checked the server with its new sign-in', async () => {
    await startSignIn([SIGNED_IN, CONNECTED]);
    intervals[0]?.();
    await act(() => refreshExtensions());
    expect(selectExtensions().snapshot).toEqual(SIGNED_IN);
    expect(toasts.success).not.toHaveBeenCalled();
    intervals[0]?.();
    await act(() => refreshExtensions());
    expect(toasts.success).toHaveBeenCalledWith('Signed in to linear.');
    expect(selectExtensions().snapshot).toEqual(CONNECTED);
  });

  it('reads the server again the moment you come back to Shinsa', async () => {
    await startSignIn([CONNECTED]);
    window.dispatchEvent(new Event('focus'));
    await act(() => refreshExtensions());
    expect(toasts.success).toHaveBeenCalledWith('Signed in to linear.');
    expect(FakeChannel.opened[0]?.closed).toBe(true);
  });

  it('hears the sign-in page through its opener, on Shinsa’s channel only', async () => {
    await startSignIn();
    window.dispatchEvent(new MessageEvent('message', { data: 'noise' }));
    window.dispatchEvent(new MessageEvent('message', { data: { channel: 'other', ok: true } }));
    expect(toasts.success).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent('message', { data: { channel: SIGN_IN_CHANNEL, ok: false } }));
    expect(toasts.error).toHaveBeenCalledWith('Couldn’t sign in to linear. Try again.');
    await startSignIn([CONNECTED]);
    showPage('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    showPage('visible');
    FakeChannel.opened[1]?.post(null);
    await act(() => refreshExtensions());
    expect(toasts.success).toHaveBeenCalledWith('Signed in to linear.');
  });

  it('says so when the sign-in page reports a failure', async () => {
    await startSignIn();
    FakeChannel.opened[0]?.post({ ok: false });
    expect(toasts.error).toHaveBeenCalledWith('Couldn’t sign in to linear. Try again.');
    expect(FakeChannel.opened[0]?.closed).toBe(true);
  });

  it('stops watching after two minutes', async () => {
    const now = spyOn(Date, 'now').mockReturnValue(1_000);
    await startSignIn();
    now.mockReturnValue(1_000 + SIGN_IN_LIMIT_MS);
    intervals[0]?.();
    expect(FakeChannel.opened[0]?.closed).toBe(true);
    now.mockRestore();
  });

  it('watches only the latest sign-in', async () => {
    await startSignIn();
    await startSignIn();
    expect(FakeChannel.opened.map((channel) => channel.closed)).toEqual([true, false]);
  });

  it('closes the blank tab when the server is already signed in', async () => {
    serve({
      'POST /api/extensions/servers/sign-in': { answer: { authorizationUrl: null, snapshot: SIGNED_IN } },
    });
    expect(await signInServer(LINEAR)).toBe(true);
    expect(tab.closed).toBe(true);
    expect(toasts.success).toHaveBeenCalledWith('linear is already signed in.');
    expect(FakeChannel.opened).toHaveLength(0);
  });

  it('opens the sign-in page directly when the browser blocked the blank tab', async () => {
    opened.mockReturnValue(null);
    await startSignIn();
    expect(opened).toHaveBeenLastCalledWith('https://auth.linear.app/x', '_blank');
  });

  it('closes the blank tab and shows the reason when the sign-in cannot start', async () => {
    serve({ 'POST /api/extensions/servers/sign-in': REFUSED });
    expect(await signInServer(LINEAR)).toBe(false);
    expect(tab.closed).toBe(true);
    expect(toasts.error).toHaveBeenCalledWith('That server is not Shinsa’s.');
  });

  it('copes with a blocked tab when the sign-in cannot start or is not needed', async () => {
    opened.mockReturnValue(null);
    serve({ 'POST /api/extensions/servers/sign-in': REFUSED });
    expect(await signInServer(LINEAR)).toBe(false);
    fake?.stop();
    serve({
      'POST /api/extensions/servers/sign-in': { answer: { authorizationUrl: null, snapshot: SIGNED_IN } },
    });
    expect(await signInServer(LINEAR)).toBe(true);
  });
});
