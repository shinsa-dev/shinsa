import { resolveConfig, resolveServerAddress } from '../config/index.ts';
import { resolveServerUrl } from '../http/index.ts';
import { describeVersion, ServerRunningError } from '../instance/index.ts';
import { describeError, log } from '../log/index.ts';
import { type Shinsa, startShinsa } from '../serve.ts';
import {
  createServiceControl,
  isStartedByService,
  SERVICE_MARKER,
  type ServiceControl,
} from '../service/index.ts';
import { describeFailure, runCommand } from '../shell/index.ts';
import { applyLoginEnv, createLoginEnvReader, isStartedFromTerminal } from '../shell/login.ts';
import { describeSurface } from '../surface/index.ts';
import { createApiClient } from './api.ts';
import { type CommandIo, createTask, importSession, openInBrowser, printStatus } from './commands.ts';
import { isSurfaceGroup, runSurface } from './surface.ts';

export interface CliIo {
  env: Record<string, string | undefined>;
  cwd: string;
  write: (line?: string) => void;
  writeError: (line: string) => void;
  openUrl: (url: string) => Promise<void>;
  serve: (env: Record<string, string | undefined>) => Promise<Shinsa>;
  onShutdown: (stop: () => Promise<void>) => void;
  projectsDir?: string;
  service?: ServiceControl;
}

export const USAGE = `shinsa: a control plane for coding agents

Usage
  shinsa                  Start Shinsa (the server and the web app on http://127.0.0.1:5180)
  shinsa serve            Same as above
  shinsa do <request>     Hand Shinsa a piece of work. Options: --plan-first (approve a plan before building), --urgent, --high
  shinsa import <session> Turn a Claude Code session (.jsonl path or id) into a task. --in <dir> picks the repo
  shinsa status           What needs a decision, and what agents are working on
  shinsa open [task-id]   Open Shinsa, or one task, in the browser
  shinsa help             This text

Managing Shinsa (the running server; add --help to any for its arguments, --json for JSON)
${describeSurface()}

Agents can call these too: \`shinsa do\` from inside any project hands work over to Shinsa.`;

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

async function openUrl(url: string) {
  const command = ['open', url];
  const result = await runCommand(command, process.cwd());
  if (!result.ok) throw new Error(describeFailure(command, result));
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

interface ProcessOptions {
  isTerminal?: () => boolean;
}

async function serveWithLoginEnv(env: Record<string, string | undefined>, isTerminal: () => boolean) {
  delete Bun.env[SERVICE_MARKER];
  if (isTerminal()) {
    log.info('[Serve] Started from a terminal, so the login shell environment is not read');
  } else {
    const added = await applyLoginEnv(Bun.env, createLoginEnvReader(Bun.env));
    log.info('[Serve] Read the login shell environment', { added: added.length });
  }
  return startShinsa(resolveConfig(env));
}

export function createProcessIo(options: ProcessOptions = {}): CliIo {
  const isTerminal = options.isTerminal ?? isStartedFromTerminal;
  return {
    env: Bun.env,
    cwd: process.cwd(),
    write: (line = '') => process.stdout.write(`${line}\n`),
    writeError: (line) => process.stderr.write(`${line}\n`),
    openUrl,
    serve: (env) => serveWithLoginEnv(env, isTerminal),
    onShutdown: stopOnSignal,
    service: createServiceControl({ env: Bun.env }),
  };
}

function resolveBase(io: CliIo) {
  const address = resolveServerAddress(io.env);
  return resolveServerUrl(address.hostname, address.port);
}

function createCommandIo(io: CliIo): CommandIo {
  return {
    api: createApiClient(resolveBase(io)),
    cwd: io.cwd,
    write: io.write,
    openUrl: io.openUrl,
    projectsDir: io.projectsDir,
  };
}

async function serve(io: CliIo) {
  const byService = isStartedByService(io.env);
  try {
    const shinsa = await io.serve(io.env);
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

async function routeCommand(command: string, args: string[], io: CliIo) {
  switch (command) {
    case 'serve':
      return serve(io);
    case 'help':
    case '--help':
    case '-h':
      io.write(USAGE);
      return 0;
    case 'do':
      await createTask(args, createCommandIo(io));
      return 0;
    case 'import':
      await importSession(args, createCommandIo(io));
      return 0;
    case 'status':
      await printStatus(createCommandIo(io));
      return 0;
    case 'open':
      await openInBrowser(args, createCommandIo(io));
      return 0;
    default:
      if (isSurfaceGroup(command)) {
        return runSurface([command, ...args], {
          base: resolveBase(io),
          write: io.write,
          service: io.service,
        });
      }
      io.write(USAGE);
      return 1;
  }
}

export async function runCli(args: string[], io: CliIo = createProcessIo()): Promise<number> {
  const [command = 'serve', ...rest] = args;
  try {
    return await routeCommand(command, rest, io);
  } catch (error) {
    io.writeError(`shinsa ${command}: ${describeError(error)}`);
    return 1;
  }
}
