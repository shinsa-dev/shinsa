import { uptime } from 'node:os';
import { selectErrnoCode } from '../../shell/errno.ts';
import { NOT_PERMITTED } from '../../shell/schema.ts';

export function resolveBootedAt(now = Date.now()) {
  return Math.round(now - uptime() * 1000);
}

export function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return selectErrnoCode(error) === NOT_PERMITTED;
  }
}
