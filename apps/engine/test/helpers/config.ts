import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readMachineConfig } from '../../src/config/file.ts';
import type { ServerConfig } from '../../src/config/index.ts';

export function createConfigAt(root: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  const dataDir = join(root, 'data');
  const config: ServerConfig = {
    home: root,
    configPath: join(root, 'config.json'),
    userHome: root,
    machine: readMachineConfig(join(root, 'config.json')),
    dataDir,
    databasePath: join(dataDir, 'shinsa.sqlite'),
    worktreesDir: join(dataDir, 'worktrees'),
    checkBasesDir: join(dataDir, 'check-bases'),
    scratchDir: join(dataDir, 'scratch'),
    cachesDir: join(dataDir, 'caches'),
    evidenceDir: join(dataDir, 'evidence'),
    attachmentsDir: join(dataDir, 'attachments'),
    transcriptsDir: join(dataDir, 'transcripts'),
    pluginDir: resolve(import.meta.dirname, '../../plugin'),
    webDir: join(root, 'web'),
    port: 0,
    hostname: '127.0.0.1',
    allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
    roots: [root],
    inspect: false,
    simulateMissing: [],
    editor: null,
    terminal: 'Terminal',
    settleDelayMs: 3_600_000,
    pushRetryMs: 10,
    overloadRetryMs: 10,
    remoteOrigin: 'http://127.0.0.1:1',
    previewOrigin: 'https://shinsa.page',
    ...overrides,
  };
  for (const dir of [config.dataDir, config.worktreesDir, config.evidenceDir, config.transcriptsDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return config;
}
