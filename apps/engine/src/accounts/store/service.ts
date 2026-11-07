import { existsSync } from 'node:fs';
import { DomainError } from '@shinsa/core';
import { Clock, Context, Effect, Layer, Ref } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { AccountChanges } from '../changes/service.ts';
import { AccountFolders } from '../folders/service.ts';
import {
  resolveAccountDir,
  resolveRegistryPath,
  resolveSharedConfigDir,
  resolveSharedGlobalConfig,
} from '../paths.ts';
import { AccountRegistry } from '../registry/service.ts';
import {
  type AccountDetails,
  type AccountIdentity,
  AccountsEnv,
  NewAccountId,
  type Registry,
  type StoredAccount,
} from '../schema.ts';
import { isSameIdentity, isSharedLogin } from './identity.ts';
import type { AccountChange } from './schema.ts';

export class AccountStore extends Context.Service<
  AccountStore,
  {
    readonly exists: Effect.Effect<boolean>;
    readonly list: Effect.Effect<StoredAccount[]>;
    readonly defaultAccountId: Effect.Effect<string | null>;
    select(id: string): Effect.Effect<StoredAccount | null>;
    find(id: string): Effect.Effect<StoredAccount, DomainError>;
    selectByIdentity(
      identity: AccountIdentity,
      exceptId?: string | null
    ): Effect.Effect<StoredAccount | null>;
    readonly resolveDuplicates: Effect.Effect<Map<string, string>>;
    readonly listDistinct: Effect.Effect<StoredAccount[]>;
    isDefault(id: string, duplicates?: ReadonlyMap<string, string>): Effect.Effect<boolean>;
    create(details?: AccountDetails): Effect.Effect<StoredAccount>;
    writeAccountConfig(configDir: string, patch: Record<string, unknown>): Effect.Effect<void>;
    linkSharedEntries(configDir: string): Effect.Effect<void>;
    createFolder(id: string): Effect.Effect<StoredAccount | null>;
    update(id: string, patch: AccountChange): Effect.Effect<void>;
    updateDefault(id: string): Effect.Effect<void, DomainError>;
    move(id: string, position: number): Effect.Effect<void, DomainError>;
    remove(id: string): Effect.Effect<void, DomainError>;
    removeFolder(configDir: string): Effect.Effect<void>;
  }
>()('shinsa/engine/accounts/store/AccountStore') {
  static readonly layer = Layer.effect(
    AccountStore,
    Effect.gen(function* () {
      const config = yield* EngineConfig;
      const env = yield* AccountsEnv;
      const newId = yield* NewAccountId;
      const registries = yield* AccountRegistry;
      const folders = yield* AccountFolders;
      const changes = yield* AccountChanges;
      const path = resolveRegistryPath(config.home);
      const sources = {
        sharedDir: resolveSharedConfigDir(env, config.userHome),
        sharedGlobalConfig: resolveSharedGlobalConfig(env, config.userHome),
      };
      const registry = yield* Ref.make<Registry>(yield* registries.readAccounts(path));
      const removed = new DomainError({ code: 'account_not_found', message: 'That account was removed.' });

      const write = Effect.fn('AccountStore.write')(function* (next: Registry) {
        yield* Ref.set(registry, next);
        yield* registries.writeAccounts(path, next);
        yield* changes.notify;
      });

      const list = Effect.map(Ref.get(registry), (current) =>
        current.accounts.map((account) => ({ ...account }))
      );

      const select = (id: string) =>
        Effect.map(list, (accounts) => accounts.find((candidate) => candidate.id === id) ?? null);

      const find = Effect.fn('AccountStore.find')(function* (id: string) {
        const account = yield* select(id);
        if (!account) return yield* removed;
        return account;
      });

      const selectByIdentity = (identity: AccountIdentity, exceptId: string | null = null) =>
        Effect.map(
          list,
          (accounts) =>
            accounts.find((account) => account.id !== exceptId && isSameIdentity(account, identity)) ?? null
        );

      const resolveDuplicates = Effect.map(Ref.get(registry), ({ accounts, defaultAccountId }) => {
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
      });

      const listDistinct = Effect.gen(function* () {
        const duplicates = yield* resolveDuplicates;
        return (yield* list).filter((account) => !duplicates.has(account.id));
      });

      const isDefault = Effect.fn('AccountStore.isDefault')(function* (
        id: string,
        duplicates?: ReadonlyMap<string, string>
      ) {
        const preferred = (yield* Ref.get(registry)).defaultAccountId;
        if (preferred === null) return false;
        const known = duplicates ?? (yield* resolveDuplicates);
        return preferred === id || known.get(preferred) === id;
      });

      const linkSharedEntries = (configDir: string) => folders.prepare(configDir, sources);

      const create = Effect.fn('AccountStore.create')(function* (details: AccountDetails = {}) {
        const id = yield* newId;
        const configDir = resolveAccountDir(config.home, id);
        yield* linkSharedEntries(configDir);
        const account: StoredAccount = {
          id,
          configDir,
          email: details.email ?? null,
          organization: details.organization ?? null,
          plan: details.plan ?? null,
          origin: 'login',
          owner: details.owner ?? null,
          addedAt: yield* Clock.currentTimeMillis,
          paused: false,
          switchAt: null,
        };
        const current = yield* Ref.get(registry);
        yield* write({
          ...current,
          accounts: [...current.accounts, account],
          defaultAccountId: current.defaultAccountId ?? id,
        });
        return { ...account };
      });

      const replaceAccount = (current: Registry, account: StoredAccount): Registry => ({
        ...current,
        accounts: current.accounts.map((candidate) => (candidate.id === account.id ? account : candidate)),
      });

      const createFolder = Effect.fn('AccountStore.createFolder')(function* (id: string) {
        const current = yield* Ref.get(registry);
        const found = current.accounts.find((candidate) => candidate.id === id);
        if (!found) return null;
        const account = { ...found, configDir: found.configDir ?? resolveAccountDir(config.home, id) };
        yield* linkSharedEntries(account.configDir);
        yield* write(replaceAccount(current, account));
        return { ...account };
      });

      const update = Effect.fn('AccountStore.update')(function* (id: string, patch: AccountChange) {
        const current = yield* Ref.get(registry);
        const account = current.accounts.find((candidate) => candidate.id === id);
        if (!account) return;
        const next = { ...account, ...patch };
        if (JSON.stringify(next) === JSON.stringify(account)) return;
        yield* write(replaceAccount(current, next));
      });

      const updateDefault = Effect.fn('AccountStore.updateDefault')(function* (id: string) {
        yield* find(id);
        const current = yield* Ref.get(registry);
        if (current.defaultAccountId === id) return;
        yield* write({ ...current, defaultAccountId: id });
      });

      const move = Effect.fn('AccountStore.move')(function* (id: string, position: number) {
        const current = yield* Ref.get(registry);
        const accounts = [...current.accounts];
        const from = accounts.findIndex((candidate) => candidate.id === id);
        if (from < 0) return yield* removed;
        const to = Math.max(0, Math.min(accounts.length - 1, Math.round(position)));
        if (from === to) return;
        const [account] = accounts.splice(from, 1) as [StoredAccount];
        accounts.splice(to, 0, account);
        yield* write({ ...current, accounts });
      });

      const removeFolder = (configDir: string) => folders.remove(configDir);

      const remove = Effect.fn('AccountStore.remove')(function* (id: string) {
        const account = yield* find(id);
        const current = yield* Ref.get(registry);
        const accounts = current.accounts.filter((candidate) => candidate.id !== id);
        const defaultAccountId =
          current.defaultAccountId === id ? (accounts[0]?.id ?? null) : current.defaultAccountId;
        yield* write({ ...current, accounts, defaultAccountId });
        if (account.configDir) yield* removeFolder(account.configDir);
      });

      return AccountStore.of({
        exists: Effect.sync(() => existsSync(path)),
        list,
        defaultAccountId: Effect.map(Ref.get(registry), (current) => current.defaultAccountId),
        select,
        find,
        selectByIdentity,
        resolveDuplicates,
        listDistinct,
        isDefault,
        create,
        writeAccountConfig: (configDir, patch) => folders.writeConfig(configDir, patch),
        linkSharedEntries,
        createFolder,
        update,
        updateDefault,
        move,
        remove,
        removeFolder,
      });
    })
  );
}
