import { Effect } from 'effect';
import { KEYCHAIN_COMMAND, KEYCHAIN_NOT_FOUND, KEYCHAIN_TIMEOUT_MS } from '../schema.ts';
import type { KeychainDefinition } from './schema.ts';

export const readKeychainSecret = Effect.fn('Keychain.read')(function* (
  definition: KeychainDefinition,
  service: string,
  account: string
) {
  if (definition.platform !== 'darwin') return null;
  const result = yield* definition.run(
    [KEYCHAIN_COMMAND, 'find-generic-password', '-a', account, '-s', service, '-w'],
    definition.home,
    { timeoutMs: KEYCHAIN_TIMEOUT_MS }
  );
  if (result.ok) return result.stdout;
  if (result.code !== KEYCHAIN_NOT_FOUND)
    yield* Effect.logWarning('[Accounts] The keychain did not answer').pipe(
      Effect.annotateLogs({ service, code: result.code })
    );
  return null;
});
