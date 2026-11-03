import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { resolveSecretLookup } from './credentials.ts';
import type { LoginRenewalHandle, LoginRenewalOptions } from './renewal/schema.ts';
import { makeLoginRenewal } from './renewal/service.ts';
import type { StoredAccount } from './store.ts';

export { describeExpiredLogin, isTokenFailure } from './renewal/failures.ts';
export type { LoginRenewalOptions, RenewedLogin } from './renewal/schema.ts';

export class LoginRenewal {
  readonly handle: LoginRenewalHandle;

  constructor(options: LoginRenewalOptions) {
    this.handle = edgeRuntime.runSync(
      makeLoginRenewal({
        env: options.env,
        userHome: options.userHome,
        readSecret: resolveSecretLookup(options.readSecret),
        now: Effect.sync(options.now),
      })
    );
  }

  renew(account: StoredAccount) {
    return edgeRuntime.runPromise(this.handle.renew(account));
  }

  recordFailed(account: StoredAccount) {
    return edgeRuntime.runPromise(this.handle.recordFailed(account));
  }

  clear(accountId: string) {
    edgeRuntime.runSync(this.handle.clear(accountId));
  }

  listRenewed(accounts: StoredAccount[]) {
    return edgeRuntime.runPromise(this.handle.listRenewed(accounts));
  }
}
