import { describe, expect, it } from 'bun:test';
import {
  isAppPath,
  isAppUrl,
  isLoopbackHost,
  isPermissionAllowed,
  resolveHistoryStep,
  resolveNavigation,
} from '../../src/lib/navigation.ts';

const ORIGIN = 'http://127.0.0.1:5180';

describe('resolveNavigation', () => {
  it('keeps the server’s own pages in the window, whichever loopback name they use', () => {
    expect(resolveNavigation('http://127.0.0.1:5180/tasks/LOC-4?tab=chat#end', ORIGIN)).toEqual({
      kind: 'app',
      path: '/tasks/LOC-4?tab=chat#end',
    });
    expect(resolveNavigation('http://localhost:5180/settings', ORIGIN)).toEqual({
      kind: 'app',
      path: '/settings',
    });
  });

  it('opens Shinsa links in the window', () => {
    expect(resolveNavigation('shinsa://task/LOC-4', ORIGIN)).toEqual({ kind: 'link', path: '/tasks/LOC-4' });
  });

  it('sends the web and mail to the default apps', () => {
    expect(resolveNavigation('https://github.com/o/r/pull/4', ORIGIN)).toEqual({
      kind: 'external',
      url: 'https://github.com/o/r/pull/4',
    });
    expect(resolveNavigation('http://127.0.0.1:5181/', ORIGIN)).toEqual({
      kind: 'external',
      url: 'http://127.0.0.1:5181/',
    });
    expect(resolveNavigation('mailto:a@b.c', ORIGIN)).toEqual({ kind: 'external', url: 'mailto:a@b.c' });
  });

  it('blocks everything else', () => {
    expect(resolveNavigation('file:///etc/passwd', ORIGIN)).toEqual({ kind: 'blocked' });
    expect(resolveNavigation('javascript:alert(1)', ORIGIN)).toEqual({ kind: 'blocked' });
    expect(resolveNavigation('nonsense', ORIGIN)).toEqual({ kind: 'blocked' });
  });
});

describe('the server’s origin', () => {
  it('treats every loopback name as one host', () => {
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('example.com')).toBe(false);
    expect(isAppUrl(new URL('http://[::1]:5180/'), ORIGIN)).toBe(true);
    expect(isAppUrl(new URL('https://127.0.0.1:5180/'), ORIGIN)).toBe(false);
    expect(isAppUrl(new URL('http://shinsa.example:5180/'), 'http://shinsa.example:5180')).toBe(true);
  });

  it('accepts only paths on the server', () => {
    expect(isAppPath('/tasks/LOC-4')).toBe(true);
    expect(isAppPath('//evil.example/')).toBe(false);
    expect(isAppPath('/\\evil')).toBe(false);
    expect(isAppPath('tasks')).toBe(false);
    expect(isAppPath(`/${'a'.repeat(2048)}`)).toBe(false);
    expect(isAppPath(4)).toBe(false);
  });
});

describe('isPermissionAllowed', () => {
  it('grants the clipboard and full screen to the server’s page only', () => {
    expect(isPermissionAllowed('clipboard-sanitized-write', 'http://localhost:5180/tasks', ORIGIN)).toBe(
      true
    );
    expect(isPermissionAllowed('fullscreen', 'https://example.com/', ORIGIN)).toBe(false);
    expect(isPermissionAllowed('clipboard-read', 'not a url', ORIGIN)).toBe(false);
  });

  it('never grants notifications, so only the app notifies', () => {
    expect(isPermissionAllowed('notifications', ORIGIN, ORIGIN)).toBe(false);
    expect(isPermissionAllowed('media', ORIGIN, ORIGIN)).toBe(false);
  });
});

describe('resolveHistoryStep', () => {
  const urls = [
    'file:///Applications/Shinsa.app/static/waiting.html',
    `${ORIGIN}/`,
    `${ORIGIN}/tasks/LOC-4`,
    `${ORIGIN}/settings`,
  ];

  it('steps back and forward through the server’s own pages', () => {
    expect(resolveHistoryStep(urls, 2, -1, ORIGIN)).toBe(1);
    expect(resolveHistoryStep(urls, 2, 1, ORIGIN)).toBe(3);
  });

  it('never steps onto the waiting page or past either end', () => {
    expect(resolveHistoryStep(urls, 1, -1, ORIGIN)).toBeNull();
    expect(resolveHistoryStep(urls, 3, 1, ORIGIN)).toBeNull();
    expect(resolveHistoryStep(urls, 0, -1, ORIGIN)).toBeNull();
  });

  it('ignores an entry that is not a URL', () => {
    expect(resolveHistoryStep(['not a url', `${ORIGIN}/`], 1, -1, ORIGIN)).toBeNull();
  });
});
