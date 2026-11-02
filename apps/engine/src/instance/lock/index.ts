import { join } from 'node:path';
import { DomainError } from '@shinsa/core';
import { Context, Effect, Exit, Layer, Option, Scope } from 'effect';
import { edgeRuntime } from '../../runtime/edge.ts';
import { describeVersion } from '../install.ts';
import { readLockHolder } from './file.ts';
import {
  LOCK_FILE,
  type LockAddress,
  type LockContended,
  type LockHolder,
  type LockOptions,
  type LockOwner,
  type ServerRunning,
} from './schema.ts';
import { ServeLock } from './service.ts';

export { isProcessAlive, resolveBootedAt } from './liveness.ts';
export { LOCK_FILE, type LockHolder, type LockOptions } from './schema.ts';

export interface DataDirLock {
  path: string;
  holder: () => LockHolder;
  update: (address: LockAddress) => void;
  release: () => void;
}

export class ServerRunningError extends DomainError {
  declare readonly holder: LockHolder;
  declare readonly dataDir: string;

  static create(dataDir: string, holder: LockHolder) {
    const error = new ServerRunningError({
      code: 'server_running',
      message: `Shinsa is already running on ${dataDir}: ${holder.url} (pid ${holder.pid}, version ${describeVersion(holder)}). Stop it first, or set SHINSA_HOME to another folder.`,
    });
    return Object.assign(error, { holder, dataDir });
  }
}

export function resolveLockError(error: ServerRunning | LockContended) {
  if (error._tag === 'ServerRunning') return ServerRunningError.create(error.dataDir, error.holder);
  return new DomainError({
    code: 'server_lock_contended',
    message: `Another Shinsa kept taking the lock on ${error.dataDir} while this one started. Try again.`,
  });
}

export function selectLockHolder(dataDir: string) {
  return Option.getOrNull(edgeRuntime.runSync(readLockHolder(join(dataDir, LOCK_FILE))));
}

export function acquireDataDirLock(
  dataDir: string,
  owner: LockOwner,
  options: LockOptions = {}
): DataDirLock {
  const scope = Scope.makeUnsafe();
  const context = edgeRuntime.runSync(
    Layer.buildWithScope(ServeLock.layer(dataDir, owner, options), scope).pipe(
      Effect.mapError(resolveLockError)
    )
  );
  const lock = Context.get(context, ServeLock);
  return {
    path: lock.path,
    holder: () => edgeRuntime.runSync(lock.holder),
    update: (address) => edgeRuntime.runSync(lock.update(address)),
    release: () => edgeRuntime.runSync(Scope.close(scope, Exit.void)),
  };
}
