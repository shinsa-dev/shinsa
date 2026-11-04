import { InstanceId, RemoteUserId } from '@shinsa/core';
import { Clock, Context, Effect, Layer, type Option, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { TokenHash } from '../../crypto/schema.ts';
import { Count } from '../shared/schema.ts';

import {
  MACHINE_COLUMNS,
  Machine,
  NewMachine,
  type MachineBeat,
  type SharedMachine,
  SharedMachineRow,
  StoredFeatures,
} from './schema.ts';

export class Machines extends Context.Service<
  Machines,
  {
    create(machine: NewMachine): Effect.Effect<void>;
    readonly count: Effect.Effect<number>;
    countOwned(userId: RemoteUserId): Effect.Effect<number>;
    listOfUser(userId: RemoteUserId): Effect.Effect<ReadonlyArray<SharedMachine>>;
    select(id: InstanceId): Effect.Effect<Option.Option<Machine>>;
    selectByToken(machineTokenHash: TokenHash): Effect.Effect<Option.Option<Machine>>;
    recordHeartbeat(id: InstanceId, beat: MachineBeat): Effect.Effect<void>;
    recordOffline(id: InstanceId): Effect.Effect<void>;
    remove(id: InstanceId): Effect.Effect<void>;
  }
>()('shinsa/cloud/store/Machines') {
  static readonly layer = Layer.effect(
    Machines,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const columns = sql.literal(MACHINE_COLUMNS);

      const resolveSharedMachine = ({
        ownerLogin,
        ownerName,
        ownerAvatarUrl,
        role,
        ...machine
      }: typeof SharedMachineRow.Type): SharedMachine => ({
        machine,
        owner: { id: machine.userId, login: ownerLogin, name: ownerName, avatarUrl: ownerAvatarUrl },
        role,
      });

      const insert = SqlSchema.void({
        Request: Schema.Struct({ ...NewMachine.fields, createdAt: Schema.Number }),
        execute: (row) =>
          sql`INSERT INTO instances (id, user_id, name, fingerprint, tunnel_id, dns_record_id, machine_token_hash, connect_key, features, created_at) VALUES (${row.id}, ${row.userId}, ${row.name}, ${row.fingerprint}, ${row.tunnelId}, ${row.dnsRecordId}, ${row.machineTokenHash}, ${row.connectKey}, ${row.features}, ${row.createdAt})`,
      });
      const countAll = SqlSchema.findOne({
        Request: Schema.Void,
        Result: Count,
        execute: () => sql`SELECT COUNT(*) AS total FROM instances`,
      });
      const countByOwner = SqlSchema.findOne({
        Request: RemoteUserId,
        Result: Count,
        execute: (userId) => sql`SELECT COUNT(*) AS total FROM instances WHERE user_id = ${userId}`,
      });
      const ofUser = SqlSchema.findAll({
        Request: RemoteUserId,
        Result: SharedMachineRow,
        execute: (userId) =>
          sql`WITH access (instance_id, role, rank) AS (SELECT id, 'owner', 0 FROM instances WHERE user_id = ${userId} UNION ALL SELECT instance_id, 'member', 1 FROM instance_members WHERE user_id = ${userId} UNION ALL SELECT instance_id, 'guest', 2 FROM instance_guests WHERE user_id = ${userId}), roles AS (SELECT instance_id, role, MIN(rank) FROM access GROUP BY instance_id) SELECT ${columns}, users.login AS owner_login, users.name AS owner_name, users.avatar_url AS owner_avatar_url, roles.role FROM roles JOIN instances ON instances.id = roles.instance_id JOIN users ON users.id = instances.user_id ORDER BY instances.created_at, instances.id`,
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
          features: StoredFeatures,
          at: Schema.Number,
        }),
        execute: (row) =>
          sql`UPDATE instances SET local_url = ${row.localUrl}, online = 1, last_seen_at = ${row.at}, signing_key = COALESCE(${row.signingKey}, signing_key), features = ${row.features} WHERE id = ${row.id}`,
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
        beat: MachineBeat
      ) {
        yield* heartbeat({ id, ...beat, at: yield* Clock.currentTimeMillis });
      }, Effect.orDie);

      return Machines.of({
        create,
        count: countAll(undefined).pipe(Effect.orDie, Effect.withSpan('Machines.count')),
        countOwned: Effect.fn('Machines.countOwned')(
          (userId: RemoteUserId) => countByOwner(userId),
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
