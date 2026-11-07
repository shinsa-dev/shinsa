import { closeSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DomainError } from '@shinsa/core';
import { Cause, Duration, Effect, Exit, Fiber, FileSystem } from 'effect';
import { flow } from 'effect/Function';
import { resolveKeychainAccount } from '../accounts/paths.ts';
import { resolveServerAddress } from '../config/index.ts';
import { EngineConfig } from '../config/service.ts';
import { Remote } from '../git/remote/service.ts';
import { resolveServerUrl } from '../http/index.ts';
import {
  BUNDLE,
  createSystemdService,
  describeVersion,
  isStartedByService,
  SERVICE_MARKER,
  ServerRunningError,
  type ServiceRunner,
  type ShinsaBundle,
  STOP_DEADLINE_MS,
} from '../instance/index.ts';
import { describeError } from '../log/index.ts';
import { runEngine as runEngineLayer } from '../serve/run.ts';
import { resolveBrowserCommand } from '../shell/browser.ts';
import { describeFailure } from '../shell/index.ts';
import {
  applyLoginEnv,
  createLoginEnvReader,
  isStartedFromTerminal,
  mergePathLists,
} from '../shell/login.ts';
import { type Argv, COMMAND_TIMEOUT, type CommandResult, NOT_STARTED_EXIT_CODE } from '../shell/schema.ts';
import { Shell } from '../shell/service.ts';
import { listSectionGroups } from '../surface/index.ts';
import { describeInline, resolveTerminal, selectClosest, splitHint } from '../terminal/index.ts';
import { createApiClient } from './api.ts';
import { APP_BUNDLE_ID, isInsideApp, isPathArgument, ownsEngineJob, resolveLinkPage } from './app.ts';
import { createTask, openApp, printStatus, readArgs } from './commands.ts';
import { printVersion, restartEngine, startEngine, stopEngine, waitFor, readHealth } from './engine.ts';
import { CLI_COMMANDS, describeCliUsage, describeHelp, describeHelpAll, selectCliCommand } from './help.ts';
import { createLaunchdService } from './launchd.ts';
import { ENGINE_LOG, printLogs } from './logs.ts';
import {
  CliFailed,
  type CliFailure,
  type CliIo,
  type CliServices,
  type CommandIo,
  ENGINE_LOG_MAX_BYTES,
  type EngineIo,
  type OpenAppOptions,
  type ProcessOptions,
  type WakeOptions,
} from './schema.ts';
import { isSurfaceGroup, runSurface } from './surface.ts';

export type { CliIo, OpenAppOptions, WakeOptions } from './schema.ts';

const MANAGED_PLATFORMS: string[] = ['darwin', 'linux'];

const IS_BUNDLED = Boolean(BUNDLE) && MANAGED_PLATFORMS.includes(process.platform);

const runProgram = Effect.fn('Cli.runProgram')(function* (argv: Argv) {
  const shell = yield* Shell;
  return yield* shell.run({ argv, cwd: process.cwd(), timeout: COMMAND_TIMEOUT }).pipe(
    Effect.catchTag('CommandNotFound', (missing) =>
      Effect.succeed<CommandResult>({
        ok: false,
        code: NOT_STARTED_EXIT_CODE,
        stdout: '',
        stderr: missing.message,
        timedOut: false,
      })
    )
  );
});

const runOrFail = Effect.fn('Cli.runOrFail')(function* (argv: Argv) {
  const result = yield* runProgram(argv);
  if (result.ok) return result.stdout;
  return yield* new CliFailed({ message: describeFailure([...argv], result) });
});

export function createOpenApp(base: string, options: OpenAppOptions) {
  const platform = options.platform ?? process.platform;
  return Effect.fn('Cli.openApp')(function* (link: string) {
    const inside = options.inApp ?? (Boolean(BUNDLE) && (yield* isInsideApp()));
    if (inside && platform === 'darwin') {
      yield* runOrFail(['open', '-b', APP_BUNDLE_ID, link]);
      return;
    }
    const url = `${base}${resolveLinkPage(link)}`;
    const [program, ...args] = resolveBrowserCommand(url, platform, options.env ?? Bun.env) ?? [];
    if (program) yield* runOrFail([program, ...args]);
    else options.write(`No display here, so open ${url} in a browser that reaches this machine.`);
  });
}

function readRepoRoot(dir: string) {
  return Remote.use((remote) => remote.resolveRoot(dir)).pipe(Effect.map((root) => root || null));
}

function createServiceRunner(tool: Argv): ServiceRunner {
  return (args) =>
    Effect.map(runProgram([...tool, ...args]), (result) => ({
      ok: result.ok,
      output: `${result.stdout}${result.stderr}`,
    }));
}

export const createPlatformService = Effect.fn('Cli.createPlatformService')(function* (
  platform: string = process.platform,
  env: Record<string, string | undefined> = Bun.env
) {
  if (platform === 'linux') {
    return yield* createSystemdService({
      env,
      program: process.execPath,
      user: resolveKeychainAccount(env),
      systemctl: createServiceRunner(['systemctl', '--user']),
      loginctl: createServiceRunner(['loginctl']),
    });
  }
  const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
  return createLaunchdService({
    uid: process.getuid?.() ?? 0,
    launchctl: createServiceRunner(['launchctl']),
    ownsJob: flow(ownsEngineJob, withFiles),
    inApp: yield* isInsideApp(),
    program: process.execPath,
    home: env.HOME || homedir(),
    env,
  });
});

export const createWakeEngine = Effect.fn('Cli.createWakeEngine')(function* (
  base: string,
  given?: WakeOptions
) {
  const options = given ?? { bundled: IS_BUNDLED, kick: (yield* createPlatformService()).kick };
  const shell = yield* Shell;
  return Effect.gen(function* () {
    if (!options.bundled || !(yield* options.kick)) return false;
    const health = yield* waitFor(options, readHealth(base));
    return health !== null;
  }).pipe(Effect.provideService(Shell, shell));
});

export const stopEngineFiber = Effect.fn('Cli.stopEngineFiber')(function* <E>(
  engine: Fiber.Fiber<unknown, E>,
  exit: (code: number) => void = process.exit,
  deadlineMs: number = STOP_DEADLINE_MS
) {
  yield* Effect.logInfo('[Serve] Stopping');
  const deadline = yield* Effect.forkDetach(
    Effect.sleep(Duration.millis(deadlineMs)).pipe(
      Effect.andThen(
        Effect.logError('[Engine] Did not stop in time, so it exits anyway').pipe(
          Effect.annotateLogs({ deadlineMs })
        )
      ),
      Effect.andThen(Effect.sync(() => exit(0)))
    )
  );
  yield* Fiber.interrupt(engine);
  const stopped = yield* Fiber.await(engine);
  yield* Fiber.interrupt(deadline);
  if (Exit.isSuccess(stopped) || Cause.hasInterruptsOnly(stopped.cause)) {
    yield* Effect.sync(() => exit(0));
    return;
  }
  yield* Effect.logError('[Engine] Could not stop cleanly').pipe(
    Effect.annotateLogs({ error: describeError(Cause.squash(stopped.cause)) })
  );
  yield* Effect.sync(() => exit(1));
});

export const trimEngineLog = Effect.fn('Cli.trimEngineLog')(function* (
  path: string,
  maxBytes: number = ENGINE_LOG_MAX_BYTES
) {
  yield* Effect.try({
    try: () => {
      if (statSync(path).size <= maxBytes) return;
      const text = readFileSync(path);
      writeFileSync(path, text.subarray(text.length - Math.floor(maxBytes / 2)));
    },
    catch: (error) => new CliFailed({ message: describeError(error) }),
  }).pipe(Effect.ignore);
});

export const writeOutputTo = Effect.fn('Cli.writeOutputTo')(function* (
  path: string,
  streams: NodeJS.WriteStream[] = [process.stdout, process.stderr]
) {
  yield* trimEngineLog(path);
  return yield* Effect.sync(() => {
    const fd = openSync(path, 'a');
    for (const stream of streams) {
      stream.write = ((chunk: string | Uint8Array) => {
        writeSync(fd, typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        return true;
      }) as typeof stream.write;
    }
    return () => closeSync(fd);
  });
});

const startEngineProcess = Effect.fn('Cli.startEngineProcess')(function* (
  env: Record<string, string | undefined>,
  isTerminal: () => boolean,
  bundle: ShinsaBundle | null,
  exit: (code: number) => void
) {
  const byService = isStartedByService(env);
  yield* Effect.sync(() => {
    delete Bun.env[SERVICE_MARKER];
  });
  const config = yield* Effect.orDie(Effect.provide(EngineConfig, EngineConfig.layer(env, bundle)));
  if (byService && bundle) {
    yield* Effect.sync(() => mkdirSync(config.dataDir, { recursive: true }));
    yield* writeOutputTo(join(config.dataDir, ENGINE_LOG));
  }
  if (isTerminal()) {
    yield* Effect.logInfo('[Serve] Started from a terminal, so the login shell environment is not read');
  } else {
    const added = yield* Effect.flatMap(createLoginEnvReader(Bun.env), (read) =>
      applyLoginEnv(Bun.env, read)
    );
    yield* Effect.logInfo('[Serve] Read the login shell environment').pipe(
      Effect.annotateLogs({ added: added.length })
    );
  }
  if (bundle) {
    yield* Effect.sync(() => {
      Bun.env.PATH = mergePathLists(bundle.bin, Bun.env.PATH ?? '');
    });
  }
  const engine = yield* Effect.forkChild(
    runEngineLayer(config, { byService }).pipe(
      Effect.mapError((error) =>
        error._tag === 'LogVersionError' || error._tag === 'PortInUse'
          ? new CliFailed({ message: error.message })
          : error
      )
    )
  );
  return yield* Fiber.join(engine).pipe(Effect.onInterrupt(() => stopEngineFiber(engine, exit)));
});

const resolveBase = Effect.fn('Cli.resolveBase')(function* (env: Record<string, string | undefined>) {
  const address = yield* Effect.orDie(resolveServerAddress(env));
  return resolveServerUrl(address.hostname, address.port);
});

export const createProcessIo = Effect.fn('Cli.createProcessIo')(function* (options: ProcessOptions = {}) {
  const isTerminal = options.isTerminal ?? isStartedFromTerminal;
  const bundle = options.bundle === undefined ? BUNDLE : options.bundle;
  const exit = options.exit ?? process.exit;
  const base = yield* resolveBase(Bun.env);
  const write = (line = '') => process.stdout.write(`${line}\n`);
  const io: CliIo = {
    env: Bun.env,
    cwd: process.cwd(),
    write,
    writeError: (line) => process.stderr.write(`${line}\n`),
    openApp: createOpenApp(base, { write }),
    readRepoRoot,
    wakeEngine: yield* createWakeEngine(base),
    engine: { bundled: IS_BUNDLED, service: yield* createPlatformService() },
    runEngine: (env) => startEngineProcess(env, isTerminal, bundle, exit),
    terminal: resolveTerminal(Bun.env, process.stdout, process.stderr),
  };
  return io;
});

const createCommandIo = Effect.fn('Cli.createCommandIo')(function* (io: CliIo) {
  const command: CommandIo = {
    api: createApiClient(yield* resolveBase(io.env), io.wakeEngine),
    display: io.terminal.display,
    home: io.terminal.home,
    cwd: io.cwd,
    write: io.write,
    openApp: io.openApp,
    readRepoRoot: io.readRepoRoot,
  };
  return command;
});

const runEngine = Effect.fn('Cli.runEngine')(function* (io: CliIo) {
  const byService = isStartedByService(io.env);
  return yield* io.runEngine(io.env).pipe(
    Effect.as(0),
    Effect.catchIf(
      (error): error is ServerRunningError => byService && error instanceof ServerRunningError,
      (error) =>
        Effect.logWarning(
          '[Serve] Another Shinsa holds this data directory, so the service stays stopped'
        ).pipe(
          Effect.annotateLogs({
            dataDir: error.dataDir,
            pid: error.holder.pid,
            url: error.holder.url,
            version: describeVersion(error.holder),
          }),
          Effect.as(0)
        )
    )
  );
});

const createEngineIo = Effect.fn('Cli.createEngineIo')(function* (io: CliIo) {
  const engine: EngineIo = {
    ...io.engine,
    base: yield* resolveBase(io.env),
    display: io.terminal.display,
    write: io.write,
    startProgress: io.terminal.startProgress,
  };
  return engine;
});

function isHelp(args: string[]) {
  return args.includes('--help') || args.includes('-h');
}

const printHelp = Effect.fn('Cli.printHelp')(function* (args: string[], io: CliIo) {
  const [topic] = args;
  const { display } = io.terminal;
  if (!topic) {
    io.write(describeHelp(display));
    return 0;
  }
  if (topic === '--all') {
    io.write(describeHelpAll(display));
    return 0;
  }
  const command = selectCliCommand(topic);
  if (command) {
    io.write(describeCliUsage(command, display));
    return 0;
  }
  return yield* routeCommand(topic, ['--help'], io);
});

const routeTopLevel = Effect.fn('Cli.routeTopLevel')(function* (command: string, args: string[], io: CliIo) {
  switch (command) {
    case 'do':
      yield* createTask(args, yield* createCommandIo(io));
      return 0;
    case 'status':
      return yield* printStatus(args, yield* createCommandIo(io));
    case 'open':
      yield* openApp(args, yield* createCommandIo(io));
      return 0;
    case 'start':
      yield* startEngine(yield* createEngineIo(io));
      return 0;
    case 'stop':
      yield* stopEngine(yield* createEngineIo(io));
      return 0;
    case 'restart':
      yield* restartEngine(yield* createEngineIo(io), (yield* readArgs(args)).flags.has('--when-idle'));
      return 0;
    case 'logs':
      yield* printLogs(args, { env: io.env, display: io.terminal.display, write: io.write });
      return 0;
    default:
      yield* printVersion(yield* createEngineIo(io), (yield* readArgs(args)).flags.has('--json'));
      return 0;
  }
});

const TOP_LEVEL_WORDS = [
  ...CLI_COMMANDS.map((command) => command.name).filter((name) => name !== '.'),
  'help',
  ...listSectionGroups(),
];

function describeUnknown(command: string) {
  const closest = selectClosest(command, TOP_LEVEL_WORDS);
  const hint = closest ? ` Did you mean \`shinsa ${closest}\`?` : '';
  return `No command shinsa ${command}.${hint} Run \`shinsa help\` for the list.`;
}

const routeCommand: (
  command: string,
  args: string[],
  io: CliIo
) => Effect.Effect<number, CliFailure, CliServices> = Effect.fn('Cli.routeCommand')(function* (
  command: string,
  args: string[],
  io: CliIo
) {
  if (command === 'engine') return yield* runEngine(io);
  if (command === 'help' || command === '--help' || command === '-h') return yield* printHelp(args, io);
  if (command === '--version' || command === '-v') return yield* routeTopLevel('version', args, io);
  const known = selectCliCommand(command);
  if (known && known.name !== '.') {
    if (isHelp(args)) {
      io.write(describeCliUsage(known, io.terminal.display));
      return 0;
    }
    return yield* routeTopLevel(command, args, io);
  }
  if (isPathArgument(command)) {
    yield* openApp([command], yield* createCommandIo(io));
    return 0;
  }
  if (isSurfaceGroup(command)) {
    return yield* runSurface([command, ...args], {
      base: yield* resolveBase(io.env),
      display: io.terminal.display,
      write: io.write,
      wake: io.wakeEngine,
    });
  }
  return yield* new DomainError({ code: 'command_unknown', message: describeUnknown(command) });
});

function writeFailure(io: CliIo, error: unknown) {
  const style = io.terminal.errorStyle;
  const { message, hint } = splitHint(describeError(error));
  io.writeError(`${style.danger(style.bold('Error:'))} ${describeInline(style, message)}`);
  if (hint) io.writeError(style.dim(describeInline(style, hint)));
}

export const executeCli = Effect.fn('Cli.execute')(function* (args: string[], given?: CliIo) {
  const io = given ?? (yield* createProcessIo());
  const [command = 'open', ...rest] = args;
  return yield* routeCommand(command, rest, io).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        writeFailure(io, Cause.squash(cause));
        return 1;
      })
    )
  );
});
