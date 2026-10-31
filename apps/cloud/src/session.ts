import {
  decodeText,
  encodeText,
  type NativeSignInTokenResponse,
  parseBase64Url,
  REMOTE_NATIVE_CLIENT,
  REMOTE_NATIVE_REDIRECT_SCHEMES,
  REMOTE_PATHS,
  type RemoteSession,
  type RemoteUser,
  serializeBase64Url,
} from '@shinsa/core';
import { createCodeChallenge, createToken, isSameSecret, resolveTokenHash } from './crypto.ts';
import type { UserRow } from './database.ts';
import {
  assertSameOrigin,
  CloudError,
  readBearer,
  readCookie,
  readJsonFields,
  readResponseFields,
  readText,
  respondJson,
  serializeCookie,
} from './http.ts';
import type { CloudWorld } from './world.ts';

const SESSION_COOKIE = '__Host-shinsa_session';

const OAUTH_COOKIE = '__Host-shinsa_oauth';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const OAUTH_TTL_SECONDS = 600;

const SIGN_IN_CODE_TTL_MS = 60_000;

const NATIVE_REDIRECT_LIMIT = 200;

const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';

const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';

const GITHUB_USER = 'https://api.github.com/user';

interface GitHubUser {
  id: number;
  login: string;
  avatar_url?: string;
}

interface NativeSignIn {
  redirect: string;
  challenge: string;
}

interface OAuthState {
  state: string;
  verifier: string;
  returnPath: string;
  native: NativeSignIn | null;
}

function readSessionToken(request: Request) {
  return readBearer(request) ?? readCookie(request, SESSION_COOKIE);
}

async function selectSessionUser(request: Request, world: CloudWorld) {
  const token = readSessionToken(request);
  if (!token) return null;
  return world.store.selectSessionUser(await resolveTokenHash(token), world.now());
}

export async function findSessionUser(request: Request, world: CloudWorld) {
  const user = await selectSessionUser(request, world);
  if (!user) throw new CloudError('signed_out', 'Sign in with GitHub first.', 401);
  return user;
}

export function assertPageRequest(request: Request, world: CloudWorld) {
  if (readBearer(request) === null) assertSameOrigin(request, world.config.origin);
}

export function findPageUser(request: Request, world: CloudWorld) {
  assertPageRequest(request, world);
  return findSessionUser(request, world);
}

function serializeUser(user: UserRow): RemoteUser {
  return { id: user.id, login: user.login, avatarUrl: user.avatar_url };
}

export async function respondSession(request: Request, world: CloudWorld) {
  const user = await selectSessionUser(request, world);
  const session: RemoteSession = { user: user ? serializeUser(user) : null };
  return respondJson(session);
}

function resolveReturnPath(value: string | null, origin: string) {
  if (!value?.startsWith('/')) return REMOTE_PATHS.app;
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}` : REMOTE_PATHS.app;
  } catch {
    return REMOTE_PATHS.app;
  }
}

function selectNativeRedirect(value: string | null) {
  if (!value || value.length > NATIVE_REDIRECT_LIMIT) return null;
  try {
    const url = new URL(value);
    return REMOTE_NATIVE_REDIRECT_SCHEMES.some((scheme) => scheme === url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function resolveNativeSignIn(url: URL): NativeSignIn | null {
  if (url.searchParams.get('client') !== REMOTE_NATIVE_CLIENT) return null;
  const redirect = selectNativeRedirect(url.searchParams.get('redirect'));
  if (!redirect)
    throw new CloudError('invalid_redirect', 'The app can only be sent back to a shinsa:// address.', 400);
  const challenge = url.searchParams.get('code_challenge') ?? '';
  const method = url.searchParams.get('code_challenge_method') ?? 'S256';
  if (method !== 'S256' || !CODE_CHALLENGE_PATTERN.test(challenge))
    throw new CloudError('invalid_challenge', 'Send an S256 code challenge with the sign-in.', 400);
  return { redirect, challenge };
}

function serializeOAuthState(state: OAuthState) {
  return serializeBase64Url(encodeText(JSON.stringify(state)));
}

function readOAuthState(request: Request): OAuthState | null {
  const bytes = parseBase64Url(readCookie(request, OAUTH_COOKIE) ?? '');
  if (!bytes) return null;
  try {
    const fields = JSON.parse(decodeText(bytes)) as Partial<OAuthState>;
    if (typeof fields.state !== 'string' || typeof fields.verifier !== 'string') return null;
    const native = fields.native ?? null;
    const redirect = native ? selectNativeRedirect(native.redirect) : null;
    const challenge = native && CODE_CHALLENGE_PATTERN.test(native.challenge) ? native.challenge : null;
    return {
      state: fields.state,
      verifier: fields.verifier,
      returnPath: typeof fields.returnPath === 'string' ? fields.returnPath : REMOTE_PATHS.app,
      native: redirect && challenge ? { redirect, challenge } : null,
    };
  } catch {
    return null;
  }
}

function resolveNativeLocation(redirect: string, name: string, value: string) {
  const location = new URL(redirect);
  location.searchParams.set(name, value);
  return location.toString();
}

export function resolveCallbackFailureLocation(request: Request, code: string) {
  const native = readOAuthState(request)?.native;
  if (native) return resolveNativeLocation(native.redirect, 'error', code);
  return `${REMOTE_PATHS.app}?sign_in_error=${encodeURIComponent(code)}`;
}

export async function respondSignIn(url: URL, world: CloudWorld) {
  const native = resolveNativeSignIn(url);
  const state = createToken(24);
  const verifier = createToken(32);
  const returnPath = resolveReturnPath(url.searchParams.get('return'), world.config.origin);
  const authorize = new URL(GITHUB_AUTHORIZE);
  authorize.searchParams.set('client_id', world.config.githubClientId);
  authorize.searchParams.set('redirect_uri', `${world.config.origin}${REMOTE_PATHS.signInCallback}`);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', await createCodeChallenge(verifier));
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('allow_signup', 'false');
  const cookie = serializeOAuthState({ state, verifier, returnPath, native });
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      'set-cookie': serializeCookie(OAUTH_COOKIE, cookie, OAUTH_TTL_SECONDS),
      'cache-control': 'no-store',
    },
  });
}

async function requestGitHubUser(code: string, verifier: string, world: CloudWorld): Promise<GitHubUser> {
  const tokenResponse = await world.fetch(GITHUB_TOKEN, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: world.config.githubClientId,
      client_secret: world.config.githubClientSecret,
      code,
      code_verifier: verifier,
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

async function createSession(userId: string, world: CloudWorld) {
  const token = createToken();
  await world.store.createSession(await resolveTokenHash(token), userId, world.now() + SESSION_TTL_MS);
  return token;
}

async function respondNativeCallback(user: UserRow, native: NativeSignIn, world: CloudWorld) {
  const code = createToken();
  const now = world.now();
  await world.store.createSignInCode(
    await resolveTokenHash(code),
    { user_id: user.id, code_challenge: native.challenge, expires_at: now + SIGN_IN_CODE_TTL_MS },
    now
  );
  return new Response(null, {
    status: 302,
    headers: {
      location: resolveNativeLocation(native.redirect, 'code', code),
      'cache-control': 'no-store',
      'set-cookie': serializeCookie(OAUTH_COOKIE, '', 0),
    },
  });
}

export async function respondSignInCallback(request: Request, url: URL, world: CloudWorld) {
  const oauth = readOAuthState(request);
  const answered = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code');
  if (!oauth?.state || !oauth.verifier || !code || !isSameSecret(oauth.state, answered))
    throw new CloudError(
      'sign_in_failed',
      'The sign-in expired or came from somewhere else. Try again.',
      400
    );
  const github = await requestGitHubUser(code, oauth.verifier, world);
  const user: UserRow = { id: String(github.id), login: github.login, avatar_url: github.avatar_url ?? null };
  await world.store.upsertUser(user, world.now());
  if (oauth.native) return respondNativeCallback(user, oauth.native, world);
  const token = await createSession(user.id, world);
  const headers = new Headers({
    location: resolveReturnPath(oauth.returnPath, world.config.origin),
    'cache-control': 'no-store',
  });
  headers.append('set-cookie', serializeCookie(SESSION_COOKIE, token, SESSION_TTL_MS / 1000));
  headers.append('set-cookie', serializeCookie(OAUTH_COOKIE, '', 0));
  return new Response(null, { status: 302, headers });
}

async function findSignInCodeUser(code: string, verifier: string, world: CloudWorld) {
  const row = await world.store.takeSignInCode(await resolveTokenHash(code));
  const challenge = await createCodeChallenge(verifier);
  const failed = new CloudError(
    'sign_in_failed',
    'The sign-in expired or came from somewhere else. Try again.',
    400
  );
  if (!row || !isSameSecret(challenge, row.code_challenge) || row.expires_at <= world.now()) throw failed;
  const user = await world.store.selectUser(row.user_id);
  if (!user) throw failed;
  return user;
}

export async function respondSignInToken(request: Request, world: CloudWorld) {
  const fields = await readJsonFields(request);
  const user = await findSignInCodeUser(readText(fields, 'code'), readText(fields, 'codeVerifier'), world);
  const answer: NativeSignInTokenResponse = {
    token: await createSession(user.id, world),
    user: serializeUser(user),
  };
  return respondJson(answer);
}

export async function respondSignOut(request: Request, world: CloudWorld) {
  assertPageRequest(request, world);
  const token = readSessionToken(request);
  if (token) await world.store.removeSession(await resolveTokenHash(token));
  return respondJson({ ok: true }, 200, { 'set-cookie': serializeCookie(SESSION_COOKIE, '', 0) });
}
