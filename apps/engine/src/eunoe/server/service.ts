import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Body, claudeCodeSessionId, createForwarder, foldThread, rewriteAsync } from '@chroxify/eunoe';
import { Cause, DateTime, Effect, Exit, Ref, Scope } from 'effect';
import type { EunoeStatus, EunoeWatcher } from '../../agents/providers/claude/index.ts';
import { describeError } from '../../log/redact.ts';
import { isStuck, resolveCompactionNotice } from '../notices.ts';
import {
  CHARS_PER_TOKEN,
  ForwarderUnavailable,
  IDLE_TIMEOUT_S,
  LOOPBACK,
  REQUEST_LOG,
  type RequestEntry,
  STOPPING,
} from '../schema.ts';
import {
  EunoeRewriteFailed,
  type EunoeServerDefinition,
  type EunoeServerHandle,
  type FoldToken,
  FoldUnavailable,
  type Forwarder,
  RequestLogUnwritable,
} from './schema.ts';

export const makeEunoeServer = Effect.fn('EunoeServer.make')(function* (definition: EunoeServerDefinition) {
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const runSync = Effect.runSyncWith(context);
  const scope = yield* Scope.make();
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
    if (pending.warm && estimate < definition.foldFloor) {
      yield* dropFold(threadId);
      yield* Effect.logInfo('[Eunoe] Too little before this turn to be worth a fold').pipe(
        Effect.annotateLogs({ threadId, estimate: Math.round(estimate) })
      );
      return false;
    }
    const folded = yield* Effect.try({
      try: () => foldThread({ store: definition.store, threadId, messages: body.messages }, { at: 'latest' }),
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
    const window = yield* rewrite(() => definition.window(body.model, request.headers, definition.upstream));
    const folded = threadId !== null && mayCompact && (yield* foldPending(threadId, body));
    const result = yield* rewrite(() =>
      rewriteAsync({
        body,
        threadId,
        config: definition.config,
        store: definition.store,
        window,
        mayCompact,
      })
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
    const line = JSON.stringify({ ts, mode: definition.config.mode, ...entry });
    yield* Effect.try({
      try: () => appendFileSync(join(definition.dir, REQUEST_LOG), `${line}\n`),
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
      mkdirSync(definition.dir, { recursive: true });
      const forward = createForwarder({
        store: definition.store,
        upstream: definition.upstream,
        prepare: (request, body, mayCompact) => runPromise(prepare(request, body, mayCompact)),
        record: (entry) => runSync(record(entry)),
      });
      return Bun.serve({
        hostname: LOOPBACK,
        port: definition.port,
        idleTimeout: IDLE_TIMEOUT_S,
        fetch: forward,
      });
    },
    catch: (error) => new ForwarderUnavailable({ message: describeError(error) }),
  });

  const open = Effect.acquireRelease(serve, (started) => Effect.promise(() => started.stop(true))).pipe(
    Effect.tap((started) =>
      Effect.logInfo('[Eunoe] Serving the forwarder').pipe(
        Effect.annotateLogs({ port: started.port, dir: definition.dir })
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
      yield* Effect.logWarning('[Eunoe] The forwarder is not available; runs talk to Claude directly').pipe(
        Effect.annotateLogs({ reason })
      );
      const unavailable: EunoeStatus = { ok: false, reason };
      return unavailable;
    }
    yield* Ref.set(server, started.value);
    const ready: EunoeStatus = {
      ok: true,
      url: `http://${LOOPBACK}:${started.value.port}`,
      dir: definition.dir,
    };
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

  const handle: EunoeServerHandle = {
    ensure,
    watch,
    fold,
    stop: Effect.gen(function* () {
      yield* Ref.set(stopped, true);
      yield* Ref.set(server, null);
      yield* Scope.close(scope, Exit.void);
    }),
  };
  return handle;
});
