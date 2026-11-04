import type { ExtensionUsageRead } from '@shinsa/core';
import { Context, type Deferred } from 'effect';
import { USAGE_CHUNK_BYTES, USAGE_HORIZON_DAYS } from '../schema.ts';

export type UsageRefresh = Deferred.Deferred<void>;

export class UsageIndexLimits extends Context.Reference<{
  readonly horizonDays: number;
  readonly chunkBytes: number;
}>('shinsa/engine/extensions/usage-index/UsageIndexLimits', {
  defaultValue: () => ({ horizonDays: USAGE_HORIZON_DAYS, chunkBytes: USAGE_CHUNK_BYTES }),
}) {}

export interface UsageView {
  readonly read: ExtensionUsageRead;
  readonly selectServer: (runtimeName: string) => number | null;
  readonly selectSkill: (name: string) => number | null;
}
