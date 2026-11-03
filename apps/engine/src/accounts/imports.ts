import { DomainError } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Cswap } from './cswap.ts';
import { ImportSignInFailed, type ImportsHandle } from './imports/schema.ts';
import { makeAccountImports } from './imports/service.ts';
import type { AccountStore } from './store.ts';

export interface AccountImportsOptions {
  store: AccountStore;
  cswap: Cswap;
  signIn: (email: string) => Promise<void>;
  onChange: () => void;
}

export class AccountImports {
  readonly #handle: ImportsHandle;

  constructor(options: AccountImportsOptions) {
    const { store } = options;
    this.#handle = edgeRuntime.runSync(
      makeAccountImports({
        listKnownEmails: Effect.sync(() =>
          store.list().flatMap((account) => (account.email ? [account.email] : []))
        ),
        hasAccount: (email) =>
          Effect.sync(() => store.selectByIdentity({ email, organization: null }) !== null),
        cswap: options.cswap.handle,
        signIn: (email) =>
          Effect.tryPromise({
            try: () => options.signIn(email),
            catch: (error) =>
              error instanceof DomainError
                ? error
                : new ImportSignInFailed({ message: describeError(error) }),
          }),
        changed: Effect.sync(options.onChange),
      })
    );
  }

  list() {
    return edgeRuntime.runSync(this.#handle.list);
  }

  sync() {
    return edgeRuntime.runPromise(this.#handle.sync);
  }

  importAccount(origin: unknown, email: unknown) {
    return edgeRuntime.runPromise(this.#handle.importAccount(origin, email));
  }
}
