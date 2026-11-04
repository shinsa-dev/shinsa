import { redactSecrets } from './redact.ts';
import type { LogFields, LogLevelName } from './schema.ts';

export function writeLogLine(level: LogLevelName, message: string, fields: LogFields, at = new Date()) {
  const line = redactSecrets(JSON.stringify({ at: at.toISOString(), level, message, ...fields }));
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}
