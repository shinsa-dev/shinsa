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

      const Handoff = Schema.Struct({ machineId: InstanceId, tokenHash: TokenHash });
      const insertHandoff = SqlSchema.void({
        Request: Schema.Struct({ ...Handoff.fields, at: Schema.Number }),
        execute: (row) =>
          sql`INSERT INTO machine_handoffs (token_hash, machine_id, created_at) VALUES (${row.tokenHash}, ${row.machineId}, ${row.at})`,
      });
      const handoffRemoval = SqlSchema.void({
        Request: Handoff,
        execute: (row) =>
          sql`DELETE FROM machine_handoffs WHERE machine_id = ${row.machineId} AND token_hash = ${row.tokenHash}`,
      });
      const handoffLookup = SqlSchema.findOneOption({
        Request: TokenHash,
        Result: Schema.Struct({ machineId: InstanceId }),
        execute: (hash) => sql`SELECT machine_id FROM machine_handoffs WHERE token_hash = ${hash}`,
      });

      const handoffs: Handoffs = {
        create: Effect.fn('MachineAccess.handoffs.create')(function* (
          instanceId: InstanceId,
          tokenHash: TokenHash
        ) {
          yield* insertHandoff({ machineId: instanceId, tokenHash, at: yield* Clock.currentTimeMillis });
        }, Effect.orDie),
        remove: Effect.fn('MachineAccess.handoffs.remove')(
          (instanceId: InstanceId, tokenHash: TokenHash) =>
            handoffRemoval({ machineId: instanceId, tokenHash }),
          Effect.orDie
        ),
        select: Effect.fn('MachineAccess.handoffs.select')(
          (tokenHash: TokenHash) =>
            Effect.map(
              handoffLookup(tokenHash),
              Option.map((row) => row.machineId)
            ),
          Effect.orDie
        ),
      };

      return MachineAccess.of({
        invites: createInvites(sql, InstanceId, {
          name: 'MachineAccess.invites',
          table: 'machine_invites',
          scope: 'machine_id',
        }),
        requesters: createMembership(sql, InstanceId, {
          name: 'MachineAccess.requesters',
          table: 'machine_requesters',
          scope: 'machine_id',
          time: 'requested_at',
          onRepeat: 'refresh',
        }),
        members: createMembership(sql, InstanceId, {
          name: 'MachineAccess.members',
          table: 'machine_members',
          scope: 'machine_id',
          time: 'added_at',
          onRepeat: 'keep',
        }),
        guests: createMembership(sql, InstanceId, {
          name: 'MachineAccess.guests',
          table: 'machine_guests',
          scope: 'machine_id',
          time: 'added_at',
          onRepeat: 'keep',
        }),
        handoffs,
      });
    })
  );
}
