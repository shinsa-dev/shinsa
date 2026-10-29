import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repo, UserCommand } from '@shinsa/core';
import {
  isJobProgram,
  isPathArgument,
  ownsEngineJob,
  parseEngineJob,
  readAppBundleId,
  resolveEngineTarget,
  resolveHomeLink,
  resolveLinkPage,
  resolvePathArgument,
  resolveRealPath,
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
    expect(resolveHomeLink()).toBe('shinsa://home');
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

describe('which engine job this shinsa may control', () => {
  const APP = '/Applications/Shinsa.app';
  const PROGRAM = `${APP}/Contents/Resources/engine/bin/shinsa`;
  const REGISTERED = [
    'gui/501/studio.overclock.shinsa.engine = {',
    '\tprogram identifier = Contents/Resources/engine/bin/shinsa (mode: 2)',
    '\tparent bundle identifier = studio.overclock.shinsa',
  ].join('\n');
  const WRITTEN = `gui/501/studio.overclock.shinsa.engine = {\n\tprogram = ${PROGRAM}\n`;
  const identity = (program: string, ids: Record<string, string> = { [APP]: 'studio.overclock.shinsa' }) => ({
    program,
    real: (path: string) => path.replace('/private', ''),
    readBundleId: (app: string) => ids[app] ?? null,
  });

  test('reads both kinds of job launchd prints', () => {
    expect(parseEngineJob(REGISTERED)).toEqual({
      program: null,
      relative: 'Contents/Resources/engine/bin/shinsa',
      bundleId: 'studio.overclock.shinsa',
    });
    expect(parseEngineJob(WRITTEN)).toEqual({ program: PROGRAM, relative: null, bundleId: null });
  });

  test('a job the app registered belongs only to the program in that app', () => {
    const job = parseEngineJob(REGISTERED);
    expect(isJobProgram(job, identity(PROGRAM))).toBe(true);
    expect(isJobProgram(job, identity('/tmp/Copy.app/Contents/Resources/engine/bin/shinsa'))).toBe(false);
    expect(isJobProgram(job, identity('/tmp/shinsa/apps/engine/dist/engine/bin/shinsa'))).toBe(false);
    const testCopy = { [APP]: 'studio.overclock.shinsa.test' };
    expect(isJobProgram(job, identity(PROGRAM, testCopy))).toBe(false);
  });

  test('a job written with a full path belongs only to that program, followed through links', () => {
    const job = parseEngineJob(WRITTEN);
    expect(isJobProgram(job, identity(PROGRAM))).toBe(true);
    expect(isJobProgram({ ...job, program: `/private${PROGRAM}` }, identity(PROGRAM))).toBe(true);
    expect(isJobProgram(job, identity('/tmp/shinsa/apps/engine/dist/engine/bin/shinsa'))).toBe(false);
    expect(isJobProgram({ program: null, relative: null, bundleId: null }, identity(PROGRAM))).toBe(false);
  });
});

describe('reading who this shinsa is on disk', () => {
  test('follows links to the real program, and keeps a path that does not exist', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'shinsa-real-')));
    writeFileSync(join(dir, 'shinsa'), '');
    symlinkSync(join(dir, 'shinsa'), join(dir, 'link'));
    expect(resolveRealPath(join(dir, 'link'))).toBe(join(dir, 'shinsa'));
    expect(resolveRealPath(join(dir, 'missing'))).toBe(join(dir, 'missing'));
  });

  test('reads an app’s bundle id with plutil, and nothing when the plist or the tool is missing or fails', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'shinsa-app-')));
    const app = join(dir, 'Shinsa.app');
    mkdirSync(join(app, 'Contents'), { recursive: true });
    writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist/>');
    const answering = join(dir, 'plutil');
    writeFileSync(answering, '#!/bin/sh\necho studio.overclock.shinsa\n');
    chmodSync(answering, 0o755);
    const failing = join(dir, 'plutil-fails');
    writeFileSync(failing, '#!/bin/sh\nexit 1\n');
    chmodSync(failing, 0o755);
    expect(readAppBundleId(app, answering)).toBe('studio.overclock.shinsa');
    expect(readAppBundleId(app, failing)).toBeNull();
    expect(readAppBundleId(app, join(dir, 'no-plutil'))).toBeNull();
    expect(readAppBundleId(join(dir, 'Other.app'), answering)).toBeNull();
  });

  test('owns a job that runs this very program, and no job that names nothing', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'shinsa-own-')));
    const program = join(dir, 'shinsa');
    writeFileSync(program, '');
    expect(ownsEngineJob(`\tprogram = ${program}\n`, program)).toBe(true);
    expect(ownsEngineJob(`\tprogram = ${join(dir, 'other')}\n`, program)).toBe(false);
    expect(ownsEngineJob('state = running', program)).toBe(false);
  });
});
