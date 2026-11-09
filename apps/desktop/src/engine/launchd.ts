import { join } from 'node:path';
import { resolveEngineLabel } from '@shinsa/core';
import { Option, Schema } from 'effect';
import { resolveConfigHome } from '../server/url.ts';
import {
  AGENT_PROGRAM,
  APP_ID,
  CRASHES_BEFORE_GIVING_UP,
  ENGINE_LABEL,
  ENGINE_LOG,
  ENGINE_VARIABLES,
  EX_CONFIG,
  LAUNCHD_FIELDS,
  type LaunchdJob,
  LockHolder,
  Registration,
  RESTART_THROTTLE_SECONDS,
} from './schema.ts';

const decodeRegistration = Schema.decodeUnknownOption(Registration);

const decodeLockHolder = Schema.decodeUnknownOption(LockHolder);

function escapeXml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function unescapeXml(text: string) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function serializeString(text: string) {
  return `<string>${escapeXml(text)}</string>`;
}

function readNumber(text: string, pattern: RegExp) {
  const match = pattern.exec(text);
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function listEngineVariables(env: Record<string, string | undefined>) {
  const variables: Record<string, string> = { SHINSA_SERVICE: '1' };
  for (const name of ENGINE_VARIABLES) {
    const value = env[name];
    if (value) variables[name] = value;
  }
  return variables;
}

export function serializeEngineAgent(
  program: { bundle: string } | { path: string },
  variables: Record<string, string> = { SHINSA_SERVICE: '1' },
  appId = APP_ID
) {
  const location =
    'bundle' in program
      ? [
          '  <key>BundleProgram</key>',
          `  ${serializeString(program.bundle)}`,
          '  <key>AssociatedBundleIdentifiers</key>',
          '  <array>',
          `    ${serializeString(appId)}`,
          '  </array>',
        ]
      : [];
  const executable = 'bundle' in program ? 'shinsa' : program.path;
  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  ${serializeString(resolveEngineLabel(appId))}`,
    ...location,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    ${serializeString(executable)}`,
    `    ${serializeString('engine')}`,
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    ...Object.keys(variables)
      .sort()
      .flatMap((name) => [
        `    <key>${escapeXml(name)}</key>`,
        `    ${serializeString(variables[name] ?? '')}`,
      ]),
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

export function resolveLaunchAgentPath(home: string, label = ENGINE_LABEL) {
  return join(home, 'Library', 'LaunchAgents', `${label}.plist`);
}

export function resolveEngineTarget(uid: number, label = ENGINE_LABEL) {
  return `gui/${uid}/${label}`;
}

export function isStandaloneAgent(plist: string, appProgram: string) {
  const program = AGENT_PROGRAM.exec(plist)?.[1];
  return program !== undefined && unescapeXml(program) !== appProgram;
}

export function resolveEngineProgram(resourcesPath: string) {
  return join(resourcesPath, 'engine', 'bin', 'shinsa');
}

export function parseRegistration(value: unknown): Registration {
  return Option.getOrElse(decodeRegistration(value), () => 'unsupported' as const);
}

export function parseLaunchdJob(printed: string): LaunchdJob {
  return {
    pid: readNumber(printed, LAUNCHD_FIELDS.pid),
    runs: readNumber(printed, LAUNCHD_FIELDS.runs) ?? 0,
    lastExitCode: readNumber(printed, LAUNCHD_FIELDS.lastExitCode),
    spawnFailed: LAUNCHD_FIELDS.spawnFailed.test(printed),
  };
}

export function isOnOtherPort(job: LaunchdJob, lockText: string | null, port: number) {
  const holder = Option.getOrNull(decodeLockHolder(lockText));
  return job.pid !== null && holder?.pid === job.pid && holder.port !== port;
}

export function isSpawnRefused(job: LaunchdJob) {
  return job.spawnFailed || job.lastExitCode === EX_CONFIG;
}

export function isCrashing(job: LaunchdJob) {
  return job.runs >= CRASHES_BEFORE_GIVING_UP && (job.lastExitCode ?? 0) !== 0;
}

export function resolveDataDir(env: Record<string, string | undefined>, home: string) {
  if (env.SHINSA_HOME) return join(env.SHINSA_HOME, 'data');
  if (env.SHINSA_DATA_DIR) return env.SHINSA_DATA_DIR;
  return join(resolveConfigHome(env, home), 'data');
}

export function resolveEngineLog(env: Record<string, string | undefined>, home: string) {
  return join(resolveDataDir(env, home), ENGINE_LOG);
}
