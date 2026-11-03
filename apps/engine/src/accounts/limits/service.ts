import type { AccountUsage, UsageWindow } from '@shinsa/core';
import { Deferred, Effect, Ref } from 'effect';
import { AccountRegistry } from '../registry/service.ts';
import { type KeyedWindow, LIMITED_BACKOFF_MS, type UsageRead } from '../schema.ts';
import { resolveWindowId } from '../usage/answer.ts';
import type { RateLimitNotice, UsageLimitsDefinition, UsageLimitsHandle } from './schema.ts';
import { createUnknownUsage } from './unknown.ts';

export const makeUsageLimits = Effect.fn('UsageLimits.make')(function* (definition: UsageLimitsDefinition) {
  const registry = yield* AccountRegistry;
  const entries = yield* Ref.make<ReadonlyMap<string, AccountUsage>>(
    yield* registry.readUsage(definition.path)
  );
  const reading = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<void>>>(new Map());

  const resolvePushedPercent = (notice: RateLimitNotice) => {
    if (notice.status === 'rejected') return 100;
    if (notice.utilization === null) return null;
    return Math.min(100, Math.max(0, notice.utilization * 100));
  };

  const selectEntry = (accountId: string) => Effect.map(Ref.get(entries), (all) => all.get(accountId));

  const snapshot = (accountId: string) =>
    Effect.map(selectEntry(accountId), (usage) => usage ?? createUnknownUsage());

  const persist = Effect.gen(function* () {
    yield* registry.keepUsage(definition.path, yield* Ref.get(entries));
    yield* definition.changed;
  });

  const store = Effect.fn('UsageLimits.store')(function* (accountId: string, usage: AccountUsage) {
    yield* Ref.update(entries, (all) => new Map(all).set(accountId, usage));
    yield* persist;
  });

  const remove = Effect.fn('UsageLimits.remove')(function* (accountId: string) {
    const removed = yield* Ref.modify(entries, (all) => {
      if (!all.has(accountId)) return [false, all];
      const rest = new Map(all);
      rest.delete(accountId);
      return [true, rest];
    });
    if (removed) yield* persist;
  });

  const isFresh = Effect.fn('UsageLimits.isFresh')(function* (accountId: string) {
    const checkedAt = (yield* selectEntry(accountId))?.checkedAt ?? null;
    return checkedAt !== null && (yield* definition.now) - checkedAt < definition.ttlMs;
  });

  const attempt = (accountId: string) =>
    definition.read(accountId).pipe(
      Effect.catch((failure) => {
        const failed: UsageRead = {
          ok: false,
          reason: 'failed',
          detail: `Could not read usage: ${failure.message}`,
          retryAfterMs: null,
        };
        return Effect.succeed(failed);
      })
    );

  const read = Effect.fn('UsageLimits.read')(function* (accountId: string) {
    const result = yield* attempt(accountId);
    const { retryAt: _retryAt, ...previous } = (yield* selectEntry(accountId)) ?? createUnknownUsage();
    const now = yield* definition.now;
    if (result.ok) {
      const found = result.windows.length > 0;
      const fastMode = result.fastMode ?? previous.fastMode;
      return yield* store(accountId, {
        status: found ? 'ok' : 'unavailable',
        windows: result.windows,
        detail: found ? null : definition.emptyDetail,
        checkedAt: now,
        source: 'read',
        ...(fastMode ? { fastMode } : {}),
      });
    }
    yield* store(accountId, {
      ...previous,
      status: previous.windows.length > 0 ? previous.status : 'unavailable',
      detail: result.detail,
      ...(result.reason === 'limited'
        ? { retryAt: now + Math.max(result.retryAfterMs ?? 0, LIMITED_BACKOFF_MS) }
        : {}),
    });
  });

  const refreshOne = Effect.fn('UsageLimits.refreshOne')(function* (accountId: string, force: boolean) {
    const retryAt = (yield* selectEntry(accountId))?.retryAt;
    if (retryAt !== undefined && retryAt > (yield* definition.now)) return;
    if (!force && (yield* isFresh(accountId))) return;
    const own = yield* Deferred.make<void>();
    const running = yield* Ref.modify(reading, (all) => {
      const current = all.get(accountId);
      return current ? [current, all] : [own, new Map(all).set(accountId, own)];
    });
    if (running !== own) return yield* Deferred.await(running);
    yield* read(accountId).pipe(
      Effect.ensuring(
        Ref.update(reading, (all) => {
          const rest = new Map(all);
          rest.delete(accountId);
          return rest;
        }).pipe(Effect.andThen(Deferred.succeed(own, undefined)))
      )
    );
  });

  const refresh = (accountIds: readonly string[], force: boolean) =>
    Effect.forEach(accountIds, (accountId) => refreshOne(accountId, force), {
      concurrency: 'unbounded',
      discard: true,
    });

  const recordPush = Effect.fn('UsageLimits.recordPush')(function* (
    accountId: string,
    notice: RateLimitNotice
  ) {
    if (!notice.limit) return;
    const table = definition.windows;
    const keyed = table[notice.limit];
    const id = keyed?.id ?? resolveWindowId(notice.limit);
    const previous = (yield* selectEntry(accountId)) ?? createUnknownUsage();
    const known = previous.windows.find((candidate) => candidate.id === id);
    if (!known && !keyed) return;
    const usedPercent = resolvePushedPercent(notice) ?? known?.usedPercent ?? null;
    if (usedPercent === null) return;
    const window: UsageWindow = known
      ? { ...known, usedPercent, resetsAt: notice.resetsAt ?? known.resetsAt }
      : { ...(keyed as KeyedWindow), usedPercent, resetsAt: notice.resetsAt };
    const windows = known
      ? previous.windows.map((candidate) => (candidate.id === id ? window : candidate))
      : [...previous.windows, window];
    yield* store(accountId, {
      ...previous,
      status: 'ok',
      windows,
      detail: null,
      checkedAt: yield* definition.now,
      source: 'push',
    });
  });

  const handle: UsageLimitsHandle = { snapshot, isFresh, refresh, remove, recordPush };
  return handle;
});
