import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAT_PROTOCOL_VERSION, type ChatEntry, type ChatEvent } from '@shinsa/core';
import { describeError, log } from '../../log/index.ts';
import { readRange, readSize, repeatEverySecond, watchFile } from './file.ts';
import { parseLines } from './lines.ts';
import {
  CACHED_RUNS,
  type CheckRepeater,
  type FileWatcher,
  type Follower,
  type RunFile,
  type TranscriptListener,
  type TranscriptRead,
} from './schema.ts';

export { type TranscriptRead, UNREADABLE_LINE } from './schema.ts';

export class Transcripts {
  readonly #dir: string;
  readonly #watch: FileWatcher;
  readonly #listeners = new Set<TranscriptListener>();
  readonly #followers = new Map<string, Follower>();
  readonly #files = new Map<string, RunFile>();
  readonly #checked = new Set<string>();
  readonly #repeat: CheckRepeater;

  constructor(
    dir: string,
    watchChanges: FileWatcher = watchFile,
    repeatCheck: CheckRepeater = repeatEverySecond
  ) {
    this.#dir = dir;
    this.#watch = watchChanges;
    this.#repeat = repeatCheck;
  }

  #pathOf(runId: string) {
    return join(this.#dir, `${runId.replace(/[^a-zA-Z0-9-]/g, '')}.jsonl`);
  }

  resolvePath(runId: string) {
    return this.#pathOf(runId);
  }

  #emit(runId: string, entries: ChatEntry[], start: number | null) {
    if (entries.length === 0) return;
    for (const listener of this.#listeners) listener(runId, entries, start);
  }

  #keep(runId: string, file: RunFile) {
    this.#files.delete(runId);
    this.#files.set(runId, file);
    for (const cached of this.#files.keys()) {
      if (this.#files.size <= CACHED_RUNS) return;
      if (!this.#followers.has(cached)) this.#files.delete(cached);
    }
  }

  #sync(runId: string, size: number) {
    const cached = this.#files.get(runId);
    const file = cached && cached.offset <= size ? cached : { offset: 0, entries: [] };
    this.#keep(runId, file);
    const start = file.entries.length;
    if (size <= file.offset) return { file, added: [], start };
    const appended = readRange(this.#pathOf(runId), file.offset, size);
    const complete = appended.lastIndexOf(0x0a) + 1;
    const added = parseLines(appended.subarray(0, complete), file.offset);
    file.offset += complete;
    file.entries.push(...added);
    return { file, added, start };
  }

  #readAll(runId: string) {
    const size = readSize(this.#pathOf(runId));
    if (size < 0) return [];
    const { file } = this.#sync(runId, size);
    if (size <= file.offset) return file.entries;
    return [...file.entries, ...parseLines(readRange(this.#pathOf(runId), file.offset, size), file.offset)];
  }

  listEntries(runId: string): ChatEntry[] {
    return this.#readAll(runId).slice();
  }

  readEntries(runId: string, from: number): TranscriptRead {
    const all = this.#readAll(runId);
    const start = from <= all.length ? from : 0;
    return { entries: all.slice(start), start };
  }

  record(runId: string, event: ChatEvent) {
    const entry = { ...event, v: CHAT_PROTOCOL_VERSION, id: Bun.randomUUIDv7(), at: Date.now() } as ChatEntry;
    const path = this.#pathOf(runId);
    const size = this.#checked.has(runId) ? 0 : readSize(path);
    const torn = size > 0 && readRange(path, size - 1, size)[0] !== 0x0a;
    this.#checked.add(runId);
    appendFileSync(path, `${torn ? '\n' : ''}${JSON.stringify(entry)}\n`);
    if (!this.#files.has(runId)) {
      this.#emit(runId, [entry], null);
      return;
    }
    this.#readAppended(runId);
  }

  follow(runId: string) {
    const existing = this.#followers.get(runId);
    if (existing) existing.count += 1;
    else this.#startFollowing(runId);
    return () => this.#unfollow(runId);
  }

  #startFollowing(runId: string) {
    const path = this.#pathOf(runId);
    const follower: Follower = { count: 1, watcher: null, stopChecking: null };
    this.#followers.set(runId, follower);
    const size = readSize(path);
    this.#sync(runId, Math.max(size, 0));
    if (size < 0) return;
    const check = () => this.#readAppended(runId);
    follower.stopChecking = this.#repeat(check);
    follower.watcher = this.#watch(path, check);
    follower.watcher.on('error', (error) => {
      log.warn('[Transcripts] Watching a transcript failed; the check every second carries on', {
        runId,
        error: describeError(error),
      });
      follower.watcher?.close();
      follower.watcher = null;
    });
  }

  #readAppended(runId: string) {
    const size = readSize(this.#pathOf(runId));
    if (size < 0) return;
    const synced = this.#sync(runId, size);
    this.#emit(runId, synced.added, synced.start);
  }

  #unfollow(runId: string) {
    const follower = this.#followers.get(runId);
    if (!follower) return;
    follower.count -= 1;
    if (follower.count > 0) return;
    follower.watcher?.close();
    follower.stopChecking?.();
    this.#followers.delete(runId);
  }

  subscribe(listener: TranscriptListener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
