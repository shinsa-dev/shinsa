import { REMOTE_PATHS, type RemoteSession } from '@shinsa/core';
import { createToken, isSameSecret, resolveTokenHash } from './crypto.ts';
import type { UserRow } from './database.ts';
import {
  assertSameOrigin,
  CloudError,
  readCookie,
  readResponseFields,
  respondJson,
  serializeCookie,
} from './http.ts';
import type { CloudWorld } from './world.ts';

const SESSION_COOKIE = '__Secure-shinsa_session';

const OAUTH_COOKIE = '__Secure-shinsa_oauth';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const OAUTH_TTL_SECONDS = 600;

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';

const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';

const GITHUB_USER = 'https://api.github.com/user';

interface GitHubUser {
  id: number;
  login: string;
  avatar_url?: string;
}

async function selectSessionUser(request: Request, world: CloudWorld) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return world.store.selectSessionUser(await resolveTokenHash(token), world.now());
}

export async function findSessionUser(request: Request, world: CloudWorld) {
  const user = await selectSessionUser(request, world);
  if (!user) throw new CloudError('signed_out', 'Sign in with GitHub first.', 401);
  return user;
}

export async function respondSession(request: Request, world: CloudWorld) {
  const user = await selectSessionUser(request, world);
  const session: RemoteSession = {
    user: user ? { id: user.id, login: user.login, avatarUrl: user.avatar_url } : null,
  };
  return respondJson(session);
}

function resolveReturnPath(value: string | null) {
  if (!value?.startsWith(REMOTE_PATHS.app) || value.startsWith('//') || value.includes('\\'))
    return REMOTE_PATHS.app;
  return value;
}

export function respondSignIn(url: URL, world: CloudWorld) {
  const state = createToken(24);
  const returnPath = resolveReturnPath(url.searchParams.get('return'));
  const authorize = new URL(GITHUB_AUTHORIZE);
  authorize.searchParams.set('client_id', world.config.githubClientId);
  authorize.searchParams.set('redirect_uri', `${world.config.origin}${REMOTE_PATHS.signInCallback}`);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('allow_signup', 'false');
  const cookie = `${state}.${encodeURIComponent(returnPath)}`;
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      'set-cookie': serializeCookie(OAUTH_COOKIE, cookie, OAUTH_TTL_SECONDS),
      'cache-control': 'no-store',
    },
  });
}

async function requestGitHubUser(code: string, world: CloudWorld): Promise<GitHubUser> {
  const tokenResponse = await world.fetch(GITHUB_TOKEN, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: world.config.githubClientId,
      client_secret: world.config.githubClientSecret,
      code,
      redirect_uri: `${world.config.origin}${REMOTE_PATHS.signInCallback}`,
    }),
  });
  const { access_token: accessToken } = (await readResponseFields(tokenResponse)) as {
    access_token?: unknown;
  };
  if (!tokenResponse.ok || typeof accessToken !== 'string' || accessToken === '')
    throw new CloudError('sign_in_failed', 'GitHub did not accept the sign-in. Try again.', 400);
  const userResponse = await world.fetch(GITHUB_USER, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'shinsa-cloud',
    },
  });
  const user = (await readResponseFields(userResponse)) as Partial<GitHubUser>;
  if (!userResponse.ok || typeof user.id !== 'number' || typeof user.login !== 'string')
    throw new CloudError('sign_in_failed', 'GitHub did not say who you are. Try again.', 400);
  return { id: user.id, login: user.login, avatar_url: user.avatar_url };
}

function isAllowedLogin(login: string, world: CloudWorld) {
  return world.config.allowedLogins.includes(login.toLowerCase());
}

export async function respondSignInCallback(request: Request, url: URL, world: CloudWorld) {
  const [state, encodedReturn] = (readCookie(request, OAUTH_COOKIE) ?? '').split('.');
  const answered = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code');
  if (!state || !code || !isSameSecret(state, answered))
    throw new CloudError(
      'sign_in_failed',
      'The sign-in expired or came from somewhere else. Try again.',
      400
    );
  const github = await requestGitHubUser(code, world);
  if (!isAllowedLogin(github.login, world))
    throw new CloudError('sign_in_refused', `${github.login} cannot use this Shinsa dashboard.`, 403);
  const now = world.now();
  const user: UserRow = { id: String(github.id), login: github.login, avatar_url: github.avatar_url ?? null };
  await world.store.upsertUser(user, now);
  const token = createToken();
  await world.store.createSession(await resolveTokenHash(token), user.id, now + SESSION_TTL_MS);
  const headers = new Headers({
    location: resolveReturnPath(decodeURIComponent(encodedReturn ?? REMOTE_PATHS.app)),
    'cache-control': 'no-store',
  });
  headers.append('set-cookie', serializeCookie(SESSION_COOKIE, token, SESSION_TTL_MS / 1000));
  headers.append('set-cookie', serializeCookie(OAUTH_COOKIE, '', 0));
  return new Response(null, { status: 302, headers });
}

export async function respondSignOut(request: Request, world: CloudWorld) {
  assertSameOrigin(request, world.config.origin);
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await world.store.removeSession(await resolveTokenHash(token));
  return respondJson({ ok: true }, 200, { 'set-cookie': serializeCookie(SESSION_COOKIE, '', 0) });
}
