import { DomainError } from '@shinsa/core';
import { describeVersion } from '../install.ts';
import { type LockContended, type LockHolder, type ServerRunning, ServerRunningError } from './schema.ts';

export { isProcessAlive, resolveBootedAt } from './liveness.ts';
export { LOCK_FILE, type LockHolder, ServerRunningError } from './schema.ts';

export function createServerRunningError(dataDir: string, holder: LockHolder) {
  return new ServerRunningError({
    dataDir,
    holder,
    message: `Shinsa is already running on ${dataDir}: ${holder.url} (pid ${holder.pid}, version ${describeVersion(holder)}). Stop it first, or set SHINSA_HOME to another folder.`,
  });
}

export function resolveLockError(error: ServerRunning | LockContended) {
  if (error._tag === 'ServerRunning') return createServerRunningError(error.dataDir, error.holder);
  return new DomainError({
    code: 'server_lock_contended',
    message: `Another Shinsa kept taking the lock on ${error.dataDir} while this one started. Try again.`,
  });
}
