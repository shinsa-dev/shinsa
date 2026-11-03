import { CODE_LIMITS } from '@shinsa/core';
import { Duration } from 'effect';
import type { Deferred, Effect, Fiber } from 'effect';
import type { ObjectInfo, ObjectReaderStopped } from '../tree/schema.ts';

export interface BatchChild {
  pid: number;
  stdin: { write: (text: string) => unknown; flush: () => unknown };
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

export interface CatFileOptions {
  idleMs?: number;
  timeoutMs?: number;
  spawn?: (repoPath: string) => BatchChild;
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

export interface CatFileDefinition {
  readonly repoPath: string;
  readonly idle: Duration.Duration;
  readonly timeout: Duration.Duration;
  readonly spawn: (repoPath: string) => BatchChild;
}

export interface CatFileHandle {
  readonly running: Effect.Effect<boolean>;
  readonly info: (name: string) => Effect.Effect<ObjectInfo | null, ObjectReaderStopped>;
  readonly contents: (object: string) => Effect.Effect<Uint8Array, ObjectReaderStopped>;
  readonly close: Effect.Effect<void>;
}

export const BATCH_IDLE = Duration.seconds(30);

export const BATCH_TIMEOUT = Duration.millis(CODE_LIMITS.readMs);

export const READER_STOPPED = 'The object reader stopped.';
