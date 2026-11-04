import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
  canPageNotify,
  dismissDecisionNotification,
  readNotificationPermission,
  requestNotificationPermission,
  showDecisionNotification,
  showTestNotification,
  TEST_NOTIFICATION,
} from '@/lib/notifications/browser.ts';
import type { NotificationWorker } from '@/lib/notifications/schema.ts';
import { installDesktop } from '../../support/desktop.ts';
import { installNotifications } from '../../support/notifications.ts';

const NOTICE = { gateId: 'g-1', taskId: 't-1', title: 'Paint it', body: 'Which colour?' };

function createWorker() {
  const shown: { title: string; options: NotificationOptions }[] = [];
  const closed: string[] = [];
  const registration = {
    showNotification: (title: string, options: NotificationOptions) => {
      shown.push({ title, options });
      return Promise.resolve();
    },
    getNotifications: ({ tag }: { tag: string }) =>
      Promise.resolve(
        shown.filter((notice) => notice.options.tag === tag).map(() => ({ close: () => closed.push(tag) }))
      ),
  } as unknown as ServiceWorkerRegistration;
  const container = { controller: {}, ready: Promise.resolve(registration) } as NotificationWorker;
  return { container, shown, closed };
}

let fake: ReturnType<typeof installNotifications> | null = null;

afterEach(() => {
  fake?.restore();
  fake = null;
});

describe('canPageNotify', () => {
  it('lets the Mac app always alert, and a browser only once notifications are on and allowed', () => {
    expect(canPageNotify(true, 'never', 'denied')).toBe(true);
    expect(canPageNotify(false, 'always', 'granted')).toBe(true);
    expect(canPageNotify(false, 'unfocused', 'granted')).toBe(true);
    expect(canPageNotify(false, 'never', 'granted')).toBe(false);
    expect(canPageNotify(false, 'always', 'default')).toBe(false);
    expect(canPageNotify(false, 'always', 'denied')).toBe(false);
    expect(canPageNotify(false, 'always', 'unsupported')).toBe(false);
    expect(typeof canPageNotify()).toBe('boolean');
  });
});

describe('browser notifications', () => {
  it('reads as unsupported where the browser has none, and shows nothing there', async () => {
    expect(readNotificationPermission()).toBe('unsupported');
    expect(await requestNotificationPermission()).toBe('unsupported');
    expect(showDecisionNotification(NOTICE, '/tasks/SW-1', () => undefined)).toBe(false);
  });

  it('asks only while the browser has not decided', async () => {
    fake = installNotifications('default', 'granted');
    expect(await requestNotificationPermission()).toBe('granted');
    expect(await requestNotificationPermission()).toBe('granted');
    expect(fake.requests).toHaveLength(1);
  });

  it('shows the task and what it needs, one per gate, and a click opens the task', () => {
    fake = installNotifications('granted');
    const focus = spyOn(window, 'focus').mockImplementation(() => undefined);
    const opened: string[] = [];
    expect(showDecisionNotification(NOTICE, '/tasks/SW-1', (path) => opened.push(path))).toBe(true);
    expect(fake.shown[0]).toMatchObject({
      title: 'Paint it',
      options: { body: 'Which colour?', tag: 'g-1' },
    });
    fake.shown[0]?.click();
    expect(fake.shown[0]?.closed).toBe(true);
    expect(opened).toEqual(['/tasks/SW-1']);
    expect(focus).toHaveBeenCalledTimes(1);
    focus.mockRestore();
  });

  it('in the desktop app, needs no browser permission and leaves the notification to the app', async () => {
    fake = installNotifications('denied');
    const desktop = installDesktop();
    expect(readNotificationPermission()).toBe('granted');
    expect(await requestNotificationPermission()).toBe('granted');
    showTestNotification();
    expect(desktop.notices).toEqual([{ ...TEST_NOTIFICATION, tag: 'shinsa-test', path: null }]);
    expect(fake.shown).toEqual([]);
    desktop.restore();
  });

  it('shows the test in the browser, and its click only brings the page forward', () => {
    fake = installNotifications('granted');
    const focus = spyOn(window, 'focus').mockImplementation(() => undefined);
    showTestNotification();
    expect(fake.shown[0]).toMatchObject({ title: TEST_NOTIFICATION.title, options: { tag: 'shinsa-test' } });
    fake.shown[0]?.click();
    expect(focus).toHaveBeenCalledTimes(1);
    focus.mockRestore();
  });

  it('under a service worker, shows through its registration with the task’s path for the click', async () => {
    fake = installNotifications('granted');
    const worker = createWorker();
    expect(showDecisionNotification(NOTICE, '/tasks/SW-1', () => undefined, worker.container)).toBe(true);
    showTestNotification(worker.container);
    await worker.container.ready;
    await Promise.resolve();
    expect(fake.shown).toEqual([]);
    expect(worker.shown).toEqual([
      { title: 'Paint it', options: { body: 'Which colour?', tag: 'g-1', data: { path: '/tasks/SW-1' } } },
      {
        title: TEST_NOTIFICATION.title,
        options: { body: TEST_NOTIFICATION.body, tag: 'shinsa-test', data: { path: null } },
      },
    ]);
  });

  it('closes a decision’s notification once it no longer needs you, and leaves the others', async () => {
    fake = installNotifications('granted');
    showDecisionNotification(NOTICE, '/tasks/SW-1', () => undefined);
    showDecisionNotification({ ...NOTICE, gateId: 'g-2' }, '/tasks/SW-1', () => undefined);
    dismissDecisionNotification('g-1', null);
    dismissDecisionNotification('g-1', null);
    expect(fake.shown.map((notice) => notice.closed)).toEqual([true, false]);
    fake.shown[1]?.click();
    dismissDecisionNotification('g-2', null);

    const worker = createWorker();
    showDecisionNotification(NOTICE, '/tasks/SW-1', () => undefined, worker.container);
    await worker.container.ready;
    dismissDecisionNotification('g-1', worker.container);
    dismissDecisionNotification('g-9', worker.container);
    await worker.container.ready;
    await Promise.resolve();
    await Promise.resolve();
    expect(worker.closed).toEqual(['g-1']);
  });

  it('shows nothing once the browser said no', () => {
    fake = installNotifications('denied');
    expect(showDecisionNotification(NOTICE, '/tasks/SW-1', () => undefined)).toBe(false);
    expect(fake.shown).toEqual([]);
  });
});
