import { afterEach, describe, expect, it } from 'bun:test';
import {
  answerDesktopDowngrade,
  applyDesktop,
  applyDesktopChannel,
  checkDesktopUpdates,
  installDesktopUpdate,
  isDesktop,
  isPageQuiet,
  notifyDesktop,
  openDesktopNotificationSettings,
  readDesktopChannel,
  readDesktopUpdate,
  resolveSurface,
  selectDesktopBuild,
  subscribeDesktopNotifyFailed,
  subscribeDesktopUpdate,
  updateDesktopBadge,
} from '@/lib/desktop.ts';
import { installDesktop } from '../support/desktop.ts';

const NOTICE = { title: 'Paint it', body: 'Which colour?', tag: 'g-1', path: '/tasks/SW-1' };

let fake: ReturnType<typeof installDesktop> | null = null;

afterEach(() => {
  fake?.restore();
  fake = null;
});

describe('in a browser', () => {
  it('finds no app, marks nothing and sends nothing', () => {
    expect(isDesktop()).toBe(false);
    const stop = applyDesktop(() => undefined);
    expect(document.documentElement.dataset.desktop).toBeUndefined();
    stop();
    updateDesktopBadge(3);
    expect(notifyDesktop(NOTICE)).toBe(false);
    openDesktopNotificationSettings();
    subscribeDesktopNotifyFailed(() => undefined)();
  });

  it('is a browser surface, quiet while the desktop app is connected', () => {
    expect(resolveSurface()).toBe('browser');
    expect(isPageQuiet(true)).toBe(true);
    expect(isPageQuiet(false)).toBe(false);
  });
});

describe('in the desktop app', () => {
  it('is the desktop surface and never quiet', () => {
    fake = installDesktop();
    expect(resolveSurface()).toBe('desktop');
    expect(isPageQuiet(true)).toBe(false);
  });

  it('marks the page for the title bar and follows full screen', () => {
    fake = installDesktop();
    const stop = applyDesktop(() => undefined);
    expect(isDesktop()).toBe(true);
    expect(document.documentElement.dataset.desktop).toBe('window');
    fake.changeWindowState('fullscreen');
    expect(document.documentElement.dataset.desktop).toBe('fullscreen');
    stop();
    expect(document.documentElement.dataset.desktop).toBeUndefined();
    expect(fake.listeners()).toBe(0);
  });

  it('opens the pages the app asks for', () => {
    fake = installDesktop();
    const opened: string[] = [];
    const stop = applyDesktop((path) => opened.push(path));
    fake.navigate('/settings');
    expect(opened).toEqual(['/settings']);
    stop();
  });

  it('hands the Dock badge and notifications to the app', () => {
    fake = installDesktop();
    updateDesktopBadge(2);
    expect(notifyDesktop(NOTICE)).toBe(true);
    expect(fake.badges).toEqual([2]);
    expect(fake.notices).toEqual([NOTICE]);
  });

  it('opens macOS notification settings and hears when macOS refuses a notification', () => {
    fake = installDesktop();
    openDesktopNotificationSettings();
    expect(fake.settingsOpened()).toBe(1);
    let failures = 0;
    const stop = subscribeDesktopNotifyFailed(() => {
      failures += 1;
    });
    fake.failNotice();
    expect(failures).toBe(1);
    stop();
    expect(fake.failedListeners()).toBe(0);
  });
});

describe('the app’s own update', () => {
  it('is nothing in a browser', () => {
    expect(selectDesktopBuild()).toBeNull();
    expect(readDesktopUpdate()).toEqual({ status: 'none' });
    let heard = 0;
    subscribeDesktopUpdate(() => {
      heard += 1;
    })();
    installDesktopUpdate();
    checkDesktopUpdates();
    answerDesktopDowngrade(true);
    applyDesktopChannel('beta');
    expect(readDesktopChannel()).toBeNull();
    expect(heard).toBe(0);
  });

  it('reads the app’s version and update, hears each change, and asks the app to install or check', () => {
    fake = installDesktop();
    fake.bridge.update = { status: 'downloading', version: '0.6.0', percent: 10 };
    expect(selectDesktopBuild()).toEqual({ version: '0.0.0', protocol: 1 });
    expect(readDesktopUpdate()).toEqual({ status: 'downloading', version: '0.6.0', percent: 10 });
    let heard = 0;
    const stop = subscribeDesktopUpdate(() => {
      heard += 1;
    });
    fake.changeUpdate({ status: 'ready', version: '0.6.0' });
    expect(heard).toBe(1);
    expect(readDesktopUpdate()).toEqual({ status: 'ready', version: '0.6.0' });
    stop();
    installDesktopUpdate();
    checkDesktopUpdates();
    answerDesktopDowngrade(true);
    answerDesktopDowngrade(false);
    expect(fake.updateCalls).toEqual(['install', 'check', 'downgrade', 'keep beta']);
  });

  it('reads the app’s update channel and asks the app to switch it, once per change', () => {
    fake = installDesktop();
    fake.bridge.channel = 'beta';
    expect(readDesktopChannel()).toBe('beta');
    let heard = 0;
    const stop = subscribeDesktopUpdate(() => {
      heard += 1;
    });
    applyDesktopChannel('beta');
    applyDesktopChannel('stable');
    expect(readDesktopChannel()).toBe('stable');
    expect(fake.channels).toEqual(['stable']);
    expect(heard).toBe(1);
    stop();
  });
});
