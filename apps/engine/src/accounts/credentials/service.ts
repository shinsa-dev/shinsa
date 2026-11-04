import { Context, Effect, Layer } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { parseStoredLogin } from '../answers.ts';
import { AccountFolders } from '../folders/service.ts';
import { Keychain } from '../keychain/service.ts';
import {
  resolveKeychainAccount,
  resolveKeychainService,
  resolveSharedConfigDir,
  selectConfiguredDir,
} from '../paths.ts';
import { AccountsEnv, type StoredLogin } from '../schema.ts';

export class StoredLogins extends Context.Service<
  StoredLogins,
  { read(configDir: string | null): Effect.Effect<StoredLogin | null> }
>()('shinsa/engine/accounts/credentials/StoredLogins') {
  static readonly layer = Layer.effect(
    StoredLogins,
    Effect.gen(function* () {
      const folders = yield* AccountFolders;
      const keychain = yield* Keychain;
      const env = yield* AccountsEnv;
      const { userHome } = yield* EngineConfig;

      const read = Effect.fn('StoredLogins.read')(function* (accountDir: string | null) {
        const configDir = accountDir ?? selectConfiguredDir(env);
        const secret = yield* keychain.read(resolveKeychainService(configDir), resolveKeychainAccount(env));
        const fromKeychain = secret === null ? null : parseStoredLogin(secret);
        if (fromKeychain) return fromKeychain;
        const file = yield* folders.readCredentials(configDir ?? resolveSharedConfigDir(env, userHome));
        return file === null ? null : parseStoredLogin(file);
      });

      return StoredLogins.of({ read });
    })
  );
}
