import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DomainError } from '@shinsa/core';
import { Effect, FileSystem } from 'effect';
import { isPresent, selectText } from '../files/probe.ts';
import { STOP_DEADLINE_MS } from './restart/schema.ts';
import {
  type EngineService,
  runServiceCommand,
  SERVICE_CARRIED_ENV,
  SERVICE_MARKER,
  type ServiceRunner,
} from './service/index.ts';

type Env = Record<string, string | undefined>;

export const SYSTEMD_UNIT = 'shinsa.service';

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
  const carried = SERVICE_CARRIED_ENV.flatMap((key) => {
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

export const createSystemdService = Effect.fn('Systemd.createService')(function* (options: SystemdOptions) {
  const fs = yield* FileSystem.FileSystem;
  const withFiles = Effect.provideService(FileSystem.FileSystem, fs);
  const { systemctl, loginctl, user } = options;
  const path = resolveUnitPath(options.env);
  const run = (args: string[]) => runServiceCommand('systemctl', systemctl, args);
  const isInstalled = withFiles(isPresent(path));

  const assertInstalled = Effect.gen(function* () {
    if (yield* isInstalled) return;
    return yield* new DomainError({
      code: 'engine_not_installed',
      message: 'The engine is not set up as a service yet. `shinsa start` sets it up.',
    });
  });

  const readLingerHint = Effect.gen(function* () {
    const linger = yield* loginctl(['show-user', user, '--property=Linger', '--value']);
    if (!linger.ok || linger.output.trim() !== 'no') return null;
    return `It stops when you log out. To keep it running and start it at boot, turn on lingering: \`sudo loginctl enable-linger ${user}\`.`;
  });

  const writeUnit = Effect.gen(function* () {
    const unit = resolveUnit(options.program, options.env);
    const written = yield* withFiles(selectText(path));
    if (written._tag === 'Some' && written.value === unit) return;
    yield* fs
      .makeDirectory(dirname(path), { recursive: true })
      .pipe(Effect.andThen(fs.writeFileString(path, unit)), Effect.orDie);
    yield* run(['daemon-reload']);
  });

  const prepare = Effect.gen(function* () {
    if (!(yield* systemctl(['show-environment'])).ok) {
      return yield* new DomainError({
        code: 'engine_no_systemd',
        message:
          'This machine has no systemd user manager to keep the engine running. Log in as this user over SSH rather than with `su`, or run `shinsa engine` under a process manager of your own.',
      });
    }
    yield* writeUnit;
    yield* run(['enable', SYSTEMD_UNIT]);
    return yield* readLingerHint;
  });

  const kick = Effect.gen(function* () {
    if (!(yield* isInstalled)) return false;
    return (yield* systemctl(['start', SYSTEMD_UNIT])).ok;
  });

  const service: EngineService = {
    manager: 'systemd',
    revivesKilled: false,
    prepare,
    assertInstalled,
    start: run(['start', SYSTEMD_UNIT]),
    stop: run(['stop', '--no-block', SYSTEMD_UNIT]),
    kill: run(['kill', '--signal=SIGKILL', SYSTEMD_UNIT]),
    restart: run(['restart', SYSTEMD_UNIT]),
    kick,
  };
  return service;
});
