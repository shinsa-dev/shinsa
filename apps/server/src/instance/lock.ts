import { linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';
import { join } from 'node:path';
import { DomainError } from '@shinsa/core';
import { log } from '../log/index.ts';
import { describeVersion, type ServerInstance } from './install.ts';

export interface LockHolder extends ServerInstance {
  port: number;
  url: string;
  bootedAt: number;
}

export interface LockOptions {
  isAlive?: (pid: number) => boolean;
  bootedAt?: number;
}

export interface DataDirLock {
  path: string;
  holder: () => LockHolder;
  update: (address: { port: number; url: string }) => void;
  release: () => void;
}

export const LOCK_FILE = 'serve.lock';

const BOOT_TOLERANCE_MS = 60_000;

const TAKEOVER_ATTEMPTS = 3;

const held = new Set<string>();

function readErrorCode(error: unknown) {
  return error instanceof Error && 'code' in error ? error.code : null;
}

export function resolveBootedAt() {
  return Math.round(Date.now() - uptime() * 1000);
}

export function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return readErrorCode(error) === 'EPERM';
  }
}

function isHolder(value: unknown): value is LockHolder {
  if (!value || typeof value !== 'object') return false;
  const holder = value as Record<string, unknown>;
  return (
    Number.isInteger(holder.pid) &&
    typeof holder.port === 'number' &&
    typeof holder.url === 'string' &&
    typeof holder.version === 'string' &&
    typeof holder.startedAt === 'number' &&
    typeof holder.bootedAt === 'number'
  );
}

function readText(path: string) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (readErrorCode(error) !== 'ENOENT') throw error;
    return null;
  }
}

function parseHolder(text: string) {
  try {
    const value: unknown = JSON.parse(text);
    return isHolder(value) ? value : null;
  } catch {
    return null;
  }
}

export function selectLockHolder(dataDir: string) {
  const text = readText(join(dataDir, LOCK_FILE));
  return text === null ? null : parseHolder(text);
}

function describeHolder(holder: LockHolder) {
  return `${holder.url} (pid ${holder.pid}, version ${describeVersion(holder)})`;
}

function writeDraft(path: string, text: string) {
  const draft = `${path}.${process.pid}.${Bun.randomUUIDv7()}`;
  writeFileSync(draft, text);
  return draft;
}

function writeExclusive(path: string, text: string) {
  const draft = writeDraft(path, text);
  try {
    linkSync(draft, path);
    return true;
  } catch (error) {
    if (readErrorCode(error) !== 'EEXIST') throw error;
    return false;
  } finally {
    rmSync(draft, { force: true });
  }
}

class HeldLock implements DataDirLock {
  readonly path: string;
  #holder: LockHolder;

  constructor(path: string, holder: LockHolder) {
    this.path = path;
    this.#holder = holder;
    held.add(path);
  }

  holder() {
    return this.#holder;
  }

  update(address: { port: number; url: string }) {
    this.#holder = { ...this.#holder, ...address };
    renameSync(writeDraft(this.path, JSON.stringify(this.#holder)), this.path);
  }

  release() {
    held.delete(this.path);
    const text = readText(this.path);
    const current = text === null ? null : parseHolder(text);
    if (current?.pid !== this.#holder.pid || current.startedAt !== this.#holder.startedAt) return;
    rmSync(this.path, { force: true });
  }
}

export function acquireDataDirLock(
  dataDir: string,
  owner: Omit<LockHolder, 'bootedAt'>,
  options: LockOptions = {}
): DataDirLock {
  const path = join(dataDir, LOCK_FILE);
  const isAlive = options.isAlive ?? isProcessAlive;
  const bootedAt = options.bootedAt ?? resolveBootedAt();
  const isLive = (holder: LockHolder) => {
    if (Math.abs(holder.bootedAt - bootedAt) > BOOT_TOLERANCE_MS) return false;
    if (holder.pid === process.pid) return held.has(path);
    return isAlive(holder.pid);
  };
  const claim: LockHolder = { ...owner, bootedAt };
  for (let attempt = 0; attempt < TAKEOVER_ATTEMPTS; attempt += 1) {
    if (writeExclusive(path, JSON.stringify(claim))) return new HeldLock(path, claim);
    const text = readText(path);
    const stale = text === null ? null : parseHolder(text);
    if (stale && isLive(stale)) {
      throw new DomainError(
        'server_running',
        `Shinsa is already running on ${dataDir}: ${describeHolder(stale)}. Stop it first, or set SHINSA_HOME to another folder.`
      );
    }
    if (text !== null && readText(path) === text) {
      log.warn('[Serve] Took over the lock a stopped Shinsa left behind', { path, pid: stale?.pid ?? null });
      rmSync(path, { force: true });
    }
  }
  throw new DomainError(
    'server_lock_contended',
    `Another Shinsa kept taking the lock on ${dataDir} while this one started. Try again.`
  );
}
