import { Deferred, Effect, Fiber, Option, Ref, Schema, Stream } from 'effect';
import { resolveBrowserEnv } from '../../../../extensions/definitions.ts';
import { describeError } from '../../../../log/index.ts';
import { stopProcessGroup } from '../../../../shell/processes.ts';
import { readRecord } from '../params.ts';
import {
  CLIENT_INFO,
  CLOSED,
  type CodexClientOptions,
  type CodexConnection,
  type CodexHandlers,
  CodexMessage,
  type CodexParams,
  CodexRequestError,
  type CodexRequestId,
  INTERNAL_ERROR,
  NO_HANDLER,
  REFUSED,
  STDERR_LINE_CHARS,
  STDERR_LINES,
  STOPPED,
} from './schema.ts';

export const makeCodexClient = Effect.fn('CodexClient.make')(function* (
  options: CodexClientOptions,
  given: Partial<CodexHandlers> = {}
) {
  const notification = given.notification ?? (() => undefined);
  const exit = given.exit ?? (() => undefined);
  const decodeMessage = Schema.decodeUnknownOption(CodexMessage);
  const isRequestId = (id: unknown): id is CodexRequestId => typeof id === 'number' || typeof id === 'string';
  const { CLAUDECODE: _claudeCode, ...inherited } = Bun.env;

  const child = yield* Effect.try({
    try: () =>
      Bun.spawn([options.path, 'app-server'], {
        cwd: options.cwd,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        detached: true,
        env: { ...resolveBrowserEnv(inherited), ...options.env },
      }),
    catch: (error) => new CodexRequestError({ method: 'app-server', message: describeError(error) }),
  });
  const closed = yield* Ref.make(false);
  const nextId = yield* Ref.make(0);
  const stderr = yield* Ref.make<readonly string[]>([]);
  const ended = yield* Deferred.make<void>();
  const pending = new Map<
    CodexRequestId,
    { method: string; answer: Deferred.Deferred<unknown, CodexRequestError> }
  >();

  const stop = Effect.ignore(stopProcessGroup(child.pid));

  const failPending = (message: string) =>
    Effect.suspend(() => {
      const waiting = [...pending.values()];
      pending.clear();
      return Effect.forEach(
        waiting,
        (entry) => Deferred.fail(entry.answer, new CodexRequestError({ method: entry.method, message })),
        { discard: true }
      );
    });

  const write = (message: CodexParams) =>
    Effect.flatMap(Ref.get(closed), (isClosed) => {
      if (isClosed) return Effect.void;
      return Effect.try({
        try: () => {
          void child.stdin.write(`${JSON.stringify(message)}\n`);
          void child.stdin.flush();
        },
        catch: describeError,
      }).pipe(Effect.catch(() => stop));
    });

  const answer = (id: CodexRequestId, method: string, params: CodexParams) =>
    Effect.suspend(() => {
      const reply = given.request?.(method, params) ?? null;
      if (reply === null) return Effect.fail(NO_HANDLER);
      return Effect.tryPromise({ try: () => reply, catch: describeError });
    }).pipe(
      Effect.matchEffect({
        onSuccess: (result) => write({ id, result }),
        onFailure: (message) => write({ id, error: { code: INTERNAL_ERROR, message } }),
      })
    );

  const settle = (id: CodexRequestId, message: CodexParams) =>
    Effect.suspend(() => {
      const entry = pending.get(id);
      if (!entry) return Effect.void;
      pending.delete(id);
      if (message.error === undefined) return Deferred.succeed(entry.answer, message.result);
      const text = readRecord(message.error).message;
      return Deferred.fail(
        entry.answer,
        new CodexRequestError({
          method: entry.method,
          message: typeof text === 'string' && text ? text : REFUSED,
        })
      );
    });

  const receive = (line: string) =>
    Option.match(decodeMessage(line), {
      onNone: () => Effect.void,
      onSome: (message): Effect.Effect<void> => {
        const { id, method } = message;
        const params = readRecord(message.params);
        if (typeof method === 'string' && isRequestId(id)) {
          return Effect.asVoid(Effect.forkDetach(answer(id, method, params)));
        }
        if (typeof method === 'string') return Effect.sync(() => notification(method, params));
        return isRequestId(id) ? settle(id, message) : Effect.void;
      },
    });

  const readLines = (stream: ReadableStream<Uint8Array>, onLine: (line: string) => Effect.Effect<void>) =>
    Stream.fromReadableStream({ evaluate: () => stream, onError: describeError }).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.filter((line) => line.trim() !== ''),
      Stream.runForEach(onLine),
      Effect.ignore
    );

  const keepStderr = (line: string) =>
    Ref.update(stderr, (lines) => [...lines, line.trim().slice(-STDERR_LINE_CHARS)].slice(-STDERR_LINES));

  const close = Effect.flatMap(Ref.getAndSet(closed, true), (wasClosed) =>
    wasClosed ? Effect.void : Effect.andThen(failPending(CLOSED), stop)
  );

  const end = Effect.fn('CodexClient.end')(function* (fallback: string) {
    const wasClosed = yield* Ref.getAndSet(closed, true);
    const message = (yield* Ref.get(stderr)).at(-1) ?? fallback;
    yield* failPending(message);
    if (!wasClosed) {
      yield* stop;
      yield* Effect.sync(() => exit(message));
    }
    yield* Deferred.succeed(ended, undefined);
  });

  yield* Effect.addFinalizer(() => close);
  const stdout = yield* Effect.forkScoped(readLines(child.stdout, receive));
  const errors = yield* Effect.forkScoped(readLines(child.stderr, keepStderr));
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      const code = yield* Effect.promise(() => child.exited);
      yield* Fiber.join(stdout);
      yield* Fiber.join(errors);
      yield* end(`Codex stopped unexpectedly (exit code ${code}).`);
    })
  );

  const request = Effect.fn('CodexClient.request')(function* (method: string, params: CodexParams) {
    if (yield* Ref.get(closed)) return yield* new CodexRequestError({ method, message: STOPPED });
    const id = yield* Ref.updateAndGet(nextId, (last) => last + 1);
    const reply = yield* Deferred.make<unknown, CodexRequestError>();
    pending.set(id, { method, answer: reply });
    yield* write({ id, method, params });
    return yield* Deferred.await(reply);
  });

  const connection: CodexConnection = {
    pid: child.pid,
    request,
    initialize: Effect.andThen(
      request('initialize', { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true } }),
      write({ method: 'initialized' })
    ),
    close,
    exited: Deferred.await(ended),
  };
  return connection;
});
