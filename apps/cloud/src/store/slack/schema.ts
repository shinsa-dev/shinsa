import { InstanceId, RemoteUserId } from '@shinsa/core';
import { Duration, Schema } from 'effect';

export const SLACK_EVENT_TTL = Duration.days(1);

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

export const LINK_COLUMNS =
  'slack_links.team_id, slack_workspaces.team_name, slack_links.slack_user_id, slack_links.slack_user_name, slack_links.user_id, slack_links.instance_id, slack_links.linked_at';

export const NewLink = SlackLink.mapFields(({ teamName: _, linkedAt: __, ...fields }) => fields);
