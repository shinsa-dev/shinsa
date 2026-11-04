import { type ChatEntry, isChatEntry } from '@shinsa/core';
import { Effect, Option, Schema } from 'effect';
import { useSyncExternalStore } from 'react';
import { runApp } from '@/lib/runtime/app.ts';
import { requestSharedText } from '@/lib/share/sources.ts';
import { createSignal } from '@/lib/signal.ts';
import { type SharedTextReader, SharedTranscriptText } from './schema.ts';

const signal = createSignal();

const transcripts = new Map<string, ChatEntry[]>();

const read = new Map<string, string>();

const pages = new Map<string, ChatEntry[]>();

const listed = new Map<string, readonly string[]>();

const decodeTranscript = Schema.decodeUnknownOption(SharedTranscriptText);

export function parseSharedTranscript(text: string): ChatEntry[] {
  return Option.match(decodeTranscript(text), {
    onNone: () => [],
    onSome: (parsed) => parsed.filter(isChatEntry),
  });
}

export function selectSharedTranscript(runId: string | null) {
  return runId ? (transcripts.get(runId) ?? null) : null;
}

export function useSharedTranscript(runId: string | null) {
  return useSyncExternalStore(signal.subscribe, () => selectSharedTranscript(runId));
}

const readPage = Effect.fn('SharedTranscripts.readPage')(function* (url: string, readText: SharedTextReader) {
  const known = pages.get(url);
  if (known) return known;
  const entries = parseSharedTranscript(yield* readText(url));
  pages.set(url, entries);
  return entries;
});

const syncRun = Effect.fn('SharedTranscripts.syncRun')(function* (
  runId: string,
  list: readonly string[],
  readText: SharedTextReader
) {
  const key = list.join('\n');
  if (read.get(runId) === key) return;
  read.set(runId, key);
  const entries = yield* Effect.option(
    Effect.forEach(list, (url) => readPage(url, readText), { concurrency: 'unbounded' })
  );
  if (Option.isNone(entries)) {
    if (read.get(runId) === key) read.delete(runId);
    return;
  }
  if (read.get(runId) !== key) return;
  for (const url of listed.get(runId) ?? []) if (!list.includes(url)) pages.delete(url);
  listed.set(runId, list);
  transcripts.set(runId, entries.value.flat());
  signal.publish();
});

export function syncSharedTranscripts(
  urls: Readonly<Record<string, readonly string[]>>,
  readText: SharedTextReader = requestSharedText
) {
  return runApp(
    Effect.forEach(Object.entries(urls), ([runId, list]) => syncRun(runId, list, readText), {
      concurrency: 'unbounded',
      discard: true,
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
