import { afterEach, describe, expect, it, mock } from 'bun:test';
import { EVIDENCE_IMAGE_LIMIT, prefetchEvidence } from '@/lib/evidence/prefetch.ts';
import { selectEvidenceText } from '@/lib/evidence/texts.ts';
import { createEvidence, createShinsaState, createTask } from '../../support/state.ts';

const realFetch = globalThis.fetch;
const RealImage = globalThis.Image;

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.Image = RealImage;
});

describe('prefetchEvidence', () => {
  it('warms each image once and reads each text ahead of the review', async () => {
    const sources: string[] = [];
    globalThis.Image = class {
      decoding = '';
      set src(value: string) {
        sources.push(value);
      }
    } as unknown as typeof Image;
    const fetch = mock(async () => new Response('All green'));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const state = createShinsaState({
      evidence: [
        createEvidence({ id: 'prefetch-shot', taskId: 't' }),
        createEvidence({
          id: 'prefetch-log',
          taskId: 't',
          kind: 'test',
          uri: '/api/evidence/prefetch-log.txt',
        }),
      ],
    });
    const task = createTask({ id: 't' });
    prefetchEvidence(state, task);
    prefetchEvidence(state, task);
    expect(sources).toEqual(['/api/evidence/prefetch-shot.png']);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(selectEvidenceText('/api/evidence/prefetch-log.txt')).toBe('All green');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(EVIDENCE_IMAGE_LIMIT).toBe(64);
  });
});
