import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TerminalInfo } from '@shinsa/core';
import { ConfigStore } from '../../src/config/index.ts';
import { type CommandRunner, type InstallTerminals, Onboarding } from '../../src/onboarding/index.ts';
import { PRIVACY_SETTINGS_URL, PrivateFoldersError, resolveChosenRoots } from '../../src/onboarding/roots.ts';
import { Roots } from '../../src/repos/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTempDir, createTestConfig, overrideEnv } from '../helpers/index.ts';

function setup(run?: CommandRunner, terminals?: InstallTerminals) {
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
    resolveLogin: () => Promise.resolve(null),
    ask: () => Promise.resolve(null),
    run: run ?? (() => Promise.resolve({ ok: true, code: 0, stdout: 'v1', stderr: '', timedOut: false })),
    models: { listModels: () => Promise.resolve([]) },
    accounts: () => Promise.resolve([]),
    terminals,
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
      approvePlans: 'large',
    });
    expect(status.roots).toMatchObject({ source: 'configured', configured: [developer] });
    expect(status.defaults).toEqual({ model: 'sonnet', mergeMethod: 'rebase' });
    expect(engine.state.settings).toMatchObject({
      defaultModel: 'sonnet',
      mergeMethod: 'rebase',
      approvePlans: 'large',
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
      [{ roots: [root], approvePlans: true }, 'Approve plans when you ask, for large plans or always.'],
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

  test('needs Bun only when a repository in your folders uses it', async () => {
    const run: CommandRunner = (command) =>
      Promise.resolve({
        ok: command[0] !== 'bun',
        code: command[0] === 'bun' ? 127 : 0,
        stdout: 'v1',
        stderr: '',
        timedOut: false,
      });
    const { onboarding, developer } = setup(run);
    expect((await onboarding.resolvePrerequisites()).ready).toBe(true);
    writeFileSync(join(developer, 'app', 'bun.lock'), '');
    const report = await onboarding.resolvePrerequisites();
    expect(report.ready).toBe(false);
    expect(report.checks.find((check) => check.id === 'bun')).toMatchObject({
      ok: false,
      detail: 'Not installed.',
    });
  });

  test('finds a tool installed since Shinsa started: each check puts the install folders on PATH', async () => {
    const { onboarding, config } = setup();
    const restore = overrideEnv({ PATH: '/usr/bin:/bin' });
    try {
      await onboarding.resolvePrerequisites();
      const before = process.env.PATH;
      expect(before?.startsWith('/usr/bin:/bin')).toBe(true);
      mkdirSync(join(config.userHome, '.local/bin'), { recursive: true });
      await onboarding.resolvePrerequisites();
      expect(process.env.PATH).toBe(`${before}:${join(config.userHome, '.local/bin')}`);
    } finally {
      restore();
    }
  });

  test('opens the install terminal for a check, refuses a command no help task replied with, and refuses without terminals', async () => {
    const opened: string[] = [];
    const terminals: InstallTerminals = {
      snapshot: () => ({ terminals: [], services: [], home: '/' }),
      create: (start) => ({ id: 't1', ...start }) as unknown as TerminalInfo,
      rename: () => undefined,
      run: (_id, command) => {
        opened.push(command);
      },
      close: () => undefined,
    };
    const { onboarding, config } = setup(undefined, terminals);
    expect(await onboarding.openInstall({ id: 'gh' })).toEqual({
      terminal: expect.objectContaining({ id: 't1', cwd: config.userHome, name: 'Set up GitHub CLI' }),
    });
    expect(opened).toEqual(['brew install gh; exit']);
    expect(onboarding.openInstall({ command: 'rm -rf ~' })).rejects.toThrow(
      'Shinsa runs only the commands the help task’s agent replied with.'
    );
    expect(onboarding.openInstall({ id: 3 })).rejects.toThrow(
      'Send “id” as the check to fix, such as gh, or a “command” from the help task.'
    );
    expect(setup().onboarding.openInstall({ id: 'gh' })).rejects.toThrow(
      'Terminals are off, so run the command yourself.'
    );
    expect(opened).toEqual(['brew install gh; exit']);
  });

  test('resolveChosenRoots expands ~ and drops duplicates', () => {
    const { root, developer } = setup();
    expect(resolveChosenRoots(['~', '~/Developer', developer], root)).toEqual([root, developer]);
  });

  test('resolveChosenRoots names every folder macOS keeps private, once, and how to allow them', () => {
    const { root, developer } = setup();
    const refuse = (code: string) => (path: string) => {
      if (path === developer) return [];
      throw Object.assign(new Error(code), { code });
    };
    for (const code of ['EPERM', 'EACCES']) {
      let refusal: unknown = null;
      try {
        resolveChosenRoots(['~', '~/Developer', root], root, refuse(code));
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(PrivateFoldersError);
      expect(refusal).toMatchObject({
        code: 'roots_private',
        folders: [root],
        picked: [root, developer],
        message:
          'macOS keeps ~ private. Turn on Shinsa in System Settings → Privacy & Security → Full Disk Access, then check again.',
      });
    }
    expect(() => resolveChosenRoots(['~'], root, refuse('EIO'))).toThrow('EIO');
  });

  test('opens the Full Disk Access pane of System Settings', async () => {
    const calls: string[][] = [];
    const { onboarding } = setup((command) => {
      calls.push(command);
      return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false });
    });
    expect(await onboarding.openPrivacySettings()).toEqual({ ok: true });
    expect(calls).toEqual([['open', PRIVACY_SETTINGS_URL]]);
    expect(PRIVACY_SETTINGS_URL).toContain('Privacy_AllFiles');
  });
});
