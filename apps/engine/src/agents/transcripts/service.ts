import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAT_PROTOCOL_VERSION, type ChatEntry, type ChatEvent } from '@shinsa/core';
import { Clock, Context, Effect, FiberMap, Layer } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { NEWLINE } from '../../files/schema.ts';
import { describeError } from '../../log/index.ts';
import { readRange, readSize } from './file.ts';
import { parseLines } from './lines.ts';
import {
  CACHED_RUNS,
  type Follower,
  type RunFile,
  TRANSCRIPT_CHECK,
  type TranscriptListener,
  type TranscriptRead,
  TranscriptWatch,
} from './schema.ts';

export class Transcripts extends Context.Service<
  Transcripts,
  {
    resolvePath(runId: string): string;
    listEntries(runId: string): Effect.Effect<ChatEntry[]>;
    readEntries(runId: string, from: number): Effect.Effect<TranscriptRead>;
    record(runId: string, event: ChatEvent): Effect.Effect<void>;
    follow(runId: string): Effect.Effect<Effect.Effect<void>>;
    subscribe(listener: TranscriptListener): Effect.Effect<Effect.Effect<void>>;
  }
>()('shinsa/engine/agents/transcripts/Transcripts') {
  static readonly layer = Layer.effect(
    Transcripts,
    Effect.gen(function* () {
      const { transcriptsDir } = yield* EngineConfig;
      const watchFile = yield* TranscriptWatch;
      const checks = yield* FiberMap.make<string>();
      const context = yield* Effect.context<never>();
      const listeners = new Set<TranscriptListener>();
      const followers = new Map<string, Follower>();
      const files = new Map<string, RunFile>();
      const checked = new Set<string>();

      const resolvePath = (runId: string) =>
        join(transcriptsDir, `${runId.replace(/[^a-zA-Z0-9-]/g, '')}.jsonl`);

      const emit = (runId: string, entries: ChatEntry[], start: number | null) => {
        if (entries.length === 0) return;
        for (const listener of listeners) listener(runId, entries, start);
      };

      const keep = (runId: string, file: RunFile) => {
        files.delete(runId);
        files.set(runId, file);
        for (const cached of files.keys()) {
          if (files.size <= CACHED_RUNS) return;
          if (!followers.has(cached)) files.delete(cached);
        }
      };

      const syncFile = (runId: string, size: number) => {
        const cached = files.get(runId);
        const file = cached && cached.offset <= size ? cached : { offset: 0, entries: [] };
        keep(runId, file);
        const start = file.entries.length;
        if (size <= file.offset) return { file, added: [], start };
        const appended = readRange(resolvePath(runId), file.offset, size);
        const complete = appended.lastIndexOf(NEWLINE) + 1;
        const added = parseLines(appended.subarray(0, complete), file.offset);
        file.offset += complete;
        file.entries.push(...added);
        return { file, added, start };
      };

      const readAll = (runId: string) => {
        const path = resolvePath(runId);
        const size = readSize(path);
        if (size < 0) return [];
        const { file } = syncFile(runId, size);
        if (size <= file.offset) return file.entries;
        return [...file.entries, ...parseLines(readRange(path, file.offset, size), file.offset)];
      };

      const readAppended = (runId: string) => {
        const size = readSize(resolvePath(runId));
        if (size < 0) return;
        const synced = syncFile(runId, size);
        emit(runId, synced.added, synced.start);
      };

      const listEntries = (runId: string) => Effect.sync(() => readAll(runId).slice());

      const readEntries = (runId: string, from: number) =>
        Effect.sync(() => {
          const all = readAll(runId);
          const start = from <= all.length ? from : 0;
          return { entries: all.slice(start), start };
        });

      const record = Effect.fn('Transcripts.record')(function* (runId: string, event: ChatEvent) {
        const at = yield* Clock.currentTimeMillis;
        const entry = { ...event, v: CHAT_PROTOCOL_VERSION, id: Bun.randomUUIDv7(), at } as ChatEntry;
        const path = resolvePath(runId);
        const size = checked.has(runId) ? 0 : readSize(path);
        const torn = size > 0 && readRange(path, size - 1, size)[0] !== NEWLINE;
        checked.add(runId);
        yield* Effect.sync(() => appendFileSync(path, `${torn ? '\n' : ''}${JSON.stringify(entry)}\n`));
        if (!files.has(runId)) emit(runId, [entry], null);
        else readAppended(runId);
      });

      const unfollow = Effect.fn('Transcripts.unfollow')(function* (runId: string) {
        const follower = followers.get(runId);
        if (!follower) return;
        follower.count -= 1;
        if (follower.count > 0) return;
        follower.watcher?.close();
        followers.delete(runId);
        yield* FiberMap.remove(checks, runId);
      });

      const watch = (runId: string, path: string, follower: Follower) => {
        const watcher = watchFile(path, () => readAppended(runId));
        watcher.on('error', (error) => {
          Effect.runForkWith(context)(
            Effect.logWarning(
              '[Transcripts] Watching a transcript failed; the check every second carries on'
            ).pipe(Effect.annotateLogs({ runId, error: describeError(error) }))
          );
          watcher.close();
          follower.watcher = null;
        });
        return watcher;
      };

      const startFollowing = Effect.fn('Transcripts.startFollowing')(function* (runId: string) {
        const path = resolvePath(runId);
        const follower: Follower = { count: 1, watcher: null };
        followers.set(runId, follower);
        const size = readSize(path);
        syncFile(runId, Math.max(size, 0));
        if (size < 0) return;
        yield* FiberMap.run(
          checks,
          runId,
          Effect.repeat(
            Effect.sync(() => readAppended(runId)),
            TRANSCRIPT_CHECK
          ),
          { startImmediately: true }
        );
        follower.watcher = watch(runId, path, follower);
      });

      const follow = Effect.fn('Transcripts.follow')(function* (runId: string) {
        const existing = followers.get(runId);
        if (existing) existing.count += 1;
        else yield* startFollowing(runId);
        return unfollow(runId);
      });

      const subscribe = (listener: TranscriptListener) =>
        Effect.sync(() => {
          listeners.add(listener);
          return Effect.sync(() => {
            listeners.delete(listener);
          });
        });

      return Transcripts.of({ resolvePath, listEntries, readEntries, record, follow, subscribe });
    })
  );
}
