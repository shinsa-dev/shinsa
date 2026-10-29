import { type AccountImport, DomainError } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { Cswap } from './cswap.ts';
import type { UsageLimits } from './limits.ts';
import type { Env } from './paths.ts';
import type { SignInState } from './rotation.ts';
import type { AuthStatus } from './status.ts';
import type { AccountStore } from './store.ts';

export interface AccountImportsOptions {
  store: AccountStore;
  limits: UsageLimits;
  signIns: Map<string, SignInState>;
  cswap: Cswap;
  readStatus: (env: Env) => Promise<AuthStatus>;
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

  async adoptClaudeLogin() {
    try {
      const status = await this.#options.readStatus({});
      if (status.signIn !== 'signed_in') return;
      this.#options.store.create('claude', {
        email: status.email,
        organization: status.organization,
        plan: status.plan,
      });
      log.info('[Accounts] Added your Claude Code login to the accounts', { email: status.email });
    } catch (error) {
      log.warn('[Accounts] Could not check your Claude Code login', { error: describeError(error) });
    }
  }

  async sync() {
    const imports: AccountImport[] = [];
    const accounts = this.#options.store.list();
    const known = new Set(
      accounts.flatMap((account) => (account.email ? [account.email.toLowerCase()] : []))
    );
    if (!accounts.some((account) => account.origin === 'claude')) {
      try {
        const status = await this.#options.readStatus({});
        if (status.signIn === 'signed_in' && status.email) {
          imports.push({ origin: 'claude', email: status.email, plan: status.plan });
        }
      } catch (error) {
        log.warn('[Accounts] Could not check your Claude Code login', { error: describeError(error) });
      }
    }
    for (const account of await this.#options.cswap.list()) {
      if (known.has(account.email.toLowerCase())) continue;
      imports.push({ origin: 'cswap', email: account.email, plan: null });
    }
    this.#imports = imports;
    this.#options.onChange();
  }

  importAccount(origin: unknown, email: unknown) {
    if (typeof email !== 'string' || !email.trim())
      throw new DomainError('import_invalid', 'Name the account to import.');
    if (origin === 'claude') return this.#importClaudeLogin(email.trim());
    if (origin === 'cswap') return this.#importCswap(email.trim());
    throw new DomainError('import_invalid', 'Import your Claude Code login or an account from claude-swap.');
  }

  async #importClaudeLogin(email: string) {
    const status = await this.#options.readStatus({});
    if (status.signIn !== 'signed_in' || status.email?.toLowerCase() !== email.toLowerCase()) {
      throw new DomainError('import_failed', `Your Claude Code login is no longer ${email}. Check again.`);
    }
    const account = this.#options.store.create('claude', {
      email: status.email,
      organization: status.organization,
      plan: status.plan,
    });
    await this.#recordImported(account.id);
  }

  async #importCswap(email: string) {
    if (this.#options.store.selectByIdentity({ email, organization: null }))
      throw new DomainError('account_exists', `${email} is already in your accounts.`);
    await this.#options.signIn(email);
  }

  async #recordImported(accountId: string) {
    this.#options.signIns.set(accountId, { signIn: 'signed_in', detail: null });
    await this.#options.limits.refresh([accountId], true);
    await this.sync();
  }
}
