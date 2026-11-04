import { Context, Effect, Layer } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { AccountCommands } from '../command/service.ts';
import { KEYCHAIN_COMMAND, KEYCHAIN_NOT_FOUND, KEYCHAIN_TIMEOUT } from '../schema.ts';
import { KeychainPlatform } from './schema.ts';

export class Keychain extends Context.Service<
  Keychain,
  { read(service: string, account: string): Effect.Effect<string | null> }
>()('shinsa/engine/accounts/keychain/Keychain') {
  static readonly layer = Layer.effect(
    Keychain,
    Effect.gen(function* () {
      const commands = yield* AccountCommands;
      const platform = yield* KeychainPlatform;
      const { userHome } = yield* EngineConfig;

      const read = Effect.fn('Keychain.read')(function* (service: string, account: string) {
        if (platform !== 'darwin') return null;
        const result = yield* commands.run(
          [KEYCHAIN_COMMAND, 'find-generic-password', '-a', account, '-s', service, '-w'],
          userHome,
          { timeout: KEYCHAIN_TIMEOUT }
        );
        if (result.ok) return result.stdout;
        if (result.code !== KEYCHAIN_NOT_FOUND)
          yield* Effect.logWarning('[Accounts] The keychain did not answer').pipe(
            Effect.annotateLogs({ service, code: result.code })
          );
        return null;
      });

      return Keychain.of({ read });
    })
  );
}
