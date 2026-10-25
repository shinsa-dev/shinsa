import { describe, expect, it } from 'bun:test';
import type { ChatEntry, RunDelegation } from '@shinsa/core';
import {
  listPrefetchRuns,
  prefetchTranscript,
  TRANSCRIPT_PREFETCH_MS,
  TRANSCRIPT_PREFETCH_RUNS,
  type TranscriptSource,
} from '@/lib/chat/prefetch.ts';
import { createRun, createShinsaState } from '../../support/state.ts';

function createSource() {
  const transcripts = new Map<string, readonly ChatEntry[]>();
  const listeners = new Set<() => void>();
  const watched: string[] = [];
  const released: string[] = [];
  const source: TranscriptSource = {
    selectTranscript: (runId) => transcripts.get(runId) ?? [],
    watchTranscript: (runId) => {
      watched.push(runId);
      return () => released.push(runId);
    },
    subscribeTranscripts: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const arrive = (runId: string, count: number) => {
    transcripts.set(
      runId,
      Array.from({ length: count }, () => ({}) as ChatEntry)
    );
    for (const listener of [...listeners]) listener();
  };
  return { source, watched, released, listeners, arrive };
}

describe('prefetchTranscript', () => {
  it('watches a run until its transcript arrives, then lets it go', () => {
    const { source, watched, released, listeners, arrive } = createSource();
    prefetchTranscript(source, 'run-1');
    prefetchTranscript(source, 'run-1');
    expect(watched).toEqual(['run-1']);
    arrive('run-2', 3);
    expect(released).toEqual([]);
    arrive('run-1', 2);
    expect(released).toEqual(['run-1']);
    expect(listeners.size).toBe(0);
    prefetchTranscript(source, 'run-1');
    expect(watched).toEqual(['run-1']);
  });

  it('gives up after a while when nothing arrives', async () => {
    const { source, released } = createSource();
    const realTimeout = globalThis.setTimeout;
    let fire: () => void = () => undefined;
    globalThis.setTimeout = ((run: () => void, ms: number) => {
      expect(ms).toBe(TRANSCRIPT_PREFETCH_MS);
      fire = run;
      return 1;
    }) as unknown as typeof setTimeout;
    prefetchTranscript(source, 'quiet');
    globalThis.setTimeout = realTimeout;
    fire();
    expect(released).toEqual(['quiet']);
  });
});

describe('listPrefetchRuns', () => {
  it('lists the last runs the task’s chat shows, not delegated ones', () => {
    const runs = [
      createRun({ id: 'a', taskId: 't', startedAt: 1 }),
      createRun({ id: 'b', taskId: 't', startedAt: 2 }),
      createRun({ id: 'c', taskId: 't', startedAt: 3 }),
      createRun({ id: 'd', taskId: 't', startedAt: 4, delegation: { parentRunId: 'c' } as RunDelegation }),
      createRun({ id: 'e', taskId: 'other', startedAt: 5 }),
    ];
    const ids = listPrefetchRuns(createShinsaState({ runs }), 't');
    expect(ids).toHaveLength(TRANSCRIPT_PREFETCH_RUNS);
    expect(ids).toEqual(['b', 'c']);
  });
});
