import { afterEach, describe, expect, it } from 'bun:test';
import {
  applyDesktop,
  isDesktop,
  isPageQuiet,
  notifyDesktop,
  resolveSurface,
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
});
