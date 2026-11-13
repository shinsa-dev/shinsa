import { SLACK_LIMITS } from '@shinsa/core';
import { Effect, type Redacted } from 'effect';
import { SlackApi } from '../integrations/slack/service.ts';
import { CHANNEL_PAGE_SIZE, type Conversation, Conversations } from './schema.ts';

export const listConversations = Effect.fn('listConversations')(function* (
  token: Redacted.Redacted<string>,
  types: string
) {
  const slack = yield* SlackApi;
  const conversations: Conversation[] = [];
  let cursor = '';
  do {
    const page = yield* slack.call(
      'users.conversations',
      {
        token,
        body: {
          form: {
            types,
            exclude_archived: 'true',
            limit: String(CHANNEL_PAGE_SIZE),
            ...(cursor ? { cursor } : {}),
          },
        },
      },
      Conversations
    );
    conversations.push(...(page.channels ?? []));
    cursor = page.response_metadata?.next_cursor ?? '';
  } while (cursor && conversations.length < SLACK_LIMITS.channels);
  return conversations;
});
