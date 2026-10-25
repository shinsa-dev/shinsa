import { resolve } from 'node:path';
import { ENGINE_PROTOCOL } from '@shinsa/core';
import serverPackage from '../../package.json' with { type: 'json' };
import { runCommand } from '../shell/index.ts';

export interface ServerInstance {
  version: string;
  commit: string | null;
  installPath: string;
  pid: number;
  startedAt: number;
}

interface HealthProblem {
  seq: number;
  type: string;
  kind: 'unreadable' | 'unappliable';
  error: string;
}

export interface EngineActivity {
  busy: boolean;
  restart: 'idle' | null;
}

export interface ServerHealth extends ServerInstance, EngineActivity {
  ok: boolean;
  protocol: number;
  seq: number;
  problems: readonly HealthProblem[];
  dataDir: string;
  uptimeMs: number;
}

export function resolveHealth(
  log: { seq: number; problems: readonly HealthProblem[] },
  dataDir: string,
  instance: ServerInstance,
  activity: EngineActivity,
  now = Date.now()
): ServerHealth {
  return {
    ok: log.problems.length === 0,
    seq: log.seq,
    problems: log.problems,
    ...instance,
    protocol: ENGINE_PROTOCOL,
    ...activity,
    dataDir,
    uptimeMs: Math.max(0, now - instance.startedAt),
  };
}

export const INSTALL_PATH = resolve(import.meta.dirname, '../../../..');

export const SERVER_ENTRY = resolve(import.meta.dirname, '../main.ts');

const COMMIT_TIMEOUT_MS = 5_000;

export function createServerInstance(commit: string | null = null, now = Date.now()): ServerInstance {
  return {
    version: serverPackage.version,
    commit,
    installPath: INSTALL_PATH,
    pid: process.pid,
    startedAt: now,
  };
}

export async function resolveServerInstance(installPath = INSTALL_PATH): Promise<ServerInstance> {
  const result = await runCommand(['git', 'rev-parse', 'HEAD'], installPath, {
    timeoutMs: COMMIT_TIMEOUT_MS,
  });
  return createServerInstance(result.ok && /^[0-9a-f]{40}$/.test(result.stdout) ? result.stdout : null);
}

export function describeVersion(instance: Pick<ServerInstance, 'version' | 'commit'>) {
  return instance.commit ? `${instance.version} (${instance.commit.slice(0, 7)})` : instance.version;
}
