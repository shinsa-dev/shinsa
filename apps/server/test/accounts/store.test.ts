import { describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '@shinsa/core';
import { AccountStore, removeAccountDir } from '../../src/accounts/store.ts';
import { log } from '../../src/log/index.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

function createStore(
  options: { ids?: string[]; shared?: Record<string, string>; globalConfig?: unknown } = {}
) {
  const root = createTempDir();
  const home = join(root, 'shinsa');
  const sharedDir = join(root, 'claude');
  const sharedGlobalConfig = join(root, '.claude.json');
  if (options.shared) writeFiles(sharedDir, options.shared);
  if (options.globalConfig !== null)
    writeFileSync(sharedGlobalConfig, JSON.stringify(options.globalConfig ?? {}));
  const ids = [...(options.ids ?? ['acc1', 'acc2', 'acc3'])];
  const reopen = () =>
    new AccountStore({
      home,
      sharedDir,
      sharedGlobalConfig,
      now: () => 500,
      newId: () => ids.shift() ?? 'extra',
    });
  return { store: reopen(), reopen, home, sharedDir, sharedGlobalConfig };
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function expectDomainError(act: () => unknown, code: string, message: string) {
  try {
    act();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code, message });
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('account store', () => {
  test('starts with no accounts and no accounts.json', () => {
    const { store } = createStore();
    expect(store.exists).toBe(false);
    expect(store.list()).toEqual([]);
    expect(store.defaultAccountId).toBeNull();
    expect(store.select('acc1')).toBeNull();
  });

  test('the Claude Code login is kept without a folder of its own, and only once', () => {
    const { store, home } = createStore();
    const account = store.create('claude', { email: 'me@x.dev', plan: 'max' });
    expect(account).toEqual({
      id: 'acc1',
      configDir: null,
      email: 'me@x.dev',
      organization: null,
      plan: 'max',
      origin: 'claude',
      addedAt: 500,
      paused: false,
      switchAt: null,
    });
    expect(existsSync(join(home, 'accounts'))).toBe(false);
    expect(store.exists).toBe(true);
    expect(store.defaultAccountId).toBe('acc1');
    expectDomainError(
      () => store.create('claude'),
      'account_exists',
      'Your Claude Code login is already in your accounts.'
    );
  });

  test('a signed-in or imported account gets its own folder, and the first account becomes the default', () => {
    const { store, home } = createStore();
    const login = store.create('login');
    const imported = store.create('cswap', { email: 'b@x.dev', organization: 'Acme' });
    expect(login.configDir).toBe(join(home, 'accounts', 'acc1'));
    expect(imported).toMatchObject({
      configDir: join(home, 'accounts', 'acc2'),
      origin: 'cswap',
      organization: 'Acme',
    });
    expect(lstatSync(join(home, 'accounts', 'acc2')).mode & 0o777).toBe(0o700);
    expect(store.defaultAccountId).toBe('acc1');
    expect(readJson(join(home, 'accounts.json'))).toEqual({
      version: 1,
      defaultAccountId: 'acc1',
      accounts: [store.find('acc1'), store.find('acc2')],
    });
  });

  test('an account links the shared Claude settings but owns its login, .claude.json and backups', () => {
    const { store, sharedDir } = createStore({
      shared: {
        'settings.json': '{}',
        'CLAUDE.md': '# me',
        'projects/app/session.jsonl': '{}',
        '.credentials.json': '{"secret":true}',
        '.claude.json': '{}',
        'backups/one.json': '{}',
        '.oauth_refresh.lock/pid': '1',
      },
    });
    const { configDir } = store.create('login');
    const dir = configDir as string;
    expect(readdirSync(dir).sort()).toEqual(['.claude.json', 'CLAUDE.md', 'projects', 'settings.json']);
    for (const entry of ['CLAUDE.md', 'projects', 'settings.json']) {
      expect(readlinkSync(join(dir, entry))).toBe(join(sharedDir, entry));
    }
    expect(lstatSync(join(dir, '.claude.json')).isSymbolicLink()).toBe(false);
  });

  test('linking again adds entries the shared folder gained and keeps what the account already has', () => {
    const { store, sharedDir } = createStore({ shared: { 'settings.json': '{}' } });
    const dir = store.create('login').configDir as string;
    writeFiles(sharedDir, { 'skills/a.md': 'a', 'CLAUDE.md': 'shared' });
    writeFileSync(join(dir, 'CLAUDE.md'), 'own');
    store.linkSharedEntries(dir);
    expect(readlinkSync(join(dir, 'skills'))).toBe(join(sharedDir, 'skills'));
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('own');
  });

  test('a missing shared folder links nothing, and a link that cannot be made is logged', () => {
    const { store } = createStore();
    const dir = store.create('login').configDir as string;
    expect(readdirSync(dir)).toEqual(['.claude.json']);

    const shared = createStore({ shared: { 'settings.json': '{}' } });
    const locked = shared.store.create('login').configDir as string;
    writeFiles(shared.sharedDir, { 'CLAUDE.md': 'shared' });
    chmodSync(locked, 0o500);
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      shared.store.linkSharedEntries(locked);
      expect(warn.mock.calls.map(([message, fields]) => [message, fields?.entry])).toEqual([
        ['[Accounts] Could not share a Claude setting with an account', 'CLAUDE.md'],
      ]);
    } finally {
      warn.mockRestore();
      chmodSync(locked, 0o700);
    }
  });

  test('linking recreates an account folder that went missing, private and with its settings seeded', () => {
    const { store, sharedDir } = createStore({ shared: { 'settings.json': '{}' } });
    const dir = store.create('login').configDir as string;
    rmSync(dir, { recursive: true });
    store.linkSharedEntries(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readJson(join(dir, '.claude.json'))).toMatchObject({ hasCompletedOnboarding: true });
    expect(readlinkSync(join(dir, 'settings.json'))).toBe(join(sharedDir, 'settings.json'));
  });

  test('a new account’s .claude.json copies only the whitelisted settings and skips onboarding', () => {
    const { store } = createStore({
      globalConfig: {
        theme: 'dark',
        mcpServers: { x: { command: 'x' } },
        projects: { '/code': {} },
        oauthAccount: { emailAddress: 'someone@else.dev' },
        userID: 'abc',
        hasCompletedOnboarding: false,
      },
    });
    const dir = store.create('login').configDir as string;
    expect(readJson(join(dir, '.claude.json'))).toEqual({
      hasCompletedOnboarding: false,
      theme: 'dark',
      mcpServers: { x: { command: 'x' } },
      projects: { '/code': {} },
    });
  });

  test('without shared settings the new .claude.json only skips onboarding', () => {
    const info = spyOn(log, 'info').mockImplementation(() => undefined);
    try {
      const { store } = createStore({ globalConfig: null });
      const dir = store.create('login').configDir as string;
      expect(readJson(join(dir, '.claude.json'))).toEqual({ hasCompletedOnboarding: true });
      expect(info.mock.calls[0]?.[0]).toBe('[Accounts] No shared Claude settings to copy into a new account');
    } finally {
      info.mockRestore();
    }
  });

  test('an existing .claude.json in the account folder is never overwritten', () => {
    const { store, home } = createStore({ globalConfig: { theme: 'dark' } });
    writeFiles(join(home, 'accounts', 'acc1'), {
      '.claude.json': '{"oauthAccount":{"emailAddress":"kept@x.dev"}}',
    });
    const dir = store.create('login').configDir as string;
    expect(readJson(join(dir, '.claude.json'))).toEqual({ oauthAccount: { emailAddress: 'kept@x.dev' } });
  });

  test('writing account config merges into the account’s .claude.json, or starts it', () => {
    const { store } = createStore({ globalConfig: { theme: 'dark' } });
    const dir = store.create('login').configDir as string;
    store.writeAccountConfig(dir, { oauthAccount: { emailAddress: 'me@x.dev' } });
    expect(readJson(join(dir, '.claude.json'))).toEqual({
      hasCompletedOnboarding: true,
      theme: 'dark',
      oauthAccount: { emailAddress: 'me@x.dev' },
    });
    const fresh = join(createTempDir(), 'fresh');
    mkdirSync(fresh);
    store.writeAccountConfig(fresh, { theme: 'light' });
    expect(readJson(join(fresh, '.claude.json'))).toEqual({ theme: 'light' });
  });

  test('accounts are found by id or by email in any case', () => {
    const { store } = createStore();
    store.create('login', { email: 'Me@X.dev' });
    store.create('login');
    expect(store.selectByEmail('me@x.DEV')?.id).toBe('acc1');
    expect(store.selectByEmail('none@x.dev')).toBeNull();
    expect(store.find('acc2').id).toBe('acc2');
    expectDomainError(
      () => store.find('gone'),
      'account_not_found',
      'That account is no longer in your accounts.'
    );
  });

  test('the list is a copy, so changing it changes nothing', () => {
    const { store } = createStore();
    store.create('login');
    const [copy] = store.list();
    if (copy) copy.email = 'changed@x.dev';
    expect(store.find('acc1').email).toBeNull();
  });

  test('an update writes and announces only a real change', () => {
    const { store, reopen } = createStore();
    store.create('login');
    let changes = 0;
    const unsubscribe = store.subscribe(() => changes++);
    store.update('acc1', { email: null, paused: false });
    expect(changes).toBe(0);
    store.update('acc1', { paused: true, switchAt: 80 });
    expect(changes).toBe(1);
    store.update('missing', { paused: true });
    expect(changes).toBe(1);
    expect(reopen().find('acc1')).toMatchObject({ paused: true, switchAt: 80 });
    unsubscribe();
    store.update('acc1', { paused: false });
    expect(changes).toBe(1);
  });

  test('the default account can be changed to another known account', () => {
    const { store, reopen } = createStore();
    store.create('login');
    store.create('login');
    let changes = 0;
    store.subscribe(() => changes++);
    store.updateDefault('acc1');
    expect(changes).toBe(0);
    store.updateDefault('acc2');
    expect(changes).toBe(1);
    expect(reopen().defaultAccountId).toBe('acc2');
    expectDomainError(
      () => store.updateDefault('gone'),
      'account_not_found',
      'That account is no longer in your accounts.'
    );
  });

  test('moving an account clamps the position to the list', () => {
    const { store } = createStore();
    for (let index = 0; index < 3; index++) store.create('login');
    const order = () => store.list().map((account) => account.id);
    let changes = 0;
    store.subscribe(() => changes++);
    store.move('acc3', -4);
    expect(order()).toEqual(['acc3', 'acc1', 'acc2']);
    store.move('acc3', 99);
    expect(order()).toEqual(['acc1', 'acc2', 'acc3']);
    store.move('acc1', 1.4);
    expect(order()).toEqual(['acc2', 'acc1', 'acc3']);
    store.move('acc1', 1);
    expect(changes).toBe(3);
    expectDomainError(
      () => store.move('gone', 0),
      'account_not_found',
      'That account is no longer in your accounts.'
    );
  });

  test('removing the default account hands the default to the next one, and the last leaves none', () => {
    const { store } = createStore();
    store.create('claude');
    store.create('login');
    store.create('login');
    store.remove('acc2');
    expect(store.defaultAccountId).toBe('acc1');
    store.remove('acc1');
    expect(store.defaultAccountId).toBe('acc3');
    store.remove('acc3');
    expect(store.defaultAccountId).toBeNull();
    expectDomainError(
      () => store.remove('acc3'),
      'account_not_found',
      'That account is no longer in your accounts.'
    );
  });

  test('removing an account deletes its folder but only unlinks the shared settings', () => {
    const { store, sharedDir } = createStore({
      shared: { 'settings.json': '{"keep":true}', 'projects/a.jsonl': 'x' },
    });
    const dir = store.create('login').configDir as string;
    writeFiles(dir, { 'backups/b.json': '{}' });
    store.remove('acc1');
    expect(existsSync(dir)).toBe(false);
    expect(readFileSync(join(sharedDir, 'settings.json'), 'utf8')).toBe('{"keep":true}');
    expect(readFileSync(join(sharedDir, 'projects/a.jsonl'), 'utf8')).toBe('x');
  });

  test('removing a folder that is already gone does nothing', () => {
    const missing = join(createTempDir(), 'gone');
    removeAccountDir(missing);
    expect(existsSync(missing)).toBe(false);
  });

  test('an entry that disappears while the folder is removed is not treated as a link', () => {
    const dir = join(createTempDir(), 'acc');
    writeFiles(dir, { 'vanishing.json': '{}' });
    const vanishing = join(dir, 'vanishing.json');
    const lstat = spyOn(fs, 'lstatSync').mockImplementation(((path: string) => {
      throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), {
        code: 'ENOENT',
      });
    }) as typeof fs.lstatSync);
    try {
      removeAccountDir(dir);
      expect(lstat).toHaveBeenCalledWith(vanishing);
    } finally {
      lstat.mockRestore();
    }
    expect(existsSync(dir)).toBe(false);
  });

  test('a broken accounts.json is copied aside and Shinsa starts with no accounts', () => {
    const { home, reopen } = createStore();
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'accounts.json'), '{ broken');
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      const store = reopen();
      expect(store.list()).toEqual([]);
      const copies = readdirSync(home).filter((name) => name.startsWith('accounts.json.unreadable-'));
      expect(copies).toHaveLength(1);
      expect(readFileSync(join(home, copies[0] as string), 'utf8')).toBe('{ broken');
      expect(warn.mock.calls[0]?.[0]).toBe(
        '[Accounts] The account list could not be read; starting with none'
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('accounts with missing or invalid fields are dropped or cleaned on read', () => {
    const { home, reopen } = createStore();
    writeFiles(home, {
      'accounts.json': JSON.stringify({
        defaultAccountId: 'missing',
        accounts: [
          'junk',
          null,
          { origin: 'login' },
          { id: 'x', origin: 'api_key' },
          {
            id: ' a ',
            origin: 'login',
            configDir: '/acc/a',
            email: ' ',
            addedAt: 'today',
            paused: 'yes',
            switchAt: 0,
          },
          { id: 'b', origin: 'cswap', email: 'b@x.dev', addedAt: 7, paused: true, switchAt: 74.6 },
          { id: 'c', origin: 'claude', switchAt: 101 },
        ],
      }),
    });
    const store = reopen();
    expect(store.list()).toEqual([
      {
        id: 'a',
        configDir: '/acc/a',
        email: null,
        organization: null,
        plan: null,
        origin: 'login',
        addedAt: 0,
        paused: false,
        switchAt: null,
      },
      {
        id: 'b',
        configDir: null,
        email: 'b@x.dev',
        organization: null,
        plan: null,
        origin: 'cswap',
        addedAt: 7,
        paused: true,
        switchAt: 75,
      },
      {
        id: 'c',
        configDir: null,
        email: null,
        organization: null,
        plan: null,
        origin: 'claude',
        addedAt: 0,
        paused: false,
        switchAt: null,
      },
    ]);
    expect(store.defaultAccountId).toBe('a');
  });

  test('a known default is kept, and a file that is not an object is an empty list', () => {
    const { home, reopen } = createStore();
    writeFiles(home, {
      'accounts.json': JSON.stringify({
        defaultAccountId: 'b',
        accounts: [
          { id: 'a', origin: 'login' },
          { id: 'b', origin: 'login' },
        ],
      }),
    });
    expect(reopen().defaultAccountId).toBe('b');
    writeFiles(home, { 'accounts.json': 'null' });
    const store = reopen();
    expect(store.list()).toEqual([]);
    expect(store.defaultAccountId).toBeNull();
  });

  test('ids come from a random uuid by default', () => {
    const root = createTempDir();
    writeFileSync(join(root, '.claude.json'), '{}');
    const store = new AccountStore({
      home: root,
      sharedDir: join(root, 'claude'),
      sharedGlobalConfig: join(root, '.claude.json'),
    });
    const account = store.create('login');
    expect(account.id).toMatch(/^[0-9a-f]{8}$/);
    expect(account.addedAt).toBeGreaterThan(0);
  });
});
