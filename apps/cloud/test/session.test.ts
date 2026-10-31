import { describe, expect, test } from 'bun:test';
import {
  decodeText,
  encodeText,
  type NativeSignInTokenResponse,
  parseBase64Url,
  type RemoteInstance,
  type RemoteSession,
  serializeBase64Url,
} from '@shinsa/core';
import { createCodeChallenge } from '../src/crypto.ts';
import {
  createHarness,
  type GitHubStandIn,
  type Harness,
  NATIVE_VERIFIER,
  readJson,
  registerGitHubCode,
} from './harness.ts';

function readOAuthCookie(response: Response) {
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const value = cookie.split('=')[1] ?? '';
  const fields = JSON.parse(decodeText(parseBase64Url(value) ?? new Uint8Array())) as {
    state: string;
    verifier: string;
    returnPath: string;
    native: { redirect: string; challenge: string } | null;
  };
  return { cookie, ...fields };
}

function serializeOAuthCookie(fields: object) {
  return `__Host-shinsa_oauth=${serializeBase64Url(encodeText(JSON.stringify(fields)))}`;
}

describe('signing in with GitHub', () => {
  test('sends you to GitHub with a state, and back to where you were with a session', async () => {
    const harness = createHarness();
    const start = await harness.call('/__remote/sign-in?return=/pair?code=ABCD');
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://app.shinsa.dev/__remote/sign-in/callback'
    );
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(start.headers.get('set-cookie')).toMatch(
      /^__Host-shinsa_oauth=.*; Path=\/; .*HttpOnly; Secure; SameSite=Lax$/
    );
    expect(start.headers.get('set-cookie')).not.toContain('Domain');
    const session = await harness.signIn('mona', 42);
    expect(session.length).toBeGreaterThan(20);
    const answer = await readJson<RemoteSession>(await harness.call('/__remote/session', { session }));
    expect(answer.user).toEqual({ id: '42', login: 'mona', name: null, avatarUrl: null });
  });

  test('stores only a hash of the session token', async () => {
    const harness = createHarness();
    const session = await harness.signIn();
    const rows = harness.db.sqlite.query('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).not.toBe(session);
  });

  test('keeps the return path on this site', async () => {
    const harness = createHarness();
    for (const unsafe of [
      '//evil.dev',
      'https://evil.dev',
      '/\\evil.dev',
      '/\t/evil.dev',
      '/\n/evil.dev',
      '//[',
    ]) {
      const start = await harness.call(`/__remote/sign-in?return=${encodeURIComponent(unsafe)}`);
      expect(readOAuthCookie(start).returnPath).toBe('/');
    }
  });

  test('proves the code with PKCE, so a stolen code cannot be redeemed elsewhere', async () => {
    const harness = createHarness();
    const start = await harness.call('/__remote/sign-in?return=/pair?code=AB.CD');
    const authorize = new URL(start.headers.get('location') ?? '');
    const { cookie, verifier } = readOAuthCookie(start);
    expect(authorize.searchParams.get('code_challenge')).toBe(await createCodeChallenge(verifier));
    const state = authorize.searchParams.get('state');
    registerGitHubCode('pkce-wrong', { id: 42, login: 'mona' }, 'another-challenge');
    const stolen = await harness.call(`/__remote/sign-in/callback?code=pkce-wrong&state=${state}`, {
      headers: { cookie },
    });
    expect(stolen.headers.get('location')).toBe('/?sign_in_error=sign_in_failed');
    registerGitHubCode(
      'pkce-right',
      { id: 42, login: 'mona' },
      authorize.searchParams.get('code_challenge') ?? ''
    );
    const done = await harness.call(`/__remote/sign-in/callback?code=pkce-right&state=${state}`, {
      headers: { cookie },
    });
    expect(done.headers.get('location')).toBe('/pair?code=AB.CD');
    const token = [...harness.calls].reverse().find((call) => call.url.includes('access_token'));
    expect(JSON.parse(token?.body ?? '{}').code_verifier).toBe(verifier);
    const noVerifier = await harness.call(`/__remote/sign-in/callback?code=x&state=${state}`, {
      headers: { cookie: serializeOAuthCookie({ state }) },
    });
    expect(noVerifier.headers.get('location')).toBe('/?sign_in_error=sign_in_failed');
  });

  test('refuses a callback whose state does not match, and says so on the page', async () => {
    const harness = createHarness();
    const done = await harness.call('/__remote/sign-in/callback?code=x&state=forged', {
      headers: { cookie: serializeOAuthCookie({ state: 'real', verifier: 'verifier', returnPath: '/' }) },
    });
    expect(done.status).toBe(302);
    expect(done.headers.get('location')).toBe('/?sign_in_error=sign_in_failed');
    const missing = await harness.call('/__remote/sign-in/callback?code=x&state=forged');
    expect(missing.headers.get('location')).toBe('/?sign_in_error=sign_in_failed');
  });

  test('refuses when GitHub refuses the code or does not say who you are', async () => {
    const harness = createHarness();
    harness.handlers.push((call) =>
      call.url.includes('access_token')
        ? new Response('not json', { status: 400 })
        : new Response('', { status: 599 })
    );
    const start = await harness.call('/__remote/sign-in');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state');
    const cookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const refused = await harness.call(`/__remote/sign-in/callback?code=x&state=${state}`, {
      headers: { cookie },
    });
    expect(refused.headers.get('location')).toBe('/?sign_in_error=sign_in_failed');
    harness.handlers.length = 0;
    const unknown = await harness.call(`/__remote/sign-in/callback?code=nobody&state=${state}`, {
      headers: { cookie },
    });
    expect(unknown.headers.get('location')).toBe('/?sign_in_error=sign_in_failed');
  });

  test('keeps your GitHub name, picks up a new one, and keeps none when it is missing or blank', async () => {
    const harness = createHarness();
    const named = await signInAs(harness, { id: 42, login: 'mona', name: '  Mona Lisa ' });
    expect(await readSessionUser(harness, named)).toEqual({
      id: '42',
      login: 'mona',
      name: 'Mona Lisa',
      avatarUrl: null,
    });
    const renamed = await signInAs(harness, { id: 42, login: 'mona', name: 'Mona' });
    expect((await readSessionUser(harness, renamed))?.name).toBe('Mona');
    const blank = await signInAs(harness, { id: 42, login: 'mona', name: '   ' });
    expect((await readSessionUser(harness, blank))?.name).toBeNull();
    const unnamed = await signInAs(harness, { id: 43, login: 'kai', name: null });
    expect((await readSessionUser(harness, unnamed))?.name).toBeNull();
    const rows = harness.db.sqlite.query('SELECT name FROM users ORDER BY id').all() as {
      name: string | null;
    }[];
    expect(rows).toEqual([{ name: null }, { name: null }]);
  });

  test('lets any GitHub account in, and each one sees only its own machines', async () => {
    const harness = createHarness();
    const mona = await harness.signIn('Mona', 1);
    const kai = await harness.signIn('kai', 2);
    expect(mona).not.toBe('');
    expect(kai).not.toBe('');
    const rows = harness.db.sqlite.query('SELECT login FROM users ORDER BY id').all() as { login: string }[];
    expect(rows.map((row) => row.login)).toEqual(['Mona', 'kai']);
    expect(await readJson(await harness.call('/__remote/instances', { session: kai }))).toEqual([]);
  });

  test('says nobody is signed in without a session or with an expired one', async () => {
    const harness = createHarness();
    expect(await readJson<RemoteSession>(await harness.call('/__remote/session'))).toEqual({
      user: null,
    });
    const session = await harness.signIn();
    harness.clock.now += 31 * 24 * 60 * 60 * 1000;
    expect(await readJson<RemoteSession>(await harness.call('/__remote/session', { session }))).toEqual({
      user: null,
    });
  });

  test('signs out only from this site, and forgets the session', async () => {
    const harness = createHarness();
    const session = await harness.signIn();
    const crossSite = await harness.post('/__remote/sign-out', {}, { session, sameOrigin: false });
    expect(crossSite.status).toBe(403);
    const out = await harness.post('/__remote/sign-out', {}, { session });
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await readJson<RemoteSession>(await harness.call('/__remote/session', { session }))).toEqual({
      user: null,
    });
    expect((await harness.post('/__remote/sign-out', {})).status).toBe(200);
  });
});

async function signInAs(harness: Harness, github: GitHubStandIn) {
  const start = await harness.call('/__remote/sign-in?return=/');
  const authorize = new URL(start.headers.get('location') ?? '');
  const code = `named-${crypto.randomUUID()}`;
  registerGitHubCode(code, github, authorize.searchParams.get('code_challenge') ?? '');
  const done = await harness.call(
    `/__remote/sign-in/callback?code=${code}&state=${authorize.searchParams.get('state') ?? ''}`,
    { headers: { cookie: readOAuthCookie(start).cookie } }
  );
  const cookie =
    done.headers.getSetCookie().find((value) => value.startsWith('__Host-shinsa_session=')) ?? '';
  return cookie.split(';')[0]?.split('=')[1] ?? '';
}

async function readSessionUser(harness: Harness, session: string) {
  return (await readJson<RemoteSession>(await harness.call('/__remote/session', { session }))).user;
}

async function startNative(
  harness: Harness,
  redirect = 'shinsa://signed-in',
  github: GitHubStandIn = { id: 7, login: 'octo' }
) {
  const challenge = await createCodeChallenge(NATIVE_VERIFIER);
  const start = await harness.call(
    `/__remote/sign-in?client=native&redirect=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256`
  );
  const authorize = new URL(start.headers.get('location') ?? '');
  const code = `native-${crypto.randomUUID()}`;
  registerGitHubCode(code, github, authorize.searchParams.get('code_challenge') ?? '');
  return {
    start,
    code,
    state: authorize.searchParams.get('state') ?? '',
    cookie: readOAuthCookie(start).cookie,
  };
}

async function finishNative(harness: Harness, redirect = 'shinsa://signed-in', github?: GitHubStandIn) {
  const { code, state, cookie } = await startNative(harness, redirect, github);
  const done = await harness.call(`/__remote/sign-in/callback?code=${code}&state=${state}`, {
    headers: { cookie },
  });
  return { done, appCode: new URL(done.headers.get('location') ?? '').searchParams.get('code') ?? '' };
}

function redeem(harness: Harness, code: string, codeVerifier = NATIVE_VERIFIER) {
  return harness.post('/__remote/sign-in/token', { code, codeVerifier }, { sameOrigin: false });
}

async function readErrorCode(response: Response) {
  return (await readJson<{ error: { code: string } }>(response)).error.code;
}

describe('signing in from the native app', () => {
  test('hands the app a one-time code instead of a cookie, which it trades for a bearer session', async () => {
    const harness = createHarness();
    const { start } = await startNative(harness);
    expect(readOAuthCookie(start).native).toEqual({
      redirect: 'shinsa://signed-in',
      challenge: await createCodeChallenge(NATIVE_VERIFIER),
    });
    const { done, appCode } = await finishNative(harness);
    expect(done.status).toBe(302);
    expect(done.headers.get('location')).toStartWith('shinsa://signed-in?code=');
    expect(done.headers.getSetCookie()).toEqual([expect.stringMatching(/^__Host-shinsa_oauth=;.*Max-Age=0/)]);
    const codes = harness.db.sqlite.query('SELECT code_hash FROM sign_in_codes').all() as {
      code_hash: string;
    }[];
    expect(codes).toHaveLength(1);
    expect(codes[0]?.code_hash).not.toBe(appCode);
    const answer = await redeem(harness, appCode);
    expect(answer.status).toBe(200);
    const { token, user } = await readJson<NativeSignInTokenResponse>(answer);
    expect(user).toEqual({ id: '7', login: 'octo', name: null, avatarUrl: null });
    const session = await harness.call('/__remote/session', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect((await readJson<RemoteSession>(session)).user?.login).toBe('octo');
    expect(harness.db.sqlite.query('SELECT * FROM sign_in_codes').all()).toEqual([]);
  });

  test('hands the app your GitHub name with the token', async () => {
    const harness = createHarness();
    const { appCode } = await finishNative(harness, 'shinsa://signed-in', {
      id: 7,
      login: 'octo',
      name: 'Octo Cat',
    });
    const { user } = await readJson<NativeSignInTokenResponse>(await redeem(harness, appCode));
    expect(user).toEqual({ id: '7', login: 'octo', name: 'Octo Cat', avatarUrl: null });
  });

  test('redeems a code only once', async () => {
    const harness = createHarness();
    const { appCode } = await finishNative(harness);
    expect((await redeem(harness, appCode)).status).toBe(200);
    const again = await redeem(harness, appCode);
    expect(again.status).toBe(400);
    expect(await readErrorCode(again)).toBe('sign_in_failed');
  });

  test('burns a code tried with the wrong verifier, so a stolen code is worth nothing', async () => {
    const harness = createHarness();
    const { appCode } = await finishNative(harness);
    expect(await readErrorCode(await redeem(harness, appCode, 'a-guessed-verifier'))).toBe('sign_in_failed');
    expect(await readErrorCode(await redeem(harness, appCode))).toBe('sign_in_failed');
  });

  test('lets a code expire after a minute', async () => {
    const harness = createHarness();
    const { appCode } = await finishNative(harness);
    harness.clock.now += 61_000;
    expect(await readErrorCode(await redeem(harness, appCode))).toBe('sign_in_failed');
  });

  test('clears expired codes when it makes a new one', async () => {
    const harness = createHarness();
    await finishNative(harness);
    harness.clock.now += 61_000;
    const { appCode } = await finishNative(harness);
    expect(harness.db.sqlite.query('SELECT * FROM sign_in_codes').all()).toHaveLength(1);
    expect((await redeem(harness, appCode)).status).toBe(200);
  });

  test('sends the dev app back to its own scheme', async () => {
    const harness = createHarness();
    const { done } = await finishNative(harness, 'shinsa-dev://signed-in');
    expect(done.headers.get('location')).toStartWith('shinsa-dev://signed-in?code=');
  });

  test('sends the app back only to a shinsa address', async () => {
    const harness = createHarness();
    const challenge = await createCodeChallenge(NATIVE_VERIFIER);
    for (const redirect of [
      'https://evil.dev/signed-in',
      'javascript:alert(1)',
      'shinsa-evil://signed-in',
      'not a url',
      `shinsa://${'a'.repeat(200)}`,
    ]) {
      const start = await harness.call(
        `/__remote/sign-in?client=native&redirect=${encodeURIComponent(redirect)}&code_challenge=${challenge}`
      );
      expect(start.status).toBe(400);
      expect(await readErrorCode(start)).toBe('invalid_redirect');
    }
    const missing = await harness.call(`/__remote/sign-in?client=native&code_challenge=${challenge}`);
    expect(await readErrorCode(missing)).toBe('invalid_redirect');
  });

  test('needs an S256 challenge', async () => {
    const harness = createHarness();
    const challenge = await createCodeChallenge(NATIVE_VERIFIER);
    for (const query of [
      '',
      '&code_challenge=short',
      `&code_challenge=${challenge}&code_challenge_method=plain`,
    ]) {
      const start = await harness.call(`/__remote/sign-in?client=native&redirect=shinsa://signed-in${query}`);
      expect(start.status).toBe(400);
      expect(await readErrorCode(start)).toBe('invalid_challenge');
    }
  });

  test('says a failed sign-in to the app rather than on the page', async () => {
    const harness = createHarness();
    const { cookie } = await startNative(harness);
    const forged = await harness.call('/__remote/sign-in/callback?code=x&state=forged', {
      headers: { cookie },
    });
    expect(forged.headers.get('location')).toBe('shinsa://signed-in?error=sign_in_failed');
  });

  test('ignores a native redirect or challenge it did not write', async () => {
    const harness = createHarness();
    for (const native of [
      { redirect: 'https://evil.dev', challenge: await createCodeChallenge(NATIVE_VERIFIER) },
      { redirect: 'shinsa://signed-in', challenge: 'short' },
    ]) {
      const cookie = serializeOAuthCookie({ state: 'real', verifier: 'verifier', native });
      const done = await harness.call('/__remote/sign-in/callback?code=x&state=forged', {
        headers: { cookie },
      });
      expect(done.headers.get('location')).toBe('/?sign_in_error=sign_in_failed');
    }
    const garbage = await harness.call('/__remote/sign-in/callback?code=x&state=forged', {
      headers: { cookie: `__Host-shinsa_oauth=${serializeBase64Url(encodeText('not json'))}` },
    });
    expect(garbage.headers.get('location')).toBe('/?sign_in_error=sign_in_failed');
  });

  test('needs the code and the verifier', async () => {
    const harness = createHarness();
    const missing = await harness.post('/__remote/sign-in/token', { code: 'x' }, { sameOrigin: false });
    expect(missing.status).toBe(400);
    expect(await readErrorCode(missing)).toBe('body_invalid');
  });
});

describe('a bearer session', () => {
  test('reads the session and your machines without a cookie or an Origin', async () => {
    const harness = createHarness();
    const token = await harness.signInNative('mona', 1);
    const headers = { authorization: `Bearer ${token}` };
    const session = await readJson<RemoteSession>(await harness.call('/__remote/session', { headers }));
    expect(session.user?.login).toBe('mona');
    expect(await readJson<RemoteInstance[]>(await harness.call('/__remote/instances', { headers }))).toEqual(
      []
    );
  });

  test('signs out without an Origin and ends only that session', async () => {
    const harness = createHarness();
    const token = await harness.signInNative();
    const browser = await harness.signIn();
    const out = await harness.post('/__remote/sign-out', {}, { bearer: token, sameOrigin: false });
    expect(out.status).toBe(200);
    const headers = { authorization: `Bearer ${token}` };
    expect(
      (await readJson<RemoteSession>(await harness.call('/__remote/session', { headers }))).user
    ).toBeNull();
    const kept = await harness.call('/__remote/session', { session: browser });
    expect((await readJson<RemoteSession>(kept)).user?.login).toBe('mona');
  });

  test('is refused when the token is unknown', async () => {
    const harness = createHarness();
    const answer = await harness.call('/__remote/instances', { headers: { authorization: 'Bearer nope' } });
    expect(answer.status).toBe(401);
  });
});
