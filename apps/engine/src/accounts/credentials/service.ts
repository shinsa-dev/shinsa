import { Effect } from 'effect';
import { parseStoredLogin } from '../answers.ts';
import { AccountFolders } from '../folders/service.ts';
import {
  resolveKeychainAccount,
  resolveKeychainService,
  resolveSharedConfigDir,
  selectConfiguredDir,
} from '../paths.ts';
import type { StoredLoginQuery } from './schema.ts';

export const readAccountLogin = Effect.fn('Credentials.readAccountLogin')(function* (
  query: StoredLoginQuery
) {
  const folders = yield* AccountFolders;
  const configDir = query.configDir ?? selectConfiguredDir(query.env);
  const secret = yield* query.readSecret(
    resolveKeychainService(configDir),
    resolveKeychainAccount(query.env)
  );
  const fromKeychain = secret === null ? null : parseStoredLogin(secret);
  if (fromKeychain) return fromKeychain;
  const file = yield* folders.readCredentials(configDir ?? resolveSharedConfigDir(query.env, query.userHome));
  return file === null ? null : parseStoredLogin(file);
});
