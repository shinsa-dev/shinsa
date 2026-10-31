import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { SharedPublication, SharePreview } from '@shinsa/core';
import {
  createPreviewSource,
  createPublicationSource,
  requestPreviewSource,
  requestPublicationSource,
  requestSharedText,
  requestViewerLogin,
  SHARE_GONE,
  ShareGoneError,
} from '@/lib/share/sources.ts';
import { createSharedTask, DIFF } from './fixtures.ts';

afterEach(() => {
  mock.restore();
});

const PUBLICATION: SharedPublication = {
  shared: createSharedTask(),
  files: ['shot-1', 'diff'],
  updatedAt: 7,
};

function answer(response: Response | Error): typeof fetch {
  return (() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))) as never;
}

describe('a publication on app.shinsa.dev', () => {
  it('serves only the files it lists, from the link’s own address', () => {
    const source = createPublicationSource(PUBLICATION, 'tok');
    expect(source.updatedAt).toBe(7);
    expect(source.resolveFileUrl('shot-1')).toBe('/__remote/shares/tok/files/shot-1');
    expect(source.resolveFileUrl('diff')).toBe('/__remote/shares/tok/files/diff');
    expect(source.resolveFileUrl('lost')).toBeNull();
  });

  it('reads the publication, and says plainly when the link no longer works', async () => {
    const source = await requestPublicationSource('tok', answer(Response.json(PUBLICATION)));
    expect(source.shared.owner).toBe('mona');
    const gone = requestPublicationSource('tok', answer(new Response('', { status: 404 })));
    await expect(gone).rejects.toBeInstanceOf(ShareGoneError);
    await expect(gone).rejects.toThrow(SHARE_GONE);
    await expect(requestPublicationSource('tok', answer(new Response('', { status: 503 })))).rejects.toThrow(
      'app.shinsa.dev answered with status 503. Reload the page.'
    );
    await expect(requestPublicationSource('tok', answer(new Error('offline')))).rejects.toThrow(
      'Couldn’t reach app.shinsa.dev. Check your connection and reload the page.'
    );
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

describe('a preview on this machine', () => {
  it('reads the engine’s preview and serves its files from their local addresses', async () => {
    const preview: SharePreview = {
      shared: createSharedTask(),
      files: { 'shot-1': '/api/evidence/settings.png' },
      updatedAt: 3,
    };
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(preview));
    const source = await requestPreviewSource('task 1');
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/tasks/task%201/share/preview');
    expect(source.resolveFileUrl('shot-1')).toBe('/api/evidence/settings.png');
    expect(source.resolveFileUrl('diff')).toBeNull();
    expect(createPreviewSource(preview).updatedAt).toBe(3);
  });
});
