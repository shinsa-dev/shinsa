import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DomainError, resolveEngineLabel } from '@shinsa/core';
import {
  type EngineService,
  runServiceOrThrow,
  SERVICE_CARRIED_ENV,
  SERVICE_MARKER,
  type ServiceRunner,
} from '../instance/index.ts';
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
  ownsJob: (printed: string) => boolean;
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

function readAgent(path: string) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export function createLaunchdService(options: LaunchdOptions): EngineService {
  const { uid, launchctl, ownsJob, inApp = true, program = process.execPath, env = {} } = options;
  const target = resolveEngineTarget(uid);
  const label = resolveEngineLabel(APP_BUNDLE_ID);
  const path = resolveLaunchAgentPath(options.home ?? homedir(), label);
  const run = (args: string[]) => runServiceOrThrow('launchctl', launchctl, args);

  const assertInstalled = async () => {
    const printed = await launchctl(['print', target]);
    if (!printed.ok) {
      throw new DomainError(
        'engine_not_installed',
        inApp
          ? 'The engine is not set up yet. Open the Shinsa app once and it sets it up.'
          : 'The engine is not set up yet. `shinsa start` sets it up.'
      );
    }
    if (ownsJob(printed.output)) return;
    if (inApp) {
      throw new DomainError(
        'engine_not_this_app',
        'This shinsa is not the one inside the Shinsa app that runs your engine, so it leaves that engine alone. Use `shinsa` from your PATH, which the app keeps pointing at itself.'
      );
    }
    if (isAppJob(printed.output)) {
      throw new DomainError(
        'engine_not_this_app',
        'The Shinsa app runs the engine on this Mac, so this shinsa leaves it alone. Use the app, or `shinsa` from your PATH, which the app keeps pointing at itself.'
      );
    }
    throw new DomainError(
      'engine_not_this_install',
      'Another shinsa set up the engine on this Mac, so this one leaves it alone. `shinsa start` from this one takes it over.'
    );
  };

  const writeAgent = async (printed: { ok: boolean; output: string }) => {
    if (printed.ok && isAppJob(printed.output)) {
      if (ownsJob(printed.output)) return;
      throw new DomainError(
        'engine_beside_app',
        'The Shinsa app runs the engine on this Mac, so this shinsa does not start a second one on the same port. Use the app, or quit and remove it to run this engine on its own.'
      );
    }
    const agent = resolveLaunchAgent(label, program, env);
    if (printed.ok && readAgent(path) === agent) return;
    if (printed.ok) await run(['bootout', target]);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, agent);
    await run(['bootstrap', `gui/${uid}`, path]);
  };

  return {
    manager: 'launchd',
    revivesKilled: true,
    prepare: async () => {
      if (inApp) await assertInstalled();
      else await writeAgent(await launchctl(['print', target]));
      return null;
    },
    assertInstalled,
    start: () => run(['kickstart', target]),
    stop: () => run(['kill', 'SIGTERM', target]),
    kill: () => run(['kill', 'SIGKILL', target]),
    restart: () => run(['kickstart', '-k', target]),
    kick: async () => {
      const printed = await launchctl(['print', target]);
      if (!printed.ok || !ownsJob(printed.output)) return false;
      return (await launchctl(['kickstart', target])).ok;
    },
  };
}
