import { describe, expect, test } from 'bun:test';
import { Effect, Exit, Redacted } from 'effect';
import { GitHub } from '../../src/integrations/github.ts';
import { createUpstream, flipTest, runTest, type UpstreamHandler } from '../layers.ts';

const signIn = GitHub.use((github) => github.signIn('code-1', Redacted.make('verifier-1')));

function createGitHub(token: Response | null, user: Response | null) {
  const upstream = createUpstream();
  const answer: UpstreamHandler = (call) => {
    if (call.url === 'https://github.com/login/oauth/access_token') return token;
    if (call.url === 'https://api.github.com/user') return user;
    return null;
  };
  upstream.handlers.push(answer);
  return upstream;
}

describe('GitHub sign-in', () => {
  test('the code and verifier become a token, the token the account, with an empty name as none', async () => {
    const upstream = createGitHub(
      Response.json({ access_token: 'gho_token' }),
      Response.json({ id: 42, login: 'mona', name: '', avatar_url: 'https://a/42' })
    );
    const user = await runTest(signIn, { upstream });
    expect(user).toEqual({ id: '42', login: 'mona', name: null, avatarUrl: 'https://a/42' });
    const [exchange, account] = upstream.calls;
    expect(JSON.parse(exchange?.body ?? '')).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      code: 'code-1',
      code_verifier: 'verifier-1',
      redirect_uri: 'https://app.shinsa.dev/__remote/sign-in/callback',
    });
    expect(account?.headers.get('authorization')).toBe('Bearer gho_token');
    expect(account?.headers.get('user-agent')).toBe('shinsa-cloud');
  });

  test('no outbound call carries trace headers', async () => {
    const upstream = createGitHub(
      Response.json({ access_token: 'gho_token' }),
      Response.json({ id: 42, login: 'mona' })
    );
    const user = await runTest(signIn, { upstream });
    expect(user.name).toBeNull();
    expect(upstream.calls.flatMap((call) => [...call.headers.keys()])).not.toContainEqual(
      expect.stringMatching(/^(traceparent|b3)$/)
    );
  });

  test.each([
    [
      'a refused code',
      Response.json({ error: 'bad_verification_code' }),
      null,
      'GitHub did not accept the sign-in. Try again.',
    ],
    [
      'a token endpoint that fails',
      new Response('down', { status: 500 }),
      null,
      'GitHub did not accept the sign-in. Try again.',
    ],
    [
      'a token GitHub does not know',
      Response.json({ access_token: 'gho_token' }),
      Response.json({ message: 'Bad credentials' }, { status: 401 }),
      'GitHub did not say who you are. Try again.',
    ],
    [
      'an account with no login',
      Response.json({ access_token: 'gho_token' }),
      Response.json({ id: 42 }),
      'GitHub did not say who you are. Try again.',
    ],
  ])('%s fails the sign-in with SignInFailed', async (_, token, user, message) => {
    const error = await flipTest(signIn, { upstream: createGitHub(token, user) });
    expect(error._tag).toBe('SignInFailed');
    expect(error.message).toBe(message);
  });

  test('GitHub out of reach is a defect, not a refused sign-in', async () => {
    const upstream = createUpstream();
    const unreachable = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    const exit = await runTest(Effect.exit(signIn), { upstream: { ...upstream, fetch: unreachable } });
    expect(Exit.isFailure(exit) && Exit.hasDies(exit)).toBe(true);
  });
});
