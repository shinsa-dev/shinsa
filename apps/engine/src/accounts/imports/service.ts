import { type AccountImport, DomainError } from '@shinsa/core';
import { Effect, Ref } from 'effect';
import type { ImportsDefinition, ImportsHandle } from './schema.ts';

export const makeAccountImports = Effect.fn('AccountImports.make')(function* (definition: ImportsDefinition) {
  const imports = yield* Ref.make<AccountImport[]>([]);

  const sync = Effect.gen(function* () {
    const known = new Set((yield* definition.listKnownEmails).map((email) => email.toLowerCase()));
    const found: AccountImport[] = [];
    for (const account of yield* definition.cswap.list) {
      if (known.has(account.email.toLowerCase())) continue;
      found.push({ origin: 'cswap', email: account.email, plan: null });
    }
    yield* Ref.set(imports, found);
    yield* definition.changed;
  });

  const importAccount = Effect.fn('AccountImports.importAccount')(function* (
    origin: unknown,
    email: unknown
  ) {
    if (typeof email !== 'string' || !email.trim())
      return yield* new DomainError({ code: 'import_invalid', message: 'Name the account to sign in to.' });
    if (origin !== 'cswap')
      return yield* new DomainError({
        code: 'import_invalid',
        message: 'Sign in to an account claude-swap has.',
      });
    const trimmed = email.trim();
    if (yield* definition.hasAccount(trimmed))
      return yield* new DomainError({ code: 'account_exists', message: `${trimmed} is already added.` });
    yield* definition.signIn(trimmed);
  });

  const handle: ImportsHandle = { list: Ref.get(imports), sync, importAccount };
  return handle;
});
