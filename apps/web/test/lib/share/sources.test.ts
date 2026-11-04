import { afterEach, describe, expect, it, mock } from 'bun:test';
import { runApp } from '@/lib/runtime/app.ts';
import { SHARED_TEXT_FAILED } from '@/lib/share/schema.ts';
import { requestSharedText, SHARE_GONE, ShareGoneError } from '@/lib/share/sources.ts';
import { requestViewerLogin } from '@/lib/share/viewer.ts';
import { answerFetch } from '../../support/fetch-fake.ts';
import { DIFF } from './fixtures.ts';

afterEach(() => {
  mock.restore();
});

describe('a shared file', () => {
  it('says plainly when a link no longer works', () => {
    expect(new ShareGoneError().message).toBe(SHARE_GONE);
    expect(new ShareGoneError('Gone.').message).toBe('Gone.');
  });

  it('reads the diff as text, and fails in words when it does not load', async () => {
    const answers: (Response | Error)[] = [
      new Response(DIFF),
      new Response('', { status: 404 }),
      new Error('offline'),
    ];
    const requests = answerFetch(() => {
      const next = answers.shift() as Response | Error;
      if (next instanceof Error) throw next;
      return next;
    });
    expect(await runApp(requestSharedText('/diff'))).toBe(DIFF);
    await expect(runApp(requestSharedText('/diff'))).rejects.toThrow(SHARED_TEXT_FAILED);
    await expect(runApp(requestSharedText('/diff'))).rejects.toThrow(SHARED_TEXT_FAILED);
    expect(requests.map(({ path }) => path)).toEqual(Array(3).fill('/diff'));
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
