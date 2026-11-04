import { describe, expect, spyOn, test } from 'bun:test';
import { Duration, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import {
  createServiceRestart,
  type EngineRestartInput,
  EngineRestarter,
  EXIT_RESTART,
  isEngineBusy,
  type RestartDrain,
  RestartDrainWindow,
  resolveEngineActivity,
  type ServiceRestart,
  stopWithin,
} from '../../src/instance/index.ts';
import { RestartFailed } from '../../src/instance/restart/schema.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { createStubEngineCoreLayer } from '../helpers/engine-core.ts';
import { captureLogs } from '../helpers/index.ts';
import { createRun, createStubEngine, type StubEngine } from '../helpers/state.ts';

const DELAY = Duration.millis(250);

function createDrain() {
  const held = new Set<string>();
  const calls: string[] = [];
  const onHeld: Effect.Effect<void>[] = [];
  const drain: RestartDrain = {
    holdNewRuns: (listener) =>
      Effect.sync(() => {
        calls.push('hold');
        onHeld.push(listener);
      }),
    releaseHeldRuns: Effect.sync(() => {
      calls.push('release');
    }),
    isHeld: (runId) => Effect.sync(() => held.has(runId)),
  };
  return { drain, held, calls, onHeld };
}

function provideRestarter<A, E>(
  stub: StubEngine,
  input: EngineRestartInput,
  body: (restarter: EngineRestarter['Service']) => Effect.Effect<A, E>,
  drainWindow?: Duration.Duration
) {
  return EngineRestarter.use(body).pipe(
    Effect.provide(
      EngineRestarter.layer(input).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            createStubEngineCoreLayer(stub),
            drainWindow ? Layer.succeed(RestartDrainWindow, drainWindow) : Layer.empty,
            JsonLogger
          )
        )
      )
    )
  );
}

function runRestarter<A, E>(
  options: { service?: boolean; fail?: boolean; drain?: RestartDrain; drainWindow?: Duration.Duration },
  body: (
    restarter: EngineRestarter['Service'],
    world: { stub: StubEngine; restarts: () => number; flush: Effect.Effect<void> }
  ) => Effect.Effect<A, E>
) {
  const stub = createStubEngine();
  let restarts = 0;
  const input: EngineRestartInput = {
    isService: Effect.succeed(options.service ?? true),
    restart: Effect.suspend(() => {
      restarts += 1;
      return options.fail ? Effect.fail(new RestartFailed({ message: 'launchctl said no' })) : Effect.void;
    }),
    drain: options.drain,
  };
  const flush = Effect.gen(function* () {
    for (let step = 0; step < 5; step += 1) yield* Effect.yieldNow;
    yield* TestClock.adjust(DELAY);
  });
  return Effect.runPromise(
    provideRestarter(
      stub,
      input,
      (restarter) =>
        Effect.andThen(TestClock.setTime(1_000), body(restarter, { stub, restarts: () => restarts, flush })),
      options.drainWindow
    ).pipe(Effect.provide(TestClock.layer()))
  );
}

describe('isEngineBusy', () => {
  test('is busy only while an agent is mid-turn, not while one is queued, waiting or done', () => {
    const stub = createStubEngine();
    expect(isEngineBusy(stub.state)).toBe(false);
    stub.update((state) => {
      state.runs.queued = createRun({ id: 'queued', status: 'queued' });
      state.runs.waiting = createRun({ id: 'waiting', status: 'waiting' });
      state.runs.done = createRun({ id: 'done', endedAt: 5 });
    });
    expect(isEngineBusy(stub.state)).toBe(false);
    stub.update((state) => {
      state.runs.live = createRun({ id: 'live' });
    });
    expect(isEngineBusy(stub.state)).toBe(true);
    expect(isEngineBusy(stub.state, (runId) => runId === 'live')).toBe(false);
    expect(resolveEngineActivity(stub.state)).toEqual({
      busy: true,
      working: 1,
      restart: null,
      restartBy: null,
    });
  });
});

describe('the engine activity', () => {
  test('counts the working agents, leaving out held ones, and says when a restart comes at the latest', async () => {
    const { drain, held } = createDrain();
    const activity = await runRestarter({ drain }, (restarter, { stub }) =>
      Effect.gen(function* () {
        stub.update((state) => {
          state.runs.live = createRun({ id: 'live' });
          state.runs.next = createRun({ id: 'next' });
        });
        const before = yield* restarter.activity;
        held.add('next');
        yield* restarter.request('idle');
        return { before, after: yield* restarter.activity };
      })
    );
    expect(activity).toEqual({
      before: { busy: true, working: 2, restart: null, restartBy: null },
      after: { busy: true, working: 1, restart: 'idle', restartBy: 901_000 },
    });
  });
});

describe('draining before a restart', () => {
  test('holds new runs, ignores the held ones and restarts once the working ones hand over', async () => {
    const { drain, held, calls } = createDrain();
    await runRestarter({ drain, drainWindow: Duration.millis(30) }, (restarter, { stub, restarts, flush }) =>
      Effect.gen(function* () {
        stub.update((state) => {
          state.runs.live = createRun({ id: 'live' });
        });
        expect(yield* restarter.request('idle')).toEqual({ restarting: false });
        expect(yield* restarter.request('idle')).toEqual({ restarting: false });
        expect(calls).toEqual(['hold']);
        expect(yield* restarter.deadlineAt).toBe(1_030);
        stub.update((state) => {
          state.runs.next = createRun({ id: 'next' });
        });
        held.add('next');
        stub.update((state) => {
          state.runs.live = createRun({ id: 'live', endedAt: 9 });
        });
        stub.notify();
        yield* flush;
        expect(restarts()).toBe(1);
        expect(yield* restarter.deadlineAt).toBeNull();
        yield* TestClock.adjust('80 millis');
        yield* flush;
        expect(restarts()).toBe(1);
      })
    );
  });

  test('a run held after the last state change still lets the engine restart', async () => {
    const { drain, held, onHeld } = createDrain();
    await runRestarter({ drain }, (restarter, { stub, restarts, flush }) =>
      Effect.gen(function* () {
        stub.update((state) => {
          state.runs.live = createRun({ id: 'live' });
        });
        yield* restarter.request('idle');
        yield* onHeld[0] ?? Effect.void;
        yield* flush;
        expect(restarts()).toBe(0);
        held.add('live');
        yield* onHeld[0] ?? Effect.void;
        yield* flush;
        expect(restarts()).toBe(1);
      })
    );
  });

  test('restarts at the deadline with agents still working, since their runs resume after it', async () => {
    const logs = captureLogs();
    try {
      await runRestarter({ drainWindow: Duration.millis(50) }, (restarter, { stub, restarts, flush }) =>
        Effect.gen(function* () {
          stub.update((state) => {
            state.runs.live = createRun({ id: 'live' });
          });
          yield* restarter.request('idle');
          yield* TestClock.adjust('49 millis');
          yield* flush;
          expect(restarts()).toBe(0);
          yield* TestClock.adjust('1 millis');
          yield* flush;
          expect(restarts()).toBe(1);
        })
      );
      expect(
        logs.fieldsOf('[Engine] Agents still work past the restart deadline; their runs resume after it')
      ).toEqual([{}]);
    } finally {
      logs.restore();
    }
  });

  test('a restart that fails releases the held runs so work goes on', async () => {
    const logs = captureLogs();
    try {
      const { drain, calls } = createDrain();
      const pending = await runRestarter({ drain, fail: true }, (restarter, { stub, flush }) =>
        Effect.gen(function* () {
          stub.update((state) => {
            state.runs.live = createRun({ id: 'live' });
          });
          yield* restarter.request('idle');
          yield* restarter.request('now');
          yield* flush;
          return yield* restarter.pending;
        })
      );
      expect(calls).toEqual(['hold', 'release']);
      expect(pending).toBeNull();
    } finally {
      logs.restore();
    }
  });
});

describe('EngineRestarter', () => {
  test('refuses when the engine does not run in the background', async () => {
    const error = await runRestarter({ service: false }, (restarter) =>
      Effect.flip(restarter.request('now'))
    );
    expect(error).toMatchObject({ code: 'restart_unsupported' });
  });

  test('says why when it cannot tell whether a service runs it', async () => {
    const error = await Effect.runPromise(
      provideRestarter(
        createStubEngine(),
        {
          isService: Effect.fail(new RestartFailed({ message: 'launchctl is gone' })),
          restart: Effect.void,
        },
        (restarter) => Effect.flip(restarter.request('now'))
      )
    );
    expect(error).toMatchObject({ _tag: 'RestartFailed', message: 'launchctl is gone' });
  });

  test('restarts now even with agents mid-turn, once, since runs resume after it', async () => {
    await runRestarter({}, (restarter, { stub, restarts, flush }) =>
      Effect.gen(function* () {
        stub.update((state) => {
          state.runs.live = createRun({ id: 'live' });
        });
        expect(yield* restarter.request('now')).toEqual({ restarting: true });
        expect(yield* restarter.request('now')).toEqual({ restarting: true });
        yield* flush;
        expect(restarts()).toBe(1);
      })
    );
  });

  test('waits for agents to be idle, then restarts', async () => {
    await runRestarter({}, (restarter, { stub, restarts, flush }) =>
      Effect.gen(function* () {
        stub.update((state) => {
          state.runs.live = createRun({ id: 'live' });
        });
        expect(yield* restarter.request('idle')).toEqual({ restarting: false });
        expect(yield* restarter.pending).toBe('idle');
        stub.notify();
        yield* flush;
        expect(restarts()).toBe(0);
        stub.update((state) => {
          state.runs.live = createRun({ id: 'live', endedAt: 9 });
        });
        stub.notify();
        yield* flush;
        expect(restarts()).toBe(1);
      })
    );
  });

  test('restarts at once when asked to wait but nothing runs', async () => {
    await runRestarter({}, (restarter, { restarts, flush }) =>
      Effect.gen(function* () {
        expect(yield* restarter.pending).toBeNull();
        expect(yield* restarter.request('idle')).toEqual({ restarting: true });
        yield* flush;
        expect(restarts()).toBe(1);
      })
    );
  });

  test('restarts a moment after answering, so the app hears that it will', async () => {
    const logs = captureLogs();
    try {
      await runRestarter({}, (restarter, { restarts }) =>
        Effect.gen(function* () {
          yield* restarter.request('now');
          yield* TestClock.adjust('249 millis');
          expect(restarts()).toBe(0);
          yield* TestClock.adjust('1 millis');
          expect(restarts()).toBe(1);
        })
      );
    } finally {
      logs.restore();
    }
  });

  test('logs a failed restart and can be asked again', async () => {
    const logs = captureLogs();
    try {
      await runRestarter({ fail: true }, (restarter, { restarts, flush }) =>
        Effect.gen(function* () {
          yield* restarter.request('now');
          yield* flush;
          yield* restarter.request('now');
          yield* flush;
          expect(restarts()).toBe(2);
        })
      );
      expect(logs.fieldsOf('[Engine] Could not restart')).toEqual([
        { error: 'launchctl said no' },
        { error: 'launchctl said no' },
      ]);
    } finally {
      logs.restore();
    }
  });
});

function requestServiceRestart<A>(service: ServiceRestart, until: Promise<A>) {
  return Effect.runPromise(
    provideRestarter(createStubEngine(), createServiceRestart(service), (restarter) =>
      Effect.andThen(
        restarter.request('now'),
        Effect.promise(() => until)
      )
    )
  );
}

describe('createServiceRestart', () => {
  test('restarts by stopping cleanly and exiting with the restart code, so launchd starts it again', async () => {
    const steps: string[] = [];
    const exited = Promise.withResolvers<void>();
    await requestServiceRestart(
      {
        byService: true,
        stop: Effect.sync(() => {
          steps.push('stop');
        }),
        exit: (code) => {
          steps.push(`exit ${code}`);
          exited.resolve();
        },
      },
      exited.promise
    );
    expect(steps).toEqual(['stop', `exit ${EXIT_RESTART}`]);
  });

  test('refuses when launchd did not start the engine, and exits the process by default', async () => {
    const refused = await Effect.runPromise(
      provideRestarter(
        createStubEngine(),
        createServiceRestart({ byService: false, stop: Effect.void }),
        (restarter) => Effect.flip(restarter.request('now'))
      )
    );
    expect(refused).toMatchObject({ code: 'restart_unsupported' });
    const exited = Promise.withResolvers<void>();
    const exit = spyOn(process, 'exit').mockImplementation((() => exited.resolve()) as () => never);
    try {
      await requestServiceRestart({ byService: true, stop: Effect.void }, exited.promise);
      expect(exit).toHaveBeenCalledWith(EXIT_RESTART);
    } finally {
      exit.mockRestore();
    }
  });

  test('a stop that hangs or fails still exits with the restart code, so launchd brings the engine back', async () => {
    const logs = captureLogs();
    try {
      for (const stop of [Effect.never, Effect.die(new Error('stuck'))]) {
        const exited = Promise.withResolvers<number>();
        const code = await requestServiceRestart(
          { byService: true, stop, exit: (exitCode) => exited.resolve(exitCode), deadlineMs: 20 },
          exited.promise
        );
        expect(code).toBe(EXIT_RESTART);
      }
      expect(logs.fieldsOf('[Engine] Did not stop in time, so it exits anyway')).toEqual([
        { deadlineMs: 20 },
      ]);
      expect(logs.fieldsOf('[Engine] Could not stop cleanly')).toEqual([{ error: 'stuck' }]);
    } finally {
      logs.restore();
    }
  });
});

describe('stopWithin', () => {
  test('says whether the stop finished, failed or ran past its deadline', async () => {
    const logs = captureLogs();
    const run = (stop: Effect.Effect<void>) =>
      Effect.runPromise(stopWithin(stop, 20).pipe(Effect.provide(JsonLogger)));
    try {
      expect(await run(Effect.void)).toBe('stopped');
      expect(await run(Effect.die(new Error('no')))).toBe('failed');
      expect(await run(Effect.never)).toBe('timed_out');
      expect(logs.fieldsOf('[Engine] Could not stop cleanly')).toEqual([{ error: 'no' }]);
    } finally {
      logs.restore();
    }
  });
});
