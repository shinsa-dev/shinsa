import type { Effect } from 'effect';
import type { Discovery } from '../schema.ts';

export interface RootsDefinition {
  readonly fromEnvironment: readonly string[];
  readonly configured: Effect.Effect<readonly string[]>;
  readonly home: string;
  readonly discover: ((home: string) => Effect.Effect<Discovery>) | null;
}

export interface RootsDiscovery {
  readonly at: number;
  readonly result: Effect.Effect<Discovery>;
}

export interface RootsHandle {
  readonly discover: (force: boolean) => Effect.Effect<Discovery>;
  readonly listRoots: Effect.Effect<string[]>;
}
