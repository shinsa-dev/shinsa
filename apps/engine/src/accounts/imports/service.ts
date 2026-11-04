import { type AccountImport, DomainError } from '@shinsa/core';
import { Context, Effect, Layer, Ref } from 'effect';
import { AccountChanges } from '../changes/service.ts';
import { Cswap } from '../cswap/service.ts';
import { AccountStore } from '../store/service.ts';

export class AccountImports extends Context.Service<
  AccountImports,
  {
    readonly list: Effect.Effect<AccountImport[]>;
    readonly sync: Effect.Effect<void>;
    resolveImportEmail(origin: unknown, email: unknown): Effect.Effect<string, DomainError>;
  }
>()('shinsa/engine/accounts/imports/AccountImports') {
  static readonly layer = Layer.effect(
    AccountImports,
    Effect.gen(function* () {
      const store = yield* AccountStore;
      const cswap = yield* Cswap;
      const changes = yield* AccountChanges;
      const imports = yield* Ref.make<AccountImport[]>([]);

      const sync = Effect.gen(function* () {
        const known = new Set(
          (yield* store.list).flatMap((account) => (account.email ? [account.email.toLowerCase()] : []))
        );
        const found: AccountImport[] = [];
        for (const account of yield* cswap.list) {
          if (known.has(account.email.toLowerCase())) continue;
          found.push({ origin: 'cswap', email: account.email, plan: null });
        }
        yield* Ref.set(imports, found);
        yield* changes.notify;
      });

      const resolveImportEmail = Effect.fn('AccountImports.resolveImportEmail')(function* (
        origin: unknown,
        email: unknown
      ) {
        if (typeof email !== 'string' || !email.trim())
          return yield* new DomainError({
            code: 'import_invalid',
            message: 'Name the account to sign in to.',
          });
        if (origin !== 'cswap')
          return yield* new DomainError({
            code: 'import_invalid',
            message: 'Sign in to an account claude-swap has.',
          });
        const trimmed = email.trim();
        if (yield* store.selectByIdentity({ email: trimmed, organization: null }))
          return yield* new DomainError({ code: 'account_exists', message: `${trimmed} is already added.` });
        return trimmed;
      });

      return AccountImports.of({ list: Ref.get(imports), sync, resolveImportEmail });
    })
  );
}
