export interface LaunchAgent {
  label: string;
  program: string[];
  workingDirectory: string;
  environment: Record<string, string>;
  logPath: string;
}

export interface LaunchdJob {
  state: string | null;
  pid: number | null;
  lastExitCode: number | null;
}

export const SERVICE_LABEL = 'studio.overclock.shinsa';

const RESTART_THROTTLE_SECONDS = 5;

function escapeXml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function serializeString(text: string, indent: string) {
  return `${indent}<string>${escapeXml(text)}</string>`;
}

function serializeEnvironment(environment: Record<string, string>) {
  const keys = Object.keys(environment).sort();
  if (keys.length === 0) return [];
  return [
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    ...keys.flatMap((key) => [
      `    <key>${escapeXml(key)}</key>`,
      serializeString(environment[key] ?? '', '    '),
    ]),
    '  </dict>',
  ];
}

export function serializeLaunchAgent(agent: LaunchAgent) {
  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    serializeString(agent.label, '  '),
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...agent.program.map((part) => serializeString(part, '    ')),
    '  </array>',
    '  <key>WorkingDirectory</key>',
    serializeString(agent.workingDirectory, '  '),
    ...serializeEnvironment(agent.environment),
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>ThrottleInterval</key>',
    `  <integer>${RESTART_THROTTLE_SECONDS}</integer>`,
    '  <key>StandardOutPath</key>',
    serializeString(agent.logPath, '  '),
    '  <key>StandardErrorPath</key>',
    serializeString(agent.logPath, '  '),
    '</dict>',
    '</plist>',
  ].join('\n')}\n`;
}

function readNumber(value: string | undefined) {
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

export function parseLaunchdJob(printed: string): LaunchdJob {
  const fields = new Map<string, string>();
  for (const line of printed.split('\n')) {
    if (!line.startsWith('\t') || line.startsWith('\t\t')) continue;
    const equals = line.indexOf(' = ');
    if (equals < 0) continue;
    const key = line.slice(1, equals).trim();
    if (!fields.has(key)) fields.set(key, line.slice(equals + 3).trim());
  }
  return {
    state: fields.get('state') ?? null,
    pid: readNumber(fields.get('pid')),
    lastExitCode: readNumber(fields.get('last exit code')),
  };
}
