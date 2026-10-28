import { createHash } from 'node:crypto';
import type { RunFailure } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import {
  readStoredLogin,
  type SecretReader,
  type SecretWriter,
  type StoredLogin,
  writeStoredLogin,
} from './credentials.ts';
import type { Cswap } from './cswap.ts';
import type { Env } from './paths.ts';
import type { StoredAccount } from './store.ts';

export interface LoginRenewalOptions {
  cswap: Cswap;
  env: Env;
  userHome: string;
  readSecret: SecretReader;
  writeSecret: SecretWriter;
  now: () => number;
}

export interface RenewedLogin {
  account: StoredAccount;
  fingerprint: string;
}

const TOKEN_FAILURE_CODES: ReadonlySet<string> = new Set([
  'login_required',
  'authentication_failed',
  'api_error_401',
]);

const EXPIRY_MARGIN_MS = 60_000;

export function isTokenFailure(failure: RunFailure) {
  return failure.class === 'auth' && TOKEN_FAILURE_CODES.has(failure.code ?? '');
}

function fingerprintLogin(login: StoredLogin | null) {
  if (!login) return null;
  return createHash('sha256')
    .update(login.refreshToken ?? login.accessToken)
    .digest('hex')
    .slice(0, 16);
}

function listEmails(accounts: StoredAccount[]) {
  const emails = accounts.map((account) => account.email ?? 'an account without an email');
  if (emails.length < 2) return emails.join('');
  return `${emails.slice(0, -1).join(', ')} and ${emails.at(-1)}`;
}

function describeSignIn(account: StoredAccount, email: string) {
  if (account.origin === 'claude') return 'Sign in to it here, or run `claude auth login` in a terminal.';
  if (account.origin === 'login') return 'Sign in to it here.';
  return `Sign in to it here, or sign in to Claude Code as ${email} and run \`cswap add\`: Shinsa takes the new login from claude-swap.`;
}

export class LoginRenewal {
  readonly #options: LoginRenewalOptions;
  readonly #failed = new Map<string, string | null>();

  constructor(options: LoginRenewalOptions) {
    this.#options = options;
  }

  #read(account: StoredAccount) {
    const { env, userHome, readSecret } = this.#options;
    return readStoredLogin({ configDir: account.configDir, env, userHome, readSecret });
  }

  async #copyFromCswap(account: StoredAccount, current: StoredLogin | null) {
    if (account.origin !== 'cswap' || !account.configDir || !account.email) return false;
    const oauth = (await this.#options.cswap.export(account.email))?.credentials.claudeAiOauth;
    if (!oauth || oauth.refreshToken === current?.refreshToken) return false;
    const { env, readSecret, writeSecret } = this.#options;
    try {
      await writeStoredLogin({ configDir: account.configDir, env, readSecret, writeSecret }, oauth);
    } catch (error) {
      log.warn('[Accounts] Could not take claude-swap’s copy of a login', {
        accountId: account.id,
        error: describeError(error),
      });
      return false;
    }
    log.info('[Accounts] Took claude-swap’s current copy of a login', {
      accountId: account.id,
      email: account.email,
    });
    return true;
  }

  async renew(account: StoredAccount) {
    const current = await this.#read(account);
    if (await this.#copyFromCswap(account, current)) return true;
    const expiresAt = current?.expiresAt ?? null;
    return expiresAt !== null && expiresAt > this.#options.now() + EXPIRY_MARGIN_MS;
  }

  async recordFailed(account: StoredAccount) {
    this.#failed.set(account.id, fingerprintLogin(await this.#read(account)));
  }

  clear(accountId: string) {
    this.#failed.delete(accountId);
  }

  async #checkRenewed(account: StoredAccount): Promise<RenewedLogin | null> {
    const failed = this.#failed.get(account.id) ?? null;
    const before = await this.#read(account);
    let current = before;
    if (await this.#copyFromCswap(account, before)) current = await this.#read(account);
    const fingerprint = fingerprintLogin(current);
    if (fingerprint === null || fingerprint === failed) return null;
    this.#failed.delete(account.id);
    return { account, fingerprint };
  }

  async listRenewed(accounts: StoredAccount[]) {
    const checked = await Promise.all(
      accounts.filter((account) => this.#failed.has(account.id)).map((account) => this.#checkRenewed(account))
    );
    return checked.filter((renewed) => renewed !== null);
  }
}

export function describeExpiredLogin(account: StoredAccount, others: StoredAccount[]) {
  const email = account.email ?? 'this account';
  const verb = others.length === 1 ? 'needs' : 'need';
  const also = others.length > 0 ? `, and ${listEmails(others)} ${verb} signing in again too` : '';
  return `Claude could not refresh the login of ${email}${also}. ${describeSignIn(account, email)}`;
}
