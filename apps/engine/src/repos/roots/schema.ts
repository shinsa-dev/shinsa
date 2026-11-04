import type { Effect } from 'effect';
import type { Discovery } from '../schema.ts';

export interface RootsDiscovery {
  readonly at: number;
  readonly result: Effect.Effect<Discovery>;
}
