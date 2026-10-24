import {
  appendFileSync,
  closeSync,
  existsSync,
  type FSWatcher,
  openSync,
  watchFile as pollFile,
  readFileSync,
  readSync,
  statSync,
  unwatchFile,
  watch,
} from 'node:fs';
import { join } from 'node:path';
import { CHAT_PROTOCOL_VERSION, type ChatEntry, type ChatEvent, isChatEntry } from '@shinsa/core';
import { describeError, log } from '../../log/index.ts';

type TranscriptListener = (runId: string, entries: ChatEntry[]) => void;

interface Follower {
  count: number;
  offset: number;
  watcher: FSWatcher | null;
  poll: (() => void) | null;
}

const POLL_MS = 1_000;

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

function parseLines(text: string, offset = 0): ChatEntry[] {
  return text.split('\n').flatMap((line, index) => {
    if (line.trim().length === 0) return [];
    const parsed = parseLine(line);
    return [isChatEntry(parsed) ? parsed : createUnreadableEntry(`unreadable-${offset}-${index}`)];
  });
}

function endsMidLine(path: string) {
  if (!existsSync(path)) return false;
  const size = statSync(path).size;
  if (size === 0) return false;
  const last = Buffer.alloc(1);
  const handle = openSync(path, 'r');
  try {
    readSync(handle, last, 0, 1, size - 1);
  } finally {
    closeSync(handle);
  }
  return last[0] !== 0x0a;
}

type FileWatcher = (path: string, onChange: () => void) => FSWatcher;

function watchFile(path: string, onChange: () => void) {
  return watch(path, onChange);
}

export class Transcripts {
  readonly #dir: string;
  readonly #watch: FileWatcher;
  readonly #listeners = new Set<TranscriptListener>();
  readonly #followers = new Map<string, Follower>();
  readonly #checked = new Set<string>();
  readonly #pollMs: number;

  constructor(dir: string, watchChanges: FileWatcher = watchFile, pollMs = POLL_MS) {
    this.#dir = dir;
    this.#watch = watchChanges;
    this.#pollMs = pollMs;
  }

  #pathOf(runId: string) {
    return join(this.#dir, `${runId.replace(/[^a-zA-Z0-9-]/g, '')}.jsonl`);
  }

  resolvePath(runId: string) {
    return this.#pathOf(runId);
  }

  #emit(runId: string, entries: ChatEntry[]) {
    if (entries.length === 0) return;
    for (const listener of this.#listeners) listener(runId, entries);
  }

  listEntries(runId: string): ChatEntry[] {
    const path = this.#pathOf(runId);
    if (!existsSync(path)) return [];
    return parseLines(readFileSync(path, 'utf8'));
  }

  record(runId: string, event: ChatEvent) {
    const entry = { ...event, v: CHAT_PROTOCOL_VERSION, id: Bun.randomUUIDv7(), at: Date.now() } as ChatEntry;
    const path = this.#pathOf(runId);
    const torn = !this.#checked.has(runId) && endsMidLine(path);
    this.#checked.add(runId);
    const line = `${torn ? '\n' : ''}${JSON.stringify(entry)}\n`;
    appendFileSync(path, line);
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
      poll: null,
    };
    this.#followers.set(runId, follower);
    if (!existsSync(path)) return;
    follower.poll = () => this.#readAppended(runId, follower);
    pollFile(path, { interval: this.#pollMs }, follower.poll);
    follower.watcher = this.#watch(path, () => this.#readAppended(runId, follower));
    follower.watcher.on('error', (error) => {
      log.warn('[Transcripts] Watching a transcript failed; the check every second carries on', {
        runId,
        error: describeError(error),
      });
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
    const start = follower.offset;
    follower.offset += complete;
    this.#emit(runId, parseLines(appended.subarray(0, complete).toString('utf8'), start));
  }

  #unfollow(runId: string) {
    const follower = this.#followers.get(runId);
    if (!follower) return;
    follower.count -= 1;
    if (follower.count > 0) return;
    follower.watcher?.close();
    if (follower.poll) unwatchFile(this.#pathOf(runId), follower.poll);
    this.#followers.delete(runId);
  }

  subscribe(listener: TranscriptListener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
