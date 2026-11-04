import { Context, Effect, Layer } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { GitHubLogins } from '../login/service.ts';
import type { LoginLookup } from '../registry/schema.ts';

export class CurrentLogin extends Context.Service<CurrentLogin, { readonly lookup: LoginLookup }>()(
  'shinsa/engine/repos/current-login/CurrentLogin'
) {
  static readonly layer = Layer.effect(
    CurrentLogin,
    Effect.gen(function* () {
      const { userHome } = yield* EngineConfig;
      return CurrentLogin.of({ lookup: yield* (yield* GitHubLogins).make(userHome) });
    })
  );
}
