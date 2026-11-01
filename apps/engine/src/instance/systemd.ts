import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DomainError } from '@shinsa/core';
import { STOP_DEADLINE_MS } from './restart.ts';
import { type EngineService, runServiceOrThrow, SERVICE_MARKER, type ServiceRunner } from './service.ts';

type Env = Record<string, string | undefined>;

export const SYSTEMD_UNIT = 'shinsa.service';

const CARRIED_ENV = ['SHINSA_HOME', 'SHINSA_DATA_DIR', 'XDG_CONFIG_HOME', 'SHINSA_PORT', 'SHINSA_HOST'];

const STOP_TIMEOUT_S = STOP_DEADLINE_MS / 1000 + 10;

const EXEC_ESCAPES: Record<string, string> = { '\\': '\\\\', '"': '\\"', '%': '%%', $: '$$' };

interface SystemdOptions {
  env: Env;
  program: string;
  user: string;
  systemctl: ServiceRunner;
  loginctl: ServiceRunner;
}

function quoteUnitValue(value: string, escaped: RegExp) {
  return `"${value.replace(escaped, (char) => EXEC_ESCAPES[char] ?? char)}"`;
}

export function resolveUnitPath(env: Env) {
  const config = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(config, 'systemd', 'user', SYSTEMD_UNIT);
}

export function resolveUnit(program: string, env: Env) {
  const carried = CARRIED_ENV.flatMap((key) => {
    const value = env[key];
    return value ? [`Environment=${quoteUnitValue(`${key}=${value}`, /[\\"%]/g)}`] : [];
  });
  return [
    '[Unit]',
    'Description=Shinsa engine',
    '',
    '[Service]',
    `ExecStart=${quoteUnitValue(program, /[\\"%$]/g)} engine`,
    `Environment=${SERVICE_MARKER}=1`,
    ...carried,
    'Restart=on-failure',
    'RestartSec=2',
    `TimeoutStopSec=${STOP_TIMEOUT_S}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

function readUnit(path: string) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export function createSystemdService(options: SystemdOptions): EngineService {
  const { systemctl, loginctl, user } = options;
  const path = resolveUnitPath(options.env);
  const run = (args: string[]) => runServiceOrThrow('systemctl', systemctl, args);

  const assertInstalled = () => {
    if (existsSync(path)) return Promise.resolve();
    return Promise.reject(
      new DomainError(
        'engine_not_installed',
        'The engine is not set up as a service yet. `shinsa start` sets it up.'
      )
    );
  };

  const readLingerHint = async () => {
    const linger = await loginctl(['show-user', user, '--property=Linger', '--value']);
    if (!linger.ok || linger.output.trim() !== 'no') return null;
    return `It stops when you log out. To keep it running and start it at boot, turn on lingering: \`sudo loginctl enable-linger ${user}\`.`;
  };

  return {
    manager: 'systemd',
    revivesKilled: false,
    prepare: async () => {
      if (!(await systemctl(['show-environment'])).ok) {
        throw new DomainError(
          'engine_no_systemd',
          'This machine has no systemd user manager to keep the engine running. Log in as this user over SSH rather than with `su`, or run `shinsa engine` under a process manager of your own.'
        );
      }
      const unit = resolveUnit(options.program, options.env);
      if (readUnit(path) !== unit) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, unit);
        await run(['daemon-reload']);
      }
      await run(['enable', SYSTEMD_UNIT]);
      return readLingerHint();
    },
    assertInstalled,
    start: () => run(['start', SYSTEMD_UNIT]),
    stop: () => run(['stop', '--no-block', SYSTEMD_UNIT]),
    kill: () => run(['kill', '--signal=SIGKILL', SYSTEMD_UNIT]),
    restart: () => run(['restart', SYSTEMD_UNIT]),
    kick: async () => existsSync(path) && (await systemctl(['start', SYSTEMD_UNIT])).ok,
  };
}
