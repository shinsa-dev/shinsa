import { afterEach, describe, expect, it, mock } from 'bun:test';
import { recordEvidenceText, requestEvidenceText, selectEvidenceText } from '@/lib/evidence/texts.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('requestEvidenceText', () => {
  it('reads a text once, however many ask while it loads, and keeps it', async () => {
    const fetch = mock(async () => new Response('3 pass'));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    expect(selectEvidenceText('/api/evidence/texts-once.txt')).toBeNull();
    const [first, second] = await Promise.all([
      requestEvidenceText('/api/evidence/texts-once.txt'),
      requestEvidenceText('/api/evidence/texts-once.txt'),
    ]);
    expect([first, second]).toEqual(['3 pass', '3 pass']);
    expect(await requestEvidenceText('/api/evidence/texts-once.txt')).toBe('3 pass');
    expect(selectEvidenceText('/api/evidence/texts-once.txt')).toBe('3 pass');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('answers a failure with why, and reads again next time', async () => {
    globalThis.fetch = mock(
      async () => new Response('gone', { status: 404 })
    ) as unknown as typeof globalThis.fetch;
    expect(await requestEvidenceText('/api/evidence/texts-gone.txt')).toBe(
      'Couldn’t read this evidence. Shinsa answered with status 404.'
    );
    expect(selectEvidenceText('/api/evidence/texts-gone.txt')).toBeNull();
  });

  it('answers a text recorded in advance without reading it', async () => {
    const fetch = mock(async () => new Response('never'));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    recordEvidenceText('sample:texts-recorded.txt', '1 pass');
    expect(await requestEvidenceText('sample:texts-recorded.txt')).toBe('1 pass');
    expect(fetch).not.toHaveBeenCalled();
  });
});
