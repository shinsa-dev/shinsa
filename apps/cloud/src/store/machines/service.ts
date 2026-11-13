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
        owner: { id: machine.ownerId, login: ownerLogin, name: ownerName, avatarUrl: ownerAvatarUrl },
        role,
      });

      const insert = SqlSchema.void({
        Request: Schema.Struct({ ...NewMachine.fields, createdAt: Schema.Number }),
        execute: (row) =>
          sql`INSERT INTO machines (id, owner_id, name, fingerprint, machine_token_hash, connect_key, features, created_at) VALUES (${row.id}, ${row.ownerId}, ${row.name}, ${row.fingerprint}, ${row.machineTokenHash}, ${row.connectKey}, ${row.features}, ${row.createdAt})`,
      });
      const countAll = SqlSchema.findOne({
        Request: Schema.Void,
        Result: Count,
        execute: () => sql`SELECT COUNT(*) AS total FROM machines`,
      });
      const countByOwner = SqlSchema.findOne({
        Request: RemoteUserId,
        Result: Count,
        execute: (userId) => sql`SELECT COUNT(*) AS total FROM machines WHERE owner_id = ${userId}`,
      });
      const ofUser = SqlSchema.findAll({
        Request: RemoteUserId,
        Result: SharedMachineRow,
        execute: (userId) =>
          sql`WITH my_teams (id) AS (SELECT id FROM teams WHERE owner_id = ${userId} UNION SELECT team_id FROM team_members WHERE user_id = ${userId}), teammates (user_id) AS (SELECT owner_id FROM teams WHERE id IN my_teams UNION SELECT user_id FROM team_members WHERE team_id IN my_teams), access (machine_id, role, rank) AS (SELECT id, 'owner', 0 FROM machines WHERE owner_id = ${userId} UNION ALL SELECT machine_id, 'member', 1 FROM machine_members WHERE user_id = ${userId} UNION ALL SELECT machine_id, 'guest', 2 FROM machine_guests WHERE user_id = ${userId} UNION ALL SELECT id, 'teammate', 3 FROM machines WHERE owner_id IN teammates), roles AS (SELECT machine_id, role, MIN(rank) FROM access GROUP BY machine_id) SELECT ${columns}, users.login AS owner_login, users.name AS owner_name, users.avatar_url AS owner_avatar_url, roles.role FROM roles JOIN machines ON machines.id = roles.machine_id JOIN users ON users.id = machines.owner_id ORDER BY machines.created_at, machines.id`,
      });
      const byId = SqlSchema.findOneOption({
        Request: InstanceId,
        Result: Machine,
        execute: (id) => sql`SELECT ${columns} FROM machines WHERE id = ${id}`,
      });
      const byToken = SqlSchema.findOneOption({
        Request: TokenHash,
        Result: Machine,
        execute: (hash) => sql`SELECT ${columns} FROM machines WHERE machine_token_hash = ${hash}`,
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
          sql`UPDATE machines SET local_url = ${row.localUrl}, online = 1, last_seen_at = ${row.at}, signing_key = COALESCE(${row.signingKey}, signing_key), features = ${row.features} WHERE id = ${row.id}`,
      });
      const offline = SqlSchema.void({
        Request: InstanceId,
        execute: (id) => sql`UPDATE machines SET online = 0 WHERE id = ${id}`,
      });
      const removal = SqlSchema.void({
        Request: InstanceId,
        execute: (id) => sql`DELETE FROM machines WHERE id = ${id}`,
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
