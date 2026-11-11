import { join } from 'node:path';
import type { AccountUsage, UsageWindow } from '@shinsa/core';
import { Clock, Context, Deferred, Duration, Effect, Layer, Ref } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { AccountChanges } from '../changes/service.ts';
import { UsageReadings } from '../readings/service.ts';
import { AccountRegistry } from '../registry/service.ts';
import {
  type AccountStepFailed,
  KEYED_WINDOWS,
  type KeyedWindow,
  LIMITED_BACKOFF_MS,
  PROVIDER_WINDOWS,
  type UsageRead,
  UsageTtl,
} from '../schema.ts';
import { resolveWindowId } from '../usage/answer.ts';
import { resolveReadUsage } from './read.ts';
import {
  ACCOUNT_USAGE_FILE,
  NO_PROVIDER_WINDOWS,
  NO_WINDOWS,
  PROVIDER_USAGE_FILE,
  type RateLimitNotice,
  type UsageTable,
} from './schema.ts';
import { createUnknownUsage } from './unknown.ts';

export class UsageLimits extends Context.Service<
  UsageLimits,
  { readonly claude: UsageTable; readonly providers: UsageTable }
>()('shinsa/engine/accounts/limits/UsageLimits') {
  static readonly layer = Layer.effect(
    UsageLimits,
    Effect.gen(function* () {
      const registry = yield* AccountRegistry;
      const readings = yield* UsageReadings;
      const changes = yield* AccountChanges;
      const { dataDir } = yield* EngineConfig;
      const ttlMs = Duration.toMillis(yield* UsageTtl);

      const resolvePushedPercent = (notice: RateLimitNotice) => {
        if (notice.status === 'rejected') return 100;
        if (notice.utilization === null) return null;
        return Math.min(100, Math.max(0, notice.utilization * 100));
      };

      const makeTable = Effect.fn('UsageLimits.makeTable')(function* (table: {
        readonly path: string;
        readonly read: (id: string) => Effect.Effect<UsageRead, AccountStepFailed>;
        readonly windows: Record<string, KeyedWindow>;
        readonly emptyDetail: string;
      }) {
        const entries = yield* Ref.make<ReadonlyMap<string, AccountUsage>>(
          yield* registry.readUsage(table.path)
        );
        const lastRead = yield* Ref.make<ReadonlyMap<string, AccountUsage>>(
          new Map([...(yield* Ref.get(entries))].filter(([, usage]) => usage.source !== 'push'))
        );
        const reading = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<void>>>(new Map());

        const selectEntry = (id: string) => Effect.map(Ref.get(entries), (all) => all.get(id));

        const snapshot = (id: string) =>
          Effect.map(selectEntry(id), (usage) => usage ?? createUnknownUsage());

        const measured = (id: string) =>
          Effect.map(Ref.get(lastRead), (all) => all.get(id) ?? createUnknownUsage());

        const persist = Effect.gen(function* () {
          yield* registry.keepUsage(table.path, yield* Ref.get(entries));
          yield* changes.notify;
        });

        const store = Effect.fn('UsageLimits.store')(function* (id: string, usage: AccountUsage) {
          yield* Ref.update(entries, (all) => new Map(all).set(id, usage));
          yield* persist;
        });

        const remove = Effect.fn('UsageLimits.remove')(function* (id: string) {
          const removed = yield* Ref.modify(entries, (all) => {
            if (!all.has(id)) return [false, all];
            const rest = new Map(all);
            rest.delete(id);
            return [true, rest];
          });
          yield* Ref.update(lastRead, (all) => {
            const rest = new Map(all);
            rest.delete(id);
            return rest;
          });
          if (removed) yield* persist;
        });

        const isFresh = Effect.fn('UsageLimits.isFresh')(function* (id: string) {
          const checkedAt = (yield* selectEntry(id))?.checkedAt ?? null;
          return checkedAt !== null && (yield* Clock.currentTimeMillis) - checkedAt < ttlMs;
        });

        const attempt = (id: string) =>
          table.read(id).pipe(
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

        const read = Effect.fn('UsageLimits.read')(function* (id: string) {
          const result = yield* attempt(id);
          const { retryAt: _retryAt, ...previous } = (yield* selectEntry(id)) ?? createUnknownUsage();
          const now = yield* Clock.currentTimeMillis;
          if (result.ok) {
            const fresh = resolveReadUsage(result, previous, now, table.emptyDetail);
            yield* Ref.update(lastRead, (all) => new Map(all).set(id, fresh));
            return yield* store(id, fresh);
          }
          yield* store(id, {
            ...previous,
            status: previous.windows.length > 0 ? previous.status : 'unavailable',
            detail: result.detail,
            ...(result.reason === 'limited'
              ? { retryAt: now + Math.max(result.retryAfterMs ?? 0, LIMITED_BACKOFF_MS) }
              : {}),
          });
        });

        const refreshOne = Effect.fn('UsageLimits.refreshOne')(function* (id: string, force: boolean) {
          const retryAt = (yield* selectEntry(id))?.retryAt;
          if (retryAt !== undefined && retryAt > (yield* Clock.currentTimeMillis)) return;
          if (!force && (yield* isFresh(id))) return;
          const own = yield* Deferred.make<void>();
          const running = yield* Ref.modify(reading, (all) => {
            const current = all.get(id);
            return current ? [current, all] : [own, new Map(all).set(id, own)];
          });
          if (running !== own) return yield* Deferred.await(running);
          yield* read(id).pipe(
            Effect.ensuring(
              Ref.update(reading, (all) => {
                const rest = new Map(all);
                rest.delete(id);
                return rest;
              }).pipe(Effect.andThen(Deferred.succeed(own, undefined)))
            )
          );
        });

        const refresh = (ids: readonly string[], force: boolean) =>
          Effect.forEach(ids, (id) => refreshOne(id, force), { concurrency: 'unbounded', discard: true });

        const recordPush = Effect.fn('UsageLimits.recordPush')(function* (
          id: string,
          notice: RateLimitNotice
        ) {
          if (!notice.limit) return;
          const keyed = table.windows[notice.limit];
          const windowId = keyed?.id ?? resolveWindowId(notice.limit);
          const previous = (yield* selectEntry(id)) ?? createUnknownUsage();
          const known = previous.windows.find((candidate) => candidate.id === windowId);
          if (!known && !keyed) return;
          const usedPercent = resolvePushedPercent(notice) ?? known?.usedPercent ?? null;
          if (usedPercent === null) return;
          const window: UsageWindow = known
            ? { ...known, usedPercent, resetsAt: notice.resetsAt ?? known.resetsAt }
            : { ...(keyed as KeyedWindow), usedPercent, resetsAt: notice.resetsAt };
          const windows = known
            ? previous.windows.map((candidate) => (candidate.id === windowId ? window : candidate))
            : [...previous.windows, window];
          yield* store(id, {
            ...previous,
            status: 'ok',
            windows,
            detail: null,
            checkedAt: yield* Clock.currentTimeMillis,
            source: 'push',
          });
        });

        const usage: UsageTable = { snapshot, measured, isFresh, refresh, remove, recordPush };
        return usage;
      });

      const claude = yield* makeTable({
        path: join(dataDir, ACCOUNT_USAGE_FILE),
        read: readings.readAccount,
        windows: KEYED_WINDOWS,
        emptyDetail: NO_WINDOWS,
      });
      const providers = yield* makeTable({
        path: join(dataDir, PROVIDER_USAGE_FILE),
        read: readings.readProvider,
        windows: PROVIDER_WINDOWS,
        emptyDetail: NO_PROVIDER_WINDOWS,
      });

      return UsageLimits.of({ claude, providers });
    })
  );
}
