import { describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigStore } from '../../src/config/index.ts';
import { Onboarding } from '../../src/onboarding/index.ts';
import { resolveChosenRoots } from '../../src/onboarding/roots.ts';
import { Roots } from '../../src/repos/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTempDir, createTestConfig } from '../helpers/index.ts';

function setup() {
  const root = createTempDir();
  const config = createTestConfig(root, { roots: [] });
  const engine = new Engine(new EventLog(config.databasePath));
  const store = new ConfigStore(config.configPath);
  const developer = join(root, 'Developer');
  mkdirSync(join(developer, 'app', '.git'), { recursive: true });
  const roots = new Roots([], store, root, () =>
    Promise.resolve({ candidates: [{ path: developer, repoCount: 1, repos: ['app'] }], truncated: false })
  );
  const onboarding = new Onboarding({
    engine,
    config,
    store,
    roots,
    run: () => Promise.resolve({ ok: true, code: 0, stdout: 'v1', stderr: '', timedOut: false }),
    models: { listModels: () => Promise.resolve([]) },
    accounts: () => Promise.resolve([]),
    accountActions: {
      listImports: () => Promise.resolve([]),
      importAccount: () => Promise.resolve(),
      startLogin: () => Promise.resolve(),
      isSigningIn: () => false,
    },
    interpret: () => Promise.resolve(null),
    clarify: () => Promise.resolve(null),
  });
  return { root, config, engine, store, developer, onboarding };
}

describe('Onboarding', () => {
  test('starts not done, with discovered folders standing in for the chosen ones', async () => {
    const { onboarding, config, developer } = setup();
    expect(await onboarding.resolveStatus()).toEqual({
      completed: false,
      completedAt: null,
      roots: { source: 'discovered', configured: [], fromEnvironment: [], effective: [developer] },
      defaults: { model: 'opus', mergeMethod: 'squash' },
      paths: {
        home: config.home,
        configPath: config.configPath,
        dataDir: config.dataDir,
        userHome: config.userHome,
      },
    });
    expect(await onboarding.listSuggestions(false)).toEqual({
      suggestions: [{ path: developer, repoCount: 1, repos: ['app'], chosen: false }],
      truncated: false,
    });
  });

  test('saves the folders to config.json and the defaults as settings, then completes', async () => {
    const { onboarding, engine, store, developer, root } = setup();
    expect(() => onboarding.complete()).toThrow('Choose the folders that hold your repositories first.');
    const status = await onboarding.applySetup({
      roots: ['~/Developer', `${developer}/`],
      defaultModel: 'sonnet',
      mergeMethod: 'rebase',
      approvePlans: true,
    });
    expect(status.roots).toMatchObject({ source: 'configured', configured: [developer] });
    expect(status.defaults).toEqual({ model: 'sonnet', mergeMethod: 'rebase' });
    expect(engine.state.settings).toMatchObject({
      defaultModel: 'sonnet',
      mergeMethod: 'rebase',
      approvePlans: true,
    });
    expect(store.config.roots).toEqual([developer]);
    expect((await onboarding.listSuggestions(true)).suggestions[0]?.chosen).toBe(true);
    const seq = engine.state.seq;
    await onboarding.applySetup({ roots: [root] });
    expect(engine.state.seq).toBe(seq);
    const done = await onboarding.complete();
    expect(done.completed).toBe(true);
    expect((await onboarding.complete()).completedAt).toBe(done.completedAt);
    expect(new ConfigStore(store.path).config.onboardedAt).toBe(done.completedAt);
  });

  test('refuses a setup it cannot use, and changes nothing', async () => {
    const { onboarding, store, root } = setup();
    for (const [body, message] of [
      [{ roots: [] }, 'Choose at least one folder that holds your repositories.'],
      [{ roots: 'x' }, 'Choose at least one folder that holds your repositories.'],
      [{ roots: Array.from({ length: 51 }, () => root) }, 'Choose at most 50 folders.'],
      [{ roots: [3] }, 'Each folder must be a path.'],
      [{ roots: ['relative/path'] }, 'relative/path is not a full path.'],
      [{ roots: ['/no/such/folder'] }, '/no/such/folder is not a folder on this machine.'],
      [{ roots: [root], defaultModel: 'rm -rf' }, 'Pick a model from the list.'],
      [{ roots: [root], mergeMethod: 'fast-forward' }, 'Merge with squash, merge or rebase.'],
      [{ roots: [root], approvePlans: 'sometimes' }, 'Say yes or no to approving plans.'],
    ] as const) {
      await expect(onboarding.applySetup(body)).rejects.toThrow(message);
    }
    expect(store.config.roots).toEqual([]);
    expect((await onboarding.applySetup({ roots: [root], defaultModel: null })).defaults.model).toBeNull();
  });

  test('checks the prerequisites with the injected runner', async () => {
    const { onboarding } = setup();
    expect((await onboarding.resolvePrerequisites()).ready).toBe(true);
  });

  test('resolveChosenRoots expands ~ and drops duplicates', () => {
    const { root, developer } = setup();
    expect(resolveChosenRoots(['~', '~/Developer', developer], root)).toEqual([root, developer]);
  });

  test('resolveChosenRoots says how to give Shinsa access to a folder macOS keeps private', () => {
    const { root } = setup();
    const refuse = (code: string) => () => {
      throw Object.assign(new Error(code), { code });
    };
    for (const code of ['EPERM', 'EACCES']) {
      expect(() => resolveChosenRoots(['~'], root, refuse(code))).toThrow(
        expect.objectContaining({ code: 'roots_unreadable' })
      );
    }
    expect(() => resolveChosenRoots(['~'], root, refuse('EIO'))).toThrow('EIO');
  });
});
