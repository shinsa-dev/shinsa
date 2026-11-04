import { Context, Effect, Layer } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { parseAuthStatus } from '../answers.ts';
import { AccountCommands } from '../command/service.ts';
import type { Env } from '../paths.ts';
import { type AuthStatus, STATUS_TIMEOUT } from '../schema.ts';

export class AuthStatusReader extends Context.Service<
  AuthStatusReader,
  { read(claude: string, env: Env): Effect.Effect<AuthStatus> }
>()('shinsa/engine/accounts/status/AuthStatusReader') {
  static readonly layer = Layer.effect(
    AuthStatusReader,
    Effect.gen(function* () {
      const commands = yield* AccountCommands;
      const { userHome } = yield* EngineConfig;

      const read = Effect.fn('AuthStatusReader.read')(function* (claude: string, env: Env) {
        const result = yield* commands.run([claude, 'auth', 'status', '--json'], userHome, {
          env,
          timeout: STATUS_TIMEOUT,
        });
        if (!result.timedOut) return parseAuthStatus(result);
        const status: AuthStatus = {
          signIn: 'unknown',
          email: null,
          organization: null,
          plan: null,
          detail: 'Claude took too long to answer.',
        };
        return status;
      });

      return AuthStatusReader.of({ read });
    })
  );
}
