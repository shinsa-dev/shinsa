import type { Effect } from 'effect';

export const ACCESS_FINALIZER_STRATEGY = 'parallel';

export interface AccessLease {
  readonly release: Effect.Effect<void>;
}
