import { createHash } from 'node:crypto';
import { Effect, Ref } from 'effect';
import { readAccountLogin } from '../credentials/service.ts';
import { AccountFolders } from '../folders/service.ts';
import { LOGIN_EXPIRY_MARGIN_MS, type StoredAccount, type StoredLogin } from '../schema.ts';
import type { LoginRenewalDefinition, LoginRenewalHandle, RenewedLogin } from './schema.ts';

export const makeLoginRenewal = Effect.fn('LoginRenewal.make')(function* (
  definition: LoginRenewalDefinition
) {
  const folders = yield* AccountFolders;
  const failed = yield* Ref.make<ReadonlyMap<string, string | null>>(new Map());

  const fingerprintLogin = (login: StoredLogin | null) => {
    if (!login) return null;
    return createHash('sha256')
      .update(login.refreshToken ?? login.accessToken)
      .digest('hex')
      .slice(0, 16);
  };

  const read = (account: StoredAccount) =>
    readAccountLogin({
      configDir: account.configDir,
      env: definition.env,
      userHome: definition.userHome,
      readSecret: definition.readSecret,
    }).pipe(Effect.provideService(AccountFolders, folders));

  const forget = (accountId: string) =>
    Ref.update(failed, (all) => {
      const rest = new Map(all);
      rest.delete(accountId);
      return rest;
    });

  const renew = Effect.fn('LoginRenewal.renew')(function* (account: StoredAccount) {
    const expiresAt = (yield* read(account))?.expiresAt ?? null;
    return expiresAt !== null && expiresAt > (yield* definition.now) + LOGIN_EXPIRY_MARGIN_MS;
  });

  const recordFailed = Effect.fn('LoginRenewal.recordFailed')(function* (account: StoredAccount) {
    const fingerprint = fingerprintLogin(yield* read(account));
    yield* Ref.update(failed, (all) => new Map(all).set(account.id, fingerprint));
  });

  const checkRenewed = Effect.fn('LoginRenewal.checkRenewed')(function* (account: StoredAccount) {
    const before = (yield* Ref.get(failed)).get(account.id) ?? null;
    const fingerprint = fingerprintLogin(yield* read(account));
    if (fingerprint === null || fingerprint === before) return null;
    yield* forget(account.id);
    const renewed: RenewedLogin = { account, fingerprint };
    return renewed;
  });

  const listRenewed = Effect.fn('LoginRenewal.listRenewed')(function* (accounts: readonly StoredAccount[]) {
    const all = yield* Ref.get(failed);
    const checked = yield* Effect.forEach(
      accounts.filter((account) => all.has(account.id)),
      checkRenewed,
      { concurrency: 'unbounded' }
    );
    return checked.filter((renewed) => renewed !== null);
  });

  const handle: LoginRenewalHandle = { renew, recordFailed, clear: forget, listRenewed };
  return handle;
});
