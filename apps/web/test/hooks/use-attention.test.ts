import { afterEach, describe, expect, it } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useAttention } from '@/hooks/use-attention.ts';
import { NOTIFY_BLOCKED } from '@/lib/notifications/settings.ts';
import { writeNotificationPreferences } from '@/lib/preferences/notifications.ts';
import { spyOnToasts } from '../support/commands.ts';
import { installDesktop } from '../support/desktop.ts';
import { installAudio, installNotifications } from '../support/notifications.ts';
import { pushSurfaces, startFakeServer, stopFakeServer } from '../support/server.ts';
import { createGate, createShinsaState, createTask } from '../support/state.ts';

function meta(name: string) {
  return document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null;
}

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  document.title = 'Shinsa';
});

function question(id: string) {
  return createGate({
    id,
    taskId: 't-1',
    type: 'question',
    title: `Question ${id}`,
  });
}

function withGates(...gates: ReturnType<typeof question>[]) {
  return createShinsaState({ tasks: [createTask({ id: 't-1', title: 'Paint it' })], gates });
}

describe('useAttention', () => {
  it('puts what needs you in the title and in Floaty’s meta tags', () => {
    const { rerender } = renderHook(({ state }) => useAttention(state), {
      initialProps: { state: withGates() },
    });
    expect(document.title).toBe('Shinsa');
    expect([meta('floaty:status'), meta('floaty:badge')]).toEqual(['working', '0']);
    rerender({ state: withGates(question('g-1'), question('g-2')) });
    expect(document.title).toBe('[2] Shinsa');
    expect([meta('floaty:status'), meta('floaty:badge')]).toEqual(['waiting', '2']);
    expect(document.head.querySelectorAll('meta[name="floaty:badge"]')).toHaveLength(1);
  });

  it('names the task on screen in the title, by its handle when it has one', () => {
    const state = createShinsaState({
      tasks: [
        createTask({ id: 't-1', title: 'Paint it', handle: 'SW-142' }),
        createTask({ id: 't-2', title: 'Sand it' }),
      ],
      gates: [question('g-1')],
    });
    const { rerender } = renderHook(({ reference }) => useAttention(state, reference), {
      initialProps: { reference: 'sw-142' as string | null },
    });
    expect(document.title).toBe('[1] SW-142 Paint it · Shinsa');
    rerender({ reference: 't-2' });
    expect(document.title).toBe('[1] Sand it · Shinsa');
    rerender({ reference: 'gone' });
    expect(document.title).toBe('[1] Shinsa');
  });

  it('plays the sound and shows the notification the watcher asks for, and a click opens the task', () => {
    const audio = installAudio();
    const notifications = installNotifications('granted');
    restores.push(audio.restore, notifications.restore);
    writeNotificationPreferences({ sound: 'always', notify: 'always' });
    const { rerender } = renderHook(({ state }) => useAttention(state), {
      initialProps: { state: withGates() },
    });
    rerender({ state: withGates(question('g-1')) });
    expect(notifications.shown.map((shown) => [shown.title, shown.options.body])).toEqual([
      ['Paint it', 'Question g-1'],
    ]);
    expect(audio.created).toHaveLength(1);
    notifications.shown[0]?.click();
    expect(location.pathname).toBe('/tasks/t-1');
  });

  it('in a browser or Floaty, plays no sound and shows no notification while the desktop app is connected, but keeps the count', () => {
    const audio = installAudio();
    const notifications = installNotifications('granted');
    restores.push(audio.restore, notifications.restore, stopFakeServer);
    startFakeServer();
    pushSurfaces(true);
    restores.push(() => pushSurfaces(false));
    writeNotificationPreferences({ sound: 'always', notify: 'always' });
    const { rerender } = renderHook(({ state }) => useAttention(state), {
      initialProps: { state: withGates() },
    });
    rerender({ state: withGates(question('g-1')) });
    expect(notifications.shown).toEqual([]);
    expect(audio.created).toEqual([]);
    expect(document.title).toBe('[1] Shinsa');
    expect([meta('floaty:status'), meta('floaty:badge')]).toEqual(['waiting', '1']);
  });

  it('in the desktop app, keeps notifying while it is the connected app', () => {
    const notifications = installNotifications('granted');
    const desktop = installDesktop();
    restores.push(notifications.restore, desktop.restore, stopFakeServer);
    startFakeServer();
    pushSurfaces(true);
    restores.push(() => pushSurfaces(false));
    writeNotificationPreferences({ notify: 'always' });
    const { rerender } = renderHook(({ state }) => useAttention(state), {
      initialProps: { state: withGates() },
    });
    rerender({ state: withGates(question('g-1')) });
    expect(desktop.notices.map((notice) => notice.tag)).toEqual(['g-1']);
    expect(desktop.badges.at(-1)).toBe(1);
    expect(document.title).toBe('[1] Shinsa');
  });

  it('in the desktop app, hands the notification and the Dock badge to the app, never to the browser', () => {
    const audio = installAudio();
    const notifications = installNotifications('granted');
    const desktop = installDesktop();
    restores.push(audio.restore, notifications.restore, desktop.restore);
    writeNotificationPreferences({ notify: 'always' });
    const state = (gates: ReturnType<typeof question>[]) =>
      createShinsaState({ tasks: [createTask({ id: 't-1', title: 'Paint it', handle: 'SW-142' })], gates });
    const { rerender } = renderHook(({ current }) => useAttention(current), {
      initialProps: { current: state([]) },
    });
    rerender({ current: state([question('g-1')]) });
    expect(notifications.shown).toEqual([]);
    expect(desktop.notices).toEqual([
      { title: 'Paint it', body: 'Question g-1', tag: 'g-1', path: '/tasks/SW-142' },
    ]);
    expect(desktop.badges.at(-1)).toBe(1);
  });

  it('in the app, shows a toast when macOS refuses a notification, until it unmounts', () => {
    const desktop = installDesktop();
    restores.push(desktop.restore);
    const toasts = spyOnToasts();
    restores.push(toasts.restore);
    const { unmount } = renderHook(() => useAttention(withGates()));
    desktop.failNotice();
    expect(toasts.error.mock.calls.map(([message]) => message)).toEqual([NOTIFY_BLOCKED]);
    unmount();
    expect(desktop.failedListeners()).toBe(0);
  });
});
