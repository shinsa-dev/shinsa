import { resolve } from 'node:path';
import { type AppFlavor, ENGINE_PROTOCOL } from '@shinsa/core';
import enginePackage from '../../package.json' with { type: 'json' };
import { runCommand } from '../shell/index.ts';
import { BUNDLE, type ShinsaBundle } from './bundle.ts';
import { FLAVOR } from './flavor.ts';

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
  flavor: AppFlavor;
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
  now = Date.now(),
  flavor: AppFlavor = FLAVOR.flavor
): ServerHealth {
  return {
    ok: log.problems.length === 0,
    seq: log.seq,
    problems: log.problems,
    ...instance,
    protocol: ENGINE_PROTOCOL,
    flavor,
    ...activity,
    dataDir,
    uptimeMs: Math.max(0, now - instance.startedAt),
  };
}

export const INSTALL_PATH = BUNDLE ? BUNDLE.root : resolve(import.meta.dirname, '../../../..');

export const ENGINE_ENTRY = resolve(import.meta.dirname, '../main.ts');

const COMMIT_TIMEOUT_MS = 5_000;

export function createServerInstance(
  commit: string | null = null,
  now = Date.now(),
  bundle: ShinsaBundle | null = BUNDLE
): ServerInstance {
  return {
    version: bundle?.version ?? enginePackage.version,
    commit,
    installPath: INSTALL_PATH,
    pid: process.pid,
    startedAt: now,
  };
}

export async function resolveServerInstance(
  installPath = INSTALL_PATH,
  bundle: ShinsaBundle | null = BUNDLE
): Promise<ServerInstance> {
  if (bundle) return createServerInstance(bundle.commit, Date.now(), bundle);
  const result = await runCommand(['git', 'rev-parse', 'HEAD'], installPath, {
    timeoutMs: COMMIT_TIMEOUT_MS,
  });
  return createServerInstance(result.ok && /^[0-9a-f]{40}$/.test(result.stdout) ? result.stdout : null);
}

export function describeVersion(instance: Pick<ServerInstance, 'version' | 'commit'>) {
  return instance.commit ? `${instance.version} (${instance.commit.slice(0, 7)})` : instance.version;
}
