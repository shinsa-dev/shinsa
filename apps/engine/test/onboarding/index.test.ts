import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TerminalInfo } from '@shinsa/core';
import { Effect } from 'effect';
import { type SystemErrorTag, systemError } from 'effect/PlatformError';
import type { ServerConfig } from '../../src/config/index.ts';
import type { InstallTerminals } from '../../src/onboarding/index.ts';
import { PRIVACY_SETTINGS_URL, resolveChosenRoots } from '../../src/onboarding/roots.ts';
import type { CommandRunner } from '../../src/onboarding/schema.ts';
import { measureWorktreeUsage } from '../../src/onboarding/worktrees.ts';
import { runCommand } from '../../src/shell/command.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import { WORKTREE_ROOT_MARKER } from '../../src/workspaces/root/schema.ts';
import { runFiles } from '../harness.ts';
import { readMachineConfig } from '../helpers/config.ts';
import { Engine } from '../helpers/engine.ts';
import { openEventLog } from '../helpers/event-log.ts';
import { createTempDir, createTestConfig, overrideEnv } from '../helpers/index.ts';
import { createTestMachine } from '../helpers/machine.ts';
import { promised } from '../helpers/promised.ts';
import { createTask } from '../helpers/state.ts';
import { createTestOnboardingService, type FakeCommand } from './harness.ts';

async function setup(
  run?: FakeCommand,
  terminals?: InstallTerminals,
  simulateMissing: string[] = [],
  overrides: Partial<ServerConfig> = {}
) {
  const root = createTempDir();
  const config = createTestConfig(root, { roots: [], simulateMissing, ...overrides });
  const engine = new Engine(openEventLog(config.databasePath));
  const developer = join(root, 'Developer');
  mkdirSync(join(developer, 'app', '.git'), { recursive: true });
  const { store, context } = await createTestMachine(engine, config, {
    discover: () =>
      Promise.resolve({
        candidates: [{ path: developer, repoCount: 1, repos: ['app'] }],
        truncated: false,
        refused: [],
      }),
  });
  const onboarding = promised(
    createTestOnboardingService({
      engine,
      config,
      machine: context,
      run: run ?? (() => Promise.resolve({ ok: true, code: 0, stdout: 'v1', stderr: '', timedOut: false })),
      terminals: terminals ?? null,
    })
  );
  return { root, config, engine, store, developer, onboarding };
}

describe('Onboarding', () => {
  test('starts not done, with discovered folders standing in for the chosen ones', async () => {
    const { onboarding, config, developer } = await setup();
    expect(await onboarding.resolveStatus()).toEqual({
      completed: false,
      completedAt: null,
      roots: { source: 'discovered', configured: [], fromEnvironment: [], effective: [developer] },
      defaults: { model: 'opus', mergeMethod: 'squash' },
      worktrees: {
        effective: config.worktreesDir,
        configured: null,
        default: config.worktreesDir,
        fromEnvironment: null,
        problem: null,
      },
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
      refused: [],
    });
  });

  test('saves the folders to config.json and the defaults as settings, then completes', async () => {
    const { onboarding, engine, store, developer, root } = await setup();
    expect(() => onboarding.complete()).toThrow('Choose your repository folders first.');
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
    expect(Effect.runSync(store.config).roots).toEqual([developer]);
    expect((await onboarding.listSuggestions(true)).suggestions[0]?.chosen).toBe(true);
    const seq = engine.state.seq;
    await onboarding.applySetup({ roots: [root] });
    expect(engine.state.seq).toBe(seq);
    const done = await onboarding.complete();
    expect(done.completed).toBe(true);
    expect((await onboarding.complete()).completedAt).toBe(done.completedAt);
    expect(readMachineConfig(store.path).config.onboardedAt).toBe(done.completedAt);
  });

  test('refuses a setup it cannot use, and changes nothing', async () => {
    const { onboarding, store, root } = await setup();
    for (const [body, message] of [
      [{ roots: [] }, 'Choose a folder with your repositories.'],
      [{ roots: 'x' }, 'Choose a folder with your repositories.'],
      [{ roots: Array.from({ length: 51 }, () => root) }, 'Choose at most 50 folders.'],
      [{ roots: [3] }, 'Each folder must be a path.'],
      [{ roots: ['relative/path'] }, 'relative/path is not a full path.'],
      [{ roots: ['/no/such/folder'] }, 'That is not a folder on this machine.'],
      [{ roots: [root], defaultModel: 'rm -rf' }, 'Pick a model from the list.'],
      [{ roots: [root], mergeMethod: 'fast-forward' }, 'Merge with squash, merge or rebase.'],
      [{ roots: [root], approvePlans: true }, 'Approve plans when you ask, for large plans or always.'],
    ] as const) {
      await expect(onboarding.applySetup(body)).rejects.toThrow(message);
    }
    expect(Effect.runSync(store.config).roots).toEqual([]);
    expect((await onboarding.applySetup({ roots: [root], defaultModel: null })).defaults.model).toBeNull();
  });

  test('saves the worktree folder to config.json, and goes back to the default with null', async () => {
    const { onboarding, store, config, root } = await setup();
    const mount = join(root, 'Bucket');
    mkdirSync(mount);
    const status = await onboarding.applyWorktreesDir({ path: '~/Bucket/' });
    expect(status.worktrees).toEqual({
      effective: mount,
      configured: mount,
      default: config.worktreesDir,
      fromEnvironment: null,
      problem: null,
    });
    expect(readMachineConfig(store.path).config.worktreesDir).toBe(mount);
    expect(existsSync(join(mount, WORKTREE_ROOT_MARKER))).toBe(true);
    rmSync(join(mount, WORKTREE_ROOT_MARKER));
    expect((await onboarding.resolveStatus()).worktrees.problem).toContain(
      `The worktree folder ${mount} is not the one you chose`
    );
    rmSync(mount, { recursive: true });
    expect((await onboarding.resolveStatus()).worktrees.problem).toContain(
      `The worktree folder ${mount} does not exist.`
    );
    const reset = await onboarding.applyWorktreesDir({ path: null });
    expect(reset.worktrees).toMatchObject({
      effective: config.worktreesDir,
      configured: null,
      problem: null,
    });
    expect(Effect.runSync(store.config).worktreesDir).toBeNull();
  });

  test('refuses a worktree folder it cannot use, and keeps the one it had', async () => {
    const { onboarding, store, root } = await setup();
    const file = join(root, 'notes.txt');
    writeFileSync(file, 'x');
    const locked = join(root, 'Locked');
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    for (const [body, message] of [
      [{}, 'Send “path” as the full path of a folder, or null to use the default.'],
      [{ path: 3 }, 'Send “path” as the full path of a folder, or null to use the default.'],
      [{ path: '  ' }, 'Send “path” as the full path of a folder, or null to use the default.'],
      [{ path: 'relative/wt' }, 'relative/wt is not a full path.'],
      [{ path: '/no/such/mount' }, 'The worktree folder /no/such/mount does not exist.'],
      [{ path: file }, `The worktree folder ${file} is not a folder.`],
      [{ path: locked }, `Shinsa cannot write to the worktree folder ${locked}.`],
    ] as const) {
      await expect(onboarding.applyWorktreesDir(body)).rejects.toThrow(message);
    }
    chmodSync(locked, 0o700);
    expect(Effect.runSync(store.config).worktreesDir).toBeNull();
  });

  test('refuses a worktree folder it can see but cannot mark as its own', async () => {
    const { onboarding, store, root } = await setup();
    const readOnly = join(root, 'ReadOnly');
    mkdirSync(readOnly);
    writeFileSync(join(readOnly, WORKTREE_ROOT_MARKER), '');
    chmodSync(join(readOnly, WORKTREE_ROOT_MARKER), 0o400);
    await expect(onboarding.applyWorktreesDir({ path: readOnly })).rejects.toThrow(
      `Shinsa cannot write to the worktree folder ${readOnly}.`
    );
    expect(Effect.runSync(store.config).worktreesDir).toBeNull();
  });

  test('shows a worktree folder the environment sets, and refuses to change it', async () => {
    const { onboarding, store, root } = await setup(undefined, undefined, [], {
      worktreesDir: join(createTempDir(), 'env-wt'),
      worktreesDirFromEnvironment: true,
    });
    const status = await onboarding.resolveStatus();
    expect(status.worktrees.fromEnvironment).toBe(status.worktrees.effective);
    expect(status.worktrees.configured).toBeNull();
    expect(status.worktrees.problem).toBeNull();
    await expect(onboarding.applyWorktreesDir({ path: root })).rejects.toThrow(
      'SHINSA_WORKTREES_DIR chooses the worktree folder on this machine, so it cannot be changed here.'
    );
    expect(Effect.runSync(store.config).worktreesDir).toBeNull();
  });

  test('checks the prerequisites with the injected runner', async () => {
    const { onboarding } = await setup();
    expect((await onboarding.resolvePrerequisites()).ready).toBe(true);
  });

  test('needs Bun only when a repository in your folders uses it', async () => {
    const run: FakeCommand = (command) =>
      Promise.resolve({
        ok: command[0] !== 'bun',
        code: command[0] === 'bun' ? 127 : 0,
        stdout: 'v1',
        stderr: '',
        timedOut: false,
      });
    const { onboarding, developer } = await setup(run);
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
    const { onboarding, config } = await setup();
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
      snapshot: Effect.succeed({ terminals: [], services: [], home: '/' }),
      create: (start) => Effect.succeed({ id: 't1', ...start } as unknown as TerminalInfo),
      rename: () => Effect.void,
      run: (_id, command) => Effect.sync(() => void opened.push(command)),
      close: () => Effect.void,
    };
    const { onboarding, config } = await setup(undefined, terminals);
    expect(await onboarding.openInstall({ id: 'gh' })).toEqual({
      terminal: expect.objectContaining({ id: 't1', cwd: config.userHome, name: 'Set up GitHub CLI' }),
    });
    expect(opened).toEqual([expect.stringMatching(/\|\| brew install gh; } && \{ gh auth status .*; exit$/)]);
    expect(onboarding.openInstall({ command: 'rm -rf ~' })).rejects.toThrow(
      'Shinsa runs only the commands the help task’s agent replied with.'
    );
    expect(onboarding.openInstall({ id: 3 })).rejects.toThrow(
      'Send “id” as the check to fix, such as gh, “all” for every missing tool, or a “command” from the help task.'
    );
    expect((await setup()).onboarding.openInstall({ id: 'gh' })).rejects.toThrow(
      'Terminals are off, so run the command yourself.'
    );
    expect(opened).toEqual([expect.stringMatching(/\|\| brew install gh; } && \{ gh auth status .*; exit$/)]);
  });

  test('installs every missing tool in one terminal, and a simulated machine only pretends to', async () => {
    const opened: string[] = [];
    const terminals: InstallTerminals = {
      snapshot: Effect.succeed({ terminals: [], services: [], home: '/' }),
      create: (start) => Effect.succeed({ id: 't1', ...start } as unknown as TerminalInfo),
      rename: () => Effect.void,
      run: (_id, command) => Effect.sync(() => void opened.push(command)),
      close: () => Effect.void,
    };
    const { onboarding } = await setup(undefined, terminals, ['gh', 'bun']);
    const before = await onboarding.resolvePrerequisites();
    expect(before.checks.filter((check) => !check.ok).map((check) => check.id)).toEqual(['gh', 'bun']);
    await onboarding.openInstall({ all: true });
    expect(opened[0]).toContain('Simulated setup: nothing is installed.');
    expect(opened[0]).not.toContain('curl');
    expect((await onboarding.resolvePrerequisites()).ready).toBe(true);
    expect(onboarding.openInstall({ all: true })).rejects.toThrow('Every tool Shinsa needs is installed.');
  });

  test('resolveChosenRoots expands ~ and drops duplicates', async () => {
    const { root, developer } = await setup();
    expect(await runFiles(resolveChosenRoots(['~', '~/Developer', developer], root))).toEqual([
      root,
      developer,
    ]);
  });

  test('resolveChosenRoots names every folder macOS keeps private, once, and how to allow them', async () => {
    const { root, developer } = await setup();
    const refuse = (reason: SystemErrorTag) => (path: string) =>
      path === developer
        ? Effect.succeed([])
        : Effect.fail(
            systemError({
              _tag: reason,
              module: 'FileSystem',
              method: 'readDirectory',
              pathOrDescriptor: path,
            })
          );
    const resolveRefused = (values: string[], reason: SystemErrorTag) =>
      runFiles(Effect.flip(resolveChosenRoots(values, root, refuse(reason))));
    expect(await resolveRefused(['~', '~/Developer', root], 'PermissionDenied')).toMatchObject({
      code: 'roots_private',
      folders: [root],
      picked: [root, developer],
      message:
        'macOS keeps ~ private. Turn on Shinsa in System Settings → Privacy & Security → Full Disk Access, then check again.',
    });
    expect(await resolveRefused(['~'], 'Unknown')).toMatchObject({ _tag: 'OnboardingCallFailed' });
    const real = createTempDir();
    chmodSync(real, 0o000);
    try {
      const failure = await runFiles(Effect.flip(resolveChosenRoots([real], root)));
      expect(failure).toMatchObject({ code: 'roots_private', folders: [real] });
    } finally {
      chmodSync(real, 0o755);
    }
  });

  test('opens the Full Disk Access pane of System Settings', async () => {
    const calls: string[][] = [];
    const { onboarding } = await setup((command) => {
      calls.push(command);
      return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false });
    });
    expect(await onboarding.openPrivacySettings()).toEqual({ ok: true });
    expect(calls).toEqual([['open', PRIVACY_SETTINGS_URL]]);
    expect(PRIVACY_SETTINGS_URL).toContain('Privacy_AllFiles');
  });
});

describe('worktree usage', () => {
  const run: CommandRunner = (command, cwd, options) =>
    runCommand(command, cwd, options).pipe(Effect.provide(ShellLayer));

  function writeWorktree(path: string, bytes: number) {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'file.bin'), Buffer.alloc(bytes, 1));
    return path;
  }

  test('adds up the open worktrees and the delegation checkouts, and skips the main checkout', async () => {
    const folder = createTempDir();
    const first = writeWorktree(join(folder, 'app', 'feat-a'), 64 * 1024);
    const elsewhere = writeWorktree(join(createTempDir(), 'old-root', 'feat-b'), 32 * 1024);
    writeWorktree(join(folder, 'delegations', 'task-1', 'run-1'), 16 * 1024);
    const main = writeWorktree(join(createTempDir(), 'main'), 512 * 1024);
    const tasks = {
      a: createTask({ id: 'a', worktreePath: first }),
      b: createTask({ id: 'b', worktreePath: elsewhere }),
      gone: createTask({ id: 'gone', worktreePath: join(folder, 'removed') }),
      main: createTask({ id: 'main', worktreePath: main, workspace: 'main_checkout' }),
      none: createTask({ id: 'none', worktreePath: null }),
    };
    const usage = await Effect.runPromise(measureWorktreeUsage(folder, tasks, run, 42));
    expect(usage).toMatchObject({ folder, worktrees: 2, measuredAt: 42 });
    expect(usage.bytes).toBeGreaterThanOrEqual(112 * 1024);
    expect(usage.bytes).toBeLessThan(512 * 1024);
    expect(usage.freeBytes).toBeGreaterThan(0);
  });

  test('measures nothing without worktrees, and has no free space for a folder that is gone', async () => {
    const refused: CommandRunner = () => Effect.die('du should not run');
    const usage = await Effect.runPromise(measureWorktreeUsage('/no/such/mount', {}, refused, 1));
    expect(usage).toEqual({
      folder: '/no/such/mount',
      worktrees: 0,
      bytes: 0,
      freeBytes: null,
      measuredAt: 1,
    });
  });

  test('leaves the size unknown when du runs out of time', async () => {
    const folder = createTempDir();
    const path = writeWorktree(join(folder, 'app', 'feat-a'), 1024);
    const timedOut: CommandRunner = () =>
      Effect.succeed({ ok: false, code: -1, stdout: '', stderr: '', timedOut: true });
    const usage = await Effect.runPromise(
      measureWorktreeUsage(folder, { a: createTask({ worktreePath: path }) }, timedOut, 1)
    );
    expect(usage.bytes).toBeNull();
    expect(usage.worktrees).toBe(1);
  });

  test('Onboarding measures the folder in use', async () => {
    const { onboarding, config } = await setup();
    const usage = await onboarding.resolveWorktreeUsage();
    expect(usage).toMatchObject({ folder: config.worktreesDir, worktrees: 0, bytes: 0 });
  });
});
