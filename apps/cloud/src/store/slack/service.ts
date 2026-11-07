import { InstanceId } from '@shinsa/core';
import { Clock, Context, Duration, Effect, Layer, Option, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { Found } from '../shared/schema.ts';

import {
  LINK_COLUMNS,
  NewLink,
  SLACK_EVENT_TTL,
  SlackLink,
  SlackMessage,
  SlackThread,
  SlackWorkspace,
} from './schema.ts';

export class SlackStore extends Context.Service<
  SlackStore,
  {
    upsertWorkspace(workspace: Omit<SlackWorkspace, 'installedAt'>): Effect.Effect<void>;
    selectWorkspace(id: string): Effect.Effect<Option.Option<SlackWorkspace>>;
    removeWorkspace(id: string): Effect.Effect<void>;
    upsertLink(link: typeof NewLink.Type): Effect.Effect<void>;
    selectLink(workspaceId: string, slackUserId: string): Effect.Effect<Option.Option<SlackLink>>;
    listMachineLinks(instanceId: InstanceId): Effect.Effect<ReadonlyArray<SlackLink>>;
    removeMachineLinks(instanceId: InstanceId): Effect.Effect<void>;
    clearUserToken(workspaceId: string, slackUserId: string): Effect.Effect<void>;
    recordThread(thread: SlackThread, instanceId: InstanceId): Effect.Effect<void>;
    hasThread(thread: SlackThread, instanceId: InstanceId): Effect.Effect<boolean>;
    recordPost(post: SlackMessage, instanceId: InstanceId): Effect.Effect<void>;
    hasPost(post: SlackMessage, instanceId: InstanceId): Effect.Effect<boolean>;
    selectPoster(post: SlackMessage): Effect.Effect<Option.Option<InstanceId>>;
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
          sql`INSERT INTO slack_workspaces (id, name, bot_user_id, sealed_bot_token, installed_at) VALUES (${row.id}, ${row.name}, ${row.botUserId}, ${row.sealedBotToken}, ${row.installedAt}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, bot_user_id = excluded.bot_user_id, sealed_bot_token = excluded.sealed_bot_token, installed_at = excluded.installed_at`,
      });
      const workspaceById = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: SlackWorkspace,
        execute: (id) =>
          sql`SELECT id, name, bot_user_id, sealed_bot_token, installed_at FROM slack_workspaces WHERE id = ${id}`,
      });
      const workspaceRemoval = SqlSchema.void({
        Request: Schema.String,
        execute: (id) => sql`DELETE FROM slack_workspaces WHERE id = ${id}`,
      });
      const insertLink = SqlSchema.void({
        Request: Schema.Struct({ ...NewLink.fields, at: Schema.Number }),
        execute: (row) =>
          sql`INSERT INTO slack_links (workspace_id, slack_user_id, slack_user_name, user_id, machine_id, sealed_user_token, linked_at) VALUES (${row.workspaceId}, ${row.slackUserId}, ${row.slackUserName}, ${row.userId}, ${row.machineId}, ${row.sealedUserToken}, ${row.at}) ON CONFLICT (workspace_id, slack_user_id) DO UPDATE SET slack_user_name = excluded.slack_user_name, user_id = excluded.user_id, machine_id = excluded.machine_id, sealed_user_token = excluded.sealed_user_token, linked_at = excluded.linked_at`,
      });
      const linkByUser = SqlSchema.findOneOption({
        Request: Schema.Struct({ workspaceId: Schema.String, slackUserId: Schema.String }),
        Result: SlackLink,
        execute: (row) =>
          sql`SELECT ${links} FROM slack_links JOIN slack_workspaces ON slack_workspaces.id = slack_links.workspace_id WHERE slack_links.workspace_id = ${row.workspaceId} AND slack_links.slack_user_id = ${row.slackUserId}`,
      });
      const linksOfMachine = SqlSchema.findAll({
        Request: InstanceId,
        Result: SlackLink,
        execute: (id) =>
          sql`SELECT ${links} FROM slack_links JOIN slack_workspaces ON slack_workspaces.id = slack_links.workspace_id WHERE slack_links.machine_id = ${id} ORDER BY slack_links.linked_at`,
      });
      const linksRemoval = SqlSchema.void({
        Request: InstanceId,
        execute: (id) => sql`DELETE FROM slack_links WHERE machine_id = ${id}`,
      });
      const userTokenClearing = SqlSchema.void({
        Request: Schema.Struct({ workspaceId: Schema.String, slackUserId: Schema.String }),
        execute: (row) =>
          sql`UPDATE slack_links SET sealed_user_token = NULL WHERE workspace_id = ${row.workspaceId} AND slack_user_id = ${row.slackUserId}`,
      });
      const ThreadOf = Schema.Struct({ ...SlackThread.fields, machineId: InstanceId });
      const insertThread = SqlSchema.void({
        Request: Schema.Struct({ ...ThreadOf.fields, at: Schema.Number }),
        execute: (row) =>
          sql`INSERT INTO slack_threads (workspace_id, channel_id, thread_ts, machine_id, forwarded_at) VALUES (${row.workspaceId}, ${row.channelId}, ${row.threadTs}, ${row.machineId}, ${row.at}) ON CONFLICT DO UPDATE SET forwarded_at = excluded.forwarded_at`,
      });
      const threadLookup = SqlSchema.findOneOption({
        Request: ThreadOf,
        Result: Found,
        execute: (row) =>
          sql`SELECT 1 AS found FROM slack_threads WHERE workspace_id = ${row.workspaceId} AND channel_id = ${row.channelId} AND thread_ts = ${row.threadTs} AND machine_id = ${row.machineId}`,
      });
      const PostOf = Schema.Struct({ ...SlackMessage.fields, machineId: InstanceId });
      const insertPost = SqlSchema.void({
        Request: PostOf,
        execute: (row) =>
          sql`INSERT OR IGNORE INTO slack_posts (workspace_id, channel_id, ts, machine_id) VALUES (${row.workspaceId}, ${row.channelId}, ${row.ts}, ${row.machineId})`,
      });
      const postLookup = SqlSchema.findOneOption({
        Request: PostOf,
        Result: Found,
        execute: (row) =>
          sql`SELECT 1 AS found FROM slack_posts WHERE workspace_id = ${row.workspaceId} AND channel_id = ${row.channelId} AND ts = ${row.ts} AND machine_id = ${row.machineId}`,
      });
      const posterLookup = SqlSchema.findOneOption({
        Request: SlackMessage,
        Result: Schema.Struct({ machineId: InstanceId }),
        execute: (row) =>
          sql`SELECT machine_id FROM slack_posts WHERE workspace_id = ${row.workspaceId} AND channel_id = ${row.channelId} AND ts = ${row.ts}`,
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
        yield* insertThread({ ...thread, machineId: instanceId, at: yield* Clock.currentTimeMillis });
      }, Effect.orDie);

      const recordEvent = Effect.fn('SlackStore.recordEvent')(function* (eventId: string) {
        const now = yield* Clock.currentTimeMillis;
        yield* expiredEventsRemoval(now - Duration.toMillis(SLACK_EVENT_TTL));
        return Option.isSome(yield* insertEvent({ eventId, at: now }));
      }, Effect.orDie);

      return SlackStore.of({
        upsertWorkspace,
        selectWorkspace: Effect.fn('SlackStore.selectWorkspace')(
          (id: string) => workspaceById(id),
          Effect.orDie
        ),
        removeWorkspace: Effect.fn('SlackStore.removeWorkspace')(
          (id: string) => workspaceRemoval(id),
          Effect.orDie
        ),
        upsertLink,
        selectLink: Effect.fn('SlackStore.selectLink')(
          (workspaceId: string, slackUserId: string) => linkByUser({ workspaceId, slackUserId }),
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
        clearUserToken: Effect.fn('SlackStore.clearUserToken')(
          (workspaceId: string, slackUserId: string) => userTokenClearing({ workspaceId, slackUserId }),
          Effect.orDie
        ),
        recordThread,
        hasThread: Effect.fn('SlackStore.hasThread')(
          (thread: SlackThread, instanceId: InstanceId) =>
            Effect.map(threadLookup({ ...thread, machineId: instanceId }), Option.isSome),
          Effect.orDie
        ),
        recordPost: Effect.fn('SlackStore.recordPost')(
          (post: SlackMessage, instanceId: InstanceId) => insertPost({ ...post, machineId: instanceId }),
          Effect.orDie
        ),
        hasPost: Effect.fn('SlackStore.hasPost')(
          (post: SlackMessage, instanceId: InstanceId) =>
            Effect.map(postLookup({ ...post, machineId: instanceId }), Option.isSome),
          Effect.orDie
        ),
        selectPoster: Effect.fn('SlackStore.selectPoster')(
          (post: SlackMessage) =>
            Effect.map(
              posterLookup(post),
              Option.map((row) => row.machineId)
            ),
          Effect.orDie
        ),
        recordEvent,
      });
    })
  );
}
