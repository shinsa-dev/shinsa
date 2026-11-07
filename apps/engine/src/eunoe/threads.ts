import { join } from 'node:path';
import type { ThreadState, ThreadStore } from '@chroxify/eunoe';
import { Effect, Schema } from 'effect';
import { JSON_FILE_MODE, JSON_INDENT, JsonFileUnreadable, JsonFileWriteFailed } from '../files/schema.ts';
import { describeError } from '../log/redact.ts';
import { readFileText, replaceFileText } from './files.ts';
import { StoredThread } from './schema.ts';

export const makeFileStore = Effect.fn('EunoeThreads.make')(function* (dir: string) {
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  const decodeThread = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredThread));
  const resolveThreadFile = (key: string) => join(dir, `${key.replace(/[^\w-]/g, '_')}.json`);
  const readThread = Effect.fn('EunoeThreads.read')(
    function* (path: string) {
      const text = yield* Effect.try({
        try: () => readFileText(path),
        catch: (error) => new JsonFileUnreadable({ path, reason: describeError(error) }),
      });
      if (text === null) return {};
      const thread: ThreadState = yield* decodeThread(text).pipe(
        Effect.mapError((error) => new JsonFileUnreadable({ path, reason: error.message }))
      );
      return thread;
    },
    Effect.catchTag('JsonFileUnreadable', () => Effect.succeed<ThreadState>({}))
  );
  const saveThread = (path: string, state: ThreadState) =>
    Effect.try({
      try: () => replaceFileText(path, `${JSON.stringify(state, null, JSON_INDENT)}\n`, JSON_FILE_MODE),
      catch: (error) => new JsonFileWriteFailed({ path, message: describeError(error) }),
    });
  const store: ThreadStore = {
    read: (key) => runSync(readThread(resolveThreadFile(key))),
    save: (key, state) => runSync(saveThread(resolveThreadFile(key), state)),
  };
  return store;
});
