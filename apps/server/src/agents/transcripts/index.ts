import { appendFileSync, existsSync, type FSWatcher, readFileSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';
import { CHAT_PROTOCOL_VERSION, type ChatEntry, type ChatEvent, isChatEntry } from '@shinsa/core';
import { describeError, log } from '../../log/index.ts';
import { type LegacyTranscriptEntry, migrateLegacyEntries } from '../claude/import.ts';

type TranscriptListener = (runId: string, entries: ChatEntry[]) => void;

interface Follower {
  count: number;
  offset: number;
  watcher: FSWatcher | null;
}

function parseLines(text: string): unknown[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

export function readChatEntries(lines: unknown[]): ChatEntry[] {
  if (lines.every(isChatEntry)) return lines;
  const entries: ChatEntry[] = [];
  let legacy: LegacyTranscriptEntry[] = [];
  const flush = () => {
    entries.push(...migrateLegacyEntries(legacy));
    legacy = [];
  };
  for (const line of lines) {
    if (isChatEntry(line)) {
      flush();
      entries.push(line);
    } else legacy.push(line as LegacyTranscriptEntry);
  }
  flush();
  return entries;
}

export type FileWatcher = (path: string, onChange: () => void) => FSWatcher;

function watchFile(path: string, onChange: () => void) {
  return watch(path, onChange);
}

export class Transcripts {
  readonly #dir: string;
  readonly #watch: FileWatcher;
  readonly #listeners = new Set<TranscriptListener>();
  readonly #followers = new Map<string, Follower>();

  constructor(dir: string, watchChanges: FileWatcher = watchFile) {
    this.#dir = dir;
    this.#watch = watchChanges;
  }

  #pathOf(runId: string) {
    return join(this.#dir, `${runId.replace(/[^a-zA-Z0-9-]/g, '')}.jsonl`);
  }

  #emit(runId: string, entries: ChatEntry[]) {
    if (entries.length === 0) return;
    for (const listener of this.#listeners) listener(runId, entries);
  }

  listEntries(runId: string): ChatEntry[] {
    const path = this.#pathOf(runId);
    if (!existsSync(path)) return [];
    return readChatEntries(parseLines(readFileSync(path, 'utf8')));
  }

  record(runId: string, event: ChatEvent) {
    const entry = { ...event, v: CHAT_PROTOCOL_VERSION, id: Bun.randomUUIDv7(), at: Date.now() } as ChatEntry;
    const line = `${JSON.stringify(entry)}\n`;
    appendFileSync(this.#pathOf(runId), line);
    const follower = this.#followers.get(runId);
    if (follower) follower.offset += Buffer.byteLength(line);
    this.#emit(runId, [entry]);
  }

  follow(runId: string) {
    const existing = this.#followers.get(runId);
    if (existing) existing.count += 1;
    else this.#startFollowing(runId);
    return () => this.#unfollow(runId);
  }

  #startFollowing(runId: string) {
    const path = this.#pathOf(runId);
    const follower: Follower = {
      count: 1,
      offset: existsSync(path) ? statSync(path).size : 0,
      watcher: null,
    };
    this.#followers.set(runId, follower);
    if (!existsSync(path)) return;
    follower.watcher = this.#watch(path, () => this.#readAppended(runId, follower));
    follower.watcher.on('error', (error) => {
      log.warn('[Transcripts] Stopped following a transcript', { runId, error: describeError(error) });
      follower.watcher?.close();
      follower.watcher = null;
    });
  }

  #readAppended(runId: string, follower: Follower) {
    const path = this.#pathOf(runId);
    if (!existsSync(path)) return;
    const size = statSync(path).size;
    if (size <= follower.offset) {
      follower.offset = size;
      return;
    }
    const appended = readFileSync(path).subarray(follower.offset, size);
    const complete = appended.lastIndexOf(0x0a) + 1;
    if (complete === 0) return;
    follower.offset += complete;
    this.#emit(runId, readChatEntries(parseLines(appended.subarray(0, complete).toString('utf8'))));
  }

  #unfollow(runId: string) {
    const follower = this.#followers.get(runId);
    if (!follower) return;
    follower.count -= 1;
    if (follower.count > 0) return;
    follower.watcher?.close();
    this.#followers.delete(runId);
  }

  subscribe(listener: TranscriptListener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
