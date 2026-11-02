import { afterEach, describe, expect, it, mock } from 'bun:test';
import { requestSharedText, SHARE_GONE, ShareGoneError } from '@/lib/share/sources.ts';
import { requestViewerLogin } from '@/lib/share/viewer.ts';
import { answerFetch } from '../../support/fetch-fake.ts';
import { DIFF } from './fixtures.ts';

afterEach(() => {
  mock.restore();
});

function answer(response: Response | Error): typeof fetch {
  return (() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))) as never;
}

describe('a shared file', () => {
  it('says plainly when a link no longer works', () => {
    expect(new ShareGoneError().message).toBe(SHARE_GONE);
    expect(new ShareGoneError('Gone.').message).toBe('Gone.');
  });

  it('reads the diff as text, and fails in words when it does not load', async () => {
    expect(await requestSharedText('/diff', answer(new Response(DIFF)))).toBe(DIFF);
    await expect(requestSharedText('/diff', answer(new Response('', { status: 404 })))).rejects.toThrow(
      'The code did not load. Reload the page to try again.'
    );
  });
});

describe('who is looking at a shared page', () => {
  it('is the GitHub login signed in to app.shinsa.dev, or no one', async () => {
    const answers: (Response | Error)[] = [
      Response.json({ user: { id: '1', login: 'mona', name: null, avatarUrl: null } }),
      Response.json({ user: null }),
      new Response('', { status: 500 }),
      new Error('offline'),
    ];
    const requests = answerFetch(() => {
      const next = answers.shift() as Response | Error;
      if (next instanceof Error) throw next;
      return next;
    });
    expect(await requestViewerLogin()).toBe('mona');
    expect(await requestViewerLogin()).toBeNull();
    expect(await requestViewerLogin()).toBeNull();
    expect(await requestViewerLogin()).toBeNull();
    expect(requests.map(({ path }) => path)).toEqual(Array(4).fill('/__remote/session'));
  });
});
