import { closeSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '@shinsa/core';
import { resolveKeychainAccount } from '../accounts/paths.ts';
import { resolveConfig, resolveServerAddress } from '../config/index.ts';
import { resolveServerUrl } from '../http/index.ts';
import {
  BUNDLE,
  createSystemdService,
  describeVersion,
  type EngineService,
  isStartedByService,
  SERVICE_MARKER,
  ServerRunningError,
  type ServiceRunner,
  type ShinsaBundle,
  stopWithin,
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
import { listSectionGroups } from '../surface/index.ts';
import {
  describeInline,
  resolveTerminal,
  selectClosest,
  splitHint,
  type Terminal,
} from '../terminal/index.ts';
import { createApiClient } from './api.ts';
import { APP_BUNDLE_ID, isPathArgument, ownsEngineJob, resolveLinkPage } from './app.ts';
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
import { CLI_COMMANDS, describeCliUsage, describeHelp, describeHelpAll, selectCliCommand } from './help.ts';
import { createLaunchdService } from './launchd.ts';
import { ENGINE_LOG, printLogs } from './logs.ts';
import { isSurfaceGroup, runSurface } from './surface.ts';

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
  terminal: Terminal;
  projectsDir?: string;
}

const ENGINE_LOG_MAX_BYTES = 8 * 1024 * 1024;

const WAKE_WAIT_MS = 20_000;

const WAKE_POLL_MS = 250;

const MANAGED_PLATFORMS: string[] = ['darwin', 'linux'];

const IS_BUNDLED = Boolean(BUNDLE) && MANAGED_PLATFORMS.includes(process.platform);

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

function createServiceRunner(tool: string[]): ServiceRunner {
  return async (args) => {
    const result = await runCommand([...tool, ...args], process.cwd());
    return { ok: result.ok, output: `${result.stdout}${result.stderr}` };
  };
}

export function createPlatformService(
  platform: string = process.platform,
  env: Record<string, string | undefined> = Bun.env
): EngineService {
  if (platform === 'linux') {
    return createSystemdService({
      env,
      program: process.execPath,
      user: resolveKeychainAccount(env),
      systemctl: createServiceRunner(['systemctl', '--user']),
      loginctl: createServiceRunner(['loginctl']),
    });
  }
  return createLaunchdService({
    uid: process.getuid?.() ?? 0,
    launchctl: createServiceRunner(['launchctl']),
    ownsJob: ownsEngineJob,
  });
}

const PLATFORM_SERVICE = createPlatformService();

export interface WakeOptions {
  bundled: boolean;
  kick: () => Promise<boolean>;
  waitMs?: number;
}

export function createWakeEngine(
  base: string,
  options: WakeOptions = { bundled: IS_BUNDLED, kick: PLATFORM_SERVICE.kick }
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

export async function stopForSignal(
  signal: string,
  stop: () => Promise<void>,
  exit: (code: number) => void = (code) => process.exit(code),
  deadlineMs?: number
) {
  log.info('[Serve] Stopping', { signal });
  const outcome = await stopWithin(stop, deadlineMs);
  exit(outcome === 'failed' ? 1 : 0);
}

function stopOnSignal(stop: () => Promise<void>) {
  for (const signal of SHUTDOWN_SIGNALS) process.once(signal, () => void stopForSignal(signal, stop));
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
    engine: { bundled: IS_BUNDLED, service: PLATFORM_SERVICE },
    runEngine: (env) => runEngineWithLoginEnv(env, isTerminal, bundle),
    onShutdown: stopOnSignal,
    terminal: resolveTerminal(Bun.env, process.stdout, process.stderr),
  };
}

function createCommandIo(io: CliIo): CommandIo {
  return {
    api: createApiClient(resolveBase(io.env), io.wakeEngine),
    display: io.terminal.display,
    home: io.terminal.home,
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
  return {
    ...io.engine,
    base: resolveBase(io.env),
    display: io.terminal.display,
    write: io.write,
    startProgress: io.terminal.startProgress,
  };
}

function isHelp(args: string[]) {
  return args.includes('--help') || args.includes('-h');
}

function printHelp(args: string[], io: CliIo) {
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
      printLogs(args, { env: io.env, display: io.terminal.display, write: io.write });
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
      io.write(describeCliUsage(known, io.terminal.display));
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
      display: io.terminal.display,
      write: io.write,
      wake: io.wakeEngine,
    });
  }
  throw new DomainError('command_unknown', describeUnknown(command));
}

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

function writeFailure(io: CliIo, error: unknown) {
  const style = io.terminal.errorStyle;
  const { message, hint } = splitHint(describeError(error));
  io.writeError(`${style.danger(style.bold('Error:'))} ${describeInline(style, message)}`);
  if (hint) io.writeError(style.dim(describeInline(style, hint)));
}

export async function runCli(args: string[], io: CliIo = createProcessIo()): Promise<number> {
  const [command = 'open', ...rest] = args;
  try {
    return await routeCommand(command, rest, io);
  } catch (error) {
    writeFailure(io, error);
    return 1;
  }
}
