import { Duration, Effect, Scope } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import {
  BATCH_IDLE,
  BATCH_TIMEOUT,
  type BatchChild,
  type CatFileHandle,
  type CatFileOptions,
} from './blobs/schema.ts';
import { makeCatFile } from './blobs/service.ts';
import { READ_ENV } from './schema.ts';
import type { ObjectInfo } from './tree/schema.ts';

export { isBatchName, parseInfoLine } from './tree/entries.ts';
export type { ObjectInfo } from './tree/schema.ts';
export type { BatchChild, CatFileOptions } from './blobs/schema.ts';

function spawnBatch(repoPath: string): BatchChild {
  return Bun.spawn(['git', 'cat-file', '--batch-command'], {
    cwd: repoPath,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
    detached: true,
    env: { ...Bun.env, ...READ_ENV },
  });
}

export class CatFile {
  readonly handle: CatFileHandle;

  constructor(repoPath: string, options: CatFileOptions = {}) {
    this.handle = edgeRuntime.runSync(
      makeCatFile({
        repoPath,
        idle: options.idleMs === undefined ? BATCH_IDLE : Duration.millis(options.idleMs),
        timeout: options.timeoutMs === undefined ? BATCH_TIMEOUT : Duration.millis(options.timeoutMs),
        spawn: options.spawn ?? spawnBatch,
      }).pipe(Scope.provide(edgeRuntime.runSync(Scope.make())))
    );
  }

  get running() {
    return edgeRuntime.runSync(this.handle.running);
  }

  info(name: string): Promise<ObjectInfo | null> {
    return edgeRuntime.runPromise(this.handle.info(name));
  }

  contents(object: string): Promise<Uint8Array> {
    return edgeRuntime.runPromise(this.handle.contents(object));
  }

  close() {
    edgeRuntime.runSync(this.handle.close);
  }
}

export class CatFilePool {
  readonly #readers = new Map<string, CatFile>();
  readonly #idleMs: number | undefined;

  constructor(idleMs?: number) {
    this.#idleMs = idleMs;
  }

  select(repoPath: string) {
    const known = this.#readers.get(repoPath);
    if (known) return known;
    const reader = new CatFile(repoPath, { idleMs: this.#idleMs });
    this.#readers.set(repoPath, reader);
    return reader;
  }

  close() {
    for (const reader of this.#readers.values()) reader.close();
    this.#readers.clear();
  }
}
