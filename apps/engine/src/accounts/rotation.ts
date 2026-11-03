import { Effect } from 'effect';
import type { AccountLeaseRequest, RejectionVerdict, RunRejection } from '../agents/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { AccountRotationHandle, AccountRotationOptions } from './rotation/schema.ts';
import { makeAccountRotation } from './rotation/service.ts';

export type { AccountRotationOptions, SignInState } from './rotation/schema.ts';

export class AccountRotation {
  readonly #handle: AccountRotationHandle;

  constructor(options: AccountRotationOptions) {
    const { store, signIns } = options;
    this.#handle = edgeRuntime.runSync(
      makeAccountRotation({
        store: {
          listDistinct: Effect.sync(() => store.listDistinct()),
          resolveDuplicates: Effect.sync(() => store.resolveDuplicates()),
          isDefault: (accountId, duplicates) => Effect.sync(() => store.isDefault(accountId, duplicates)),
          select: (accountId) => Effect.sync(() => store.select(accountId)),
          find: (accountId) => Effect.sync(() => store.find(accountId)),
          linkSharedEntries: (configDir) => Effect.sync(() => store.linkSharedEntries(configDir)),
        },
        limits: options.limits.handle,
        renewal: options.renewal.handle,
        selectSignIn: (accountId) => Effect.sync(() => signIns.get(accountId)?.signIn ?? null),
        markSignedOut: (accountId, detail) =>
          Effect.sync(() => {
            signIns.set(accountId, { signIn: 'signed_out', detail });
          }),
        state: Effect.sync(options.state),
        now: Effect.sync(options.now),
        changed: Effect.sync(options.onChange),
        marksPath: options.marksPath,
      })
    );
  }

  resolveSpentUntil(accountId: string, knownResets = false) {
    return edgeRuntime.runSync(this.#handle.resolveSpentUntil(accountId, knownResets));
  }

  clear(accountId: string) {
    edgeRuntime.runSync(this.#handle.clear(accountId));
  }

  lease(request: AccountLeaseRequest) {
    return edgeRuntime.runSync(this.#handle.lease(request));
  }

  recordRejection(rejection: RunRejection): RejectionVerdict | Promise<RejectionVerdict> {
    const verdict = edgeRuntime.runSync(this.#handle.recordRejection(rejection));
    return Effect.isEffect(verdict) ? edgeRuntime.runPromise(verdict) : verdict;
  }
}
