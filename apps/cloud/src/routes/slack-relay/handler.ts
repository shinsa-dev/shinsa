import { SLACK_LIMITS, type SlackChannel } from '@shinsa/core';
import { CurrentMachine, RemoteApi } from '@shinsa/core/remote/api';
import {
  PostNotYours,
  SlackBlocksRefused,
  SlackFailed,
  SlackNotInstalled,
  ThreadNotForwarded,
} from '@shinsa/core/remote/errors';
import { Effect, Option, type Redacted, Schema } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import type { SlackCallFailed } from '../../integrations/slack/schema.ts';
import { SlackApi } from '../../integrations/slack/service.ts';
import { revokeMachineUserTokens } from '../../slack/user-tokens.ts';
import { selectWorkspaceToken } from '../../slack/workspace.ts';
import { SlackStore } from '../../store/slack/service.ts';
import {
  CHANNEL_PAGE_SIZE,
  Conversations,
  Posted,
  REFUSED_BLOCK_CODES,
  type RelayThread,
  SETTLED_REACTION_CODES,
  STATUS_UNAVAILABLE_CODES,
} from './schema.ts';
export const SlackRelayHandlers = HttpApiBuilder.group(
  RemoteApi,
  'slackRelay',
  Effect.fn(function* (handlers) {
    const refusePost = (error: SlackCallFailed) =>
      REFUSED_BLOCK_CODES.has(error.code)
        ? new SlackBlocksRefused({ message: `Slack did not take the blocks in the post (${error.code}).` })
        : new SlackFailed({ message: `Slack did not take the post (${error.code}).` });

    const logRefusedPost = (error: SlackCallFailed) =>
      Effect.logError('[Cloud] Slack did not take a post').pipe(
        Effect.annotateLogs({ error, code: error.code })
      );

    const store = yield* SlackStore;
    const slack = yield* SlackApi;

    const assertOwnPost = Effect.fn('slackRelay.assertOwnPost')(function* (thread: RelayThread, ts: string) {
      const { instanceId } = yield* CurrentMachine;
      if (
        !(yield* store.hasPost({ workspaceId: thread.teamId, channelId: thread.channelId, ts }, instanceId))
      )
        return yield* new PostNotYours({ message: 'This machine did not post that Slack message.' });
    });

    const findThreadToken = Effect.fn('slackRelay.findThreadToken')(function* (thread: RelayThread) {
      const { instanceId } = yield* CurrentMachine;
      if (
        !(yield* store.hasThread(
          { workspaceId: thread.teamId, channelId: thread.channelId, threadTs: thread.threadTs },
          instanceId
        ))
      )
        return yield* new ThreadNotForwarded({ message: 'This machine was never sent that Slack thread.' });
      const opened = yield* selectWorkspaceToken(thread.teamId);
      if (Option.isNone(opened))
        return yield* new SlackNotInstalled({ message: 'Shinsa is no longer in that Slack workspace.' });
      return opened.value.token;
    });

    const requestReaction = Effect.fn('slackRelay.requestReaction')(function* (
      method: string,
      token: Redacted.Redacted<string>,
      target: { readonly channel: string; readonly timestamp: string },
      name: string | null
    ) {
      if (!name) return true;
      return yield* slack.call(method, { token, body: { json: { ...target, name } } }, Schema.Unknown).pipe(
        Effect.as(true),
        Effect.catchTag('SlackCallFailed', (error) =>
          SETTLED_REACTION_CODES.has(error.code)
            ? Effect.succeed(true)
            : Effect.as(
                Effect.logError('[Cloud] Slack did not take a reaction').pipe(
                  Effect.annotateLogs({ error, method })
                ),
                false
              )
        )
      );
    });

    const listWorkspaceChannels = Effect.fn('slackRelay.listWorkspaceChannels')(function* (
      workspace: { readonly teamId: string; readonly teamName: string },
      token: Redacted.Redacted<string>
    ) {
      const channels: SlackChannel[] = [];
      let cursor = '';
      do {
        const page = yield* slack
          .call(
            'users.conversations',
            {
              token,
              body: {
                form: {
                  types: 'public_channel,private_channel',
                  exclude_archived: 'true',
                  limit: String(CHANNEL_PAGE_SIZE),
                  ...(cursor ? { cursor } : {}),
                },
              },
            },
            Conversations
          )
          .pipe(
            Effect.tapError((error) =>
              Effect.logError('[Cloud] Slack did not list the channels').pipe(
                Effect.annotateLogs({ error, code: error.code, teamId: workspace.teamId })
              )
            ),
            Effect.mapError(
              (error) => new SlackFailed({ message: `Slack did not list the channels (${error.code}).` })
            )
          );
        for (const channel of page.channels ?? [])
          channels.push({
            ...workspace,
            teamName: workspace.teamName.slice(0, SLACK_LIMITS.teamName),
            channelId: channel.id,
            channelName: channel.name.slice(0, SLACK_LIMITS.channelName),
            private: channel.is_private === true,
          });
        cursor = page.response_metadata?.next_cursor ?? '';
      } while (cursor && channels.length < SLACK_LIMITS.channels);
      return channels;
    });

    const listLinkedWorkspaces = Effect.fn('slackRelay.listLinkedWorkspaces')(function* () {
      const links = yield* store.listMachineLinks((yield* CurrentMachine).instanceId);
      return new Map(links.map((link) => [link.workspaceId, link.workspaceName]));
    });

    return handlers
      .handle(
        'links',
        Effect.fn('slackRelay.links')(function* () {
          const links = yield* store.listMachineLinks((yield* CurrentMachine).instanceId);
          return {
            links: links.map((link) => ({
              teamId: link.workspaceId,
              teamName: link.workspaceName,
              userId: link.slackUserId,
              userName: link.slackUserName,
              linkedAt: link.linkedAt,
              accountId: link.userId,
            })),
          };
        })
      )
      .handle(
        'unlink',
        Effect.fn('slackRelay.unlink')(function* () {
          const { instanceId } = yield* CurrentMachine;
          yield* revokeMachineUserTokens(instanceId);
          yield* store.removeMachineLinks(instanceId);
          yield* store.replaceMachineWatches(instanceId, []);
          return { ok: true as const };
        })
      )
      .handle(
        'post',
        Effect.fn('slackRelay.post')(function* ({ payload }) {
          const { instanceId } = yield* CurrentMachine;
          const token = yield* findThreadToken(payload);
          if (payload.replaceTs) yield* assertOwnPost(payload, payload.replaceTs);
          const content = {
            channel: payload.channelId,
            text: payload.message.text,
            blocks: payload.message.blocks,
          };
          if (payload.replaceTs) {
            yield* slack
              .call(
                'chat.update',
                { token, body: { json: { ...content, ts: payload.replaceTs } } },
                Schema.Unknown
              )
              .pipe(Effect.tapError(logRefusedPost), Effect.mapError(refusePost));
            return { ts: payload.replaceTs };
          }
          const posted = yield* slack
            .call(
              'chat.postMessage',
              {
                token,
                body: {
                  json: { ...content, thread_ts: payload.threadTs, unfurl_links: false, unfurl_media: false },
                },
              },
              Posted
            )
            .pipe(Effect.tapError(logRefusedPost), Effect.mapError(refusePost));
          if (!posted.ts)
            return yield* new SlackFailed({ message: 'Slack did not say where the post went.' });
          yield* store.recordPost(
            { workspaceId: payload.teamId, channelId: payload.channelId, ts: posted.ts },
            instanceId
          );
          return { ts: posted.ts };
        })
      )
      .handle(
        'session',
        Effect.fn('slackRelay.session')(function* ({ payload }) {
          const token = yield* findThreadToken(payload);
          const json = { channel_id: payload.channelId, thread_ts: payload.threadTs, status: payload.status };
          return yield* slack
            .call('agents.sessions.setStatus', { token, body: { json } }, Schema.Unknown)
            .pipe(
              Effect.as({ applied: true }),
              Effect.catchTag('SlackCallFailed', (error) => {
                if (STATUS_UNAVAILABLE_CODES.has(error.code)) return Effect.succeed({ applied: false });
                return Effect.logError('[Cloud] Slack did not take a thread status').pipe(
                  Effect.annotateLogs({ error, teamId: payload.teamId }),
                  Effect.andThen(
                    Effect.fail(
                      new SlackFailed({ message: `Slack did not take the thread status (${error.code}).` })
                    )
                  )
                );
              })
            );
        })
      )
      .handle(
        'react',
        Effect.fn('slackRelay.react')(function* ({ payload }) {
          const token = yield* findThreadToken(payload);
          const target = { channel: payload.channelId, timestamp: payload.messageTs };
          const removed = yield* requestReaction('reactions.remove', token, target, payload.remove);
          const added = yield* requestReaction('reactions.add', token, target, payload.add);
          return { applied: removed && added };
        })
      )
      .handle(
        'channels',
        Effect.fn('slackRelay.channels')(function* () {
          const channels: SlackChannel[] = [];
          for (const [teamId, teamName] of yield* listLinkedWorkspaces()) {
            const opened = yield* selectWorkspaceToken(teamId);
            if (Option.isNone(opened)) continue;
            channels.push(...(yield* listWorkspaceChannels({ teamId, teamName }, opened.value.token)));
          }
          return { channels: channels.slice(0, SLACK_LIMITS.channels) };
        })
      )
      .handle(
        'watches',
        Effect.fn('slackRelay.watches')(function* ({ payload }) {
          const { instanceId } = yield* CurrentMachine;
          const linked = yield* listLinkedWorkspaces();
          yield* store.replaceMachineWatches(
            instanceId,
            payload.watches
              .filter((watch) => linked.has(watch.teamId))
              .map((watch) => ({ workspaceId: watch.teamId, channelId: watch.channelId }))
          );
          return { ok: true as const };
        })
      );
  })
);
