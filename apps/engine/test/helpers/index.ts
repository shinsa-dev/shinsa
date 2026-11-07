import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Repo, ShinsaEffect, ShinsaEventInput } from '@shinsa/core';
import { Effect } from 'effect';
import type { ServerConfig } from '../../src/config/index.ts';
import { HandoffCallFailed, type HandoffEffects } from '../../src/remote/handoffs/schema.ts';
import { PreviewDispatchFailed, type PreviewEffects } from '../../src/remote/previews/schema.ts';
import { ShareDispatchFailed, type ShareEffects } from '../../src/remote/shares/schema.ts';
import { EffectFailed } from '../../src/runtime/failures/schema.ts';
import {
  type Display,
  NO_PROGRESS,
  PLAIN_DISPLAY,
  PLAIN_STYLE,
  type Progress,
  type Terminal,
} from '../../src/terminal/index.ts';
import { createTestOnboardingService, type FakeCommand } from '../onboarding/harness.ts';
import { createConfigAt } from './config.ts';
import type { Engine } from './engine.ts';
import type { TestEventLog } from './event-log.ts';
import { createTestMachine } from './machine.ts';
import { runCommandOrThrow } from './shell.ts';
import { createTempDir } from './temp.ts';
import { until } from './until.ts';

export { createTempDir };
export { captureLogs } from './logs.ts';

export function commitEvents(
  log: TestEventLog,
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

export { until };

export function awaitEffect(log: Pick<TestEventLog, 'selectEffectStatus'>, key: string, timeoutMs = 5_000) {
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

const FAKE_RUN: FakeCommand = (command) =>
  Promise.resolve({ ok: true, code: 0, stdout: `${command[0]} 1.0`, stderr: '', timedOut: false });

export async function createTestOnboarding(
  engine: Engine,
  config: ServerConfig,
  run: FakeCommand = FAKE_RUN
) {
  const machine = await createTestMachine(engine, config);
  const { store, roots } = machine;
  return {
    store,
    roots,
    machine,
    onboarding: createTestOnboardingService({ engine, config, machine: machine.context, run }),
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

export const NO_SHARES: ShareEffects = {
  link: () => Effect.fail(new ShareDispatchFailed({ message: 'This test shares no task.' })),
};

export const NO_PREVIEWS: PreviewEffects = {
  link: () => Effect.fail(new PreviewDispatchFailed({ message: 'This test shares no preview.' })),
};

export const NO_HANDOFFS: HandoffEffects = {
  link: () =>
    Effect.fail(
      new EffectFailed({
        message: 'This test hands off no task.',
        detail: 'This test hands off no task.',
        retryable: false,
        delayMs: null,
      })
    ),
  revoke: () => Effect.fail(new HandoffCallFailed({ message: 'This test hands off no task.' })),
};
