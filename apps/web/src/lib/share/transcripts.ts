import { type ChatEntry, isChatEntry } from '@shinsa/core';
import { useSyncExternalStore } from 'react';
import { requestSharedText } from '@/lib/share/sources.ts';
import { createSignal } from '@/lib/signal.ts';

const signal = createSignal();

const transcripts = new Map<string, ChatEntry[]>();

const read = new Map<string, string>();

const pages = new Map<string, ChatEntry[]>();

const listed = new Map<string, readonly string[]>();

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

async function readPage(url: string, readText: (url: string) => Promise<string>) {
  const known = pages.get(url);
  if (known) return known;
  const entries = parseSharedTranscript(await readText(url));
  pages.set(url, entries);
  return entries;
}

export async function syncSharedTranscripts(
  urls: Readonly<Record<string, readonly string[]>>,
  readText: (url: string) => Promise<string> = requestSharedText
) {
  await Promise.all(
    Object.entries(urls).map(async ([runId, list]) => {
      const key = list.join('\n');
      if (read.get(runId) === key) return;
      read.set(runId, key);
      let entries: ChatEntry[][];
      try {
        entries = await Promise.all(list.map((url) => readPage(url, readText)));
      } catch {
        if (read.get(runId) === key) read.delete(runId);
        return;
      }
      if (read.get(runId) !== key) return;
      for (const url of listed.get(runId) ?? []) if (!list.includes(url)) pages.delete(url);
      listed.set(runId, list);
      transcripts.set(runId, entries.flat());
      signal.publish();
    })
  );
}

export function resetSharedTranscripts() {
  transcripts.clear();
  read.clear();
  pages.clear();
  listed.clear();
  signal.publish();
}
