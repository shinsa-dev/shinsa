import { writeLogLine } from './line.ts';
import type { LogFields } from './schema.ts';

export { describeError, redactSecrets } from './redact.ts';

export const log = {
  info: (message: string, fields: LogFields = {}) => writeLogLine('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => writeLogLine('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => writeLogLine('error', message, fields),
};
