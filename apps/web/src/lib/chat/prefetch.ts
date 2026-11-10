import type { ChatEntry, ShinsaState } from '@shinsa/core';
import { listChatRuns } from '@/lib/chat/delegations.ts';
import { listTaskRuns } from '@/lib/chat/runs.ts';
import { scheduleAfter } from '@/lib/runtime/timers.ts';

export const TRANSCRIPT_PREFETCH_RUNS = 2;

export const TRANSCRIPT_PREFETCH_MS = 5000;

export interface TranscriptSource {
  selectTranscript: (runId: string) => readonly ChatEntry[];
  watchTranscript: (runId: string) => () => void;
  subscribeTranscripts: (listener: () => void) => () => void;
}

const held = new Set<string>();

export function prefetchTranscript(source: TranscriptSource, runId: string) {
  if (held.has(runId) || source.selectTranscript(runId).length > 0) return;
  held.add(runId);
  const release = source.watchTranscript(runId);
  const stop = () => {
    unsubscribe();
    cancel();
    release();
    held.delete(runId);
  };
  const unsubscribe = source.subscribeTranscripts(() => {
    if (source.selectTranscript(runId).length > 0) stop();
  });
  const cancel = scheduleAfter(TRANSCRIPT_PREFETCH_MS, stop);
}

export function listPrefetchRuns(state: ShinsaState, taskId: string) {
  return listChatRuns(listTaskRuns(state.runs, taskId))
    .slice(-TRANSCRIPT_PREFETCH_RUNS)
    .map((run) => run.id);
}
