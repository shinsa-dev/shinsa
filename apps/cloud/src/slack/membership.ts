import { Effect, Option } from 'effect';
import { SlackApi } from '../integrations/slack/service.ts';
import type { SlackLink } from '../store/slack/schema.ts';
import { listConversations } from './conversations.ts';
import {
  type ChannelAccess,
  ChannelMembership,
  MEMBERSHIP_DENIED_CODES,
  type PrivateMemberships,
} from './schema.ts';
import { selectUserToken } from './user-tokens.ts';

export const listPrivateMemberships = Effect.fn('listPrivateMemberships')(function* (
  links: readonly SlackLink[]
) {
  const member = new Set<string>();
  let failed: string | null = null;
  for (const link of links) {
    if (link.sealedUserToken === null) continue;
    const token = yield* selectUserToken(link.sealedUserToken);
    if (Option.isNone(token)) continue;
    const joined = yield* listConversations(token.value, 'private_channel').pipe(
      Effect.catchTag('SlackCallFailed', (error) => {
        if (!MEMBERSHIP_DENIED_CODES.has(error.code)) failed = error.code;
        return Effect.as(
          Effect.logWarning('[Cloud] Slack did not list a linked person’s private channels').pipe(
            Effect.annotateLogs({ error, code: error.code, teamId: link.workspaceId })
          ),
          []
        );
      })
    );
    for (const channel of joined) member.add(channel.id);
  }
  const memberships: PrivateMemberships = { member, failed };
  return memberships;
});

export const resolveChannelAccess = Effect.fn('resolveChannelAccess')(function* (
  links: readonly SlackLink[],
  channelId: string
) {
  const slack = yield* SlackApi;
  let access: ChannelAccess = 'denied';
  for (const link of links) {
    if (link.sealedUserToken === null) continue;
    const token = yield* selectUserToken(link.sealedUserToken);
    if (Option.isNone(token)) continue;
    const member = yield* slack
      .call(
        'conversations.info',
        { token: token.value, body: { form: { channel: channelId } } },
        ChannelMembership
      )
      .pipe(
        Effect.map((answer) => answer.channel?.is_member === true),
        Effect.catchTag('SlackCallFailed', (error) => {
          if (MEMBERSHIP_DENIED_CODES.has(error.code)) return Effect.succeed(false);
          access = 'unknown';
          return Effect.as(
            Effect.logWarning(
              '[Cloud] Slack did not say whether a linked person is in a private channel'
            ).pipe(Effect.annotateLogs({ error, code: error.code, teamId: link.workspaceId, channelId })),
            false
          );
        })
      );
    if (member) return 'member' satisfies ChannelAccess;
  }
  return access;
});
