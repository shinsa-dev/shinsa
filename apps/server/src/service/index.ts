import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DomainError } from '@shinsa/core';
import { type Env, resolveShinsaPaths, resolveUserHome } from '../config/index.ts';
import {
  INSTALL_PATH,
  isProcessAlive,
  type LockHolder,
  SERVER_ENTRY,
  selectLockHolder,
} from '../instance/index.ts';
import { type CommandResult, describeFailure, runCommand } from '../shell/index.ts';
import { type LaunchdJob, parseLaunchdJob, SERVICE_LABEL, serializeLaunchAgent } from './launchd.ts';

export { SERVICE_LABEL } from './launchd.ts';

type Launchctl = (args: string[]) => Promise<CommandResult>;

export interface ServiceOptions {
  env: Env;
  launchctl?: Launchctl;
  platform?: string;
  uid?: number;
  bun?: string;
  entry?: string;
  unloadTimeoutMs?: number;
}

interface ServiceServer extends LockHolder {
  service: boolean;
}

export interface ServiceStatus extends LaunchdJob {
  label: string;
  plist: string;
  log: string;
  installed: boolean;
  loaded: boolean;
  server: ServiceServer | null;
}

export interface ServiceInstall {
  label: string;
  plist: string;
  log: string;
  program: string[];
  replaced: boolean;
  running: LockHolder | null;
}

interface ServiceRemoval {
  plist: string;
  wasLoaded: boolean;
  removedPlist: boolean;
}

interface ServiceLogs {
  path: string;
  lines: string[];
}

export interface ServiceControl {
  install: () => Promise<ServiceInstall>;
  uninstall: () => Promise<ServiceRemoval>;
  status: () => Promise<ServiceStatus>;
  restart: () => Promise<ServiceStatus>;
  logs: (lines: number) => ServiceLogs;
}

const LAUNCHCTL_TIMEOUT_MS = 30_000;

const UNLOAD_TIMEOUT_MS = 5_000;

const UNLOAD_POLL_MS = 100;

function listShinsaVariables(env: Env) {
  const entries = Object.entries(env).filter(
    (entry): entry is [string, string] => entry[0].startsWith('SHINSA_') && Boolean(entry[1])
  );
  return Object.fromEntries(entries);
}

function selectLiveHolder(dataDir: string) {
  const holder = selectLockHolder(dataDir);
  return holder && isProcessAlive(holder.pid) ? holder : null;
}

export function createServiceControl(options: ServiceOptions): ServiceControl {
  const { env } = options;
  const userHome = resolveUserHome(env);
  const { dataDir } = resolveShinsaPaths(env);
  const plist = join(userHome, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
  const log = join(dataDir, 'serve.log');
  const uid = options.uid ?? process.getuid?.() ?? 0;
  const domain = `gui/${uid}`;
  const target = `${domain}/${SERVICE_LABEL}`;
  const launchctl: Launchctl =
    options.launchctl ??
    ((args) => runCommand(['launchctl', ...args], userHome, { timeoutMs: LAUNCHCTL_TIMEOUT_MS }));

  const assertMacOs = () => {
    if ((options.platform ?? process.platform) === 'darwin') return;
    throw new DomainError('service_unsupported', 'The background service runs on macOS only (launchd).');
  };

  const run = async (args: string[]) => {
    const result = await launchctl(args);
    if (!result.ok) throw new Error(describeFailure(['launchctl', ...args], result));
    return result.stdout;
  };

  const isLoaded = async () => (await launchctl(['print', target])).ok;

  const unload = async () => {
    await launchctl(['bootout', target]);
    const deadline = Date.now() + (options.unloadTimeoutMs ?? UNLOAD_TIMEOUT_MS);
    while ((await isLoaded()) && Date.now() < deadline) await Bun.sleep(UNLOAD_POLL_MS);
  };

  const status = async (): Promise<ServiceStatus> => {
    assertMacOs();
    const printed = await launchctl(['print', target]);
    const job = printed.ok ? parseLaunchdJob(printed.stdout) : { state: null, pid: null, lastExitCode: null };
    const holder = selectLiveHolder(dataDir);
    return {
      label: SERVICE_LABEL,
      plist,
      log,
      installed: existsSync(plist),
      loaded: printed.ok,
      ...job,
      server: holder ? { ...holder, service: holder.pid === job.pid } : null,
    };
  };

  return {
    install: async () => {
      assertMacOs();
      const program = [
        options.bun ?? Bun.which('bun') ?? process.execPath,
        options.entry ?? SERVER_ENTRY,
        'serve',
      ];
      mkdirSync(dirname(plist), { recursive: true });
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(
        plist,
        serializeLaunchAgent({
          label: SERVICE_LABEL,
          program,
          workingDirectory: INSTALL_PATH,
          environment: listShinsaVariables(env),
          logPath: log,
        })
      );
      const replaced = await isLoaded();
      const running = replaced ? null : selectLiveHolder(dataDir);
      if (replaced) await unload();
      await run(['bootstrap', domain, plist]);
      return { label: SERVICE_LABEL, plist, log, program, replaced, running };
    },
    uninstall: async () => {
      assertMacOs();
      const wasLoaded = await isLoaded();
      if (wasLoaded) await unload();
      const removedPlist = existsSync(plist);
      rmSync(plist, { force: true });
      return { plist, wasLoaded, removedPlist };
    },
    status,
    restart: async () => {
      assertMacOs();
      if (!(await isLoaded())) {
        throw new DomainError(
          'service_not_installed',
          'The background service is not installed. Run `shinsa service install` first.'
        );
      }
      await run(['kickstart', '-k', target]);
      return status();
    },
    logs: (lines) => {
      if (!existsSync(log)) return { path: log, lines: [] };
      const all = readFileSync(log, 'utf8').split('\n');
      if (all.at(-1) === '') all.pop();
      return { path: log, lines: all.slice(-Math.max(1, lines)) };
    },
  };
}
