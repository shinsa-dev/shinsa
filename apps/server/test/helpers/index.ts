import { afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Repo } from '@shinsa/core';
import type { ServerConfig } from '../../src/config/index.ts';
import { runCommandOrThrow } from '../../src/shell/index.ts';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function createTempDir(prefix = 'shinsa-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function writeFiles(root: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

export function createTestConfig(
  root = createTempDir(),
  overrides: Partial<ServerConfig> = {}
): ServerConfig {
  const dataDir = join(root, 'data');
  const config: ServerConfig = {
    dataDir,
    databasePath: join(dataDir, 'shinsa.sqlite'),
    worktreesDir: join(dataDir, 'worktrees'),
    evidenceDir: join(dataDir, 'evidence'),
    transcriptsDir: join(dataDir, 'transcripts'),
    pluginDir: resolve(import.meta.dirname, '../../plugin'),
    webDir: join(root, 'web'),
    port: 0,
    hostname: '127.0.0.1',
    allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
    roots: [root],
    inspect: false,
    editor: null,
    terminal: 'Terminal',
    settleDelayMs: 3_600_000,
    ...overrides,
  };
  for (const dir of [config.dataDir, config.worktreesDir, config.evidenceDir, config.transcriptsDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return config;
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
      areaId: null,
      name: 'app',
      path,
      defaultBranch: 'main',
      remote: options.remote === false ? null : 'github.com/acme/app',
      checkCommands: [],
      previewCommand: null,
    } as Repo,
  };
}

export async function until(describe: string, predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${describe}.`);
    await Bun.sleep(10);
  }
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
