import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type AccountOrigin, DomainError } from '@shinsa/core';
import { writeJsonFile } from '../config/file.ts';
import { describeError, log } from '../log/index.ts';
import {
  ACCOUNT_OWNED_ENTRIES,
  resolveAccountDir,
  resolveRegistryPath,
  SEEDED_CONFIG_KEYS,
} from './paths.ts';

export interface StoredAccount {
  id: string;
  configDir: string | null;
  email: string | null;
  organization: string | null;
  plan: string | null;
  origin: AccountOrigin;
  addedAt: number;
  paused: boolean;
  switchAt: number | null;
}

interface Registry {
  version: 1;
  defaultAccountId: string | null;
  accounts: StoredAccount[];
}

export interface AccountStoreOptions {
  home: string;
  sharedDir: string;
  sharedGlobalConfig: string;
  now?: () => number;
  newId?: () => string;
}

export type AccountDetails = Partial<Pick<StoredAccount, 'email' | 'organization' | 'plan'>>;

export type AccountIdentity = Pick<StoredAccount, 'email' | 'organization'>;

type Fields = Record<string, unknown>;

const ORIGINS = new Set<AccountOrigin>(['claude', 'login', 'cswap']);

function readText(fields: Fields, key: string) {
  const value = fields[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readAccount(value: unknown): StoredAccount | null {
  if (!value || typeof value !== 'object') return null;
  const fields = value as Fields;
  const id = readText(fields, 'id');
  const origin = fields.origin as AccountOrigin;
  if (!id || !ORIGINS.has(origin)) return null;
  const switchAt = fields.switchAt;
  return {
    id,
    configDir: readText(fields, 'configDir'),
    email: readText(fields, 'email'),
    organization: readText(fields, 'organization'),
    plan: readText(fields, 'plan'),
    origin,
    addedAt: typeof fields.addedAt === 'number' ? fields.addedAt : 0,
    paused: fields.paused === true,
    switchAt: typeof switchAt === 'number' && switchAt >= 1 && switchAt <= 100 ? Math.round(switchAt) : null,
  };
}

function createRegistry(): Registry {
  return { version: 1, defaultAccountId: null, accounts: [] };
}

function parseRegistry(value: unknown): Registry {
  const fields = (value && typeof value === 'object' ? value : {}) as Fields;
  const accounts = (Array.isArray(fields.accounts) ? fields.accounts : [])
    .map(readAccount)
    .filter((account): account is StoredAccount => account !== null);
  const preferred = readText(fields, 'defaultAccountId');
  const fallback = accounts[0]?.id ?? null;
  const defaultAccountId = accounts.some((account) => account.id === preferred) ? preferred : fallback;
  return { version: 1, defaultAccountId, accounts };
}

function isSameText(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

function isSameIdentity(a: AccountIdentity, b: AccountIdentity) {
  if (!a.email || !b.email || !isSameText(a.email, b.email)) return false;
  if (!a.organization || !b.organization) return true;
  return isSameText(a.organization, b.organization);
}

function isLink(path: string) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function exists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
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
    if (!existsSync(this.#path)) return createRegistry();
    try {
      return parseRegistry(JSON.parse(readFileSync(this.#path, 'utf8')));
    } catch (error) {
      const copy = `${this.#path}.unreadable-${Date.now()}`;
      copyFileSync(this.#path, copy);
      log.warn('[Accounts] The account list could not be read; starting with none', {
        path: this.#path,
        copy,
        error: describeError(error),
      });
      return createRegistry();
    }
  }

  #write() {
    writeJsonFile(this.#path, this.#registry);
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
    if (!account) throw new DomainError('account_not_found', 'That account is no longer in your accounts.');
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

  #seedGlobalConfig(configDir: string) {
    const target = join(configDir, '.claude.json');
    if (existsSync(target)) return;
    let shared: Fields = {};
    try {
      shared = JSON.parse(readFileSync(this.#options.sharedGlobalConfig, 'utf8')) as Fields;
    } catch (error) {
      log.info('[Accounts] No shared Claude settings to copy into a new account', {
        error: describeError(error),
      });
    }
    const seeded: Fields = { hasCompletedOnboarding: true };
    for (const key of SEEDED_CONFIG_KEYS) if (shared[key] !== undefined) seeded[key] = shared[key];
    writeFileSync(target, `${JSON.stringify(seeded, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  }

  writeAccountConfig(configDir: string, patch: Fields) {
    const target = join(configDir, '.claude.json');
    let current: Fields = {};
    try {
      current = JSON.parse(readFileSync(target, 'utf8')) as Fields;
    } catch {
      current = {};
    }
    writeJsonFile(target, { ...current, ...patch });
  }

  linkSharedEntries(configDir: string) {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true, mode: 0o700 });
      this.#seedGlobalConfig(configDir);
    }
    let entries: string[];
    try {
      entries = readdirSync(this.#options.sharedDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ACCOUNT_OWNED_ENTRIES.has(entry)) continue;
      const target = join(configDir, entry);
      if (exists(target)) continue;
      try {
        symlinkSync(join(this.#options.sharedDir, entry), target);
      } catch (error) {
        log.warn('[Accounts] Could not share a Claude setting with an account', {
          entry,
          error: describeError(error),
        });
      }
    }
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
    if (from < 0) throw new DomainError('account_not_found', 'That account is no longer in your accounts.');
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
  let entries: string[] = [];
  try {
    entries = readdirSync(configDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(configDir, entry);
    if (isLink(path)) unlinkSync(path);
  }
  rmSync(configDir, { recursive: true, force: true });
}
