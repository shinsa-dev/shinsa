import { resolve } from 'node:path';
import { ENGINE_PROTOCOL } from '@shinsa/core';
import enginePackage from '../../package.json' with { type: 'json' };
import { BUNDLE, type ShinsaBundle } from './bundle.ts';

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
  working: number;
  restart: 'idle' | null;
  restartBy: number | null;
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

export const INSTALL_PATH = BUNDLE ? BUNDLE.root : resolve(import.meta.dirname, '../../../..');

export const ENGINE_ENTRY = resolve(import.meta.dirname, '../main.ts');

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

export function describeVersion(instance: Pick<ServerInstance, 'version' | 'commit'>) {
  return instance.commit ? `${instance.version} (${instance.commit.slice(0, 7)})` : instance.version;
}
