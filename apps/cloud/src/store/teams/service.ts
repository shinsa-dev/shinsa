import { type AccessScopes, RemoteUserId, TeamId } from '@shinsa/core';
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { MACHINE_COLUMNS, Machine } from '../machines/schema.ts';
import { createInvites } from '../shared/invites.ts';
import { createMembership } from '../shared/membership.ts';
import { Count, Found, type Invites, type Membership } from '../shared/schema.ts';

import { MemberScopesRow, NewTeam, StoredScopes, TEAM_COLUMNS, Team } from './schema.ts';

export class Teams extends Context.Service<
  Teams,
  {
    create(team: Omit<NewTeam, 'createdAt'>): Effect.Effect<Team>;
    countOwned(userId: RemoteUserId): Effect.Effect<number>;
    select(id: TeamId): Effect.Effect<Option.Option<Team>>;
    listOfUser(userId: RemoteUserId): Effect.Effect<ReadonlyArray<Team>>;
    remove(id: TeamId): Effect.Effect<void>;
    shareTeam(userId: RemoteUserId, otherId: RemoteUserId): Effect.Effect<boolean>;
    listMachines(id: TeamId): Effect.Effect<ReadonlyArray<Machine>>;
    replaceScopes(id: TeamId, scopes: AccessScopes | null): Effect.Effect<void>;
    listMemberScopes(id: TeamId): Effect.Effect<ReadonlyArray<MemberScopesRow>>;
    replaceMemberScopes(id: TeamId, userId: RemoteUserId, scopes: AccessScopes | null): Effect.Effect<void>;
    readonly invites: Invites<TeamId>;
    readonly requesters: Membership<TeamId>;
    readonly members: Membership<TeamId>;
  }
>()('shinsa/cloud/store/Teams') {
  static readonly layer = Layer.effect(
    Teams,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const columns = sql.literal(TEAM_COLUMNS);

      const insert = SqlSchema.void({
        Request: NewTeam,
        execute: (team) =>
          sql`INSERT INTO teams (id, owner_id, name, created_at) VALUES (${team.id}, ${team.ownerId}, ${team.name}, ${team.createdAt})`,
      });
      const countByOwner = SqlSchema.findOne({
        Request: RemoteUserId,
        Result: Count,
        execute: (userId) => sql`SELECT COUNT(*) AS total FROM teams WHERE owner_id = ${userId}`,
      });
      const byId = SqlSchema.findOneOption({
        Request: TeamId,
        Result: Team,
        execute: (id) => sql`SELECT ${columns} FROM teams WHERE id = ${id}`,
      });
      const ofUser = SqlSchema.findAll({
        Request: RemoteUserId,
        Result: Team,
        execute: (userId) =>
          sql`SELECT ${columns} FROM teams WHERE owner_id = ${userId} OR id IN (SELECT team_id FROM team_members WHERE user_id = ${userId}) ORDER BY created_at, id`,
      });
      const removal = SqlSchema.void({
        Request: TeamId,
        execute: (id) => sql`DELETE FROM teams WHERE id = ${id}`,
      });
      const shared = SqlSchema.findOneOption({
        Request: Schema.Struct({ userId: RemoteUserId, otherId: RemoteUserId }),
        Result: Found,
        execute: ({ userId, otherId }) =>
          sql`SELECT 1 AS found FROM teams WHERE (owner_id = ${userId} OR id IN (SELECT team_id FROM team_members WHERE user_id = ${userId})) AND (owner_id = ${otherId} OR id IN (SELECT team_id FROM team_members WHERE user_id = ${otherId})) LIMIT 1`,
      });
      const machines = SqlSchema.findAll({
        Request: TeamId,
        Result: Machine,
        execute: (id) =>
          sql`SELECT ${sql.literal(MACHINE_COLUMNS)} FROM machines WHERE owner_id IN (SELECT owner_id FROM teams WHERE id = ${id} UNION SELECT user_id FROM team_members WHERE team_id = ${id}) ORDER BY created_at, id`,
      });

      const teamScopes = SqlSchema.void({
        Request: Schema.Struct({ id: TeamId, scopes: StoredScopes }),
        execute: (row) => sql`UPDATE teams SET scopes = ${row.scopes} WHERE id = ${row.id}`,
      });
      const memberScopes = SqlSchema.findAll({
        Request: TeamId,
        Result: MemberScopesRow,
        execute: (id) =>
          sql`SELECT user_id, scopes FROM team_members WHERE team_id = ${id} AND scopes IS NOT NULL ORDER BY added_at, user_id`,
      });
      const memberScopesUpdate = SqlSchema.void({
        Request: Schema.Struct({ id: TeamId, userId: RemoteUserId, scopes: StoredScopes }),
        execute: (row) =>
          sql`UPDATE team_members SET scopes = ${row.scopes} WHERE team_id = ${row.id} AND user_id = ${row.userId}`,
      });

      const create = Effect.fn('Teams.create')(function* (team: Omit<NewTeam, 'createdAt'>) {
        const created = { ...team, createdAt: yield* Clock.currentTimeMillis };
        yield* insert(created);
        return { ...created, scopes: null } satisfies Team;
      }, Effect.orDie);

      return Teams.of({
        create,
        countOwned: Effect.fn('Teams.countOwned')(
          (userId: RemoteUserId) => countByOwner(userId),
          Effect.orDie
        ),
        select: Effect.fn('Teams.select')((id: TeamId) => byId(id), Effect.orDie),
        listOfUser: Effect.fn('Teams.listOfUser')((userId: RemoteUserId) => ofUser(userId), Effect.orDie),
        remove: Effect.fn('Teams.remove')((id: TeamId) => removal(id), Effect.orDie),
        shareTeam: Effect.fn('Teams.shareTeam')(
          (userId: RemoteUserId, otherId: RemoteUserId) =>
            Effect.map(shared({ userId, otherId }), Option.isSome),
          Effect.orDie
        ),
        listMachines: Effect.fn('Teams.listMachines')((id: TeamId) => machines(id), Effect.orDie),
        replaceScopes: Effect.fn('Teams.replaceScopes')(
          (id: TeamId, scopes: AccessScopes | null) => teamScopes({ id, scopes }),
          Effect.orDie
        ),
        listMemberScopes: Effect.fn('Teams.listMemberScopes')((id: TeamId) => memberScopes(id), Effect.orDie),
        replaceMemberScopes: Effect.fn('Teams.replaceMemberScopes')(
          (id: TeamId, userId: RemoteUserId, scopes: AccessScopes | null) =>
            memberScopesUpdate({ id, userId, scopes }),
          Effect.orDie
        ),
        invites: createInvites(sql, TeamId, {
          name: 'Teams.invites',
          table: 'team_invites',
          scope: 'team_id',
        }),
        requesters: createMembership(sql, TeamId, {
          name: 'Teams.requesters',
          table: 'team_requesters',
          scope: 'team_id',
          time: 'requested_at',
          onRepeat: 'refresh',
        }),
        members: createMembership(sql, TeamId, {
          name: 'Teams.members',
          table: 'team_members',
          scope: 'team_id',
          time: 'added_at',
          onRepeat: 'keep',
        }),
      });
    })
  );
}
