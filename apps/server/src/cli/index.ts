import { closeSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { resolveConfig, resolveServerAddress } from '../config/index.ts';
import { resolveServerUrl } from '../http/index.ts';
import {
  BUNDLE,
  describeVersion,
  isStartedByService,
  SERVICE_MARKER,
  ServerRunningError,
  type ShinsaBundle,
} from '../instance/index.ts';
import { describeError, log } from '../log/index.ts';
import { type Shinsa, startShinsa } from '../serve.ts';
import { describeFailure, runCommand } from '../shell/index.ts';
import {
  applyLoginEnv,
  createLoginEnvReader,
  isStartedFromTerminal,
  mergePathLists,
} from '../shell/login.ts';
import { createApiClient } from './api.ts';
import { APP_BUNDLE_ID, isPathArgument, resolveEngineTarget, resolveLinkPage } from './app.ts';
import { type CommandIo, createTask, importSession, openApp, parseArgs, printStatus } from './commands.ts';
import {
  type EngineControl,
  type EngineIo,
  printVersion,
  readHealth,
  restartEngine,
  startEngine,
  stopEngine,
} from './engine.ts';
import { describeCliUsage, selectCliCommand, USAGE, USAGE_ALL } from './help.ts';
import { ENGINE_LOG, printLogs } from './logs.ts';
import { isSurfaceGroup, runSurface } from './surface.ts';

export { USAGE } from './help.ts';

export interface CliIo {
  env: Record<string, string | undefined>;
  cwd: string;
  write: (line?: string) => void;
  writeError: (line: string) => void;
  openApp: (link: string) => Promise<void>;
  readRepoRoot: (dir: string) => Promise<string | null>;
  wakeEngine: () => Promise<boolean>;
  engine: EngineControl;
  runEngine: (env: Record<string, string | undefined>) => Promise<Shinsa>;
  onShutdown: (stop: () => Promise<void>) => void;
  projectsDir?: string;
}

const ENGINE_LOG_MAX_BYTES = 8 * 1024 * 1024;

const WAKE_WAIT_MS = 20_000;

const WAKE_POLL_MS = 250;

const IS_BUNDLED = Boolean(BUNDLE) && process.platform === 'darwin';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

async function runOrThrow(command: string[]) {
  const result = await runCommand(command, process.cwd());
  if (!result.ok) throw new Error(describeFailure(command, result));
  return result.stdout;
}

function createOpenApp(base: string) {
  return async (link: string) => {
    if (BUNDLE) await runOrThrow(['open', '-b', APP_BUNDLE_ID, link]);
    else await runOrThrow(['open', `${base}${resolveLinkPage(link)}`]);
  };
}

async function readRepoRoot(dir: string) {
  const result = await runCommand(['git', '-C', dir, 'rev-parse', '--show-toplevel'], process.cwd());
  return result.ok ? result.stdout.trim() || null : null;
}

async function runLaunchctl(args: string[]) {
  const result = await runCommand(['launchctl', ...args], process.cwd());
  return { ok: result.ok, output: `${result.stdout}${result.stderr}` };
}

const UID = process.getuid?.() ?? 0;

export async function kickEngine() {
  return (await runLaunchctl(['kickstart', resolveEngineTarget(UID)])).ok;
}

export interface WakeOptions {
  bundled: boolean;
  kick: () => Promise<boolean>;
  waitMs?: number;
}

export function createWakeEngine(
  base: string,
  options: WakeOptions = { bundled: IS_BUNDLED, kick: kickEngine }
) {
  return async () => {
    if (!options.bundled || !(await options.kick())) return false;
    const deadline = Date.now() + (options.waitMs ?? WAKE_WAIT_MS);
    while (Date.now() < deadline) {
      if (await readHealth(base)) return true;
      await Bun.sleep(WAKE_POLL_MS);
    }
    return false;
  };
}

function stopOnSignal(stop: () => Promise<void>) {
  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      log.info('[Serve] Stopping', { signal });
      stop().then(
        () => process.exit(0),
        (error: unknown) => {
          log.error('[Serve] Could not stop cleanly', { error: describeError(error) });
          process.exit(1);
        }
      );
    });
  }
}

export function trimEngineLog(path: string, maxBytes = ENGINE_LOG_MAX_BYTES) {
  try {
    if (statSync(path).size <= maxBytes) return;
    const text = readFileSync(path);
    writeFileSync(path, text.subarray(text.length - Math.floor(maxBytes / 2)));
  } catch {
    return;
  }
}

export function writeOutputTo(
  path: string,
  streams: NodeJS.WriteStream[] = [process.stdout, process.stderr]
) {
  trimEngineLog(path);
  const fd = openSync(path, 'a');
  for (const stream of streams) {
    stream.write = ((chunk: string | Uint8Array) => {
      writeSync(fd, typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      return true;
    }) as typeof stream.write;
  }
  return () => closeSync(fd);
}

interface ProcessOptions {
  isTerminal?: () => boolean;
  bundle?: ShinsaBundle | null;
}

async function runEngineWithLoginEnv(
  env: Record<string, string | undefined>,
  isTerminal: () => boolean,
  bundle: ShinsaBundle | null
) {
  const byService = isStartedByService(env);
  delete Bun.env[SERVICE_MARKER];
  const config = resolveConfig(env, bundle);
  if (byService && bundle) {
    mkdirSync(config.dataDir, { recursive: true });
    writeOutputTo(join(config.dataDir, ENGINE_LOG));
  }
  if (isTerminal()) {
    log.info('[Serve] Started from a terminal, so the login shell environment is not read');
  } else {
    const added = await applyLoginEnv(Bun.env, createLoginEnvReader(Bun.env));
    log.info('[Serve] Read the login shell environment', { added: added.length });
  }
  if (bundle) Bun.env.PATH = mergePathLists(bundle.bin, Bun.env.PATH ?? '');
  return startShinsa(config, { byService });
}

function resolveBase(env: Record<string, string | undefined>) {
  const address = resolveServerAddress(env);
  return resolveServerUrl(address.hostname, address.port);
}

export function createProcessIo(options: ProcessOptions = {}): CliIo {
  const isTerminal = options.isTerminal ?? isStartedFromTerminal;
  const bundle = options.bundle === undefined ? BUNDLE : options.bundle;
  const base = resolveBase(Bun.env);
  return {
    env: Bun.env,
    cwd: process.cwd(),
    write: (line = '') => process.stdout.write(`${line}\n`),
    writeError: (line) => process.stderr.write(`${line}\n`),
    openApp: createOpenApp(base),
    readRepoRoot,
    wakeEngine: createWakeEngine(base),
    engine: { bundled: IS_BUNDLED, uid: UID, launchctl: runLaunchctl },
    runEngine: (env) => runEngineWithLoginEnv(env, isTerminal, bundle),
    onShutdown: stopOnSignal,
  };
}

function createCommandIo(io: CliIo): CommandIo {
  return {
    api: createApiClient(resolveBase(io.env), io.wakeEngine),
    cwd: io.cwd,
    write: io.write,
    openApp: io.openApp,
    readRepoRoot: io.readRepoRoot,
    projectsDir: io.projectsDir,
  };
}

async function runEngine(io: CliIo) {
  const byService = isStartedByService(io.env);
  try {
    const shinsa = await io.runEngine(io.env);
    io.onShutdown(shinsa.stop);
    return 0;
  } catch (error) {
    if (!byService || !(error instanceof ServerRunningError)) throw error;
    log.warn('[Serve] Another Shinsa holds this data directory, so the service stays stopped', {
      dataDir: error.dataDir,
      pid: error.holder.pid,
      url: error.holder.url,
      version: describeVersion(error.holder),
    });
    return 0;
  }
}

function createEngineIo(io: CliIo): EngineIo {
  return { ...io.engine, base: resolveBase(io.env), write: io.write };
}

function isHelp(args: string[]) {
  return args.includes('--help') || args.includes('-h');
}

function printHelp(args: string[], io: CliIo) {
  const [topic] = args;
  if (!topic) {
    io.write(USAGE);
    return 0;
  }
  if (topic === '--all') {
    io.write(USAGE_ALL);
    return 0;
  }
  const command = selectCliCommand(topic);
  if (command) {
    io.write(describeCliUsage(command));
    return 0;
  }
  return routeCommand(topic, ['--help'], io);
}

async function routeTopLevel(command: string, args: string[], io: CliIo) {
  switch (command) {
    case 'do':
      await createTask(args, createCommandIo(io));
      return 0;
    case 'import':
      await importSession(args, createCommandIo(io));
      return 0;
    case 'status':
      return printStatus(args, createCommandIo(io));
    case 'open':
      await openApp(args, createCommandIo(io));
      return 0;
    case 'start':
      await startEngine(createEngineIo(io));
      return 0;
    case 'stop':
      await stopEngine(createEngineIo(io));
      return 0;
    case 'restart':
      await restartEngine(createEngineIo(io), parseArgs(args).flags.has('--when-idle'));
      return 0;
    case 'logs':
      printLogs(args, io);
      return 0;
    default:
      await printVersion(createEngineIo(io), parseArgs(args).flags.has('--json'));
      return 0;
  }
}

async function routeCommand(command: string, args: string[], io: CliIo): Promise<number> {
  if (command === 'engine') return runEngine(io);
  if (command === 'help' || command === '--help' || command === '-h') return printHelp(args, io);
  if (command === '--version' || command === '-v') return routeTopLevel('version', args, io);
  const known = selectCliCommand(command);
  if (known && known.name !== '.') {
    if (isHelp(args)) {
      io.write(describeCliUsage(known));
      return 0;
    }
    return routeTopLevel(command, args, io);
  }
  if (isPathArgument(command)) {
    await openApp([command], createCommandIo(io));
    return 0;
  }
  if (isSurfaceGroup(command)) {
    return runSurface([command, ...args], {
      base: resolveBase(io.env),
      write: io.write,
      wake: io.wakeEngine,
    });
  }
  io.writeError(`No command shinsa ${command}. Run \`shinsa help\` for the list.`);
  return 1;
}

export async function runCli(args: string[], io: CliIo = createProcessIo()): Promise<number> {
  const [command = 'open', ...rest] = args;
  try {
    return await routeCommand(command, rest, io);
  } catch (error) {
    io.writeError(`shinsa ${command}: ${describeError(error)}`);
    return 1;
  }
}
