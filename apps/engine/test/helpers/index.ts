import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Repo, ShinsaEffect, ShinsaEventInput } from '@shinsa/core';
import { ConfigStore, type ServerConfig } from '../../src/config/index.ts';
import type { CommandRunner } from '../../src/onboarding/index.ts';
import { Onboarding } from '../../src/onboarding/index.ts';
import { Roots } from '../../src/repos/index.ts';
import type { Engine } from '../../src/runtime/index.ts';
import { runCommandOrThrow } from '../../src/shell/index.ts';
import type { EventLog } from '../../src/store/index.ts';
import {
  type Display,
  NO_PROGRESS,
  PLAIN_DISPLAY,
  PLAIN_STYLE,
  type Progress,
  type Terminal,
} from '../../src/terminal/index.ts';
import { createConfigAt } from './config.ts';
import { createTempDir } from './temp.ts';

export { createTempDir };

export function commitEvents(
  log: EventLog,
  events: ShinsaEventInput[],
  effects: ShinsaEffect[],
  fromSeq: number,
  at: number
) {
  return log.commitCommand({ events, effects, cancellations: [], fromSeq, at, receipt: null }).events;
}

export function writeFiles(root: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

export function createTestConfig(root = createTempDir(), overrides: Partial<ServerConfig> = {}) {
  return createConfigAt(root, overrides);
}

export function git(cwd: string, ...args: string[]) {
  return runCommandOrThrow(['git', ...args], cwd);
}

export interface TestRepo {
  root: string;
  path: string;
  origin: string;
  repo: Repo;
}

export async function createGitRepo(
  options: { files?: Record<string, string>; remote?: boolean; root?: string; name?: string } = {}
): Promise<TestRepo> {
  const root = options.root ?? createTempDir('shinsa-repo-');
  const path = join(root, options.name ?? 'app');
  const origin = join(root, 'origin.git');
  mkdirSync(path, { recursive: true });
  await git(path, 'init', '-q', '-b', 'main');
  writeFiles(path, { 'README.md': '# app\n', ...options.files });
  await git(path, 'add', '-A');
  await git(path, 'commit', '-q', '-m', 'chore: start');
  if (options.remote !== false) {
    await runCommandOrThrow(['git', 'init', '--bare', '-q', '-b', 'main', origin], root);
    await git(path, 'remote', 'add', 'origin', origin);
    await git(path, 'push', '-q', '-u', 'origin', 'main');
    await git(path, 'remote', 'set-head', 'origin', 'main');
  }
  return {
    root,
    path,
    origin,
    repo: {
      id: 'repo-1',
      projectId: null,
      name: 'app',
      path,
      defaultBranch: 'main',
      remote: options.remote === false ? null : 'github.com/acme/app',
      checkCommands: [],
    } as Repo,
  };
}

export async function until(
  describe: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000
) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${describe}.`);
    await Bun.sleep(10);
  }
}

export function awaitEffect(log: Pick<EventLog, 'selectEffectStatus'>, key: string, timeoutMs = 5_000) {
  return until(
    `the effect ${key} to settle`,
    () => {
      const status = log.selectEffectStatus(key);
      return status !== 'pending' && status !== 'running';
    },
    timeoutMs
  );
}

export function overrideEnv(values: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

const FAKE_RUN: CommandRunner = (command) =>
  Promise.resolve({ ok: true, code: 0, stdout: `${command[0]} 1.0`, stderr: '', timedOut: false });

export function createTestOnboarding(engine: Engine, config: ServerConfig, run: CommandRunner = FAKE_RUN) {
  const store = new ConfigStore(config.configPath);
  const roots = new Roots(config.roots, store, config.userHome, () =>
    Promise.resolve({ candidates: [], truncated: false })
  );
  return {
    store,
    roots,
    onboarding: new Onboarding({
      engine,
      config,
      store,
      roots,
      resolveLogin: () => Promise.resolve(null),
      ask: () => Promise.resolve(null),
      run,
      models: { listModels: () => Promise.resolve([]) },
      accounts: () => Promise.resolve([]),
      accountActions: {
        listImports: () => Promise.resolve([]),
        importAccount: () => Promise.resolve(),
      },
    }),
  };
}

export function createTestTerminal(
  display: Display = PLAIN_DISPLAY,
  startProgress: (text: string) => Progress = () => NO_PROGRESS
): Terminal {
  return {
    display,
    errorStyle: display.style.color ? display.style : PLAIN_STYLE,
    home: '/Users/you',
    startProgress,
  };
}
