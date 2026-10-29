import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  APP_ID,
  describeEngineScreen,
  ENGINE_ACTION_LABEL,
  ENGINE_BUNDLE_PROGRAM,
  ENGINE_LABEL,
  ENGINE_PLIST,
  type EngineScreen,
  isCrashing,
  isOnOtherPort,
  isSpawnRefused,
  listEngineVariables,
  parseEngineAction,
  parseLaunchdJob,
  parseRegistration,
  resolveDataDir,
  resolveEngineProgram,
  resolveEngineTarget,
  resolveLaunchAgentPath,
  resolveLogTail,
  selectBusyPort,
  serializeEngineAgent,
} from '../../src/lib/engine.ts';

describe('the engine’s launchd job', () => {
  it('is named after the app', () => {
    expect(APP_ID).toBe('studio.overclock.shinsa');
    expect(ENGINE_LABEL).toBe('studio.overclock.shinsa.engine');
    expect(ENGINE_PLIST).toBe('studio.overclock.shinsa.engine.plist');
    expect(resolveEngineTarget(501)).toBe('gui/501/studio.overclock.shinsa.engine');
    expect(resolveEngineTarget(501, 'x')).toBe('gui/501/x');
    expect(resolveLaunchAgentPath('/Users/me')).toBe(
      '/Users/me/Library/LaunchAgents/studio.overclock.shinsa.engine.plist'
    );
    expect(resolveEngineProgram('/A/Contents/Resources')).toBe('/A/Contents/Resources/engine/bin/shinsa');
  });

  it('ships in the app as the plist the code writes, run from inside the bundle', () => {
    const shipped = readFileSync(
      join(import.meta.dirname, '../../resources/LaunchAgents', ENGINE_PLIST),
      'utf8'
    );
    expect(shipped).toBe(serializeEngineAgent({ bundle: ENGINE_BUNDLE_PROGRAM }));
    expect(shipped).toContain('<key>BundleProgram</key>');
    expect(shipped).toContain('<string>studio.overclock.shinsa</string>');
    expect(shipped).toContain('<key>SuccessfulExit</key>\n    <false/>');
  });

  it('as a plain LaunchAgent names the program by its path and carries the data folder', () => {
    const agent = serializeEngineAgent(
      { path: '/Applications/Shin & Sa.app/engine/bin/shinsa' },
      listEngineVariables({ SHINSA_HOME: '/tmp/h', SHINSA_DATA_DIR: '', OTHER: 'x' })
    );
    expect(agent).not.toContain('BundleProgram');
    expect(agent).toContain('<string>/Applications/Shin &amp; Sa.app/engine/bin/shinsa</string>');
    expect(agent).toContain('<key>SHINSA_HOME</key>\n    <string>/tmp/h</string>');
    expect(agent).toContain('<key>SHINSA_SERVICE</key>\n    <string>1</string>');
    expect(agent).not.toContain('OTHER');
    expect(listEngineVariables({ SHINSA_DATA_DIR: '/d' })).toEqual({
      SHINSA_SERVICE: '1',
      SHINSA_DATA_DIR: '/d',
    });
  });

  it('reads the login item status, and anything unknown as unsupported', () => {
    for (const status of ['enabled', 'requires-approval', 'not-registered', 'not-found'] as const)
      expect(parseRegistration(status)).toBe(status);
    expect(parseRegistration(undefined)).toBe('unsupported');
  });

  it('reads launchd’s view of the job and calls three failing runs in a row a crash loop', () => {
    const printed = ['\tstate = waiting', '\tpid = 812', '\truns = 4', '\tlast exit code = 1'].join('\n');
    expect(parseLaunchdJob(printed)).toEqual({ pid: 812, runs: 4, lastExitCode: 1, spawnFailed: false });
    expect(parseLaunchdJob('')).toEqual({ pid: null, runs: 0, lastExitCode: null, spawnFailed: false });
    const job = { pid: null, runs: 9, lastExitCode: 1, spawnFailed: false };
    expect(isCrashing({ ...job, pid: 812, runs: 4 })).toBe(true);
    expect(isCrashing({ ...job, runs: 2 })).toBe(false);
    expect(isCrashing({ ...job, lastExitCode: 0 })).toBe(false);
    expect(isCrashing({ ...job, lastExitCode: null })).toBe(false);
  });

  it('tells a job launchd refuses to start, as after the app was replaced, from one that crashes', () => {
    const refused = parseLaunchdJob(
      ['\tjob state = spawn failed', '\tlast exit code = 78: EX_CONFIG'].join('\n')
    );
    expect(refused).toMatchObject({ spawnFailed: true, lastExitCode: 78 });
    expect(isSpawnRefused(refused)).toBe(true);
    expect(isSpawnRefused({ pid: null, runs: 1, lastExitCode: 78, spawnFailed: false })).toBe(true);
    expect(isSpawnRefused({ pid: null, runs: 4, lastExitCode: 1, spawnFailed: false })).toBe(false);
  });
});

describe('an engine left on another port', () => {
  const job = { pid: 812, runs: 1, lastExitCode: null, spawnFailed: false };
  const lock = (holder: object) =>
    JSON.stringify({ version: '0.4.0', url: 'http://127.0.0.1:5180', ...holder });

  it('is the job’s own engine still on the port of the version before an update', () => {
    expect(isOnOtherPort(job, lock({ pid: 812, port: 5180 }), 7446)).toBe(true);
  });

  it('is not an engine on this port, another program’s lock, or a job that is not running', () => {
    expect(isOnOtherPort(job, lock({ pid: 812, port: 7446 }), 7446)).toBe(false);
    expect(isOnOtherPort(job, lock({ pid: 9001, port: 5180 }), 7446)).toBe(false);
    expect(isOnOtherPort({ ...job, pid: null }, lock({ pid: 812, port: 5180 }), 7446)).toBe(false);
  });

  it('reads no holder from a missing, broken or partial lock', () => {
    for (const text of [null, '', '{ broken', 'null', '7', JSON.stringify({ pid: 812 })]) {
      expect(isOnOtherPort(job, text, 7446)).toBe(false);
    }
  });
});

describe('the engine log', () => {
  it('keeps the warnings, errors and plain lines, once each, in plain words', () => {
    const log = [
      '{"level":"info","message":"[Serve] Ready"}',
      '{"level":"warn","message":"[Accounts] Could not check","error":"offline"}',
      '{"level":"error","message":"[Serve] Could not stop"}',
      '{"level":"warn","error":3}',
      '{not json',
      '',
      'shinsa engine: Failed to start server. Is port 5199 in use?',
      'shinsa engine: Failed to start server. Is port 5199 in use?',
    ].join('\n');
    expect(resolveLogTail(log)).toBe(
      [
        '[Accounts] Could not check: offline',
        '[Serve] Could not stop',
        '{not json',
        'shinsa engine: Failed to start server. Is port 5199 in use?',
      ].join('\n')
    );
    expect(resolveLogTail(log, 1)).toBe('shinsa engine: Failed to start server. Is port 5199 in use?');
    expect(selectBusyPort(log)).toBe(5199);
    expect(selectBusyPort('fine')).toBeNull();
  });

  it('lives in the data folder the engine uses', () => {
    expect(resolveDataDir({ SHINSA_HOME: '/h' }, '/u')).toBe('/h/data');
    expect(resolveDataDir({ SHINSA_DATA_DIR: '/d' }, '/u')).toBe('/d');
    expect(resolveDataDir({ XDG_CONFIG_HOME: '/x' }, '/u')).toBe('/x/shinsa/data');
    expect(resolveDataDir({ HOME: '/me' }, '/u')).toBe('/me/.config/shinsa/data');
    expect(resolveDataDir({}, '/u')).toBe('/u/.config/shinsa/data');
  });
});

describe('the status screen', () => {
  it('says what is happening and offers only what fixes it', () => {
    const screens: EngineScreen[] = [
      { kind: 'starting' },
      { kind: 'dev' },
      { kind: 'approval' },
      { kind: 'crashing', detail: 'log' },
      { kind: 'port', port: 5180, detail: 'log' },
      { kind: 'stopped', detail: 'log' },
    ];
    const views = screens.map((screen) => describeEngineScreen(screen));
    expect(views.map((view) => view.title)).toEqual([
      'Starting Shinsa',
      'Waiting for Shinsa',
      'Allow Shinsa to run in the background',
      'Shinsa’s engine keeps stopping',
      'Port 5180 is taken',
      'Shinsa’s engine is not running',
    ]);
    expect(views.map((view) => view.actions)).toEqual([
      [],
      [],
      ['open-login-items', 'retry'],
      ['restart', 'copy-details'],
      ['restart', 'copy-details'],
      ['restart', 'open-privacy', 'copy-details'],
    ]);
    expect(views.map((view) => view.busy)).toEqual([true, true, false, false, false, false]);
    expect(views[3]?.detail).toBe('log');
  });

  it('takes an action only from its own links', () => {
    for (const action of Object.keys(ENGINE_ACTION_LABEL))
      expect(parseEngineAction(`shinsa://engine/${action}`)).toBe(action as never);
    expect(parseEngineAction('shinsa://engine/format-disk')).toBeNull();
    expect(parseEngineAction('shinsa://task/SW-1')).toBeNull();
  });
});
