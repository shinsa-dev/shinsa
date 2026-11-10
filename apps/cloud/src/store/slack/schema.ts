import { InstanceId, RemoteUserId } from '@shinsa/core';
import { Duration, Schema } from 'effect';

export const SLACK_EVENT_TTL = Duration.days(1);

export const SlackWorkspace = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  botUserId: Schema.String,
  sealedBotToken: Schema.String,
  installedAt: Schema.Number,
});

export type SlackWorkspace = typeof SlackWorkspace.Type;

export const SlackLink = Schema.Struct({
  workspaceId: Schema.String,
  workspaceName: Schema.String,
  slackUserId: Schema.String,
  slackUserName: Schema.String,
  userId: RemoteUserId,
  machineId: InstanceId,
  sealedUserToken: Schema.NullOr(Schema.String),
  linkedAt: Schema.Number,
});

export type SlackLink = typeof SlackLink.Type;

export const SlackThread = Schema.Struct({
  workspaceId: Schema.String,
  channelId: Schema.String,
  threadTs: Schema.String,
});

export type SlackThread = typeof SlackThread.Type;

export const SlackMessage = Schema.Struct({
  workspaceId: Schema.String,
  channelId: Schema.String,
  ts: Schema.String,
});

export type SlackMessage = typeof SlackMessage.Type;

export const SlackChannelWatch = Schema.Struct({ workspaceId: Schema.String, channelId: Schema.String });

export type SlackChannelWatch = typeof SlackChannelWatch.Type;

export const NewChannelWatch = Schema.Struct({ ...SlackChannelWatch.fields, private: Schema.Boolean });

export type NewChannelWatch = typeof NewChannelWatch.Type;

export const SlackChannelWatcher = Schema.Struct({
  machineId: InstanceId,
  memberCheckedAt: Schema.NullOr(Schema.Number),
});

export type SlackChannelWatcher = typeof SlackChannelWatcher.Type;

export const LINK_COLUMNS =
  'slack_links.workspace_id, slack_workspaces.name AS workspace_name, slack_links.slack_user_id, slack_links.slack_user_name, slack_links.user_id, slack_links.machine_id, slack_links.sealed_user_token, slack_links.linked_at';

export const NewLink = SlackLink.mapFields(({ workspaceName: _, linkedAt: __, ...fields }) => fields);
