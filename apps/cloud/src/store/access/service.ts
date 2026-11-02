import { InstanceId } from '@shinsa/core';
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { TokenHash } from '../../crypto/schema.ts';
import { createInvites } from '../shared/invites.ts';
import { createMembership } from '../shared/membership.ts';
import type { Invites, Membership } from '../shared/schema.ts';

import type { Handoffs } from './schema.ts';

export class MachineAccess extends Context.Service<
  MachineAccess,
  {
    readonly invites: Invites<InstanceId>;
    readonly requesters: Membership<InstanceId>;
    readonly members: Membership<InstanceId>;
    readonly guests: Membership<InstanceId>;
    readonly handoffs: Handoffs;
  }
>()('shinsa/cloud/store/MachineAccess') {
  static readonly layer = Layer.effect(
    MachineAccess,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const Handoff = Schema.Struct({ instanceId: InstanceId, tokenHash: TokenHash });
      const insertHandoff = SqlSchema.void({
        Request: Schema.Struct({ ...Handoff.fields, at: Schema.Number }),
        execute: (row) =>
          sql`INSERT INTO instance_handoffs (token_hash, instance_id, created_at) VALUES (${row.tokenHash}, ${row.instanceId}, ${row.at})`,
      });
      const handoffRemoval = SqlSchema.void({
        Request: Handoff,
        execute: (row) =>
          sql`DELETE FROM instance_handoffs WHERE instance_id = ${row.instanceId} AND token_hash = ${row.tokenHash}`,
      });
      const handoffLookup = SqlSchema.findOneOption({
        Request: TokenHash,
        Result: Schema.Struct({ instanceId: InstanceId }),
        execute: (hash) => sql`SELECT instance_id FROM instance_handoffs WHERE token_hash = ${hash}`,
      });

      const handoffs: Handoffs = {
        create: Effect.fn('MachineAccess.handoffs.create')(function* (
          instanceId: InstanceId,
          tokenHash: TokenHash
        ) {
          yield* insertHandoff({ instanceId, tokenHash, at: yield* Clock.currentTimeMillis });
        }, Effect.orDie),
        remove: Effect.fn('MachineAccess.handoffs.remove')(
          (instanceId: InstanceId, tokenHash: TokenHash) => handoffRemoval({ instanceId, tokenHash }),
          Effect.orDie
        ),
        select: Effect.fn('MachineAccess.handoffs.select')(
          (tokenHash: TokenHash) =>
            Effect.map(
              handoffLookup(tokenHash),
              Option.map((row) => row.instanceId)
            ),
          Effect.orDie
        ),
      };

      return MachineAccess.of({
        invites: createInvites(sql, InstanceId, {
          name: 'MachineAccess.invites',
          table: 'instance_invites',
          scope: 'instance_id',
        }),
        requesters: createMembership(sql, InstanceId, {
          name: 'MachineAccess.requesters',
          table: 'instance_requesters',
          scope: 'instance_id',
          time: 'requested_at',
          onRepeat: 'refresh',
        }),
        members: createMembership(sql, InstanceId, {
          name: 'MachineAccess.members',
          table: 'instance_members',
          scope: 'instance_id',
          time: 'added_at',
          onRepeat: 'keep',
        }),
        guests: createMembership(sql, InstanceId, {
          name: 'MachineAccess.guests',
          table: 'instance_guests',
          scope: 'instance_id',
          time: 'added_at',
          onRepeat: 'keep',
        }),
        handoffs,
      });
    })
  );
}
