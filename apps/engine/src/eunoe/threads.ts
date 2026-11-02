import { join } from 'node:path';
import type { ThreadState, ThreadStore } from '@chroxify/eunoe';
import { Effect, Option } from 'effect';
import { JsonFile } from '../files/service.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { StoredThread } from './schema.ts';

function resolveThreadFile(dir: string, key: string) {
  return join(dir, `${key.replace(/[^\w-]/g, '_')}.json`);
}

export function createFileStore(dir: string): ThreadStore {
  return {
    read: (key) =>
      edgeRuntime.runSync(
        JsonFile.use((file) => file.read(resolveThreadFile(dir, key), StoredThread)).pipe(
          Effect.map((stored): ThreadState => Option.getOrElse(stored, () => ({}))),
          Effect.catchTag('JsonFileUnreadable', () => Effect.succeed<ThreadState>({}))
        )
      ),
    save: (key, state) =>
      edgeRuntime.runSync(JsonFile.use((file) => file.write(resolveThreadFile(dir, key), state))),
  };
}
