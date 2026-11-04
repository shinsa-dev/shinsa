import { CODE_LIMITS } from '@shinsa/core';
import { Context, Duration } from 'effect';
import type { Deferred, Effect, Fiber } from 'effect';
import type { BatchReader, ObjectInfo, ObjectReaderStopped } from '../tree/schema.ts';

export interface BatchChild {
  pid: number;
  stdin: { write: (text: string) => unknown; flush: () => unknown };
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

export type BatchReply = { kind: 'info'; info: ObjectInfo | null } | { kind: 'contents'; bytes: Uint8Array };

export interface BatchWaiting {
  readonly kind: BatchReply['kind'];
  readonly reply: Deferred.Deferred<BatchReply, ObjectReaderStopped>;
}

export interface BatchSession {
  readonly child: BatchChild;
  readonly buffer: Uint8Array;
  readonly waiting: readonly BatchWaiting[];
  readonly fibers: readonly Fiber.Fiber<unknown, unknown>[];
}

export interface CatFile extends BatchReader {
  readonly running: Effect.Effect<boolean>;
  readonly close: Effect.Effect<void>;
}

export interface CatFileSettingsShape {
  readonly idle: Duration.Duration;
  readonly timeout: Duration.Duration;
  readonly spawn: ((repoPath: string) => BatchChild) | null;
}

export const BATCH_IDLE = Duration.seconds(30);

export const BATCH_TIMEOUT = Duration.millis(CODE_LIMITS.readMs);

export const CatFileSettings = Context.Reference<CatFileSettingsShape>(
  'shinsa/engine/git/blobs/CatFileSettings',
  {
    defaultValue: (): CatFileSettingsShape => ({ idle: BATCH_IDLE, timeout: BATCH_TIMEOUT, spawn: null }),
  }
);

export const READER_STOPPED = 'The object reader stopped.';
