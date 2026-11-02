import { type LogLevel, UPDATE_LOG } from './schema.ts';

function describeLogMessage(message: unknown) {
  if (message instanceof Error) return message.stack ?? message.message;
  if (typeof message === 'string') return message;
  return JSON.stringify(message) ?? String(message);
}

export function formatLogLine(level: LogLevel, message: unknown, at: Date) {
  return `${at.toISOString()} ${level} ${describeLogMessage(message)}\n`;
}

export function needsLogRotation(size: number) {
  return size > UPDATE_LOG.limit;
}
