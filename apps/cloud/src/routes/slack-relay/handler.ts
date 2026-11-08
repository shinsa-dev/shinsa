import { CurrentMachine, RemoteApi } from '@shinsa/core/remote/api';
import {
  PostNotYours,
  SlackBlocksRefused,
  SlackFailed,
  SlackNotInstalled,
  SlackNotLinked,
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
  ChannelPage,
  DIRECTORY_CHANNEL_TYPES,
  DIRECTORY_PAGE_LIMIT,
  DIRECTORY_PAGE_SIZE,
  MemberPage,
  NOTIFY_REFUSALS,
  Notified,
  type PagedAnswer,
  Posted,
  REFUSED_BLOCK_CODES,
  type RelayThread,
  SETTLED_REACTION_CODES,
  SLACKBOT_USER_ID,
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

    const refuseNotify = (error: SlackCallFailed) =>
      REFUSED_BLOCK_CODES.has(error.code)
        ? refusePost(error)
        : new SlackFailed({
            message: NOTIFY_REFUSALS[error.code] ?? `Slack did not take the post (${error.code}).`,
          });

    const byName = (left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name);

    const store = yield* SlackStore;
    const slack = yield* SlackApi;

    const assertOwnPost = Effect.fn('slackRelay.assertOwnPost')(function* (
      thread: Pick<RelayThread, 'teamId' | 'channelId'>,
      ts: string
    ) {
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

    const findWorkspaceToken = Effect.fn('slackRelay.findWorkspaceToken')(function* (teamId: string) {
      const { instanceId } = yield* CurrentMachine;
      const opened = yield* selectWorkspaceToken(teamId);
      if (Option.isNone(opened))
        return yield* new SlackNotInstalled({ message: 'Shinsa is not in that Slack workspace.' });
      const links = yield* store.listMachineLinks(instanceId);
      if (!links.some((link) => link.workspaceId === teamId))
        return yield* new SlackNotLinked({
          message: 'This machine is not connected to that Slack workspace.',
        });
      return opened.value.token;
    });

    const listPages = Effect.fn('slackRelay.listPages')(function* <P extends PagedAnswer, I, A>(
      method: string,
      token: Redacted.Redacted<string>,
      form: Readonly<Record<string, string>>,
      Page: Schema.Codec<P, I>,
      read: (page: P) => readonly A[]
    ) {
      const entries: A[] = [];
      let cursor = '';
      for (let page = 0; page < DIRECTORY_PAGE_LIMIT; page++) {
        const answer = yield* slack
          .call(
            method,
            { token, body: { form: { ...form, limit: String(DIRECTORY_PAGE_SIZE), cursor } } },
            Page
          )
          .pipe(
            Effect.tapError((error) =>
              Effect.logError('[Cloud] Slack did not list a directory').pipe(
                Effect.annotateLogs({ error, method })
              )
            ),
            Effect.mapError(
              (error) => new SlackFailed({ message: `Slack did not list the workspace (${error.code}).` })
            )
          );
        entries.push(...read(answer));
        cursor = answer.response_metadata?.next_cursor ?? '';
        if (!cursor) break;
      }
      return entries;
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
        'directory',
        Effect.fn('slackRelay.directory')(function* ({ query }) {
          const token = yield* findWorkspaceToken(query.teamId);
          const channels = yield* listPages(
            'conversations.list',
            token,
            { types: DIRECTORY_CHANNEL_TYPES, exclude_archived: 'true' },
            ChannelPage,
            (page) =>
              page.channels.flatMap((channel) =>
                channel.is_member ? [{ id: channel.id, name: channel.name }] : []
              )
          );
          const people = yield* listPages('users.list', token, {}, MemberPage, (page) =>
            page.members.flatMap((member) => {
              if (member.deleted || member.is_bot || member.id === SLACKBOT_USER_ID) return [];
              const name = member.profile?.real_name || member.profile?.display_name || member.name;
              return name ? [{ id: member.id, name }] : [];
            })
          );
          return { teamId: query.teamId, channels: channels.sort(byName), people: people.sort(byName) };
        })
      )
      .handle(
        'notify',
        Effect.fn('slackRelay.notify')(function* ({ payload }) {
          const { instanceId } = yield* CurrentMachine;
          const token = yield* findWorkspaceToken(payload.teamId);
          const content = { text: payload.message.text, blocks: payload.message.blocks };
          if (payload.replace) {
            const { channelId, ts } = payload.replace;
            yield* assertOwnPost({ teamId: payload.teamId, channelId }, ts);
            yield* slack
              .call(
                'chat.update',
                { token, body: { json: { ...content, channel: channelId, ts } } },
                Schema.Unknown
              )
              .pipe(Effect.tapError(logRefusedPost), Effect.mapError(refuseNotify));
            return payload.replace;
          }
          const posted = yield* slack
            .call(
              'chat.postMessage',
              {
                token,
                body: { json: { ...content, channel: payload.id, unfurl_links: false, unfurl_media: false } },
              },
              Notified
            )
            .pipe(Effect.tapError(logRefusedPost), Effect.mapError(refuseNotify));
          if (!posted.ts || !posted.channel)
            return yield* new SlackFailed({ message: 'Slack did not say where the post went.' });
          yield* store.recordPost(
            { workspaceId: payload.teamId, channelId: posted.channel, ts: posted.ts },
            instanceId
          );
          return { channelId: posted.channel, ts: posted.ts };
        })
      );
  })
);
