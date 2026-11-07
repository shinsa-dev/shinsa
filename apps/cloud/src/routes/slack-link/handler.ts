import { InstanceId, isSameSecret, resolveSlackLinkedPath, SLACK_RELAY_PATHS } from '@shinsa/core';
import { SignedOut, SlackDenied, SlackExpired } from '@shinsa/core/remote/errors';
import { Cause, Effect, Layer, Option, Redacted, Schema } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/http';
import { findOwnMachine } from '../../auth/access.ts';
import { OAUTH_STATE_BYTES } from '../../auth/schema.ts';
import { selectRequestUser } from '../../auth/tokens.ts';
import { CloudConfig } from '../../config/service.ts';
import { CloudCrypto } from '../../crypto/service.ts';
import { serializeCookie, serializeExpiredCookie } from '../../http/cookies.ts';
import { CurrentUrl, readCookie } from '../../http/request.ts';
import { resolveFailureCode, respondRedirect, respondSignInRedirect } from '../../http/responses.ts';
import { SLACK_BOT_SCOPES, SlackCallFailed } from '../../integrations/slack/schema.ts';
import { SlackApi } from '../../integrations/slack/service.ts';
import { selectWorkspaceToken } from '../../slack/workspace.ts';
import type { Machine } from '../../store/machines/schema.ts';
import { Machines } from '../../store/machines/service.ts';
import { SlackStore } from '../../store/slack/service.ts';
import {
  IdentityAnswer,
  InstallAnswer,
  SLACK_CONNECT_AUTHORIZE,
  SLACK_COOKIE,
  SLACK_COOKIE_TTL,
  SLACK_INSTALL_AUTHORIZE,
  SLACK_USER_SCOPES,
  type SlackIdentity,
  TokenAnswer,
} from './schema.ts';

export const SlackLinkRoutes = Layer.unwrap(
  Effect.sync(() => {
    const decodeInstanceId = Schema.decodeUnknownOption(InstanceId);

    const present = (value: string | undefined) => (value ? value : null);

    const respondLinked = (result: { team: string } | { error: string }) => {
      return respondRedirect(resolveSlackLinkedPath(result), {
        cookies: [serializeExpiredCookie(SLACK_COOKIE)],
      });
    };

    const respondAuthorize = Effect.fn('slackLink.respondAuthorize')(function* (
      authorize: URL,
      machine: Machine,
      options: { readonly nonce: boolean }
    ) {
      const crypto = yield* CloudCrypto;
      const state = Redacted.value(yield* crypto.createToken(OAUTH_STATE_BYTES));
      authorize.searchParams.set('state', state);
      if (options.nonce) authorize.searchParams.set('nonce', state);
      return respondRedirect(authorize.toString(), {
        cookies: [serializeCookie(SLACK_COOKIE, `${state}.${machine.id}`, SLACK_COOKIE_TTL)],
      });
    });

    const selectConnectMachine = Effect.fn('slackLink.selectConnectMachine')(function* (
      userId: Parameters<typeof findOwnMachine>[0],
      requested: string | null
    ) {
      const machines = yield* Machines;
      if (requested !== null) {
        const instanceId = decodeInstanceId(requested);
        if (Option.isSome(instanceId)) return Option.some(yield* findOwnMachine(userId, instanceId.value));
      }
      const owned = (yield* machines.listOfUser(userId))
        .filter((shared) => shared.role === 'owner')
        .map((shared) => shared.machine)
        .sort((left, right) => (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0));
      return Option.fromNullishOr(owned[0]);
    });

    const respondConnect = Effect.gen(function* () {
      const url = yield* CurrentUrl;
      const config = yield* CloudConfig;
      const user = yield* selectRequestUser;
      if (Option.isNone(user)) return respondSignInRedirect(config.origin, url);
      const machine = yield* selectConnectMachine(user.value.id, url.searchParams.get('instance'));
      if (Option.isNone(machine)) return respondLinked({ error: 'no_machine' });
      const authorize = new URL(SLACK_CONNECT_AUTHORIZE);
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('scope', SLACK_USER_SCOPES.join(' '));
      authorize.searchParams.set('client_id', config.slackClientId);
      authorize.searchParams.set('redirect_uri', config.slackConnectCallbackUrl);
      return yield* respondAuthorize(authorize, machine.value, { nonce: true });
    });

    const findCallbackMachine = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = yield* CurrentUrl;
      const [state, instanceId] = (readCookie(request, SLACK_COOKIE) ?? '').split('.');
      if (url.searchParams.has('error'))
        return yield* new SlackDenied({ message: 'Slack was not connected.' });
      const machineId = decodeInstanceId(instanceId);
      if (!state || Option.isNone(machineId) || !isSameSecret(state, url.searchParams.get('state') ?? ''))
        return yield* new SlackExpired({ message: 'Connecting Slack took too long. Try again.' });
      const code = url.searchParams.get('code');
      if (!code) return yield* new SlackDenied({ message: 'Slack was not connected.' });
      const user = yield* selectRequestUser;
      if (Option.isNone(user)) return yield* new SignedOut({ message: 'Sign in with GitHub first.' });
      return { machine: yield* findOwnMachine(user.value.id, machineId.value), code };
    });

    const requestIdentity = Effect.fn('slackLink.requestIdentity')(function* (code: string) {
      const config = yield* CloudConfig;
      const slack = yield* SlackApi;
      const exchange = yield* slack.call(
        'openid.connect.token',
        {
          body: {
            form: {
              client_id: config.slackClientId,
              client_secret: Redacted.value(config.slackClientSecret),
              code,
              redirect_uri: config.slackConnectCallbackUrl,
            },
          },
        },
        TokenAnswer
      );
      const token = present(exchange.access_token);
      if (!token) return yield* new SlackCallFailed({ method: 'openid.connect.token', code: 'no_token' });
      const info = yield* slack.call(
        'openid.connect.userInfo',
        { token: Redacted.make(token), body: { empty: true } },
        IdentityAnswer
      );
      const teamId = present(info['https://slack.com/team_id']);
      const userId = present(info['https://slack.com/user_id']);
      if (!teamId || !userId)
        return yield* new SlackCallFailed({ method: 'openid.connect.userInfo', code: 'no_identity' });
      return {
        teamId,
        userId,
        teamName: present(info['https://slack.com/team_name']) ?? teamId,
        userName: present(info.name) ?? userId,
      } satisfies SlackIdentity;
    });

    const recordLink = Effect.fn('slackLink.recordLink')(function* (
      identity: SlackIdentity,
      machine: Machine
    ) {
      const store = yield* SlackStore;
      yield* store.upsertLink({
        workspaceId: identity.teamId,
        slackUserId: identity.userId,
        slackUserName: identity.userName,
        userId: machine.ownerId,
        machineId: machine.id,
      });
    });

    const respondInstall = Effect.fn('slackLink.respondInstall')(function* (
      identity: SlackIdentity,
      machine: Machine
    ) {
      const config = yield* CloudConfig;
      const authorize = new URL(SLACK_INSTALL_AUTHORIZE);
      authorize.searchParams.set('client_id', config.slackClientId);
      authorize.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
      authorize.searchParams.set('team', identity.teamId);
      authorize.searchParams.set('redirect_uri', config.slackInstallCallbackUrl);
      return yield* respondAuthorize(authorize, machine, { nonce: false });
    });

    const connectCallback = Effect.gen(function* () {
      const slack = yield* SlackApi;
      const { machine, code } = yield* findCallbackMachine;
      const identity = yield* requestIdentity(code);
      const opened = yield* selectWorkspaceToken(identity.teamId);
      if (Option.isNone(opened) || !(yield* slack.hasBotScopes(opened.value.token)))
        return yield* respondInstall(identity, machine);
      yield* recordLink(identity, machine);
      return respondLinked({ team: opened.value.workspace.name });
    });

    const installCallback = Effect.gen(function* () {
      const config = yield* CloudConfig;
      const crypto = yield* CloudCrypto;
      const slack = yield* SlackApi;
      const store = yield* SlackStore;
      const { machine, code } = yield* findCallbackMachine;
      const install = yield* slack.call(
        'oauth.v2.access',
        {
          body: {
            form: {
              client_id: config.slackClientId,
              client_secret: Redacted.value(config.slackClientSecret),
              code,
              redirect_uri: config.slackInstallCallbackUrl,
            },
          },
        },
        InstallAnswer
      );
      const teamId = present(install.team?.id);
      const botToken = present(install.access_token);
      const botUserId = present(install.bot_user_id);
      const userId = present(install.authed_user?.id);
      if (!teamId || !botToken || !botUserId || !userId)
        return yield* new SlackCallFailed({ method: 'oauth.v2.access', code: 'no_bot' });
      const teamName = present(install.team?.name) ?? teamId;
      const token = Redacted.make(botToken);
      yield* store.upsertWorkspace({
        id: teamId,
        name: teamName,
        botUserId,
        sealedBotToken: yield* crypto.sealToken(token),
      });
      const userName = Option.getOrElse(yield* slack.selectUserName(token, userId), () => userId);
      yield* recordLink({ teamId, teamName, userId, userName }, machine);
      return respondLinked({ team: teamName });
    });

    type LinkFailure = Effect.Error<typeof connectCallback> | Effect.Error<typeof installCallback>;

    const respondLinkFailure = Effect.fn('slackLink.respondLinkFailure')(function* (
      cause: Cause.Cause<LinkFailure>
    ) {
      const failure = Cause.findErrorOption(cause);
      if (Option.isSome(failure) && failure.value._tag !== 'SlackCallFailed')
        return respondLinked({ error: resolveFailureCode(failure.value) });
      yield* Effect.logError('[Cloud] Slack could not be connected').pipe(
        Effect.annotateLogs({ cause: Cause.pretty(cause) })
      );
      return respondLinked({ error: Option.isSome(failure) ? 'slack_failed' : 'server_error' });
    });

    return Layer.mergeAll(
      HttpRouter.add('GET', SLACK_RELAY_PATHS.connect, respondConnect),
      HttpRouter.add(
        'GET',
        SLACK_RELAY_PATHS.connectCallback,
        connectCallback.pipe(Effect.catchCause(respondLinkFailure))
      ),
      HttpRouter.add(
        'GET',
        SLACK_RELAY_PATHS.installCallback,
        installCallback.pipe(Effect.catchCause(respondLinkFailure))
      )
    );
  })
);
