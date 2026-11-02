import { Schema } from 'effect';

const MAX_PATH_LENGTH = 2048;

export const AppPath = Schema.String.check(
  Schema.isMaxLength(MAX_PATH_LENGTH),
  Schema.makeFilter((path) => path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'))
);

export type Navigation =
  | { kind: 'app'; path: string }
  | { kind: 'link'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'blocked' };

export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export const EXTERNAL_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
]);
