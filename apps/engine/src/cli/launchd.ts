import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DomainError, resolveEngineLabel } from '@shinsa/core';
import { Effect, FileSystem } from 'effect';
import { selectText } from '../files/probe.ts';
import {
  type EngineService,
  runServiceCommand,
  SERVICE_CARRIED_ENV,
  SERVICE_MARKER,
  ServiceCommandFailed,
  type ServiceRunner,
} from '../instance/index.ts';
import { describeError } from '../log/redact.ts';
import type { Shell } from '../shell/service.ts';
import { APP_BUNDLE_ID, parseEngineJob, resolveEngineTarget } from './app.ts';

type Env = Record<string, string | undefined>;

const RESTART_THROTTLE_SECONDS = 5;

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export interface LaunchdOptions {
  uid: number;
  launchctl: ServiceRunner;
  ownsJob: (printed: string) => Effect.Effect<boolean, never, Shell>;
  inApp?: boolean;
  program?: string;
  home?: string;
  env?: Env;
}

function serializeString(text: string) {
  return `<string>${text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char)}</string>`;
}

function resolveLaunchAgentPath(home: string, label: string) {
  return join(home, 'Library', 'LaunchAgents', `${label}.plist`);
}

export function resolveLaunchAgent(label: string, program: string, env: Env) {
  const variables: Record<string, string> = { [SERVICE_MARKER]: '1' };
  for (const key of SERVICE_CARRIED_ENV) {
    const value = env[key];
    if (value) variables[key] = value;
  }
  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  ${serializeString(label)}`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    ${serializeString(program)}`,
    `    ${serializeString('engine')}`,
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    ...Object.keys(variables)
      .sort()
      .flatMap((name) => [`    <key>${name}</key>`, `    ${serializeString(variables[name] ?? '')}`]),
    '  </dict>',
    '  <key>ProcessType</key>',
    `  ${serializeString('Interactive')}`,
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>ThrottleInterval</key>',
    `  <integer>${RESTART_THROTTLE_SECONDS}</integer>`,
    '</dict>',
    '</plist>',
  ].join('\n')}\n`;
}

export function isAppJob(printed: string) {
  const job = parseEngineJob(printed);
  return job.bundleId !== null || Boolean(job.program?.includes('.app/Contents/'));
}

export function createLaunchdService(options: LaunchdOptions): EngineService {
  const { uid, launchctl, ownsJob, inApp = true, program = process.execPath, env = {} } = options;
  const target = resolveEngineTarget(uid);
  const label = resolveEngineLabel(APP_BUNDLE_ID);
  const path = resolveLaunchAgentPath(options.home ?? homedir(), label);
  const run = (args: string[]) => runServiceCommand('launchctl', launchctl, args);
  const printJob = Effect.suspend(() => launchctl(['print', target]));

  const assertInstalled = Effect.gen(function* () {
    const printed = yield* printJob;
    if (!printed.ok) {
      return yield* new DomainError({
        code: 'engine_not_installed',
        message: inApp
          ? 'The engine is not set up yet. Open the Shinsa app once and it sets it up.'
          : 'The engine is not set up yet. `shinsa start` sets it up.',
      });
    }
    if (yield* ownsJob(printed.output)) return;
    if (inApp) {
      return yield* new DomainError({
        code: 'engine_not_this_app',
        message:
          'This shinsa is not the one inside the Shinsa app that runs your engine, so it leaves that engine alone. Use `shinsa` from your PATH, which the app keeps pointing at itself.',
      });
    }
    if (isAppJob(printed.output)) {
      return yield* new DomainError({
        code: 'engine_not_this_app',
        message:
          'The Shinsa app runs the engine on this Mac, so this shinsa leaves it alone. Use the app, or `shinsa` from your PATH, which the app keeps pointing at itself.',
      });
    }
    return yield* new DomainError({
      code: 'engine_not_this_install',
      message:
        'Another shinsa set up the engine on this Mac, so this one leaves it alone. `shinsa start` from this one takes it over.',
    });
  });

  const writeAgent = Effect.gen(function* () {
    const printed = yield* printJob;
    if (printed.ok && isAppJob(printed.output)) {
      if (yield* ownsJob(printed.output)) return;
      return yield* new DomainError({
        code: 'engine_beside_app',
        message:
          'The Shinsa app runs the engine on this Mac, so this shinsa does not start a second one on the same port. Use the app, or quit and remove it to run this engine on its own.',
      });
    }
    const agent = resolveLaunchAgent(label, program, env);
    const fs = yield* FileSystem.FileSystem;
    const written = yield* selectText(path);
    if (printed.ok && written._tag === 'Some' && written.value === agent) return;
    if (printed.ok) yield* run(['bootout', target]);
    yield* fs.makeDirectory(dirname(path), { recursive: true }).pipe(
      Effect.andThen(fs.writeFileString(path, agent)),
      Effect.mapError((error) => new ServiceCommandFailed({ message: describeError(error) }))
    );
    yield* run(['bootstrap', `gui/${uid}`, path]);
  });

  const kick = Effect.gen(function* () {
    const printed = yield* printJob;
    if (!printed.ok || !(yield* ownsJob(printed.output))) return false;
    return (yield* launchctl(['kickstart', target])).ok;
  });

  return {
    manager: 'launchd',
    revivesKilled: true,
    prepare: Effect.as(inApp ? assertInstalled : writeAgent, null),
    assertInstalled,
    start: run(['kickstart', target]),
    stop: run(['kill', 'SIGTERM', target]),
    kill: run(['kill', 'SIGKILL', target]),
    restart: run(['kickstart', '-k', target]),
    kick,
  };
}
