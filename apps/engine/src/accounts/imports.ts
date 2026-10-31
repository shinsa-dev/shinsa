import { type AccountImport, DomainError } from '@shinsa/core';
import type { Cswap } from './cswap.ts';
import type { AccountStore } from './store.ts';

export interface AccountImportsOptions {
  store: AccountStore;
  cswap: Cswap;
  signIn: (email: string) => Promise<void>;
  onChange: () => void;
}

export class AccountImports {
  readonly #options: AccountImportsOptions;
  #imports: AccountImport[] = [];

  constructor(options: AccountImportsOptions) {
    this.#options = options;
  }

  list() {
    return this.#imports;
  }

  async sync() {
    const known = new Set(
      this.#options.store.list().flatMap((account) => (account.email ? [account.email.toLowerCase()] : []))
    );
    const imports: AccountImport[] = [];
    for (const account of await this.#options.cswap.list()) {
      if (known.has(account.email.toLowerCase())) continue;
      imports.push({ origin: 'cswap', email: account.email, plan: null });
    }
    this.#imports = imports;
    this.#options.onChange();
  }

  importAccount(origin: unknown, email: unknown) {
    if (typeof email !== 'string' || !email.trim())
      throw new DomainError('import_invalid', 'Name the account to sign in to.');
    if (origin !== 'cswap') throw new DomainError('import_invalid', 'Sign in to an account claude-swap has.');
    return this.#importCswap(email.trim());
  }

  async #importCswap(email: string) {
    if (this.#options.store.selectByIdentity({ email, organization: null }))
      throw new DomainError('account_exists', `${email} is already added.`);
    await this.#options.signIn(email);
  }
}
