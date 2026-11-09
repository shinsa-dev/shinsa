import { DomainError } from '@shinsa/core';
import { Duration, Effect, Schedule } from 'effect';
import {
  BUNDLE,
  createServerInstance,
  describeVersion,
  type ServerHealth,
  type ShinsaBundle,
  STOP_DEADLINE_MS,
} from '../instance/index.ts';
import { describeError } from '../log/index.ts';
import { describeFields, describeInline, describeMark, type Tone } from '../terminal/index.ts';
import { createSurfaceClient } from './api.ts';
import {
  CliFailed,
  type CommandVersion,
  ENGINE_POLL_SCHEDULE,
  ENGINE_STOPPED,
  ENGINE_WAIT_MS,
  type EngineControl,
  type EngineIo,
  HEALTH_TIMEOUT_MS,
} from './schema.ts';

export {
  type CommandVersion,
  ENGINE_STOPPED,
  type EngineControl,
  type EngineIo,
  HUMAN_ONLY_ENGINE_COMMANDS,
} from './schema.ts';

const ENGINE_STOP_WAIT_MS = STOP_DEADLINE_MS + 10_000;

type EngineStop = 'stopped' | 'replaced' | 'forced';

export const readHealth = Effect.fn('Cli.readHealth')(function* (base: string) {
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`${base}/api/health`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(HEALTH_TIMEOUT_MS)]),
      });
      if (!response.ok) return null;
      return (await response.json()) as ServerHealth;
    },
    catch: (error) => new CliFailed({ message: describeError(error) }),
  }).pipe(Effect.catch(() => Effect.succeed(null)));
});

export function waitFor<T, E, R>(
  io: { waitMs?: number },
  check: Effect.Effect<T | null, E, R>,
  fallbackMs = ENGINE_WAIT_MS
) {
  return check.pipe(
    Effect.repeat({
      schedule: ENGINE_POLL_SCHEDULE.pipe(
        Schedule.upTo({ duration: Duration.millis(io.waitMs ?? fallbackMs) })
      ),
      until: (found) => found !== null,
    })
  );
}

function describeEngine(health: ServerHealth) {
  return `Shinsa ${describeVersion(health)}, pid ${health.pid}`;
}

export function describeDuration(ms: number) {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function writeOutcome(io: EngineIo, tone: Tone, symbol: 'check' | 'dot', text: string, detail: string) {
  const { style } = io.display;
  const tail = detail ? ` ${style.dim(describeInline(style, detail))}` : '';
  io.write(describeMark(style, tone, symbol, `${text}${tail}`));
}

function withProgress<A, E, R>(io: EngineIo, text: string, work: Effect.Effect<A, E, R>) {
  return Effect.scoped(Effect.andThen(io.startProgress(text), Effect.timed(work))).pipe(
    Effect.map(([elapsed, result]) => ({ result, took: describeDuration(Duration.toMillis(elapsed)) }))
  );
}

function describeWait(io: EngineControl, fallbackMs = ENGINE_WAIT_MS) {
  const seconds = Math.ceil((io.waitMs ?? fallbackMs) / 1000);
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

const waitForEngine = Effect.fn('Cli.waitForEngine')(function* (
  io: EngineIo,
  accept: (health: ServerHealth) => boolean
) {
  const health = yield* waitFor(
    io,
    Effect.map(readHealth(io.base), (answer) => (answer && accept(answer) ? answer : null))
  );
  if (health) return health;
  return yield* new CliFailed({
    message: `The engine did not answer within ${describeWait(io)}. \`shinsa logs\` shows why.`,
  });
});

const assertManaged = Effect.fn('Cli.assertManaged')(function* (io: EngineControl) {
  if (io.bundled) return;
  return yield* new DomainError({
    code: 'engine_unmanaged',
    message:
      'This shinsa runs from source, so it does not start or stop the engine. `bun dev` runs the engine and Ctrl-C stops it.',
  });
});

const assertEngineJob = Effect.fn('Cli.assertEngineJob')(function* (io: EngineControl) {
  yield* assertManaged(io);
  yield* io.service.assertInstalled;
});

export const startEngine = Effect.fn('Cli.startEngine')(function* (io: EngineIo) {
  const running = yield* readHealth(io.base);
  if (running) {
    writeOutcome(io, 'success', 'dot', 'The engine is already running.', `${describeEngine(running)}.`);
    return;
  }
  yield* assertManaged(io);
  const note = yield* io.service.prepare;
  const { result: health, took } = yield* withProgress(
    io,
    'Starting the engine',
    io.service.start.pipe(Effect.andThen(waitForEngine(io, () => true)))
  );
  writeOutcome(io, 'success', 'check', `Started the engine in ${took}.`, `${describeEngine(health)}.`);
  if (note) writeOutcome(io, 'info', 'dot', note, '');
});

export const stopEngine = Effect.fn('Cli.stopEngine')(function* (io: EngineIo) {
  yield* assertEngineJob(io);
  const before = yield* readHealth(io.base);
  if (!before) {
    writeOutcome(io, 'dim', 'dot', 'The engine is not running.', '');
    return;
  }
  const readStop = Effect.map(readHealth(io.base), (answer): EngineStop | null => {
    if (!answer) return 'stopped';
    return answer.pid === before.pid ? null : 'replaced';
  });
  const { manager } = io.service;
  const stopping = Effect.gen(function* () {
    yield* io.service.stop;
    const clean = yield* waitFor(io, readStop, ENGINE_STOP_WAIT_MS);
    if (clean) return clean;
    yield* io.service.kill;
    if (yield* waitFor(io, readStop)) return 'forced' as const;
    return yield* new CliFailed({
      message: `The engine is still running after ${describeWait(io, ENGINE_STOP_WAIT_MS)} and a forced stop. \`shinsa logs\` shows why.`,
    });
  });
  const { result: stop, took } = yield* withProgress(io, 'Stopping the engine', stopping);
  if (stop === 'replaced') {
    writeOutcome(
      io,
      'warning',
      'dot',
      `The engine did not stop cleanly in ${took}, so ${manager} started a fresh one.`,
      'Runs it cut off resume there. `shinsa logs` shows why it failed to stop.'
    );
    return;
  }
  if (stop === 'forced') {
    writeOutcome(
      io,
      'warning',
      'dot',
      `Forced the engine to stop in ${took}.`,
      io.service.revivesKilled
        ? `It did not stop on its own, so ${manager} starts a fresh one. Runs it cut off resume there. \`shinsa logs\` shows what held it.`
        : 'It did not stop on its own. Runs it cut off resume when it starts again. `shinsa logs` shows what held it.'
    );
    return;
  }
  writeOutcome(
    io,
    'success',
    'check',
    `Stopped the engine in ${took}.`,
    'Runs it cut off resume when it starts again: `shinsa start` or any command that needs it.'
  );
});

export const restartEngine = Effect.fn('Cli.restartEngine')(function* (io: EngineIo, whenIdle: boolean) {
  yield* assertEngineJob(io);
  const before = yield* readHealth(io.base);
  if (whenIdle) {
    if (!before) return yield* new DomainError({ code: 'engine_stopped', message: ENGINE_STOPPED });
    const client = createSurfaceClient(io.base, `cli:${Bun.randomUUIDv7()}`);
    const answer = yield* client.api.server.restart({ payload: { when: 'idle' } });
    if (!answer.restarting) {
      writeOutcome(io, 'info', 'dot', 'The engine restarts once no agent is mid-turn.', '');
      return;
    }
  }
  const restarting = whenIdle ? Effect.void : io.service.restart;
  const { result: health, took } = yield* withProgress(
    io,
    'Restarting the engine',
    restarting.pipe(Effect.andThen(waitForEngine(io, (answer) => answer.pid !== before?.pid)))
  );
  writeOutcome(io, 'success', 'check', `Restarted the engine in ${took}.`, `${describeEngine(health)}.`);
});

export function resolveCommandVersion(bundle: ShinsaBundle | null = BUNDLE): CommandVersion {
  const instance = createServerInstance(bundle?.commit ?? null, 0, bundle);
  return { version: instance.version, commit: instance.commit };
}

export const printVersion = Effect.fn('Cli.printVersion')(function* (
  io: EngineIo,
  json: boolean,
  bundle: ShinsaBundle | null = BUNDLE
) {
  const command = resolveCommandVersion(bundle);
  const engine = yield* readHealth(io.base);
  if (json) {
    io.write(JSON.stringify({ command, engine }, null, 2));
    return;
  }
  const { style } = io.display;
  const engineLine = engine
    ? `${describeVersion(engine)}, ${style.dim(`pid ${engine.pid}, protocol ${engine.protocol}`)}`
    : describeMark(style, 'danger', 'dot', 'Not running');
  for (const line of describeFields(
    io.display,
    [
      ['Command', describeVersion(command)],
      ['Engine', engineLine],
    ],
    0
  )) {
    io.write(line);
  }
  if (engine && io.bundled && engine.version !== command.version) {
    io.write();
    io.write(
      describeMark(
        style,
        'warning',
        'warning',
        describeInline(
          style,
          'The engine runs another version than the app carries. `shinsa restart` starts the app’s.'
        )
      )
    );
  }
});
