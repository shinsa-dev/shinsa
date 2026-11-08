import { afterEach, describe, expect, test } from 'bun:test';
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
import { Effect, Exit, FileSystem, Layer, Scope } from 'effect';
import { systemError } from 'effect/PlatformError';
import { AccountChanges } from '../../src/accounts/changes/service.ts';
import { AccountFolders } from '../../src/accounts/folders/service.ts';
import type { AccountDetails, AccountIdentity, StoredAccount } from '../../src/accounts/schema.ts';
import type { AccountChange } from '../../src/accounts/store/schema.ts';
import { AccountStore } from '../../src/accounts/store/service.ts';
import { JsonFile } from '../../src/files/service.ts';
import { captureLogs, createTempDir, createTestConfig, writeFiles } from '../helpers/index.ts';
import { type AccountsHarness, buildUnitAccounts } from './harness.ts';

const open: AccountsHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

async function openStore(root: string, home: string, newId?: () => string, now?: number) {
  const harness = await buildUnitAccounts({
    config: { ...createTestConfig(root), home, userHome: root },
    env: {},
    ...(newId ? { newId } : {}),
    ...(now === undefined ? {} : { now }),
  });
  open.push(harness);
  const store = harness.service(AccountStore);
  const changes = harness.service(AccountChanges);
  const sync = harness.run;
  return {
    get exists() {
      return sync(store.exists);
    },
    get defaultAccountId() {
      return sync(store.defaultAccountId);
    },
    list: () => sync(store.list),
    select: (id: string) => sync(store.select(id)),
    find: (id: string) => sync(store.find(id)),
    selectByIdentity: (identity: AccountIdentity, exceptId?: string) =>
      sync(store.selectByIdentity(identity, exceptId)),
    resolveDuplicates: () => sync(store.resolveDuplicates),
    listDistinct: () => sync(store.listDistinct),
    isDefault: (id: string) => sync(store.isDefault(id)),
    create: (details?: AccountDetails): Promise<StoredAccount> => sync(store.create(details)),
    writeAccountConfig: (configDir: string, patch: Record<string, unknown>) =>
      sync(store.writeAccountConfig(configDir, patch)),
    linkSharedEntries: (configDir: string) => sync(store.linkSharedEntries(configDir)),
    createFolder: (id: string) => sync(store.createFolder(id)),
    update: (id: string, patch: AccountChange) => sync(store.update(id, patch)),
    updateDefault: (id: string) => sync(store.updateDefault(id)),
    move: (id: string, position: number) => sync(store.move(id, position)),
    remove: (id: string) => sync(store.remove(id)),
    removeFolder: (configDir: string) => sync(store.removeFolder(configDir)),
    subscribe: (listener: () => void) => {
      const scope = harness.runSync(Scope.make());
      harness.runSync(changes.listen(Effect.sync(listener)).pipe(Scope.provide(scope)));
      return () => harness.runSync(Scope.close(scope, Exit.void));
    },
  };
}

async function createStore(
  options: { ids?: string[]; shared?: Record<string, string>; globalConfig?: unknown } = {}
) {
  const root = createTempDir();
  const home = join(root, 'shinsa');
  const sharedDir = join(root, '.claude');
  const sharedGlobalConfig = join(root, '.claude.json');
  if (options.shared) writeFiles(sharedDir, options.shared);
  if (options.globalConfig !== null)
    writeFileSync(sharedGlobalConfig, JSON.stringify(options.globalConfig ?? {}));
  const ids = [...(options.ids ?? ['acc1', 'acc2', 'acc3'])];
  const reopen = () => openStore(root, home, () => ids.shift() ?? 'extra', 500);
  return { store: await reopen(), reopen, root, home, sharedDir, sharedGlobalConfig };
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function expectDomainError(act: () => unknown, code: string, message: string) {
  try {
    await act();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code, message });
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('account store', () => {
  test('starts with no accounts and no accounts.json', async () => {
    const { store } = await createStore();
    expect(await store.exists).toBe(false);
    expect(await store.list()).toEqual([]);
    expect(await store.defaultAccountId).toBeNull();
    expect(await store.select('acc1')).toBeNull();
  });

  test('a signed-in account gets its own folder, and the first account becomes the default', async () => {
    const { store, home } = await createStore();
    const first = await store.create();
    const second = await store.create({ email: 'b@x.dev', organization: 'Acme' });
    expect(first).toEqual({
      id: 'acc1',
      configDir: join(home, 'accounts', 'acc1'),
      email: null,
      organization: null,
      plan: null,
      origin: 'login',
      addedAt: 500,
      paused: false,
      switchAt: null,
    });
    expect(second).toMatchObject({ configDir: join(home, 'accounts', 'acc2'), organization: 'Acme' });
    expect(lstatSync(join(home, 'accounts', 'acc2')).mode & 0o777).toBe(0o700);
    expect(await store.exists).toBe(true);
    expect(await store.defaultAccountId).toBe('acc1');
    expect(readJson(join(home, 'accounts.json'))).toEqual({
      version: 1,
      defaultAccountId: 'acc1',
      accounts: [await store.find('acc1'), await store.find('acc2')],
    });
  });

  test('an account that ran on your Claude Code login gets a folder of its own when it signs in again', async () => {
    const { reopen, home } = await createStore();
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, 'accounts.json'),
      JSON.stringify({
        version: 1,
        defaultAccountId: 'mine',
        accounts: [
          {
            id: 'mine',
            configDir: null,
            email: 'me@x.dev',
            organization: null,
            plan: 'max',
            origin: 'claude',
            addedAt: 1,
            paused: false,
            switchAt: null,
          },
        ],
      })
    );
    const store = await reopen();
    expect(await store.createFolder('mine')).toMatchObject({
      configDir: join(home, 'accounts', 'mine'),
      origin: 'claude',
    });
    expect(existsSync(join(home, 'accounts', 'mine'))).toBe(true);
    expect((await (await reopen()).find('mine')).configDir).toBe(join(home, 'accounts', 'mine'));
    expect((await store.createFolder('mine'))?.configDir).toBe(join(home, 'accounts', 'mine'));
    expect(await store.createFolder('gone')).toBeNull();
  });

  test('an account links the shared Claude settings but owns its login, .claude.json and backups', async () => {
    const { store, sharedDir } = await createStore({
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
    const { configDir } = await store.create();
    const dir = configDir as string;
    expect(readdirSync(dir).sort()).toEqual(['.claude.json', 'CLAUDE.md', 'projects', 'settings.json']);
    for (const entry of ['CLAUDE.md', 'projects', 'settings.json']) {
      expect(readlinkSync(join(dir, entry))).toBe(join(sharedDir, entry));
    }
    expect(lstatSync(join(dir, '.claude.json')).isSymbolicLink()).toBe(false);
  });

  test('linking again adds entries the shared folder gained and keeps what the account already has', async () => {
    const { store, sharedDir } = await createStore({ shared: { 'settings.json': '{}' } });
    const dir = (await store.create()).configDir as string;
    writeFiles(sharedDir, { 'skills/a.md': 'a', 'CLAUDE.md': 'shared' });
    writeFileSync(join(dir, 'CLAUDE.md'), 'own');
    await store.linkSharedEntries(dir);
    expect(readlinkSync(join(dir, 'skills'))).toBe(join(sharedDir, 'skills'));
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('own');
  });

  test('a missing shared folder links nothing, and a link that cannot be made is logged', async () => {
    const { store } = await createStore();
    const dir = (await store.create()).configDir as string;
    expect(readdirSync(dir)).toEqual(['.claude.json']);

    const shared = await createStore({ shared: { 'settings.json': '{}' } });
    const locked = (await shared.store.create()).configDir as string;
    writeFiles(shared.sharedDir, { 'CLAUDE.md': 'shared' });
    chmodSync(locked, 0o500);
    const logs = captureLogs();
    try {
      await shared.store.linkSharedEntries(locked);
    } finally {
      logs.restore();
      chmodSync(locked, 0o700);
    }
    expect(logs.entries.map((entry) => [entry.message, entry.entry])).toEqual([
      ['[Accounts] Could not share a Claude setting with an account', 'CLAUDE.md'],
    ]);
  });

  test('linking recreates an account folder that went missing, private and with its settings seeded', async () => {
    const { store, sharedDir } = await createStore({ shared: { 'settings.json': '{}' } });
    const dir = (await store.create()).configDir as string;
    rmSync(dir, { recursive: true });
    await store.linkSharedEntries(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readJson(join(dir, '.claude.json'))).toMatchObject({ hasCompletedOnboarding: true });
    expect(readlinkSync(join(dir, 'settings.json'))).toBe(join(sharedDir, 'settings.json'));
  });

  test('a new account’s .claude.json copies only the whitelisted settings and skips onboarding', async () => {
    const { store } = await createStore({
      globalConfig: {
        theme: 'dark',
        mcpServers: { x: { command: 'x' } },
        projects: { '/code': {} },
        oauthAccount: { emailAddress: 'someone@else.dev' },
        userID: 'abc',
        hasCompletedOnboarding: false,
      },
    });
    const dir = (await store.create()).configDir as string;
    expect(readJson(join(dir, '.claude.json'))).toEqual({
      hasCompletedOnboarding: false,
      theme: 'dark',
      mcpServers: { x: { command: 'x' } },
      projects: { '/code': {} },
    });
  });

  test('without shared settings the new .claude.json only skips onboarding', async () => {
    const logs = captureLogs();
    try {
      const { store } = await createStore({ globalConfig: null });
      const dir = (await store.create()).configDir as string;
      expect(readJson(join(dir, '.claude.json'))).toEqual({ hasCompletedOnboarding: true });
    } finally {
      logs.restore();
    }
    expect(logs.entries[0]?.message).toBe('[Accounts] No shared Claude settings to copy into a new account');
  });

  test('an existing .claude.json in the account folder is never overwritten', async () => {
    const { store, home } = await createStore({ globalConfig: { theme: 'dark' } });
    writeFiles(join(home, 'accounts', 'acc1'), {
      '.claude.json': '{"oauthAccount":{"emailAddress":"kept@x.dev"}}',
    });
    const dir = (await store.create()).configDir as string;
    expect(readJson(join(dir, '.claude.json'))).toEqual({ oauthAccount: { emailAddress: 'kept@x.dev' } });
  });

  test('writing account config merges into the account’s .claude.json, or starts it', async () => {
    const { store } = await createStore({ globalConfig: { theme: 'dark' } });
    const dir = (await store.create()).configDir as string;
    await store.writeAccountConfig(dir, { oauthAccount: { emailAddress: 'me@x.dev' } });
    expect(readJson(join(dir, '.claude.json'))).toEqual({
      hasCompletedOnboarding: true,
      theme: 'dark',
      oauthAccount: { emailAddress: 'me@x.dev' },
    });
    const fresh = join(createTempDir(), 'fresh');
    mkdirSync(fresh);
    await store.writeAccountConfig(fresh, { theme: 'light' });
    expect(readJson(join(fresh, '.claude.json'))).toEqual({ theme: 'light' });
    writeFileSync(join(fresh, '.claude.json'), '{ broken');
    await store.writeAccountConfig(fresh, { theme: 'dark' });
    expect(readJson(join(fresh, '.claude.json'))).toEqual({ theme: 'dark' });
  });

  test('accounts are found by id or by their email and organization in any case', async () => {
    const { store } = await createStore();
    await store.create({ email: 'Me@X.dev', organization: 'Acme' });
    await store.create();
    expect((await store.selectByIdentity({ email: 'me@x.DEV', organization: 'ACME' }))?.id).toBe('acc1');
    expect((await store.selectByIdentity({ email: 'me@x.dev', organization: null }))?.id).toBe('acc1');
    expect(await store.selectByIdentity({ email: 'me@x.dev', organization: 'Other' })).toBeNull();
    expect(await store.selectByIdentity({ email: 'me@x.dev', organization: 'Acme' }, 'acc1')).toBeNull();
    expect(await store.selectByIdentity({ email: 'none@x.dev', organization: null })).toBeNull();
    expect(await store.selectByIdentity({ email: null, organization: null })).toBeNull();
    expect((await store.find('acc2')).id).toBe('acc2');
    await expectDomainError(() => store.find('gone'), 'account_not_found', 'That account was removed.');
  });

  test('the list is a copy, so changing it changes nothing', async () => {
    const { store } = await createStore();
    await store.create();
    const [copy] = await store.list();
    if (copy) copy.email = 'changed@x.dev';
    expect((await store.find('acc1')).email).toBeNull();
  });

  test('an update writes and announces only a real change', async () => {
    const { store, reopen } = await createStore();
    await store.create();
    let changes = 0;
    const unsubscribe = await store.subscribe(() => changes++);
    await store.update('acc1', { email: null, paused: false });
    expect(changes).toBe(0);
    await store.update('acc1', { paused: true, switchAt: 80 });
    expect(changes).toBe(1);
    await store.update('missing', { paused: true });
    expect(changes).toBe(1);
    expect(await (await reopen()).find('acc1')).toMatchObject({ paused: true, switchAt: 80 });
    unsubscribe();
    await store.update('acc1', { paused: false });
    expect(changes).toBe(1);
  });

  test('the default account can be changed to another known account', async () => {
    const { store, reopen } = await createStore();
    await store.create();
    await store.create();
    let changes = 0;
    await store.subscribe(() => changes++);
    await store.updateDefault('acc1');
    expect(changes).toBe(0);
    await store.updateDefault('acc2');
    expect(changes).toBe(1);
    expect(await (await reopen()).defaultAccountId).toBe('acc2');
    await expectDomainError(
      () => store.updateDefault('gone'),
      'account_not_found',
      'That account was removed.'
    );
  });

  test('moving an account clamps the position to the list', async () => {
    const { store } = await createStore();
    for (let index = 0; index < 3; index++) await store.create();
    const order = async () => (await store.list()).map((account) => account.id);
    let changes = 0;
    await store.subscribe(() => changes++);
    await store.move('acc3', -4);
    expect(await order()).toEqual(['acc3', 'acc1', 'acc2']);
    await store.move('acc3', 99);
    expect(await order()).toEqual(['acc1', 'acc2', 'acc3']);
    await store.move('acc1', 1.4);
    expect(await order()).toEqual(['acc2', 'acc1', 'acc3']);
    await store.move('acc1', 1);
    expect(changes).toBe(3);
    await expectDomainError(() => store.move('gone', 0), 'account_not_found', 'That account was removed.');
  });

  test('removing the default account hands the default to the next one, and the last leaves none', async () => {
    const { store } = await createStore();
    await store.create();
    await store.create();
    await store.create();
    await store.remove('acc2');
    expect(await store.defaultAccountId).toBe('acc1');
    await store.remove('acc1');
    expect(await store.defaultAccountId).toBe('acc3');
    await store.remove('acc3');
    expect(await store.defaultAccountId).toBeNull();
    await expectDomainError(() => store.remove('acc3'), 'account_not_found', 'That account was removed.');
  });

  test('removing an account deletes its folder but only unlinks the shared settings', async () => {
    const { store, sharedDir } = await createStore({
      shared: { 'settings.json': '{"keep":true}', 'projects/a.jsonl': 'x' },
    });
    const dir = (await store.create()).configDir as string;
    writeFiles(dir, { 'backups/b.json': '{}' });
    await store.remove('acc1');
    expect(existsSync(dir)).toBe(false);
    expect(readFileSync(join(sharedDir, 'settings.json'), 'utf8')).toBe('{"keep":true}');
    expect(readFileSync(join(sharedDir, 'projects/a.jsonl'), 'utf8')).toBe('x');
  });

  test('removing a folder that is already gone does nothing', async () => {
    const missing = join(createTempDir(), 'gone');
    const { store } = await createStore();
    await store.removeFolder(missing);
    expect(existsSync(missing)).toBe(false);
  });

  test('an entry that disappears while the folder is removed is not treated as a link', async () => {
    const removed: string[] = [];
    const files = FileSystem.makeNoop({
      readDirectory: () => Effect.succeed(['vanishing.json']),
      lstat: (path) =>
        Effect.fail(
          systemError({ _tag: 'NotFound', module: 'FileSystem', method: 'lstat', pathOrDescriptor: path })
        ),
      remove: (path) => Effect.sync(() => void removed.push(path)),
    });
    await Effect.runPromise(
      AccountFolders.use((folders) => folders.remove('/acc')).pipe(
        Effect.provide(
          AccountFolders.layer.pipe(
            Layer.provideMerge(JsonFile.layer),
            Layer.provide(Layer.succeed(FileSystem.FileSystem, files))
          )
        )
      )
    );
    expect(removed).toEqual(['/acc']);
  });

  test('a broken accounts.json is copied aside and Shinsa starts with no accounts', async () => {
    const { home, reopen } = await createStore();
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'accounts.json'), '{ broken');
    const logs = captureLogs();
    try {
      const store = await reopen();
      expect(await store.list()).toEqual([]);
      const copies = readdirSync(home).filter((name) => name.startsWith('accounts.json.unreadable-'));
      expect(copies).toHaveLength(1);
      expect(readFileSync(join(home, copies[0] as string), 'utf8')).toBe('{ broken');
    } finally {
      logs.restore();
    }
    expect(logs.entries[0]?.message).toBe(
      '[Accounts] The account list could not be read; starting with none'
    );
  });

  test('accounts with missing or invalid fields are dropped or cleaned on read', async () => {
    const { home, reopen } = await createStore();
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
    const store = await reopen();
    expect(await store.list()).toEqual([
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
    expect(await store.defaultAccountId).toBe('a');
  });

  test('a known default is kept, and a file that is not an object is an empty list', async () => {
    const { home, reopen } = await createStore();
    writeFiles(home, {
      'accounts.json': JSON.stringify({
        defaultAccountId: 'b',
        accounts: [
          { id: 'a', origin: 'login' },
          { id: 'b', origin: 'login' },
        ],
      }),
    });
    expect(await (await reopen()).defaultAccountId).toBe('b');
    writeFiles(home, { 'accounts.json': 'null' });
    const store = await reopen();
    expect(await store.list()).toEqual([]);
    expect(await store.defaultAccountId).toBeNull();
  });

  test('ids come from a random uuid by default, and the time from the clock', async () => {
    const root = createTempDir();
    writeFileSync(join(root, '.claude.json'), '{}');
    const store = await openStore(root, join(root, 'shinsa'), undefined, 1_234);
    const account = await store.create();
    expect(account.id).toMatch(/^[0-9a-f]{8}$/);
    expect(account.addedAt).toBe(1_234);
  });

  test('an account with the login of another is a duplicate of it, and a login of its own is kept over a shared one', async () => {
    const { store } = await createStore({ ids: ['copy', 'other', 'mine', 'org'] });
    await store.create({ email: 'me@x.dev', organization: 'Acme' });
    await store.create({ email: 'you@x.dev', organization: 'Acme' });
    await store.create({ email: 'ME@x.dev', organization: 'acme' });
    await store.create({ email: 'me@x.dev', organization: 'Elsewhere' });
    await store.update('copy', { origin: 'cswap' });
    await store.update('other', { origin: 'claude' });
    expect(await store.defaultAccountId).toBe('copy');
    expect([...(await store.resolveDuplicates())]).toEqual([['copy', 'mine']]);
    expect((await store.listDistinct()).map((account) => account.id)).toEqual(['other', 'mine', 'org']);
    expect(await store.isDefault('mine')).toBe(true);
    expect(await store.isDefault('copy')).toBe(true);
    expect(await store.isDefault('other')).toBe(false);
    await store.update('mine', { email: 'new@x.dev' });
    expect((await store.resolveDuplicates()).size).toBe(0);
    expect(await store.isDefault('mine')).toBe(false);
  });

  test('of two copies Shinsa keeps the default, then the one listed first', async () => {
    const { store } = await createStore({ ids: ['first', 'second', 'third'] });
    await store.create({ email: 'me@x.dev' });
    await store.create({ email: 'me@x.dev', organization: 'Acme' });
    await store.create({ email: 'me@x.dev', organization: 'Acme' });
    expect([...(await store.resolveDuplicates())]).toEqual([
      ['second', 'first'],
      ['third', 'first'],
    ]);
    await store.updateDefault('third');
    expect([...(await store.resolveDuplicates())]).toEqual([
      ['first', 'third'],
      ['second', 'third'],
    ]);
    await store.remove('first');
    await store.remove('second');
    await store.remove('third');
    expect(await store.isDefault('third')).toBe(false);
  });
});
