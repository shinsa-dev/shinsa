import { isSameSecret, REMOTE_PATHS, resolveSlackLinkedPath, SLACK_RELAY_PATHS } from '@shinsa/core';
import { createToken, decryptToken, encryptToken } from './crypto.ts';
import type { InstanceRow, UserRow } from './database.ts';
import { CloudError, readCookie, serializeCookie } from './http.ts';
import { findOwnInstance } from './instances.ts';
import { recordFailure } from './log.ts';
import { selectSessionUser } from './session.ts';
import {
  hasSlackBotScopes,
  readSlackFields,
  readSlackText,
  requestSlack,
  requestSlackUserName,
  SLACK_BOT_SCOPES,
  SLACK_USER_SCOPES,
  SlackApiError,
} from './slack-api.ts';
import type { CloudWorld } from './world.ts';

const SLACK_COOKIE = '__Host-shinsa_slack';

const SLACK_COOKIE_TTL_SECONDS = 600;

const SLACK_CONNECT_AUTHORIZE = 'https://slack.com/openid/connect/authorize';

const SLACK_INSTALL_AUTHORIZE = 'https://slack.com/oauth/v2/authorize';

interface SlackIdentity {
  teamId: string;
  teamName: string;
  userId: string;
  userName: string;
}

function respondRedirect(location: string, cookie: string | null = null) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  if (cookie !== null) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function respondLinked(result: { team: string } | { error: string }) {
  return respondRedirect(resolveSlackLinkedPath(result), serializeCookie(SLACK_COOKIE, '', 0));
}

function resolveCallbackUrl(world: CloudWorld, path: string) {
  return `${world.config.origin}${path}`;
}

function respondAuthorize(authorize: URL, state: string, instanceId: string) {
  return respondRedirect(
    authorize.toString(),
    serializeCookie(SLACK_COOKIE, `${state}.${instanceId}`, SLACK_COOKIE_TTL_SECONDS)
  );
}

async function selectConnectInstance(user: UserRow, instanceId: string | null, world: CloudWorld) {
  if (instanceId) return findOwnInstance(user, instanceId, world);
  const instances = await world.store.listUserInstances(user.id);
  return (
    instances
      .filter((row) => row.user_id === user.id)
      .sort((left, right) => (right.last_seen_at ?? 0) - (left.last_seen_at ?? 0))[0] ?? null
  );
}

export async function respondSlackConnect(request: Request, url: URL, world: CloudWorld) {
  const user = await selectSessionUser(request, world);
  if (!user) {
    const back = `${url.pathname}${url.search}`;
    return respondRedirect(`${REMOTE_PATHS.signIn}?return=${encodeURIComponent(back)}`);
  }
  const instance = await selectConnectInstance(user, url.searchParams.get('instance'), world);
  if (!instance) return respondLinked({ error: 'no_machine' });
  const state = createToken(24);
  const authorize = new URL(SLACK_CONNECT_AUTHORIZE);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', SLACK_USER_SCOPES.join(' '));
  authorize.searchParams.set('client_id', world.config.slackClientId);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('nonce', state);
  authorize.searchParams.set('redirect_uri', resolveCallbackUrl(world, SLACK_RELAY_PATHS.connectCallback));
  return respondAuthorize(authorize, state, instance.id);
}

async function findCallbackInstance(request: Request, url: URL, world: CloudWorld): Promise<InstanceRow> {
  const [state, instanceId] = (readCookie(request, SLACK_COOKIE) ?? '').split('.');
  if (url.searchParams.has('error')) throw new CloudError('slack_denied', 'Slack was not connected.', 400);
  if (!state || !instanceId || !isSameSecret(state, url.searchParams.get('state') ?? ''))
    throw new CloudError('slack_expired', 'Connecting Slack took too long. Try again.', 400);
  if (!url.searchParams.get('code')) throw new CloudError('slack_denied', 'Slack was not connected.', 400);
  const user = await selectSessionUser(request, world);
  if (!user) throw new CloudError('signed_out', 'Sign in with GitHub first.', 401);
  return findOwnInstance(user, instanceId, world);
}

async function requestSlackIdentity(code: string, world: CloudWorld): Promise<SlackIdentity> {
  const exchange = await requestSlack(world, 'openid.connect.token', {
    form: {
      client_id: world.config.slackClientId,
      client_secret: world.config.slackClientSecret,
      code,
      redirect_uri: resolveCallbackUrl(world, SLACK_RELAY_PATHS.connectCallback),
    },
  });
  const token = readSlackText(exchange, 'access_token');
  if (!token) throw new SlackApiError('openid.connect.token', 'no_token');
  const info = await requestSlack(world, 'openid.connect.userInfo', { token });
  const teamId = readSlackText(info, 'https://slack.com/team_id');
  const userId = readSlackText(info, 'https://slack.com/user_id');
  if (!teamId || !userId) throw new SlackApiError('openid.connect.userInfo', 'no_identity');
  return {
    teamId,
    userId,
    teamName: readSlackText(info, 'https://slack.com/team_name') ?? teamId,
    userName: readSlackText(info, 'name') ?? userId,
  };
}

async function recordLink(identity: SlackIdentity, instance: InstanceRow, world: CloudWorld) {
  await world.store.upsertSlackLink({
    team_id: identity.teamId,
    slack_user_id: identity.userId,
    slack_user_name: identity.userName,
    user_id: instance.user_id,
    instance_id: instance.id,
    linked_at: world.now(),
  });
}

function respondInstall(identity: SlackIdentity, instance: InstanceRow, world: CloudWorld) {
  const state = createToken(24);
  const authorize = new URL(SLACK_INSTALL_AUTHORIZE);
  authorize.searchParams.set('client_id', world.config.slackClientId);
  authorize.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
  authorize.searchParams.set('team', identity.teamId);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('redirect_uri', resolveCallbackUrl(world, SLACK_RELAY_PATHS.installCallback));
  return respondAuthorize(authorize, state, instance.id);
}

function describeLinkFailure(error: unknown) {
  if (error instanceof CloudError && error.status < 500) return error.code;
  recordFailure('[Cloud] Slack could not be connected', { error });
  return error instanceof SlackApiError ? 'slack_failed' : 'server_error';
}

export async function respondSlackConnectCallback(request: Request, url: URL, world: CloudWorld) {
  try {
    const instance = await findCallbackInstance(request, url, world);
    const identity = await requestSlackIdentity(url.searchParams.get('code') ?? '', world);
    const workspace = await world.store.selectSlackWorkspace(identity.teamId);
    if (!workspace) return respondInstall(identity, instance, world);
    const token = await decryptToken(world.config.slackTokenKey, workspace.bot_token);
    if (!(await hasSlackBotScopes(world, token))) return respondInstall(identity, instance, world);
    await recordLink(identity, instance, world);
    return respondLinked({ team: workspace.team_name });
  } catch (error) {
    return respondLinked({ error: describeLinkFailure(error) });
  }
}

async function recordInstall(code: string, instance: InstanceRow, world: CloudWorld) {
  const install = await requestSlack(world, 'oauth.v2.access', {
    form: {
      client_id: world.config.slackClientId,
      client_secret: world.config.slackClientSecret,
      code,
      redirect_uri: resolveCallbackUrl(world, SLACK_RELAY_PATHS.installCallback),
    },
  });
  const team = readSlackFields(install, 'team');
  const teamId = readSlackText(team, 'id');
  const botToken = readSlackText(install, 'access_token');
  const botUserId = readSlackText(install, 'bot_user_id');
  const userId = readSlackText(readSlackFields(install, 'authed_user'), 'id');
  if (!teamId || !botToken || !botUserId || !userId) throw new SlackApiError('oauth.v2.access', 'no_bot');
  const teamName = readSlackText(team, 'name') ?? teamId;
  await world.store.upsertSlackWorkspace({
    team_id: teamId,
    team_name: teamName,
    bot_user_id: botUserId,
    bot_token: await encryptToken(world.config.slackTokenKey, botToken),
    installed_at: world.now(),
  });
  const userName = (await requestSlackUserName(world, botToken, userId)) ?? userId;
  await recordLink({ teamId, teamName, userId, userName }, instance, world);
  return teamName;
}

export async function respondSlackInstallCallback(request: Request, url: URL, world: CloudWorld) {
  try {
    const instance = await findCallbackInstance(request, url, world);
    return respondLinked({ team: await recordInstall(url.searchParams.get('code') ?? '', instance, world) });
  } catch (error) {
    return respondLinked({ error: describeLinkFailure(error) });
  }
}
