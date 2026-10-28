import {
  type ChatEntry,
  type ChatTool,
  type Monitor,
  SILENCE_MINUTES,
  type SilenceLevel,
  type StalledReason,
} from '@shinsa/core';
import { formatSpan, formatUntil } from '@/lib/format/time.ts';

export const STALLED_REASON: Record<StalledReason, string> = {
  needs_you: 'is waiting on you',
  paused: 'is paused',
  cancelled: 'was cancelled',
};

export function describeNextCheckIn(monitor: Monitor, now: number) {
  return formatUntil('Checks in again', monitor.nextCheckAt, now);
}

export function describeGiveUp(monitor: Monitor, now: number) {
  return monitor.timeoutAt <= now
    ? 'gives up at the next check-in'
    : formatUntil('gives up', monitor.timeoutAt, now);
}

export function describeCheckInCount(monitor: Monitor) {
  return `Check-in ${monitor.attempts + 1} of ${monitor.maxAttempts}`;
}

export interface RunningTool {
  command: string | null;
}

export function selectRunningTool(entries: readonly ChatEntry[]): RunningTool | null {
  const open = new Map<string, ChatTool>();
  for (const entry of entries) {
    if (entry.type === 'tool_call') open.set(entry.callId, entry.tool);
    else if (entry.type === 'tool_result') open.delete(entry.callId);
  }
  const tool = [...open.values()].at(-1);
  if (!tool) return null;
  return { command: tool.kind === 'command' && tool.action === 'run' ? tool.command : null };
}

export function describeSilence(
  level: SilenceLevel,
  since: number,
  now: number,
  running: RunningTool | null = null
) {
  if (level !== 'suspicious' && level !== 'critical') return null;
  const quiet = formatSpan(since, now) ?? `${SILENCE_MINUTES.suspicious} minutes`;
  if (!running) return `No output for ${quiet}`;
  return `A ${running.command === null ? 'tool' : 'command'} has been running for ${quiet}`;
}
