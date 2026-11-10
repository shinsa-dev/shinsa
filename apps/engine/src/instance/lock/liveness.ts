import { uptime } from 'node:os';
import { Result } from 'effect';
import { selectErrnoCode } from '../../shell/errno.ts';
import { NOT_PERMITTED } from '../../shell/schema.ts';

export function resolveBootedAt(now: number) {
  return Math.round(now - uptime() * 1000);
}

export function isProcessAlive(pid: number) {
  return Result.match(
    Result.try(() => process.kill(pid, 0)),
    { onFailure: (error) => selectErrnoCode(error) === NOT_PERMITTED, onSuccess: () => true }
  );
}
