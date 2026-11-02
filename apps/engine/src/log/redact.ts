import { SECRET_TOKENS, URL_CREDENTIALS } from './schema.ts';

export function redactSecrets(text: string) {
  return text.replace(URL_CREDENTIALS, '$1***@').replace(SECRET_TOKENS, '***');
}

export function describeError(error: unknown) {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}
