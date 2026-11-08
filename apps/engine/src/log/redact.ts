import { isPlatformError, type PlatformError } from 'effect/PlatformError';
import { SECRET_TOKENS, URL_CREDENTIALS } from './schema.ts';

export function redactSecrets(text: string) {
  return text.replace(URL_CREDENTIALS, '$1***@').replace(SECRET_TOKENS, '***');
}

function describePlatformError(error: PlatformError, cause: Error) {
  const path = error.reason._tag === 'BadArgument' ? undefined : error.reason.pathOrDescriptor;
  if (typeof path !== 'string' || cause.message.includes(path)) return cause.message;
  return `${cause.message} '${path}'`;
}

export function describeError(error: unknown): string {
  if (isPlatformError(error) && error.reason.cause instanceof Error)
    return redactSecrets(describePlatformError(error, error.reason.cause));
  return redactSecrets(error instanceof Error ? error.message : String(error));
}
