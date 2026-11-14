import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { CloudSignIn } from '../../src/cloud-sign-in/service.ts';
import { AppWindow } from '../../src/window/service.ts';
import { answerJson, createWorld, type DesktopWorld, flush, runDesktop } from '../support/desktop.ts';

const TOKEN_PATH = '/__remote/sign-in/token';

const USER = { id: 'u1', login: 'mona', name: 'Mona', avatarUrl: null };

function cloudWorld(overrides: Partial<DesktopWorld> = {}) {
  return createWorld({
    files: new Map([
      [
        '/Users/me/Library/Application Support/Shinsa/prefs.json',
        JSON.stringify({ engineSource: { kind: 'cloud', machine: null } }),
      ],
    ]),
    answer: (path) => (path === TOKEN_PATH ? answerJson({ token: 'session-token', user: USER }) : 'refuse'),
    ...overrides,
  });
}

function signIn(world: DesktopWorld, back: (opened: URL) => string, onPage = true) {
  return runDesktop(
    world,
    Effect.gen(function* () {
      const window = yield* AppWindow;
      const sign = yield* CloudSignIn;
      if (onPage) yield* window.showServerPage;
      yield* sign.start;
      const opened = new URL(world.shell.at(-1)?.replace(/^open /, '') ?? '');
      const handled = yield* sign.finish(back(opened));
      yield* flush;
      return { opened, handled };
    })
  );
}

async function hashChallenge(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

describe('signing in to Shinsa Cloud', () => {
  it('opens GitHub in the browser, trades the code for a session and reloads Shinsa signed in', async () => {
    const world = cloudWorld();
    const { opened, handled } = await signIn(world, () => 'shinsa://signed-in?code=one-time');
    expect(handled).toBe(true);
    expect(opened.origin + opened.pathname).toBe('https://app.shinsa.dev/__remote/sign-in');
    expect(world.posts).toHaveLength(1);
    const body = world.posts[0]?.body as { code: string; codeVerifier: string };
    expect(world.posts[0]?.url).toBe('https://app.shinsa.dev/__remote/sign-in/token');
    expect(body.code).toBe('one-time');
    expect(await hashChallenge(body.codeVerifier)).toBe(opened.searchParams.get('code_challenge') ?? '');
    expect(world.cookies).toEqual([
      {
        url: 'https://app.shinsa.dev',
        name: '__Host-shinsa_session',
        value: 'session-token',
        expiresAt: 30 * 24 * 60 * 60,
      },
    ]);
    expect(world.window.slice(-2)).toEqual(['load https://app.shinsa.dev/', 'show']);
  });

  it('uses each code verifier once, so a replayed link only explains itself', async () => {
    const world = cloudWorld();
    await runDesktop(
      world,
      Effect.gen(function* () {
        const window = yield* AppWindow;
        const sign = yield* CloudSignIn;
        yield* window.showServerPage;
        yield* sign.start;
        yield* sign.finish('shinsa://signed-in?code=one-time');
        yield* sign.finish('shinsa://signed-in?code=one-time');
      })
    );
    expect(world.posts).toHaveLength(1);
    expect(world.window.at(-2)).toBe('load https://app.shinsa.dev/?sign_in_error=sign_in_expired');
  });

  it('shows the error Shinsa Cloud sent, and a failed exchange or cookie as a failed sign-in', async () => {
    const refused = cloudWorld();
    await signIn(refused, () => 'shinsa://signed-in?error=sign_in_failed');
    expect(refused.posts).toEqual([]);
    expect(refused.window.at(-2)).toBe('load https://app.shinsa.dev/?sign_in_error=sign_in_failed');

    const broken = cloudWorld({ answer: () => ({ status: 401, body: '{}' }) });
    await signIn(broken, () => 'shinsa://signed-in?code=one-time');
    expect(broken.cookies).toEqual([]);
    expect(broken.window.at(-2)).toBe('load https://app.shinsa.dev/?sign_in_error=sign_in_failed');

    const noCookie = cloudWorld({ cookiesFail: true });
    await signIn(noCookie, () => 'shinsa://signed-in?code=one-time');
    expect(noCookie.window.at(-2)).toBe('load https://app.shinsa.dev/?sign_in_error=sign_in_failed');
  });

  it('keeps the landing page for when Shinsa Cloud answers again, while the status page shows', async () => {
    const world = cloudWorld();
    const loaded = await runDesktop(
      world,
      Effect.gen(function* () {
        const window = yield* AppWindow;
        const sign = yield* CloudSignIn;
        yield* sign.start;
        yield* sign.finish('shinsa://signed-in?code=one-time');
        const before = [...world.window];
        yield* window.showServerPage;
        return before;
      })
    );
    expect(loaded).toEqual(['show']);
    expect(world.window.at(-1)).toBe('load https://app.shinsa.dev/');
  });

  it('leaves any other link alone', async () => {
    const world = cloudWorld();
    const { handled } = await signIn(world, () => 'shinsa://task/LOC-4', false);
    expect(handled).toBe(false);
    expect(world.posts).toEqual([]);
  });
});
