import { afterEach, describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import {
  NOTIFICATION_FAILED,
  NOTIFICATION_OPEN,
  type NotificationClients,
} from '@/lib/notifications/schema.ts';
import {
  openNotificationTarget,
  readNotificationPath,
  selectNotificationWorker,
  serveNotificationOpens,
} from '@/lib/notifications/worker.ts';

function createClients(windows: { focused: boolean }[]) {
  const focused: number[] = [];
  const messages: { index: number; message: unknown }[] = [];
  const opened: string[] = [];
  const clients: NotificationClients = {
    matchAll: () =>
      Promise.resolve(
        windows.map((window, index) => ({
          focused: window.focused,
          focus: () => {
            focused.push(index);
            return Promise.resolve();
          },
          postMessage: (message: unknown) => messages.push({ index, message }),
        }))
      ),
    openWindow: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
  };
  return { clients, focused, messages, opened };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('a notification’s click in the service worker', () => {
  it('reads only a path inside the app from the notification', () => {
    expect(readNotificationPath({ path: '/tasks/SW-1' })).toBe('/tasks/SW-1');
    expect(readNotificationPath({ path: null })).toBeNull();
    expect(readNotificationPath({ path: 'https://evil.dev/' })).toBeNull();
    expect(readNotificationPath({ path: '//evil.dev/' })).toBeNull();
    expect(readNotificationPath({ path: '/\\evil.dev/' })).toBeNull();
    expect(readNotificationPath(null)).toBeNull();
    expect(readNotificationPath('/tasks/SW-1')).toBeNull();
  });

  it('brings the focused page forward and tells it which task to open', async () => {
    const page = createClients([{ focused: false }, { focused: true }]);
    await Effect.runPromise(openNotificationTarget('/tasks/SW-1', '/', page.clients));
    expect(page.focused).toEqual([1]);
    expect(page.messages).toEqual([{ index: 1, message: { type: NOTIFICATION_OPEN, path: '/tasks/SW-1' } }]);
    expect(page.opened).toEqual([]);
  });

  it('takes the first page when none has focus, and only focuses it for a test notification', async () => {
    const page = createClients([{ focused: false }, { focused: false }]);
    await Effect.runPromise(openNotificationTarget(null, '/', page.clients));
    expect(page.focused).toEqual([0]);
    expect(page.messages).toEqual([]);
  });

  it('opens the task in a new window when every page is closed, or the dashboard for a test', async () => {
    const page = createClients([]);
    await Effect.runPromise(openNotificationTarget('/tasks/SW-1', '/', page.clients));
    await Effect.runPromise(openNotificationTarget(null, 'https://app.shinsa.dev/', page.clients));
    expect(page.opened).toEqual(['/tasks/SW-1', 'https://app.shinsa.dev/']);
  });
});

describe('a notification’s click that fails', () => {
  it('fails with what the browser said, or a sentence of its own', async () => {
    const failing = (reason: unknown): NotificationClients => ({
      matchAll: () => Promise.reject(reason),
      openWindow: () => Promise.resolve(),
    });
    const said = await Effect.runPromise(
      Effect.flip(openNotificationTarget(null, '/', failing(new Error('No windows here.'))))
    );
    expect(said).toMatchObject({ _tag: 'NotificationFailed', message: 'No windows here.' });
    const unsaid = await Effect.runPromise(Effect.flip(openNotificationTarget(null, '/', failing('gone'))));
    expect(unsaid.message).toBe(NOTIFICATION_FAILED);
  });
});

describe('the page’s side', () => {
  it('opens the path the worker names and ignores every other message, until stopped', () => {
    const target = new EventTarget();
    const opened: string[] = [];
    const stop = serveNotificationOpens(target as unknown as ServiceWorkerContainer, (path) =>
      opened.push(path)
    );
    const send = (data: unknown) => target.dispatchEvent(Object.assign(new Event('message'), { data }));
    send({ type: NOTIFICATION_OPEN, path: '/tasks/SW-1' });
    send({ type: NOTIFICATION_OPEN, path: '//evil.dev/' });
    send({ type: 'shinsa-remote-request', path: '/tasks/SW-2' });
    send(null);
    stop();
    send({ type: NOTIFICATION_OPEN, path: '/tasks/SW-3' });
    expect(opened).toEqual(['/tasks/SW-1']);
  });

  it('uses the service worker only while one controls the page', () => {
    expect(selectNotificationWorker()).toBeNull();
    const container = { controller: null };
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    expect(selectNotificationWorker()).toBeNull();
    const controlled = { controller: {} };
    Object.defineProperty(navigator, 'serviceWorker', { value: controlled, configurable: true });
    expect(selectNotificationWorker()).toBe(controlled as unknown as ServiceWorkerContainer);
  });
});
