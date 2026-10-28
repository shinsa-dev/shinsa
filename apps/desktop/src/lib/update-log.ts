import type { UpdateState } from './update.ts';

export const UPDATE_LOG = { file: 'updater.log', previous: 'updater.old.log', limit: 1_000_000 };

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function describeLogMessage(message: unknown) {
  if (message instanceof Error) return message.stack ?? message.message;
  if (typeof message === 'string') return message;
  return JSON.stringify(message) ?? String(message);
}

export function formatLogLine(level: LogLevel, message: unknown, at: Date) {
  return `${at.toISOString()} ${level} ${describeLogMessage(message)}\n`;
}

export function describeStateChange(previous: UpdateState, next: UpdateState) {
  if (previous.status === next.status) return null;
  const version = 'version' in next ? ` ${next.version}` : '';
  const message = next.status === 'failed' ? `: ${next.message}` : '';
  return `state ${previous.status} -> ${next.status}${version}${message}`;
}

export function needsLogRotation(size: number) {
  return size > UPDATE_LOG.limit;
}
