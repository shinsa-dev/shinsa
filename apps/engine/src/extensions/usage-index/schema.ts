import type { ExtensionUsageRead } from '@shinsa/core';
import type { Deferred, Effect } from 'effect';
import type { UsageSource } from '../schema.ts';

export interface UsageIndexOptions {
  sources: UsageSource[];
  cachePath: string | null;
  now?: () => number;
  horizonDays?: number;
  chunkBytes?: number;
}

export interface UsageIndexDefinition {
  readonly sources: readonly UsageSource[];
  readonly cachePath: string | null;
  readonly now: Effect.Effect<number>;
  readonly horizonDays: number;
  readonly chunkBytes: number;
}

export type UsageRefresh = Deferred.Deferred<void>;

export interface UsageIndexHandle {
  readonly read: Effect.Effect<ExtensionUsageRead>;
  readonly selectServer: (runtimeName: string) => Effect.Effect<number | null>;
  readonly selectSkill: (name: string) => Effect.Effect<number | null>;
  readonly isStale: (maxAgeMs: number) => Effect.Effect<boolean>;
  readonly refresh: Effect.Effect<UsageRefresh>;
  readonly join: (refresh: UsageRefresh) => Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}
