import { describe, expect, test } from 'bun:test';
import type { Repo, UserCommand } from '@shinsa/core';
import {
  isPathArgument,
  resolveEngineTarget,
  resolveLinkPage,
  resolvePathArgument,
  resolveTaskLink,
} from '../../src/cli/app.ts';
import { type CommandIo, openApp } from '../../src/cli/commands.ts';
import { PLAIN_DISPLAY } from '../../src/terminal/index.ts';

function createRepo(fields: Partial<Repo>): Repo {
  return {
    id: 'r1',
    name: 'shop',
    path: '/code/shop',
    defaultBranch: 'main',
    remote: null,
    projectId: 'p1',
    checkCommands: [],
    ...fields,
  };
}

function createIo(repos: Repo[], root: string | null) {
  const opened: string[] = [];
  const sent: UserCommand[] = [];
  const out: string[] = [];
  const io: CommandIo = {
    api: {
      base: 'http://127.0.0.1:5180',
      sendCommand: (command) => {
        sent.push(command);
        return Promise.resolve({ events: [] } as never);
      },
      readQueue: () => Promise.reject(new Error('not in this test')),
      readRepos: () => Promise.resolve({ repos }),
    },
    display: PLAIN_DISPLAY,
    home: undefined,
    cwd: '/code/shop/src',
    write: (line = '') => out.push(line),
    openApp: (link) => {
      opened.push(link);
      return Promise.resolve();
    },
    readRepoRoot: () => Promise.resolve(root),
  };
  return { io, opened, sent, out };
}

describe('links into the app', () => {
  test('a task link, and the page it is in a browser', () => {
    expect(resolveTaskLink('SW-142')).toBe('shinsa://task/SW-142');
    expect(resolveLinkPage('shinsa://task/SW-142')).toBe('/tasks/SW-142');
    expect(resolveLinkPage('shinsa://home')).toBe('/');
    expect(resolveEngineTarget(501)).toBe('gui/501/studio.overclock.shinsa.engine');
  });

  test('tells a folder from a task, and resolves it against where shinsa ran', () => {
    for (const arg of ['.', '..', '/code', './src', '../x', '~', '~/code'])
      expect(isPathArgument(arg)).toBe(true);
    for (const arg of ['SW-142', 'fix-it', 'help']) expect(isPathArgument(arg)).toBe(false);
    expect(resolvePathArgument('.', '/code/shop', '/home/me')).toBe('/code/shop');
    expect(resolvePathArgument('~', '/code', '/home/me')).toBe('/home/me');
    expect(resolvePathArgument('~/code', '/x', '/home/me')).toBe('/home/me/code');
    expect(resolvePathArgument('../other', '/code/shop', '/home/me')).toBe('/code/other');
  });
});

describe('shinsa <folder>', () => {
  test('focuses on the project of the repository the folder is in, then opens Home', async () => {
    const { io, opened, sent } = createIo([createRepo({})], '/code/shop');
    await openApp(['.'], io);
    expect(sent).toEqual([{ type: 'focus.change', projectId: 'p1', until: null }]);
    expect(opened).toEqual(['shinsa://home']);
  });

  test('a repository in no project opens Home without changing the focus', async () => {
    const { io, opened, sent, out } = createIo([createRepo({ projectId: null })], '/code/shop');
    await openApp(['.'], io);
    expect(sent).toEqual([]);
    expect(out).toEqual([]);
    expect(opened).toEqual(['shinsa://home']);
  });
});
