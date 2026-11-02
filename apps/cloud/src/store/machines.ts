import { InstanceId, RemoteRole, type RemoteUser, RemoteUserId } from '@shinsa/core';
import { Clock, Context, Effect, Layer, type Option, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { TokenHash } from '../crypto/crypto.ts';
import { resolveTotal, Total } from './tables.ts';

export const Machine = Schema.Struct({
  id: InstanceId,
  userId: RemoteUserId,
  name: Schema.String,
  fingerprint: Schema.String,
  tunnelId: Schema.String,
  dnsRecordId: Schema.String,
  connectKey: Schema.RedactedFromValue(Schema.String),
  localUrl: Schema.NullOr(Schema.String),
  online: Schema.BooleanFromBit,
  lastSeenAt: Schema.NullOr(Schema.Number),
  signingKey: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
});

export type Machine = typeof Machine.Type;

export const NewMachine = Schema.Struct({
  id: InstanceId,
  userId: RemoteUserId,
  name: Schema.String,
  fingerprint: Schema.String,
  tunnelId: Schema.String,
  dnsRecordId: Schema.String,
  machineTokenHash: TokenHash,
  connectKey: Schema.RedactedFromValue(Schema.String),
});

export type NewMachine = typeof NewMachine.Type;

const SharedMachineRow = Schema.Struct({
  ...Machine.fields,
  ownerLogin: Schema.String,
  ownerName: Schema.NullOr(Schema.String),
  ownerAvatarUrl: Schema.NullOr(Schema.String),
  role: RemoteRole,
});

export interface SharedMachine {
  readonly machine: Machine;
  readonly owner: RemoteUser;
  readonly role: RemoteRole;
}

function resolveSharedMachine({
  ownerLogin,
  ownerName,
  ownerAvatarUrl,
  role,
  ...machine
}: typeof SharedMachineRow.Type): SharedMachine {
  return {
    machine,
    owner: { id: machine.userId, login: ownerLogin, name: ownerName, avatarUrl: ownerAvatarUrl },
    role,
  };
}

export const MACHINE_COLUMNS =
  'instances.id, instances.user_id, instances.name, instances.fingerprint, instances.tunnel_id, instances.dns_record_id, instances.connect_key, instances.local_url, instances.online, instances.last_seen_at, instances.signing_key, instances.created_at';

export class Machines extends Context.Service<
  Machines,
  {
    create(machine: NewMachine): Effect.Effect<void>;
    readonly count: Effect.Effect<number>;
    countOwned(userId: RemoteUserId): Effect.Effect<number>;
    listOfUser(userId: RemoteUserId): Effect.Effect<ReadonlyArray<SharedMachine>>;
    select(id: InstanceId): Effect.Effect<Option.Option<Machine>>;
    selectByToken(machineTokenHash: TokenHash): Effect.Effect<Option.Option<Machine>>;
    recordHeartbeat(id: InstanceId, localUrl: string, signingKey: string | null): Effect.Effect<void>;
    recordOffline(id: InstanceId): Effect.Effect<void>;
    remove(id: InstanceId): Effect.Effect<void>;
  }
>()('shinsa/cloud/store/Machines') {
  static readonly layer = Layer.effect(
    Machines,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const columns = sql.literal(MACHINE_COLUMNS);

      const insert = SqlSchema.void({
        Request: Schema.Struct({ ...NewMachine.fields, createdAt: Schema.Number }),
        execute: (row) =>
          sql`INSERT INTO instances (id, user_id, name, fingerprint, tunnel_id, dns_record_id, machine_token_hash, connect_key, created_at) VALUES (${row.id}, ${row.userId}, ${row.name}, ${row.fingerprint}, ${row.tunnelId}, ${row.dnsRecordId}, ${row.machineTokenHash}, ${row.connectKey}, ${row.createdAt})`,
      });
      const countAll = SqlSchema.findOne({
        Request: Schema.Void,
        Result: Total,
        execute: () => sql`SELECT COUNT(*) AS total FROM instances`,
      });
      const countByOwner = SqlSchema.findOne({
        Request: RemoteUserId,
        Result: Total,
        execute: (userId) => sql`SELECT COUNT(*) AS total FROM instances WHERE user_id = ${userId}`,
      });
      const ofUser = SqlSchema.findAll({
        Request: RemoteUserId,
        Result: SharedMachineRow,
        execute: (userId) =>
          sql`SELECT ${columns}, users.login AS owner_login, users.name AS owner_name, users.avatar_url AS owner_avatar_url, CASE WHEN instances.user_id = ${userId} THEN 'owner' WHEN instances.id IN (SELECT instance_id FROM instance_members WHERE user_id = ${userId}) THEN 'member' ELSE 'guest' END AS role FROM instances JOIN users ON users.id = instances.user_id WHERE instances.user_id = ${userId} OR instances.id IN (SELECT instance_id FROM instance_members WHERE user_id = ${userId}) OR instances.id IN (SELECT instance_id FROM instance_guests WHERE user_id = ${userId}) ORDER BY instances.created_at`,
      });
      const byId = SqlSchema.findOneOption({
        Request: InstanceId,
        Result: Machine,
        execute: (id) => sql`SELECT ${columns} FROM instances WHERE id = ${id}`,
      });
      const byToken = SqlSchema.findOneOption({
        Request: TokenHash,
        Result: Machine,
        execute: (hash) => sql`SELECT ${columns} FROM instances WHERE machine_token_hash = ${hash}`,
      });
      const heartbeat = SqlSchema.void({
        Request: Schema.Struct({
          id: InstanceId,
          localUrl: Schema.String,
          signingKey: Schema.NullOr(Schema.String),
          at: Schema.Number,
        }),
        execute: (row) =>
          sql`UPDATE instances SET local_url = ${row.localUrl}, online = 1, last_seen_at = ${row.at}, signing_key = COALESCE(${row.signingKey}, signing_key) WHERE id = ${row.id}`,
      });
      const offline = SqlSchema.void({
        Request: InstanceId,
        execute: (id) => sql`UPDATE instances SET online = 0 WHERE id = ${id}`,
      });
      const removal = SqlSchema.void({
        Request: InstanceId,
        execute: (id) => sql`DELETE FROM instances WHERE id = ${id}`,
      });

      const create = Effect.fn('Machines.create')(function* (machine: NewMachine) {
        yield* insert({ ...machine, createdAt: yield* Clock.currentTimeMillis });
      }, Effect.orDie);

      const recordHeartbeat = Effect.fn('Machines.recordHeartbeat')(function* (
        id: InstanceId,
        localUrl: string,
        signingKey: string | null
      ) {
        yield* heartbeat({ id, localUrl, signingKey, at: yield* Clock.currentTimeMillis });
      }, Effect.orDie);

      return Machines.of({
        create,
        count: countAll(undefined).pipe(
          Effect.map(resolveTotal),
          Effect.orDie,
          Effect.withSpan('Machines.count')
        ),
        countOwned: Effect.fn('Machines.countOwned')(
          (userId: RemoteUserId) => Effect.map(countByOwner(userId), resolveTotal),
          Effect.orDie
        ),
        listOfUser: Effect.fn('Machines.listOfUser')(
          (userId: RemoteUserId) => Effect.map(ofUser(userId), (rows) => rows.map(resolveSharedMachine)),
          Effect.orDie
        ),
        select: Effect.fn('Machines.select')((id: InstanceId) => byId(id), Effect.orDie),
        selectByToken: Effect.fn('Machines.selectByToken')((hash: TokenHash) => byToken(hash), Effect.orDie),
        recordHeartbeat,
        recordOffline: Effect.fn('Machines.recordOffline')((id: InstanceId) => offline(id), Effect.orDie),
        remove: Effect.fn('Machines.remove')((id: InstanceId) => removal(id), Effect.orDie),
      });
    })
  );
}
