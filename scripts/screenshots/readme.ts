import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { BunRuntime } from '@effect/platform-bun';
import { Console, Effect, FileSystem, Option, Ref, Schema, Stream } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { selectOnPath } from '../../apps/engine/src/files/probe.ts';
import { type CdpPage, Chromium, ChromiumLayer } from '../kit/chromium/index.ts';
import { reportFailure } from '../kit/script.ts';
import {
  AppWindowsText,
  CLEARED_ENV,
  FOCUS_PAUSE,
  Health,
  QUIT_TIMEOUT,
  READY_POLL,
  SETTLE_PAUSE,
  SETTLED_CHECKS,
  StepFailed,
  THEMES,
  type Theme,
  WAIT_TIMEOUT,
  WaitTimedOut,
  WINDOW,
  WindowNotFound,
} from './schema.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const WORK = Bun.env.SHINSA_SHOTS_DIR ?? '/tmp/shinsa-shots';
const ASSETS = join(ROOT, '.github/assets');
const DEV_PREFS = join(homedir(), 'Library/Application Support/Shinsa Dev/prefs.json');
const WINDOWS_HELPER = join(import.meta.dirname, 'windows.swift');
const ENV = Object.fromEntries(
  Object.entries(Bun.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !CLEARED_ENV.includes(entry[0])
  )
);

const program = Effect.gen(function* () {
  const chromium = yield* Chromium;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const http = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;
  const decodeWindows = Schema.decodeUnknownEffect(AppWindowsText);

  const runStep = Effect.fn('Readme.runStep')(function* (
    label: string,
    command: readonly [string, ...string[]],
    cwd: string,
    extra: Record<string, string> = {}
  ) {
    yield* Console.log(`· ${label}`);
    const [binary, ...args] = command;
    const failed = (detail: string) => new StepFailed({ message: `${command.join(' ')} failed:\n${detail}` });
    const handle = yield* spawner
      .spawn(
        ChildProcess.make(binary, args, {
          cwd,
          env: { ...ENV, ...extra },
          extendEnv: false,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        })
      )
      .pipe(Effect.mapError((error) => failed(error.message)));
    const [stdout, stderr, code] = yield* Effect.all(
      [
        Stream.mkString(Stream.decodeText(handle.stdout)),
        Stream.mkString(Stream.decodeText(handle.stderr)),
        handle.exitCode,
      ],
      { concurrency: 'unbounded' }
    ).pipe(Effect.mapError((error) => failed(error.message)));
    if (code !== 0) return yield* failed(`${stderr}${stdout}`);
    return stdout;
  }, Effect.scoped);

  const reservePort = Effect.gen(function* () {
    const server = yield* Effect.sync(() =>
      Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
    );
    const port = server.port;
    yield* Effect.promise(() => server.stop(true));
    if (port === undefined) return yield* new StepFailed({ message: 'No free port.' });
    return port;
  });

  const waitFor = Effect.fn('Readme.waitFor')(function* <A, E, R>(
    label: string,
    attempt: Effect.Effect<A | null | undefined | false, E, R>
  ) {
    const value = yield* attempt.pipe(
      Effect.orElseSucceed(() => null),
      Effect.repeat({
        schedule: READY_POLL,
        until: (found) => found !== null && found !== undefined && found !== false,
      }),
      Effect.timeoutOrElse({
        duration: WAIT_TIMEOUT,
        orElse: () => Effect.fail(new WaitTimedOut({ message: `Timed out waiting for ${label}.` })),
      })
    );
    if (value === null || value === undefined || value === false)
      return yield* new WaitTimedOut({ message: `Timed out waiting for ${label}.` });
    return value;
  });

  const writeLog = (name: string, output: Stream.Stream<Uint8Array, unknown>) =>
    output.pipe(Stream.run(fs.sink(join(WORK, name), { flag: 'a' })), Effect.ignore, Effect.forkScoped);

  const startEngine = Effect.fn('Readme.startEngine')(function* (port: number) {
    const data = join(WORK, 'data');
    const engine = yield* spawner
      .spawn(
        ChildProcess.make('bun', ['src/main.ts', 'engine'], {
          cwd: join(ROOT, 'apps/engine'),
          env: {
            ...ENV,
            SHINSA_DATA_DIR: data,
            SHINSA_INSPECT: '1',
            SHINSA_PORT: String(port),
            SHINSA_WEB_DIR: join(WORK, 'web'),
          },
          extendEnv: false,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          killSignal: 'SIGTERM',
        })
      )
      .pipe(
        Effect.mapError((error) => new StepFailed({ message: `The engine did not start: ${error.message}` }))
      );
    yield* writeLog('engine.log', engine.stdout);
    yield* writeLog('engine.err.log', engine.stderr);
    const origin = `http://127.0.0.1:${port}`;
    return yield* waitFor(
      'the engine',
      http.get(`${origin}/api/health`).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Health)),
        Effect.map((health) => (health.ok && health.dataDir === data ? origin : null))
      )
    );
  });

  const keepDevPrefs = Effect.acquireRelease(
    Effect.gen(function* () {
      if (!(yield* fs.exists(DEV_PREFS))) return null;
      return yield* fs.readFileString(DEV_PREFS);
    }).pipe(
      Effect.mapError(
        (error) => new StepFailed({ message: `Reading the dev app's preferences failed: ${error.message}` })
      )
    ),
    (saved) =>
      Effect.ignore(
        saved === null ? fs.remove(DEV_PREFS, { force: true }) : fs.writeFileString(DEV_PREFS, saved)
      )
  );

  const launchApp = Effect.fn('Readme.launchApp')(function* (origin: string) {
    const mainPort = yield* reservePort;
    const pagePort = yield* reservePort;
    const launcher = yield* spawner
      .spawn(
        ChildProcess.make(
          'bun',
          ['scripts/dev.ts', `--inspect=${mainPort}`, `--remote-debugging-port=${pagePort}`],
          {
            cwd: join(ROOT, 'apps/desktop'),
            env: { ...ENV, SHINSA_URL: origin },
            extendEnv: false,
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            killSignal: 'SIGTERM',
          }
        )
      )
      .pipe(
        Effect.mapError((error) => new StepFailed({ message: `The app did not start: ${error.message}` }))
      );
    yield* writeLog('app.log', launcher.stdout);
    yield* writeLog('app.err.log', launcher.stderr);
    const mainUrl = yield* waitFor(
      'the app',
      Effect.map(
        chromium.listTargets(mainPort),
        (targets) => targets.find((entry) => entry.type === 'node')?.webSocketDebuggerUrl
      )
    );
    const main = yield* chromium.connect(mainUrl);
    const pid = yield* main.evaluate('process.pid', Schema.Number);
    const quitApp = Effect.fn('Readme.quitApp')(function* () {
      yield* Effect.ignore(
        main.evaluate(`process.mainModule.require('electron').app.quit()`, Schema.Unknown)
      );
      const exited = yield* launcher.exitCode.pipe(
        Effect.as(true),
        Effect.timeoutOrElse({ duration: QUIT_TIMEOUT, orElse: () => Effect.succeed(false) }),
        Effect.orElseSucceed(() => false)
      );
      if (!exited)
        yield* Effect.ignore(
          Effect.try({
            try: () => process.kill(pid, 'SIGTERM'),
            catch: () => new StepFailed({ message: 'kill' }),
          })
        );
    });
    yield* Effect.addFinalizer(() => quitApp());
    const pageUrl = yield* waitFor(
      'the page',
      Effect.map(
        chromium.listTargets(pagePort),
        (targets) =>
          targets.find((entry) => entry.type === 'page' && entry.url.startsWith(origin))?.webSocketDebuggerUrl
      )
    );
    const page = yield* chromium.connect(pageUrl);
    yield* Effect.addFinalizer(() =>
      Effect.ignore(page.evaluate(`localStorage.removeItem('shinsa.theme')`, Schema.Unknown))
    );
    return { main, page, pid };
  });

  const placeWindow = (main: CdpPage, theme: Theme) =>
    main.evaluate(
      `(() => {
    const { app, BrowserWindow, nativeTheme, screen } = process.mainModule.require('electron');
    nativeTheme.themeSource = '${theme}';
    const win = BrowserWindow.getAllWindows().find((each) => each.isVisible()) ?? BrowserWindow.getAllWindows()[0];
    const cursor = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(cursor).workArea;
    const half = (start, size, point, length) => {
      const left = point >= start + size / 2;
      const room = size / 2;
      const offset = Math.max(0, Math.round((room - length) / 2));
      return left ? start + offset : start + size - length - offset;
    };
    win.setBounds({
      x: half(area.x, area.width, cursor.x, ${WINDOW.width}),
      y: half(area.y, area.height, cursor.y, ${WINDOW.height}),
      width: ${WINDOW.width},
      height: ${WINDOW.height},
    });
    win.show();
    win.focus();
    app.focus({ steal: true });
    return win.isFocused();
  })()`,
      Schema.Boolean
    );

  const isPageSettled = (page: CdpPage, theme: Theme) =>
    page.evaluate(
      `(async () => {
    await document.fonts.ready;
    document.activeElement?.blur?.();
    return document.fonts.status === 'loaded'
      && !!document.querySelector('main textarea')
      && !!document.querySelector('html[data-desktop="window"]')
      && document.documentElement.classList.contains('${theme}')
      && !document.querySelector('[aria-label="Reconnecting"]')
      && !document.querySelector('[data-sonner-toast]')
      && !document.querySelector('.animate-spin');
  })()`,
      Schema.Boolean
    );

  const findAppWindow = Effect.fn('Readme.findAppWindow')(function* (pid: number) {
    const output = yield* runStep('find the window', ['swift', WINDOWS_HELPER, String(pid)], ROOT);
    const windows = yield* decodeWindows(output).pipe(
      Effect.mapError(
        (issue) => new WindowNotFound({ message: `The window list did not decode: ${issue.message}` })
      )
    );
    const match = windows.find(
      (each) => each.bounds.Width === WINDOW.width && each.bounds.Height === WINDOW.height
    );
    if (!match)
      return yield* new WindowNotFound({
        message: `No ${WINDOW.width}×${WINDOW.height} window for pid ${pid}: ${output.trim()}`,
      });
    return match.id;
  });

  const writeImage = Effect.fn('Readme.writeImage')(function* (raw: string, target: string) {
    const pngquant = yield* selectOnPath('pngquant', Bun.env.PATH ?? '');
    if (Option.isNone(pngquant)) {
      yield* Console.log('  pngquant is not installed (brew install pngquant): writing the capture as is');
      return yield* fs
        .copyFile(raw, target)
        .pipe(
          Effect.mapError((error) => new StepFailed({ message: `Copying ${raw} failed: ${error.message}` }))
        );
    }
    yield* runStep(
      `shrink ${target}`,
      [pngquant.value, '--quality', '75-95', '--speed', '1', '--strip', '--force', '--output', target, raw],
      ROOT
    );
  });

  const captureTheme = Effect.fn('Readme.captureTheme')(function* (
    main: CdpPage,
    page: CdpPage,
    pid: number,
    theme: Theme
  ) {
    yield* placeWindow(main, theme);
    const calm = yield* Ref.make(0);
    yield* waitFor(
      `the ${theme} page to settle`,
      isPageSettled(page, theme).pipe(
        Effect.flatMap((settled) => Ref.updateAndGet(calm, (count) => (settled ? count + 1 : 0))),
        Effect.map((count) => count >= SETTLED_CHECKS)
      )
    );
    yield* Effect.sleep(SETTLE_PAUSE);
    yield* waitFor('the window to have focus', placeWindow(main, theme));
    yield* Effect.sleep(FOCUS_PAUSE);
    const raw = join(WORK, `shinsa-${theme}.raw.png`);
    const windowId = yield* findAppWindow(pid);
    yield* runStep(
      `capture ${theme}`,
      ['screencapture', '-l', String(windowId), '-x', '-t', 'png', raw],
      ROOT
    );
    yield* writeImage(raw, join(ASSETS, `shinsa-${theme}.png`));
  });

  yield* fs.remove(WORK, { recursive: true, force: true }).pipe(
    Effect.andThen(fs.makeDirectory(WORK, { recursive: true })),
    Effect.mapError((error) => new StepFailed({ message: `Clearing ${WORK} failed: ${error.message}` }))
  );
  yield* runStep('seed', ['bun', 'scripts/seed.ts'], ROOT, { SHINSA_SEED_DIR: WORK });
  yield* runStep(
    'build the web app',
    ['bun', 'run', 'build', '--outDir', join(WORK, 'web'), '--emptyOutDir'],
    join(ROOT, 'apps/web')
  );
  yield* runStep('build the app', ['bun', 'run', 'build'], join(ROOT, 'apps/desktop'));
  const origin = yield* startEngine(yield* reservePort);
  yield* Console.log(`· engine on ${origin}`);
  yield* keepDevPrefs;
  const { main, page, pid } = yield* launchApp(origin);
  yield* Effect.ignore(
    page.evaluate(`localStorage.removeItem('shinsa.theme'); location.reload()`, Schema.Unknown)
  );
  for (const theme of THEMES) yield* captureTheme(main, page, pid, theme);
  yield* Console.log(`Wrote ${THEMES.map((theme) => join(ASSETS, `shinsa-${theme}.png`)).join(' and ')}`);
});

program.pipe(
  Effect.scoped,
  reportFailure,
  Effect.provide(ChromiumLayer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
