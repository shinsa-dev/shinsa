import { InstanceId, RemoteUserId } from '@shinsa/core';
import { Clock, Context, Duration, Effect, Layer, Option, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { Found } from './tables.ts';

const SLACK_EVENT_TTL = Duration.days(1);

export const SlackWorkspace = Schema.Struct({
  teamId: Schema.String,
  teamName: Schema.String,
  botUserId: Schema.String,
  sealedBotToken: Schema.String,
  installedAt: Schema.Number,
});

export type SlackWorkspace = typeof SlackWorkspace.Type;

export const SlackLink = Schema.Struct({
  teamId: Schema.String,
  teamName: Schema.String,
  slackUserId: Schema.String,
  slackUserName: Schema.String,
  userId: RemoteUserId,
  instanceId: InstanceId,
  linkedAt: Schema.Number,
});

export type SlackLink = typeof SlackLink.Type;

export const SlackThread = Schema.Struct({
  teamId: Schema.String,
  channelId: Schema.String,
  threadTs: Schema.String,
});

export type SlackThread = typeof SlackThread.Type;

export const SlackMessage = Schema.Struct({
  teamId: Schema.String,
  channelId: Schema.String,
  ts: Schema.String,
});

export type SlackMessage = typeof SlackMessage.Type;

const LINK_COLUMNS =
  'slack_links.team_id, slack_workspaces.team_name, slack_links.slack_user_id, slack_links.slack_user_name, slack_links.user_id, slack_links.instance_id, slack_links.linked_at';

const NewLink = SlackLink.mapFields(({ teamName: _, linkedAt: __, ...fields }) => fields);

export class SlackStore extends Context.Service<
  SlackStore,
  {
    upsertWorkspace(workspace: Omit<SlackWorkspace, 'installedAt'>): Effect.Effect<void>;
    selectWorkspace(teamId: string): Effect.Effect<Option.Option<SlackWorkspace>>;
    removeWorkspace(teamId: string): Effect.Effect<void>;
    upsertLink(link: typeof NewLink.Type): Effect.Effect<void>;
    selectLink(teamId: string, slackUserId: string): Effect.Effect<Option.Option<SlackLink>>;
    listMachineLinks(instanceId: InstanceId): Effect.Effect<ReadonlyArray<SlackLink>>;
    removeMachineLinks(instanceId: InstanceId): Effect.Effect<void>;
    recordThread(thread: SlackThread, instanceId: InstanceId): Effect.Effect<void>;
    hasThread(thread: SlackThread, instanceId: InstanceId): Effect.Effect<boolean>;
    recordPost(post: SlackMessage, instanceId: InstanceId): Effect.Effect<void>;
    hasPost(post: SlackMessage, instanceId: InstanceId): Effect.Effect<boolean>;
    recordEvent(eventId: string): Effect.Effect<boolean>;
  }
>()('shinsa/cloud/store/SlackStore') {
  static readonly layer = Layer.effect(
    SlackStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const links = sql.literal(LINK_COLUMNS);

      const insertWorkspace = SqlSchema.void({
        Request: SlackWorkspace,
        execute: (row) =>
          sql`INSERT INTO slack_workspaces (team_id, team_name, bot_user_id, bot_token, installed_at) VALUES (${row.teamId}, ${row.teamName}, ${row.botUserId}, ${row.sealedBotToken}, ${row.installedAt}) ON CONFLICT (team_id) DO UPDATE SET team_name = excluded.team_name, bot_user_id = excluded.bot_user_id, bot_token = excluded.bot_token, installed_at = excluded.installed_at`,
      });
      const workspaceById = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: SlackWorkspace,
        execute: (teamId) =>
          sql`SELECT team_id, team_name, bot_user_id, bot_token AS sealed_bot_token, installed_at FROM slack_workspaces WHERE team_id = ${teamId}`,
      });
      const workspaceRemoval = SqlSchema.void({
        Request: Schema.String,
        execute: (teamId) => sql`DELETE FROM slack_workspaces WHERE team_id = ${teamId}`,
      });
      const insertLink = SqlSchema.void({
        Request: Schema.Struct({ ...NewLink.fields, at: Schema.Number }),
        execute: (row) =>
          sql`INSERT INTO slack_links (team_id, slack_user_id, slack_user_name, user_id, instance_id, linked_at) VALUES (${row.teamId}, ${row.slackUserId}, ${row.slackUserName}, ${row.userId}, ${row.instanceId}, ${row.at}) ON CONFLICT (team_id, slack_user_id) DO UPDATE SET slack_user_name = excluded.slack_user_name, user_id = excluded.user_id, instance_id = excluded.instance_id, linked_at = excluded.linked_at`,
      });
      const linkByUser = SqlSchema.findOneOption({
        Request: Schema.Struct({ teamId: Schema.String, slackUserId: Schema.String }),
        Result: SlackLink,
        execute: (row) =>
          sql`SELECT ${links} FROM slack_links JOIN slack_workspaces ON slack_workspaces.team_id = slack_links.team_id WHERE slack_links.team_id = ${row.teamId} AND slack_links.slack_user_id = ${row.slackUserId}`,
      });
      const linksOfMachine = SqlSchema.findAll({
        Request: InstanceId,
        Result: SlackLink,
        execute: (id) =>
          sql`SELECT ${links} FROM slack_links JOIN slack_workspaces ON slack_workspaces.team_id = slack_links.team_id WHERE slack_links.instance_id = ${id} ORDER BY slack_links.linked_at`,
      });
      const linksRemoval = SqlSchema.void({
        Request: InstanceId,
        execute: (id) => sql`DELETE FROM slack_links WHERE instance_id = ${id}`,
      });
      const ThreadOf = Schema.Struct({ ...SlackThread.fields, instanceId: InstanceId });
      const insertThread = SqlSchema.void({
        Request: Schema.Struct({ ...ThreadOf.fields, at: Schema.Number }),
        execute: (row) =>
          sql`INSERT INTO slack_threads (team_id, channel_id, thread_ts, instance_id, forwarded_at) VALUES (${row.teamId}, ${row.channelId}, ${row.threadTs}, ${row.instanceId}, ${row.at}) ON CONFLICT DO UPDATE SET forwarded_at = excluded.forwarded_at`,
      });
      const threadLookup = SqlSchema.findOneOption({
        Request: ThreadOf,
        Result: Found,
        execute: (row) =>
          sql`SELECT 1 AS found FROM slack_threads WHERE team_id = ${row.teamId} AND channel_id = ${row.channelId} AND thread_ts = ${row.threadTs} AND instance_id = ${row.instanceId}`,
      });
      const PostOf = Schema.Struct({ ...SlackMessage.fields, instanceId: InstanceId });
      const insertPost = SqlSchema.void({
        Request: PostOf,
        execute: (row) =>
          sql`INSERT OR IGNORE INTO slack_posts (team_id, channel_id, ts, instance_id) VALUES (${row.teamId}, ${row.channelId}, ${row.ts}, ${row.instanceId})`,
      });
      const postLookup = SqlSchema.findOneOption({
        Request: PostOf,
        Result: Found,
        execute: (row) =>
          sql`SELECT 1 AS found FROM slack_posts WHERE team_id = ${row.teamId} AND channel_id = ${row.channelId} AND ts = ${row.ts} AND instance_id = ${row.instanceId}`,
      });
      const expiredEventsRemoval = SqlSchema.void({
        Request: Schema.Number,
        execute: (before) => sql`DELETE FROM slack_events WHERE received_at <= ${before}`,
      });
      const insertEvent = SqlSchema.findOneOption({
        Request: Schema.Struct({ eventId: Schema.String, at: Schema.Number }),
        Result: Schema.Struct({ eventId: Schema.String }),
        execute: (row) =>
          sql`INSERT INTO slack_events (event_id, received_at) VALUES (${row.eventId}, ${row.at}) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      });

      const upsertWorkspace = Effect.fn('SlackStore.upsertWorkspace')(function* (
        workspace: Omit<SlackWorkspace, 'installedAt'>
      ) {
        yield* insertWorkspace({ ...workspace, installedAt: yield* Clock.currentTimeMillis });
      }, Effect.orDie);

      const upsertLink = Effect.fn('SlackStore.upsertLink')(function* (link: typeof NewLink.Type) {
        yield* insertLink({ ...link, at: yield* Clock.currentTimeMillis });
      }, Effect.orDie);

      const recordThread = Effect.fn('SlackStore.recordThread')(function* (
        thread: SlackThread,
        instanceId: InstanceId
      ) {
        yield* insertThread({ ...thread, instanceId, at: yield* Clock.currentTimeMillis });
      }, Effect.orDie);

      const recordEvent = Effect.fn('SlackStore.recordEvent')(function* (eventId: string) {
        const now = yield* Clock.currentTimeMillis;
        yield* expiredEventsRemoval(now - Duration.toMillis(SLACK_EVENT_TTL));
        return Option.isSome(yield* insertEvent({ eventId, at: now }));
      }, Effect.orDie);

      return SlackStore.of({
        upsertWorkspace,
        selectWorkspace: Effect.fn('SlackStore.selectWorkspace')(
          (teamId: string) => workspaceById(teamId),
          Effect.orDie
        ),
        removeWorkspace: Effect.fn('SlackStore.removeWorkspace')(
          (teamId: string) => workspaceRemoval(teamId),
          Effect.orDie
        ),
        upsertLink,
        selectLink: Effect.fn('SlackStore.selectLink')(
          (teamId: string, slackUserId: string) => linkByUser({ teamId, slackUserId }),
          Effect.orDie
        ),
        listMachineLinks: Effect.fn('SlackStore.listMachineLinks')(
          (id: InstanceId) => linksOfMachine(id),
          Effect.orDie
        ),
        removeMachineLinks: Effect.fn('SlackStore.removeMachineLinks')(
          (id: InstanceId) => linksRemoval(id),
          Effect.orDie
        ),
        recordThread,
        hasThread: Effect.fn('SlackStore.hasThread')(
          (thread: SlackThread, instanceId: InstanceId) =>
            Effect.map(threadLookup({ ...thread, instanceId }), Option.isSome),
          Effect.orDie
        ),
        recordPost: Effect.fn('SlackStore.recordPost')(
          (post: SlackMessage, instanceId: InstanceId) => insertPost({ ...post, instanceId }),
          Effect.orDie
        ),
        hasPost: Effect.fn('SlackStore.hasPost')(
          (post: SlackMessage, instanceId: InstanceId) =>
            Effect.map(postLookup({ ...post, instanceId }), Option.isSome),
          Effect.orDie
        ),
        recordEvent,
      });
    })
  );
}
