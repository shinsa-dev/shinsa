import { afterEach, describe, expect, it, mock } from 'bun:test';
import { requestSharedText, requestViewerLogin, SHARE_GONE, ShareGoneError } from '@/lib/share/sources.ts';
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
    const signedIn = Response.json({ user: { id: '1', login: 'mona', avatarUrl: null } });
    expect(await requestViewerLogin(answer(signedIn))).toBe('mona');
    expect(await requestViewerLogin(answer(Response.json({ user: null })))).toBeNull();
    expect(await requestViewerLogin(answer(new Response('', { status: 500 })))).toBeNull();
    expect(await requestViewerLogin(answer(new Error('offline')))).toBeNull();
  });
});
