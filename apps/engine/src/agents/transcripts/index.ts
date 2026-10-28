import {
  appendFileSync,
  closeSync,
  existsSync,
  type FSWatcher,
  openSync,
  readSync,
  statSync,
  watch,
} from 'node:fs';
import { join } from 'node:path';
import { CHAT_PROTOCOL_VERSION, type ChatEntry, type ChatEvent, isChatEntry } from '@shinsa/core';
import { describeError, log } from '../../log/index.ts';

type TranscriptListener = (runId: string, entries: ChatEntry[], start: number | null) => void;

interface Follower {
  count: number;
  watcher: FSWatcher | null;
  stopChecking: (() => void) | null;
}

interface RunFile {
  offset: number;
  entries: ChatEntry[];
}

export interface TranscriptRead {
  entries: ChatEntry[];
  start: number;
}

const CHECK_MS = 1_000;

const CACHED_RUNS = 8;

export const UNREADABLE_LINE = 'Shinsa could not read one line of this transcript.';

function createUnreadableEntry(id: string): ChatEntry {
  return { v: CHAT_PROTOCOL_VERSION, id, at: 0, type: 'error', text: UNREADABLE_LINE };
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

function parseLines(bytes: Buffer, offset: number): ChatEntry[] {
  const entries: ChatEntry[] = [];
  let start = 0;
  while (start < bytes.length) {
    const newline = bytes.indexOf(0x0a, start);
    const end = newline < 0 ? bytes.length : newline;
    const line = bytes.toString('utf8', start, end);
    if (line.trim().length > 0) {
      const parsed = parseLine(line);
      entries.push(isChatEntry(parsed) ? parsed : createUnreadableEntry(`unreadable-${offset + start}`));
    }
    start = end + 1;
  }
  return entries;
}

function readRange(path: string, from: number, to: number) {
  const bytes = Buffer.alloc(to - from);
  const handle = openSync(path, 'r');
  try {
    readSync(handle, bytes, 0, bytes.length, from);
  } finally {
    closeSync(handle);
  }
  return bytes;
}

function readSize(path: string) {
  return existsSync(path) ? statSync(path).size : -1;
}

type FileWatcher = (path: string, onChange: () => void) => FSWatcher;

type CheckRepeater = (check: () => void) => () => void;

function watchFile(path: string, onChange: () => void) {
  return watch(path, onChange);
}

function repeatEverySecond(check: () => void) {
  const timer = setInterval(check, CHECK_MS);
  timer.unref();
  return () => clearInterval(timer);
}

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
