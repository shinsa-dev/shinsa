import type { InstanceId } from '@shinsa/core';
import type { Effect, Option } from 'effect';
import type { TokenHash } from '../../crypto/schema.ts';

export interface Handoffs {
  create(instanceId: InstanceId, tokenHash: TokenHash): Effect.Effect<void>;
  remove(instanceId: InstanceId, tokenHash: TokenHash): Effect.Effect<void>;
  select(tokenHash: TokenHash): Effect.Effect<Option.Option<InstanceId>>;
}
