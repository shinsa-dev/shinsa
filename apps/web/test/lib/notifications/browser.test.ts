import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
  readNotificationPermission,
  requestNotificationPermission,
  showDecisionNotification,
  showTestNotification,
  TEST_NOTIFICATION,
} from '@/lib/notifications/browser.ts';
import { installDesktop } from '../../support/desktop.ts';
import { installNotifications } from '../../support/notifications.ts';

const NOTICE = { gateId: 'g-1', taskId: 't-1', title: 'Paint it', body: 'Which colour?' };

let fake: ReturnType<typeof installNotifications> | null = null;

afterEach(() => {
  fake?.restore();
  fake = null;
});

describe('browser notifications', () => {
  it('reads as unsupported where the browser has none, and shows nothing there', async () => {
    expect(readNotificationPermission()).toBe('unsupported');
    expect(await requestNotificationPermission()).toBe('unsupported');
    expect(showDecisionNotification(NOTICE, () => undefined)).toBe(false);
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
    expect(showDecisionNotification(NOTICE, (taskId) => opened.push(taskId))).toBe(true);
    expect(fake.shown[0]).toMatchObject({
      title: 'Paint it',
      options: { body: 'Which colour?', tag: 'g-1' },
    });
    fake.shown[0]?.click();
    expect(fake.shown[0]?.closed).toBe(true);
    expect(opened).toEqual(['t-1']);
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

  it('shows nothing once the browser said no', () => {
    fake = installNotifications('denied');
    expect(showDecisionNotification(NOTICE, () => undefined)).toBe(false);
    expect(fake.shown).toEqual([]);
  });
});
