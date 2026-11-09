import { Context, Deferred, Effect, Fiber, FiberHandle, Layer, Ref, Scope, Semaphore, Stream } from 'effect';
import { NEWLINE } from '../../files/schema.ts';
import { describeError } from '../../log/redact.ts';
import { stopProcessGroup } from '../../shell/processes.ts';
import { parseInfoLine } from '../tree/entries.ts';
import { ObjectReaderStopped } from '../tree/schema.ts';
import {
  type BatchChild,
  type BatchReply,
  type BatchSession,
  type BatchWaiting,
  type CatFile,
  CatFileSettings,
  READER_STOPPED,
} from './schema.ts';
import { spawnCatFile } from './spawn.ts';

export class CatFiles extends Context.Service<
  CatFiles,
  { select(repoPath: string): Effect.Effect<CatFile> }
>()('shinsa/engine/git/blobs/CatFiles') {
  static readonly layer = Layer.effect(
    CatFiles,
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const settings = yield* CatFileSettings;
      const readers = yield* Ref.make(new Map<string, CatFile>());
      const selecting = yield* Semaphore.make(1);

      const makeReader = Effect.fn('CatFiles.makeReader')(
        function* (repoPath: string) {
          const session = yield* Ref.make<BatchSession | null>(null);
          const idle = yield* FiberHandle.make<void>();
          const timer = yield* FiberHandle.make<void>();
          const lock = yield* Semaphore.make(1);
          const decoder = new TextDecoder();

          const joinBytes = (a: Uint8Array, b: Uint8Array) => {
            if (a.length === 0) return b;
            const joined = new Uint8Array(a.length + b.length);
            joined.set(a);
            joined.set(b, a.length);
            return joined;
          };

          const stop = Effect.gen(function* () {
            const current = yield* Ref.getAndSet(session, null);
            yield* FiberHandle.clear(idle);
            yield* FiberHandle.clear(timer);
            if (!current) return;
            yield* stopProcessGroup(current.child.pid);
            yield* Effect.forkIn(Fiber.interruptAll(current.fibers), scope);
            for (const waiting of current.waiting)
              yield* Deferred.fail(waiting.reply, new ObjectReaderStopped({ message: READER_STOPPED }));
          });

          const close = Semaphore.withPermit(lock, stop);

          const closeLater = Effect.asVoid(Effect.forkIn(close, scope));

          const closeChild = (child: BatchChild) =>
            Semaphore.withPermit(
              lock,
              Effect.gen(function* () {
                if ((yield* Ref.get(session))?.child === child) yield* stop;
              })
            );

          const takeReplies = (received: Uint8Array, queued: readonly BatchWaiting[]) => {
            let buffer = received;
            const waiting = [...queued];
            const settled: [BatchWaiting, BatchReply][] = [];
            for (let next = waiting[0]; next; next = waiting[0]) {
              const end = buffer.indexOf(NEWLINE);
              if (end < 0) break;
              const info = parseInfoLine(decoder.decode(buffer.subarray(0, end)));
              if (next.kind === 'info' || !info) {
                buffer = buffer.subarray(end + 1);
                settled.push([next, { kind: 'info', info }]);
                waiting.shift();
                continue;
              }
              const start = end + 1;
              if (buffer.length < start + info.size + 1) break;
              const bytes = buffer.slice(start, start + info.size);
              buffer = buffer.subarray(start + info.size + 1);
              settled.push([next, { kind: 'contents', bytes }]);
              waiting.shift();
            }
            return { buffer, waiting, settled };
          };

          const receive = (child: BatchChild, chunk: Uint8Array) =>
            Semaphore.withPermit(
              lock,
              Effect.gen(function* () {
                const current = yield* Ref.get(session);
                if (current?.child !== child) return;
                const { buffer, waiting, settled } = takeReplies(
                  joinBytes(current.buffer, chunk),
                  current.waiting
                );
                yield* Ref.set(session, { ...current, buffer, waiting });
                for (const [each, reply] of settled) yield* Deferred.succeed(each.reply, reply);
                if (settled.length === 0 || waiting.length > 0) return;
                yield* FiberHandle.clear(timer);
                yield* FiberHandle.run(idle, Effect.andThen(Effect.sleep(settings.idle), closeLater));
              })
            );

          const start = Effect.gen(function* () {
            const current = yield* Ref.get(session);
            if (current) return current;
            const child = yield* Effect.try({
              try: (): BatchChild => (settings.spawn ? settings.spawn(repoPath) : spawnCatFile(repoPath)),
              catch: (error) => new ObjectReaderStopped({ message: describeError(error) }),
            });
            const reader = yield* Effect.forkIn(
              Stream.fromReadableStream({ evaluate: () => child.stdout, onError: describeError }).pipe(
                Stream.runForEach((chunk) => receive(child, chunk)),
                Effect.ignore
              ),
              scope
            );
            const watcher = yield* Effect.forkIn(
              Effect.promise(() => child.exited).pipe(
                Effect.andThen(Effect.forkIn(closeChild(child), scope))
              ),
              scope
            );
            const started: BatchSession = {
              child,
              buffer: new Uint8Array(),
              waiting: [],
              fibers: [reader, watcher],
            };
            yield* Ref.set(session, started);
            return started;
          });

          const send = Effect.fn('CatFile.send')(function* (command: string, kind: BatchReply['kind']) {
            const reply = yield* Deferred.make<BatchReply, ObjectReaderStopped>();
            yield* Semaphore.withPermit(
              lock,
              Effect.gen(function* () {
                const current = yield* start;
                yield* Ref.set(session, { ...current, waiting: [...current.waiting, { kind, reply }] });
                yield* FiberHandle.clear(idle);
                yield* FiberHandle.run(timer, Effect.andThen(Effect.sleep(settings.timeout), closeLater), {
                  onlyIfMissing: true,
                });
                yield* Effect.sync(() => {
                  current.child.stdin.write(command);
                  current.child.stdin.flush();
                });
              })
            );
            return yield* Deferred.await(reply);
          });

          const reader: CatFile = {
            running: Effect.map(Ref.get(session), (current) => current !== null),
            info: (name) =>
              Effect.map(send(`info ${name}\n`, 'info'), (reply) =>
                reply.kind === 'info' ? reply.info : null
              ),
            contents: (object) =>
              Effect.map(send(`contents ${object}\n`, 'contents'), (reply) =>
                reply.kind === 'contents' ? reply.bytes : new Uint8Array()
              ),
            close,
          };
          return reader;
        },
        Effect.provideService(Scope.Scope, scope)
      );

      const select = Effect.fn('CatFiles.select')(function* (repoPath: string) {
        const known = (yield* Ref.get(readers)).get(repoPath);
        if (known) return known;
        const reader = yield* makeReader(repoPath);
        yield* Ref.update(readers, (current) => new Map(current).set(repoPath, reader));
        return reader;
      }, Semaphore.withPermit(selecting));

      yield* Effect.addFinalizer(() =>
        Effect.flatMap(Ref.getAndSet(readers, new Map<string, CatFile>()), (current) =>
          Effect.forEach([...current.values()], (reader) => reader.close, { discard: true })
        )
      );

      return CatFiles.of({ select });
    })
  );
}
