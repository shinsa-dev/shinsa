import { describe, expect, test } from 'bun:test';
import { parseLaunchdJob, SERVICE_LABEL, serializeLaunchAgent } from '../../src/service/launchd.ts';

describe('the LaunchAgent plist', () => {
  test('runs the server from bun at login, restarts it after a crash and logs to the data folder', () => {
    const plist = serializeLaunchAgent({
      label: SERVICE_LABEL,
      program: ['/Users/me/.bun/bin/bun', '/src/R&D <shinsa>/apps/server/src/main.ts', 'serve'],
      workingDirectory: '/src/shinsa',
      environment: { SHINSA_PORT: '5190', SHINSA_HOME: '/Users/me/it\'s "here"' },
      logPath: '/Users/me/.config/shinsa/data/serve.log',
    });
    expect(plist).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>studio.overclock.shinsa</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/me/.bun/bin/bun</string>
    <string>/src/R&amp;D &lt;shinsa&gt;/apps/server/src/main.ts</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/src/shinsa</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SHINSA_HOME</key>
    <string>/Users/me/it&apos;s &quot;here&quot;</string>
    <key>SHINSA_PORT</key>
    <string>5190</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>/Users/me/.config/shinsa/data/serve.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/me/.config/shinsa/data/serve.log</string>
</dict>
</plist>
`);
  });

  test('leaves the environment out when there is nothing to pass', () => {
    const plist = serializeLaunchAgent({
      label: SERVICE_LABEL,
      program: ['bun'],
      workingDirectory: '/',
      environment: {},
      logPath: '/log',
    });
    expect(plist).not.toContain('EnvironmentVariables');
  });
});

describe('reading launchctl print', () => {
  test('takes the job’s own state, pid and last exit code, not those of nested sections', () => {
    const printed = [
      `gui/501/${SERVICE_LABEL} = {`,
      '\tactive count = 1',
      '\tstate = running',
      '\tendpoints = {',
      '\t\tstate = active',
      '\t\tpid = 1',
      '\t}',
      '\tpid = 4242',
      '\tpid = 9',
      '\tlast exit code = 1',
      '\tno separator here',
      '}',
    ].join('\n');
    expect(parseLaunchdJob(printed)).toEqual({ state: 'running', pid: 4242, lastExitCode: 1 });
  });

  test('a job that never ran has no pid and no exit code', () => {
    expect(parseLaunchdJob('\tstate = not running\n\tlast exit code = (never exited)')).toEqual({
      state: 'not running',
      pid: null,
      lastExitCode: null,
    });
  });
});
