import { HOUR_MS, MINUTE_MS, type TerminalInfo } from '@shinsa/core';

export const AUTO_CLOSE_LIMITS = { exitedMs: 10 * MINUTE_MS, idleMs: 8 * HOUR_MS };

export interface AutoCloseCandidate {
  info: TerminalInfo;
  running: boolean;
  viewers: number;
  lastActiveAt: number;
}

export type AutoClose = 'keep' | 'close' | 'close_when_quiet';

export function resolveAutoClose(candidate: AutoCloseCandidate, now: number): AutoClose {
  const { info, running, viewers, lastActiveAt } = candidate;
  if (info.serviceId !== null || viewers > 0) return 'keep';
  const quietFor = now - Math.max(lastActiveAt, info.endedAt ?? 0);
  if (!running && info.status === 'exited') return quietFor >= AUTO_CLOSE_LIMITS.exitedMs ? 'close' : 'keep';
  if (quietFor < AUTO_CLOSE_LIMITS.idleMs) return 'keep';
  return running ? 'close_when_quiet' : 'close';
}
