import type { ChatNotice } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import {
  NO_WINDOWS,
  type UsageLimitsHandle,
  type UsageLimitsOptions,
  UsageReaderFailed,
} from './limits/schema.ts';
import { makeUsageLimits } from './limits/service.ts';
import { KEYED_WINDOWS, USAGE_TTL_MS } from './schema.ts';

export type { UsageLimitsOptions, UsageReader } from './limits/schema.ts';
export { createUnknownUsage } from './limits/unknown.ts';
export { USAGE_TTL_MS } from './schema.ts';

export class UsageLimits {
  readonly handle: UsageLimitsHandle;
  readonly #listeners = new Set<() => void>();

  constructor(options: UsageLimitsOptions) {
    this.handle = edgeRuntime.runSync(
      makeUsageLimits({
        path: options.path,
        read: (accountId) =>
          Effect.tryPromise({
            try: () => options.read(accountId),
            catch: (error) => new UsageReaderFailed({ message: describeError(error) }),
          }),
        ttlMs: options.ttlMs ?? USAGE_TTL_MS,
        now: Effect.sync(options.now ?? Date.now),
        windows: options.windows ?? KEYED_WINDOWS,
        emptyDetail: options.emptyDetail ?? NO_WINDOWS,
        changed: Effect.sync(() => {
          for (const listener of this.#listeners) listener();
        }),
      })
    );
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  snapshot(accountId: string) {
    return edgeRuntime.runSync(this.handle.snapshot(accountId));
  }

  remove(accountId: string) {
    edgeRuntime.runSync(this.handle.remove(accountId));
  }

  isFresh(accountId: string) {
    return edgeRuntime.runSync(this.handle.isFresh(accountId));
  }

  refresh(accountIds: string[], force = false) {
    return edgeRuntime.runPromise(this.handle.refresh(accountIds, force));
  }

  recordPush(accountId: string, notice: Extract<ChatNotice, { kind: 'rate_limit' }>) {
    edgeRuntime.runSync(this.handle.recordPush(accountId, notice));
  }
}
