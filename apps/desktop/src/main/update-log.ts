import { appendFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { formatLogLine, needsLogRotation } from '../updates/log.ts';
import { type LogLevel, UPDATE_LOG } from '../updates/schema.ts';

export function createUpdateLog() {
  const directory = app.getPath('logs');
  const path = join(directory, UPDATE_LOG.file);
  try {
    if (needsLogRotation(statSync(path).size)) renameSync(path, join(directory, UPDATE_LOG.previous));
  } catch {}
  const write = (level: LogLevel) => (message: unknown) => {
    try {
      appendFileSync(path, formatLogLine(level, message, new Date()));
    } catch {}
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
