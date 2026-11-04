import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { BunRuntime } from '@effect/platform-bun';
import { Clock, Config, Console, Duration, Effect, Option, Schedule, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { Chromium, ChromiumLayer } from '../kit/chromium/index.ts';
import { writeReport } from './report/write.ts';
import { summarize } from './shell-stats.ts';
import {
  AppNeverOpened,
  HOME_READY,
  LAUNCH_KEYS,
  type Launch,
  PAINTS,
  Paints,
  STARTUP_PORT,
  STARTUP_TIMEOUT,
} from './shell/schema.ts';

const APP_DIR = resolve(Bun.argv[2] ?? 'apps/desktop');
const ORIGIN = Bun.argv[3] ?? 'http://127.0.0.1:5620';

const STARTUP_POLL = Schedule.spaced(Duration.millis(5));

const program = Effect.gen(function* () {
  const runs = yield* Config.Number('SHELL_PERF_RUNS').pipe(Config.withDefault(6));
  const out = yield* Config.option(Config.String('SHELL_PERF_OUT'));
  const userData = yield* Config.option(Config.String('SHELL_PERF_USER_DATA'));
  const electron = resolve(
    yield* Config.String('SHELL_PERF_ELECTRON').pipe(
      Config.withDefault('apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    )
  );
  const chromium = yield* Chromium;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const timeout = Duration.fromInputUnsafe(STARTUP_TIMEOUT);

  const launchOnce = Effect.fn('ShellStartup.launchOnce')(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    yield* spawner.spawn(
      ChildProcess.make(electron, [APP_DIR, `--remote-debugging-port=${STARTUP_PORT}`], {
        env: { SHINSA_URL: ORIGIN },
        extendEnv: true,
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      })
    );
    const target = yield* chromium.listTargets(STARTUP_PORT).pipe(
      Effect.map((targets) => targets.find((entry) => entry.type === 'page' && entry.url.startsWith(ORIGIN))),
      Effect.orElseSucceed(() => undefined),
      Effect.repeat({ schedule: STARTUP_POLL, until: (found) => found !== undefined }),
      Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.succeed(undefined) })
    );
    if (!target) return yield* new AppNeverOpened({ message: 'The app never opened a page on the server.' });
    const page = yield* chromium.connect(target.webSocketDebuggerUrl);
    const elapsed = (yield* Clock.currentTimeMillis) - startedAt;
    const rendered = yield* page.evaluate(HOME_READY, Schema.Boolean).pipe(
      Effect.repeat({ schedule: STARTUP_POLL, until: (ready) => ready }),
      Effect.timeoutOrElse({
        duration: Duration.subtract(timeout, Duration.millis(elapsed)),
        orElse: () => Effect.succeed(false),
      })
    );
    if (!rendered) return yield* new AppNeverOpened({ message: 'Home never rendered.' });
    const homeReady = yield* Clock.currentTimeMillis;
    const paints = yield* page.evaluate(PAINTS, Paints);
    const since = (offset: number | null) => paints.timeOrigin + (offset ?? 0) - startedAt;
    const launch: Launch = {
      navigationStart: since(0),
      firstContentfulPaint: since(paints.firstContentfulPaint),
      largestContentfulPaint: since(paints.largestContentfulPaint),
      homeReady: homeReady - startedAt,
    };
    return launch;
  }, Effect.scoped);

  if (Option.isSome(userData))
    yield* Effect.sync(() =>
      rmSync(join(homedir(), 'Library/Application Support', userData.value), { recursive: true, force: true })
    );

  const launches = yield* Effect.forEach(Array.from({ length: runs }), () =>
    Effect.andThen(launchOnce(), (launch) => Effect.as(Effect.sleep(Duration.millis(500)), launch))
  );

  const first = launches[0];
  const rest = launches.slice(1);
  yield* Console.log(`Electron start, ${APP_DIR} on ${ORIGIN}\n`);
  yield* Console.log('| From launch to | First launch (empty cache) | Later launches (median) |');
  yield* Console.log('|---|---|---|');
  for (const key of LAUNCH_KEYS) {
    const median = summarize(rest.map((launch) => launch[key])).median;
    yield* Console.log(`| ${key} | ${first?.[key].toFixed(0)} ms | ${median.toFixed(0)} ms |`);
  }
  if (Option.isSome(out))
    yield* writeReport(out.value, JSON.stringify({ appDir: APP_DIR, origin: ORIGIN, launches }, null, 2));
});

program.pipe(Effect.provide(ChromiumLayer), BunRuntime.runMain);
