import { type ChatEntry, isChatEntry } from '@shinsa/core';
import { useSyncExternalStore } from 'react';
import { requestSharedText } from '@/lib/share/sources.ts';
import { createSignal } from '@/lib/signal.ts';

const signal = createSignal();

const transcripts = new Map<string, ChatEntry[]>();

const read = new Map<string, string>();

export function parseSharedTranscript(text: string): ChatEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(isChatEntry) : [];
}

export function selectSharedTranscript(runId: string | null) {
  return runId ? (transcripts.get(runId) ?? null) : null;
}

export function useSharedTranscript(runId: string | null) {
  return useSyncExternalStore(signal.subscribe, () => selectSharedTranscript(runId));
}

export async function syncSharedTranscripts(
  urls: Readonly<Record<string, string>>,
  readText: (url: string) => Promise<string> = requestSharedText
) {
  await Promise.all(
    Object.entries(urls).map(async ([runId, url]) => {
      if (read.get(runId) === url) return;
      read.set(runId, url);
      let text: string;
      try {
        text = await readText(url);
      } catch {
        if (read.get(runId) === url) read.delete(runId);
        return;
      }
      if (read.get(runId) !== url) return;
      transcripts.set(runId, parseSharedTranscript(text));
      signal.publish();
    })
  );
}

export function resetSharedTranscripts() {
  transcripts.clear();
  read.clear();
  signal.publish();
}
