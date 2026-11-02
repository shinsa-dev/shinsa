import { uptime } from 'node:os';

export function resolveBootedAt(now = Date.now()) {
  return Math.round(now - uptime() * 1000);
}

export function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}
