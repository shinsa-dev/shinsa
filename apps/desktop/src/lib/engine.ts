import { join } from 'node:path';

export const APP_ID = process.env.SHINSA_APP_ID || 'studio.overclock.shinsa';

export const ENGINE_LABEL = `${APP_ID}.engine`;

export const ENGINE_PLIST = `${ENGINE_LABEL}.plist`;

export const ENGINE_BUNDLE_PROGRAM = 'Contents/Resources/engine/bin/shinsa';

export const ENGINE_LOG = 'engine.log';

export const LOGIN_ITEMS_URL = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension';

export const PRIVACY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

const RESTART_THROTTLE_SECONDS = 5;

const CRASHES_BEFORE_GIVING_UP = 3;

const LOG_TAIL_LINES = 12;

export type Registration = 'enabled' | 'requires-approval' | 'not-registered' | 'not-found' | 'unsupported';

export type EngineAction = 'open-login-items' | 'restart' | 'copy-details' | 'retry' | 'open-privacy';

export type EngineScreen =
  | { kind: 'starting' }
  | { kind: 'dev' }
  | { kind: 'approval' }
  | { kind: 'crashing'; detail: string }
  | { kind: 'port'; port: number; detail: string }
  | { kind: 'stopped'; detail: string };

export interface EngineScreenView {
  title: string;
  text: string;
  actions: EngineAction[];
  detail: string;
  busy: boolean;
}

export interface LaunchdJob {
  pid: number | null;
  runs: number;
  lastExitCode: number | null;
  spawnFailed: boolean;
}

const EX_CONFIG = 78;

function escapeXml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function serializeString(text: string) {
  return `<string>${escapeXml(text)}</string>`;
}

export function listEngineVariables(env: Record<string, string | undefined>) {
  const variables: Record<string, string> = { SHINSA_SERVICE: '1' };
  for (const name of ['SHINSA_HOME', 'SHINSA_DATA_DIR']) {
    const value = env[name];
    if (value) variables[name] = value;
  }
  return variables;
}

export function serializeEngineAgent(
  program: { bundle: string } | { path: string },
  variables: Record<string, string> = { SHINSA_SERVICE: '1' }
) {
  const location =
    'bundle' in program
      ? [
          '  <key>BundleProgram</key>',
          `  ${serializeString(program.bundle)}`,
          '  <key>AssociatedBundleIdentifiers</key>',
          '  <array>',
          `    ${serializeString(APP_ID)}`,
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
    `  ${serializeString(ENGINE_LABEL)}`,
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

export function resolveEngineProgram(resourcesPath: string) {
  return join(resourcesPath, 'engine', 'bin', 'shinsa');
}

export function parseRegistration(value: unknown): Registration {
  return value === 'enabled' ||
    value === 'requires-approval' ||
    value === 'not-registered' ||
    value === 'not-found'
    ? value
    : 'unsupported';
}

function readNumber(text: string, pattern: RegExp) {
  const match = pattern.exec(text);
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function parseLaunchdJob(printed: string): LaunchdJob {
  return {
    pid: readNumber(printed, /^\s*pid = (\d+)/m),
    runs: readNumber(printed, /^\s*runs = (\d+)/m) ?? 0,
    lastExitCode: readNumber(printed, /^\s*last exit code = (-?\d+)/m),
    spawnFailed: /^\s*job state = spawn failed/m.test(printed),
  };
}

export function isSpawnRefused(job: LaunchdJob) {
  return job.spawnFailed || job.lastExitCode === EX_CONFIG;
}

export function isCrashing(job: LaunchdJob) {
  return job.runs >= CRASHES_BEFORE_GIVING_UP && (job.lastExitCode ?? 0) !== 0;
}

function describeLogLine(line: string) {
  if (!line.startsWith('{')) return line;
  try {
    const entry = JSON.parse(line) as { level?: unknown; message?: unknown; error?: unknown };
    if (entry.level !== 'warn' && entry.level !== 'error') return null;
    const message = typeof entry.message === 'string' ? entry.message : '';
    return typeof entry.error === 'string' ? `${message}: ${entry.error}` : message;
  } catch {
    return line;
  }
}

export function resolveLogTail(text: string, lines = LOG_TAIL_LINES) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(describeLogLine)
    .filter((line, index, all): line is string => Boolean(line) && line !== all[index - 1])
    .slice(-lines)
    .join('\n');
}

export function selectBusyPort(log: string) {
  const match = /Is port (\d+) in use\?/.exec(log);
  return match?.[1] ? Number(match[1]) : null;
}

export function describeEngineScreen(screen: EngineScreen): EngineScreenView {
  switch (screen.kind) {
    case 'starting':
      return {
        title: 'Starting Shinsa',
        text: 'Shinsa’s engine is starting. It keeps running in the background, also when this window is closed.',
        actions: [],
        detail: '',
        busy: true,
      };
    case 'dev':
      return {
        title: 'Waiting for Shinsa',
        text: 'Start the dev servers with “bun dev” in the checkout. The window opens Shinsa as soon as they answer.',
        actions: [],
        detail: '',
        busy: true,
      };
    case 'approval':
      return {
        title: 'Allow Shinsa to run in the background',
        text: 'Shinsa’s engine runs your agents and schedules while the app is closed. Turn Shinsa on in System Settings → General → Login Items & Extensions, then come back.',
        actions: ['open-login-items', 'retry'],
        detail: '',
        busy: false,
      };
    case 'crashing':
      return {
        title: 'Shinsa’s engine keeps stopping',
        text: 'It stopped several times in a row. Start it again, and if it stops again, copy the details below into a bug report.',
        actions: ['restart', 'copy-details'],
        detail: screen.detail,
        busy: false,
      };
    case 'port':
      return {
        title: `Port ${screen.port} is taken`,
        text: `Another program listens on port ${screen.port}, where Shinsa’s engine runs. Quit that program and start the engine again, or set another "port" in Shinsa’s config.json.`,
        actions: ['restart', 'copy-details'],
        detail: screen.detail,
        busy: false,
      };
    case 'stopped':
      return {
        title: 'Shinsa’s engine is not running',
        text: 'The engine did not start. Start it again; if a folder Shinsa works in is in Desktop, Documents or Downloads, give Shinsa Full Disk Access first.',
        actions: ['restart', 'open-privacy', 'copy-details'],
        detail: screen.detail,
        busy: false,
      };
  }
}

export const ENGINE_ACTION_LABEL: Record<EngineAction, string> = {
  'open-login-items': 'Open Login Items',
  restart: 'Start engine',
  'copy-details': 'Copy details',
  retry: 'Try again',
  'open-privacy': 'Open Privacy & Security',
};

export function parseEngineAction(url: string): EngineAction | null {
  const match = /^shinsa:\/\/engine\/([a-z-]+)$/.exec(url);
  const action = match?.[1];
  return action && action in ENGINE_ACTION_LABEL ? (action as EngineAction) : null;
}

export function resolveDataDir(env: Record<string, string | undefined>, home: string) {
  if (env.SHINSA_HOME) return join(env.SHINSA_HOME, 'data');
  if (env.SHINSA_DATA_DIR) return env.SHINSA_DATA_DIR;
  return join(env.XDG_CONFIG_HOME || join(env.HOME || home, '.config'), 'shinsa', 'data');
}
