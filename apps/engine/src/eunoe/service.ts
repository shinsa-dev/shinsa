import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Body, claudeCodeSessionId, createForwarder, foldThread, rewriteAsync } from '@chroxify/eunoe';
import { Cause, Context, DateTime, Effect, Exit, Layer, Ref, Scope } from 'effect';
import type { EunoeStatus, EunoeWatcher } from '../agents/providers/claude/route/schema.ts';
import { EngineConfig } from '../config/service.ts';
import { describeError } from '../log/redact.ts';
import { isStuck, resolveCompactionNotice } from './notices.ts';
import {
  CHARS_PER_TOKEN,
  EUNOE_DIR,
  EunoeRewriteFailed,
  EunoeSettings,
  type FoldToken,
  FoldUnavailable,
  type Forwarder,
  ForwarderUnavailable,
  IDLE_TIMEOUT_S,
  LOOPBACK,
  REQUEST_LOG,
  type RequestEntry,
  RequestLogUnwritable,
  STOPPING,
  THREADS_DIR,
} from './schema.ts';
import { makeFileStore } from './threads.ts';

export class EunoeServer extends Context.Service<
  EunoeServer,
  {
    readonly dir: string;
    readonly ensure: Effect.Effect<EunoeStatus>;
    watch(sessionId: string, watcher: EunoeWatcher): Effect.Effect<Effect.Effect<void>>;
    fold(sessionId: string, warm: boolean): Effect.Effect<Effect.Effect<void>>;
    readonly stop: Effect.Effect<void>;
  }
>()('shinsa/engine/eunoe/EunoeServer') {
  static readonly layer = Layer.effect(
    EunoeServer,
    Effect.gen(function* () {
      const config = yield* EngineConfig;
      const settings = yield* EunoeSettings;
      const dir = join(config.dataDir, EUNOE_DIR);
      const store = yield* makeFileStore(join(dir, THREADS_DIR));
      const context = yield* Effect.context<never>();
      const runPromise = Effect.runPromiseWith(context);
      const runSync = Effect.runSyncWith(context);
      const scope = yield* Scope.fork(yield* Effect.scope);
      const watchers = yield* Ref.make<ReadonlyMap<string, ReadonlySet<EunoeWatcher>>>(new Map());
      const folds = yield* Ref.make<ReadonlyMap<string, FoldToken>>(new Map());
      const mainThreads = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
      const server = yield* Ref.make<Forwarder | null>(null);
      const stopped = yield* Ref.make(false);

      const hasTools = (body: Body) => Array.isArray(body.tools) && body.tools.length > 0;

      const dropFold = (threadId: string) =>
        Ref.update(folds, (current) => {
          const next = new Map(current);
          next.delete(threadId);
          return next;
        });

      const foldPending = Effect.fn('EunoeServer.foldPending')(function* (threadId: string, body: Body) {
        const pending = (yield* Ref.get(folds)).get(threadId);
        if (!pending || !hasTools(body)) return false;
        const estimate = JSON.stringify(body.messages).length / CHARS_PER_TOKEN;
        if (pending.warm && estimate < settings.foldFloor) {
          yield* dropFold(threadId);
          yield* Effect.logInfo('[Eunoe] Too little before this turn to be worth a fold').pipe(
            Effect.annotateLogs({ threadId, estimate: Math.round(estimate) })
          );
          return false;
        }
        const folded = yield* Effect.try({
          try: () => foldThread({ store, threadId, messages: body.messages }, { at: 'latest' }),
          catch: (error) => new FoldUnavailable({ message: describeError(error) }),
        }).pipe(
          Effect.as(true),
          Effect.catch((failure) =>
            Effect.as(
              Effect.logInfo('[Eunoe] Nothing to fold before this turn yet').pipe(
                Effect.annotateLogs({ threadId, reason: failure.message })
              ),
              false
            )
          )
        );
        if (folded) yield* dropFold(threadId);
        return folded;
      });

      const rewrite = <A>(work: () => Promise<A>) =>
        Effect.tryPromise({
          try: work,
          catch: (error) => new EunoeRewriteFailed({ message: describeError(error) }),
        });

      const prepare = Effect.fn('EunoeServer.prepare')(function* (
        request: Request,
        body: Body,
        mayCompact: boolean
      ) {
        const threadId = claudeCodeSessionId(request.headers, body);
        const window = yield* rewrite(() => settings.window(body.model, request.headers, settings.upstream));
        const folded = threadId !== null && mayCompact && (yield* foldPending(threadId, body));
        const result = yield* rewrite(() =>
          rewriteAsync({ body, threadId, config: settings.config, store, window, mayCompact })
        );
        const threadKey = result.threadKey;
        if (threadId && threadKey && hasTools(body))
          yield* Ref.update(mainThreads, (current) =>
            current.has(threadId) ? current : new Map(current).set(threadId, threadKey)
          );
        if (!folded) return result;
        const actions = [...(result.note.actions ?? []), 'fold'];
        return { ...result, note: { ...result.note, compacted: true, actions } };
      });

      const record = Effect.fn('EunoeServer.record')(function* (entry: RequestEntry) {
        const ts = DateTime.formatIso(yield* DateTime.now);
        const line = JSON.stringify({ ts, mode: settings.config.mode, ...entry });
        yield* Effect.try({
          try: () => appendFileSync(join(dir, REQUEST_LOG), `${line}\n`),
          catch: (error) => new RequestLogUnwritable({ message: describeError(error) }),
        }).pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[Eunoe] Could not write the request log').pipe(
              Effect.annotateLogs({ error: failure.message })
            )
          )
        );
        const thread = entry.thread;
        if (typeof thread !== 'string') return;
        const notice = resolveCompactionNotice(entry);
        const stuck = isStuck(entry);
        if (!notice && !stuck) return;
        const threads = yield* Ref.get(mainThreads);
        const listening = yield* Ref.get(watchers);
        yield* Effect.sync(() => {
          for (const [sessionId, each] of listening) {
            if (threads.get(sessionId) !== thread) continue;
            for (const watcher of each) {
              if (notice) watcher.notice(notice);
              if (stuck) watcher.stuck();
            }
          }
        });
      });

      const serve = Effect.try({
        try: () => {
          mkdirSync(dir, { recursive: true });
          const forward = createForwarder({
            store,
            upstream: settings.upstream,
            prepare: (request, body, mayCompact) => runPromise(prepare(request, body, mayCompact)),
            record: (entry) => runSync(record(entry)),
          });
          return Bun.serve({
            hostname: LOOPBACK,
            port: settings.port,
            idleTimeout: IDLE_TIMEOUT_S,
            fetch: forward,
          });
        },
        catch: (error) => new ForwarderUnavailable({ message: describeError(error) }),
      });

      const open = Effect.acquireRelease(serve, (started) => Effect.promise(() => started.stop(true))).pipe(
        Effect.tap((started) =>
          Effect.logInfo('[Eunoe] Serving the forwarder').pipe(
            Effect.annotateLogs({ port: started.port, dir })
          )
        ),
        Scope.provide(scope)
      );

      const ensure = Effect.gen(function* () {
        if (yield* Ref.get(stopped)) {
          const stopping: EunoeStatus = { ok: false, reason: STOPPING };
          return stopping;
        }
        const known = yield* Ref.get(server);
        const started = known ? Exit.succeed(known) : yield* Effect.exit(open);
        if (Exit.isFailure(started)) {
          const reason = `Eunoe could not start: ${describeError(Cause.squash(started.cause))}`;
          yield* Effect.logWarning(
            '[Eunoe] The forwarder is not available; runs talk to Claude directly'
          ).pipe(Effect.annotateLogs({ reason }));
          const unavailable: EunoeStatus = { ok: false, reason };
          return unavailable;
        }
        yield* Ref.set(server, started.value);
        const ready: EunoeStatus = { ok: true, url: `http://${LOOPBACK}:${started.value.port}`, dir };
        return ready;
      });

      const watch = Effect.fn('EunoeServer.watch')(function* (sessionId: string, watcher: EunoeWatcher) {
        yield* Ref.update(watchers, (current) =>
          new Map(current).set(sessionId, new Set(current.get(sessionId) ?? []).add(watcher))
        );
        return Ref.update(watchers, (current) => {
          const left = [...(current.get(sessionId) ?? [])].filter((each) => each !== watcher);
          const next = new Map(current);
          next.delete(sessionId);
          return left.length === 0 ? next : next.set(sessionId, new Set(left));
        });
      });

      const fold = Effect.fn('EunoeServer.fold')(function* (sessionId: string, warm: boolean) {
        const token: FoldToken = { warm };
        yield* Ref.update(folds, (current) => new Map(current).set(sessionId, token));
        return Ref.update(folds, (current) => {
          if (current.get(sessionId) !== token) return current;
          const next = new Map(current);
          next.delete(sessionId);
          return next;
        });
      });

      const stop = Effect.gen(function* () {
        if (yield* Ref.getAndSet(stopped, true)) return;
        yield* Ref.set(server, null);
        yield* Scope.close(scope, Exit.void);
        yield* Effect.logInfo('[Eunoe] Stopped the forwarder');
      });

      yield* Effect.addFinalizer(() => stop);

      return EunoeServer.of({ dir, ensure, watch, fold, stop });
    })
  );
}
