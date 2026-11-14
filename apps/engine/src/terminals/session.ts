import type { TerminalServerFrame } from '@shinsa/core';
import { Duration, Effect, Fiber } from 'effect';
import { createTerminalMirror } from './mirror.ts';
import type {
  SessionOptions,
  SessionStart,
  TerminalProcess,
  TerminalSession,
  TerminalViewer,
} from './schema.ts';

interface ViewerState {
  behind: boolean;
}

export const FLOW_LIMITS = {
  batchMs: 4,
  batchBytes: 256 * 1024,
  highWater: 4 * 1024 * 1024,
  lowWater: 512 * 1024,
  title: 200,
};

const DEFAULT_SIZE = { cols: 100, rows: 30 };

export const TYPE_LIMITS = { settleMs: 150, waitMs: 5000, keyGapMs: 30 };

const ENTER = '\r';

const ENCODER = new TextEncoder();

function joinChunks(chunks: Uint8Array[]) {
  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

export const createTerminalSession = Effect.fn('TerminalSession.create')(function* (options: SessionOptions) {
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const runSync = Effect.runSyncWith(context);
  const viewers = new Map<TerminalViewer, ViewerState>();
  let running: TerminalProcess | null = null;
  let batch: Uint8Array[] = [];
  let batchBytes = 0;
  let batchFiber: Fiber.Fiber<void> | null = null;
  let stopping = false;
  let lastOutputAt: number | null = null;
  let disposed = false;

  let lastActiveAt = runSync(options.now);

  const touch = () => {
    lastActiveAt = runSync(options.now);
  };

  const cancelBatch = () => {
    if (batchFiber) runFork(Fiber.interrupt(batchFiber));
    batchFiber = null;
  };

  const flushBatch = () => {
    cancelBatch();
    if (batch.length === 0) return;
    const frame = joinChunks(batch);
    batch = [];
    batchBytes = 0;
    for (const [viewer, state] of viewers) {
      if (state.behind) continue;
      if (viewer.send(frame) === 0 || viewer.buffered() > FLOW_LIMITS.highWater) state.behind = true;
    }
  };

  const receive = (data: Uint8Array) => {
    if (disposed) return;
    lastOutputAt = performance.now();
    touch();
    mirror.write(data);
    runSync(options.onScreen(session));
    if (viewers.size === 0) return;
    batch.push(data);
    batchBytes += data.length;
    if (batchBytes >= FLOW_LIMITS.batchBytes) flushBatch();
    else
      batchFiber ??= runFork(
        Effect.sleep(Duration.millis(FLOW_LIMITS.batchMs)).pipe(
          Effect.andThen(
            Effect.sync(() => {
              batchFiber = null;
              flushBatch();
            })
          )
        )
      );
  };

  const retitle = (title: string) => {
    const next = title.slice(0, FLOW_LIMITS.title) || null;
    if (next === session.info.title) return;
    session.info = { ...session.info, title: next };
    runSync(options.onChange);
  };

  const mirror = createTerminalMirror({
    ...DEFAULT_SIZE,
    onReply: (data) => running?.write(data),
    onTitle: retitle,
  });
  if (options.saved) mirror.write(ENCODER.encode(options.saved));

  const end = Effect.fn('TerminalSession.end')(function* (process: TerminalProcess, code: number | null) {
    if (running !== process) return;
    running = null;
    if (disposed) return;
    flushBatch();
    const status = stopping ? 'stopped' : 'exited';
    session.info = {
      ...session.info,
      status,
      exitCode: stopping ? null : code,
      endedAt: yield* options.now,
    };
    yield* options.onChange;
    yield* options.onScreen(session);
  });

  const awaitExit = (process: TerminalProcess) =>
    Effect.promise(() => process.exited).pipe(Effect.flatMap((code) => end(process, code)));

  const sendScreen = (viewer: TerminalViewer) => {
    const reset: TerminalServerFrame = { type: 'reset', cols: mirror.cols, rows: mirror.rows };
    viewer.send(JSON.stringify(reset));
    for (const part of mirror.snapshot()) {
      const bytes = typeof part === 'string' ? ENCODER.encode(part) : part;
      if (bytes.length > 0) viewer.send(bytes);
    }
    viewer.send(JSON.stringify({ type: 'live' } satisfies TerminalServerFrame));
  };

  const typeWhenSettled = (command: string, deadline: number): Effect.Effect<void> =>
    Effect.suspend(() => {
      const process = running;
      if (!process || disposed) return Effect.void;
      const settled = lastOutputAt !== null && performance.now() - lastOutputAt >= TYPE_LIMITS.settleMs;
      if (!settled && performance.now() < deadline)
        return Effect.sleep(Duration.millis(TYPE_LIMITS.settleMs)).pipe(
          Effect.andThen(typeWhenSettled(command, deadline))
        );
      process.write(command);
      return Effect.sleep(Duration.millis(TYPE_LIMITS.keyGapMs)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (running === process) process.write(ENTER);
          })
        )
      );
    });

  const start = Effect.fn('TerminalSession.start')(function* ({ command, env, spawn }: SessionStart) {
    if (running) return;
    if (session.info.endedAt !== null) receive(ENCODER.encode('\r\n'));
    lastOutputAt = null;
    stopping = false;
    session.info = {
      ...session.info,
      status: 'running',
      exitCode: null,
      startedAt: yield* options.now,
      endedAt: null,
      title: null,
    };
    touch();
    const process = yield* spawn(command, {
      cwd: session.info.cwd,
      cols: mirror.cols,
      rows: mirror.rows,
      env,
      onData: receive,
    });
    running = process;
    yield* Effect.forkDetach(awaitExit(process));
  });

  const session: TerminalSession = {
    info: options.info,
    get running() {
      return running !== null;
    },
    get pid() {
      return running?.pid ?? null;
    },
    get viewers() {
      return viewers.size;
    },
    get lastActiveAt() {
      return lastActiveAt;
    },
    start,
    attach(viewer) {
      flushBatch();
      viewers.set(viewer, { behind: false });
      touch();
      sendScreen(viewer);
    },
    detach(viewer) {
      if (viewers.delete(viewer)) touch();
    },
    drain(viewer) {
      const state = viewers.get(viewer);
      if (!state?.behind || viewer.buffered() > FLOW_LIMITS.lowWater) return;
      flushBatch();
      state.behind = false;
      sendScreen(viewer);
    },
    input(data) {
      touch();
      running?.write(data);
    },
    type(command) {
      runFork(typeWhenSettled(command, performance.now() + TYPE_LIMITS.waitMs));
    },
    resize(cols, rows) {
      if (cols === mirror.cols && rows === mirror.rows) return;
      flushBatch();
      mirror.resize(cols, rows);
      running?.resize(cols, rows);
    },
    clear() {
      mirror.clear();
    },
    replaceColors(colors) {
      mirror.replaceColors(colors);
    },
    serializeScreen: Effect.map(mirror.flushed, () => mirror.serializeSaved()),
    readOutput: (lines) => Effect.map(mirror.flushed, () => mirror.readLines(lines)),
    hangUp() {
      running?.hangUp();
    },
    stop: Effect.suspend(() => {
      stopping = true;
      const process = running;
      if (!process) return Effect.void;
      process.hangUp();
      return awaitExit(process);
    }),
    dispose() {
      disposed = true;
      for (const viewer of viewers.keys()) viewer.end();
      cancelBatch();
      viewers.clear();
      mirror.dispose();
    },
  };
  return session;
});
