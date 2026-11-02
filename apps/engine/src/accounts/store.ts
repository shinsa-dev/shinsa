import { existsSync } from 'node:fs';
import { DomainError } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import { AccountFolders } from './folders/service.ts';
import { resolveAccountDir, resolveRegistryPath } from './paths.ts';
import { AccountRegistry } from './registry/service.ts';
import type { AccountDetails, AccountIdentity, Registry, StoredAccount } from './schema.ts';

export type { AccountDetails, AccountIdentity, StoredAccount } from './schema.ts';

export interface AccountStoreOptions {
  home: string;
  sharedDir: string;
  sharedGlobalConfig: string;
  now?: () => number;
  newId?: () => string;
}

function isSameText(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

function isSameIdentity(a: AccountIdentity, b: AccountIdentity) {
  if (!a.email || !b.email || !isSameText(a.email, b.email)) return false;
  if (!a.organization || !b.organization) return true;
  return isSameText(a.organization, b.organization);
}

export function isSharedLogin(account: StoredAccount) {
  return account.origin !== 'login';
}

export class AccountStore {
  readonly #options: AccountStoreOptions;
  readonly #path: string;
  readonly #listeners = new Set<() => void>();
  #registry: Registry;

  constructor(options: AccountStoreOptions) {
    this.#options = options;
    this.#path = resolveRegistryPath(options.home);
    this.#registry = this.#read();
  }

  get exists() {
    return existsSync(this.#path);
  }

  #read(): Registry {
    return edgeRuntime.runSync(AccountRegistry.use((registry) => registry.readAccounts(this.#path)));
  }

  #write() {
    const registry = this.#registry;
    edgeRuntime.runSync(AccountRegistry.use((accounts) => accounts.writeAccounts(this.#path, registry)));
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  list(): StoredAccount[] {
    return this.#registry.accounts.map((account) => ({ ...account }));
  }

  get defaultAccountId() {
    return this.#registry.defaultAccountId;
  }

  select(id: string) {
    const account = this.#registry.accounts.find((candidate) => candidate.id === id);
    return account ? { ...account } : null;
  }

  find(id: string) {
    const account = this.select(id);
    if (!account) throw new DomainError({ code: 'account_not_found', message: 'That account was removed.' });
    return account;
  }

  selectByIdentity(identity: AccountIdentity, exceptId: string | null = null) {
    return (
      this.list().find((account) => account.id !== exceptId && isSameIdentity(account, identity)) ?? null
    );
  }

  resolveDuplicates() {
    const { accounts, defaultAccountId } = this.#registry;
    const rank = (account: StoredAccount) => {
      if (isSharedLogin(account)) return 2;
      return account.id === defaultAccountId ? 0 : 1;
    };
    const preferred = accounts
      .map((account, index) => ({ account, index }))
      .sort((a, b) => rank(a.account) - rank(b.account) || a.index - b.index)
      .map(({ account }) => account);
    const kept: StoredAccount[] = [];
    const duplicates = new Map<string, string>();
    for (const account of preferred) {
      const keeper = kept.find((candidate) => isSameIdentity(candidate, account));
      if (keeper) duplicates.set(account.id, keeper.id);
      else kept.push(account);
    }
    return duplicates;
  }

  listDistinct() {
    const duplicates = this.resolveDuplicates();
    return this.list().filter((account) => !duplicates.has(account.id));
  }

  isDefault(id: string, duplicates = this.resolveDuplicates()) {
    const preferred = this.#registry.defaultAccountId;
    if (preferred === null) return false;
    return preferred === id || duplicates.get(preferred) === id;
  }

  create(details: AccountDetails = {}) {
    const id = (this.#options.newId ?? (() => crypto.randomUUID().slice(0, 8)))();
    const configDir = resolveAccountDir(this.#options.home, id);
    this.linkSharedEntries(configDir);
    const account: StoredAccount = {
      id,
      configDir,
      email: details.email ?? null,
      organization: details.organization ?? null,
      plan: details.plan ?? null,
      origin: 'login',
      addedAt: (this.#options.now ?? Date.now)(),
      paused: false,
      switchAt: null,
    };
    this.#registry.accounts.push(account);
    this.#registry.defaultAccountId ??= id;
    this.#write();
    return { ...account };
  }

  writeAccountConfig(configDir: string, patch: Record<string, unknown>) {
    edgeRuntime.runSync(AccountFolders.use((folders) => folders.writeConfig(configDir, patch)));
  }

  linkSharedEntries(configDir: string) {
    const { sharedDir, sharedGlobalConfig } = this.#options;
    edgeRuntime.runSync(
      AccountFolders.use((folders) => folders.prepare(configDir, { sharedDir, sharedGlobalConfig }))
    );
  }

  createFolder(id: string) {
    const account = this.#registry.accounts.find((candidate) => candidate.id === id);
    if (!account) return null;
    account.configDir ??= resolveAccountDir(this.#options.home, id);
    this.linkSharedEntries(account.configDir);
    this.#write();
    return { ...account };
  }

  update(id: string, patch: Partial<Omit<StoredAccount, 'id' | 'configDir' | 'addedAt'>>) {
    const account = this.#registry.accounts.find((candidate) => candidate.id === id);
    if (!account) return;
    const next = { ...account, ...patch };
    if (JSON.stringify(next) === JSON.stringify(account)) return;
    Object.assign(account, patch);
    this.#write();
  }

  updateDefault(id: string) {
    this.find(id);
    if (this.#registry.defaultAccountId === id) return;
    this.#registry.defaultAccountId = id;
    this.#write();
  }

  move(id: string, position: number) {
    const accounts = this.#registry.accounts;
    const from = accounts.findIndex((candidate) => candidate.id === id);
    if (from < 0) throw new DomainError({ code: 'account_not_found', message: 'That account was removed.' });
    const to = Math.max(0, Math.min(accounts.length - 1, Math.round(position)));
    if (from === to) return;
    const [account] = accounts.splice(from, 1) as [StoredAccount];
    accounts.splice(to, 0, account);
    this.#write();
  }

  remove(id: string) {
    const account = this.find(id);
    this.#registry.accounts = this.#registry.accounts.filter((candidate) => candidate.id !== id);
    if (this.#registry.defaultAccountId === id) {
      this.#registry.defaultAccountId = this.#registry.accounts[0]?.id ?? null;
    }
    this.#write();
    if (account.configDir) removeAccountDir(account.configDir);
  }
}

export function removeAccountDir(configDir: string) {
  edgeRuntime.runSync(AccountFolders.use((folders) => folders.remove(configDir)));
}
