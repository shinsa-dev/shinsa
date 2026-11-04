import { join } from 'node:path';
import type { ThreadState, ThreadStore } from '@chroxify/eunoe';
import { Effect, Option } from 'effect';
import { JsonFile } from '../files/service.ts';
import { StoredThread } from './schema.ts';

export const makeFileStore = Effect.fn('EunoeThreads.make')(function* (dir: string) {
  const file = yield* JsonFile;
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  const resolveThreadFile = (key: string) => join(dir, `${key.replace(/[^\w-]/g, '_')}.json`);
  const store: ThreadStore = {
    read: (key) =>
      runSync(
        file.read(resolveThreadFile(key), StoredThread).pipe(
          Effect.map((stored): ThreadState => Option.getOrElse(stored, () => ({}))),
          Effect.catchTag('JsonFileUnreadable', () => Effect.succeed<ThreadState>({}))
        )
      ),
    save: (key, state) => runSync(file.write(resolveThreadFile(key), state)),
  };
  return store;
});
